// ============================================================
// 35c-multi-db-transfer.js
// ============================================================

FAR.transferBetweenSides = async function (mode) {
    const src = FAR.activePanel;
    const dst = src === 'left' ? 'right' : 'left';
    const sSrc = FAR.side[src];
    const sDst = FAR.side[dst];

    if (!sSrc.db) { FAR.toast('Исходная панель не подключена', 'warning'); return; }
    if (!sDst.db) { FAR.toast('Целевая панель не подключена', 'warning'); return; }

    const selected = FAR.getSelectedItemsFromActivePanel();
    if (selected.length === 0) { FAR.toast('Ничего не выбрано', 'warning'); return; }

    const items = selected.map(function(s) { return s.item; });

    return FAR.transferBetweenContexts(sSrc, sDst, items, sDst.path, mode);
};

FAR.transferBetweenContexts = async function (sSrc, sDst, items, targetPath, mode) {
    if (!sSrc || !sSrc.db) { FAR.toast('Источник не подключён', 'warning'); return; }
    if (!sDst || !sDst.db) { FAR.toast('Цель не подключена', 'warning'); return; }

    const sameServer = (sSrc.db.baseUrl && sDst.db.baseUrl &&
        sSrc.db.baseUrl === sDst.db.baseUrl);

    if (sameServer) {
        return FAR._transferCtxViaServerApi(mode, items, sSrc, sDst, targetPath);
    }
    return FAR._transferCtxViaClient(mode, items, sSrc, sDst, targetPath);
};

// ============================================================
// Быстрый путь: серверный /api/copy | /api/move (один сервер)
// ============================================================
FAR._transferCtxViaServerApi = async function (mode, items, sSrc, sDst, targetPath) {
    const actionLabel = mode === 'move' ? 'Перенос' : 'Копирование';
    const endpoint = mode === 'move' ? '/api/move' : '/api/copy';

    const prog = FAR.startProgress(
        mode === 'move' ? '✂️' : '📋',
        actionLabel + ': ' + items.length + ' элем. (сервер)',
        items.length,
        function () {}
    );

    await FAR._nextPaint();
    let ok = 0, err = 0;

    // Circuit breaker: 3 подряд "share not available" — стоп
    let fatalCount = 0;
    const MAX_FATAL = 3;
    let aborted = false;

    for (let i = 0; i < items.length; i++) {
        if (prog.state.cancelled || aborted) break;
        const item = items[i];
        const srcPath = FAR.normPath(item.path);
        const itemName = item.name || srcPath.split('/').pop();
        const dstPath = FAR.normPath(
            targetPath ? targetPath + '/' + itemName : itemName
        );

        prog.update(i, items.length, srcPath, err);
        prog.log((mode === 'move' ? '✂️ ' : '📋 ') + srcPath, 'info');

        try {
            const url = sDst.db._url(endpoint, { from: srcPath, to: dstPath });
            const res = await sDst.db._fetch(url, { method: 'POST' });
            if (!res.ok) {
                const msg = await FAR.FsClient._errorFromResponse(res);
                const e = new Error(msg);
                e.status = res.status;
                throw e;
            }
            ok++;
            fatalCount = 0;
            prog.log('✅ ' + dstPath, 'ok');
        } catch (e) {
            err++;
            prog.log('❌ ' + srcPath + ': ' + e.message, 'err');

            if (FAR._transferIsFatalError(e)) {
                fatalCount++;
                if (fatalCount >= MAX_FATAL) {
                    prog.log('⛔ Прерываю: цель недоступна (' + e.message + '). ' +
                        'Проверьте/перемонтируйте диск и повторите.', 'err');
                    aborted = true;
                    break;
                }
            } else {
                fatalCount = 0;
            }
        }
        prog.update(i + 1, items.length, srcPath, err);
    }

    prog.finish(err);
    FAR.toast(actionLabel + ' ' + ok + ' из ' + items.length, ok ? 'success' : 'error');
};

// ============================================================
// Медленный путь: разные серверы — read + write через клиент
// ============================================================
FAR._transferCtxViaClient = async function (mode, items, sSrc, sDst, targetPath) {
    const folderTasks = [];
    const fileTasks = [];
    const srcItemsToRemove = [];

    for (const item of items) {
        if (item.isFolder) {
            const srcFolderPath = FAR.normPath(item.path);
            const folderName = item.name || srcFolderPath.split('/').pop();
            const dstFolderPath = FAR.normPath(
                targetPath ? targetPath + '/' + folderName : folderName
            );
            folderTasks.push({ srcPath: srcFolderPath, dstPath: dstFolderPath });

            const subPrefix = srcFolderPath ? srcFolderPath + '/' : '';
            const encBase = encodeURIComponent(subPrefix);
            const dStart = 'd:' + encBase;
            const dEnd   = 'd:' + encBase + '\ufff0';
            const fStart = 'f:' + encBase;
            const fEnd   = 'f:' + encBase + '\ufff0';

            try {
                const [dRes, fRes] = await Promise.all([
                    sSrc.db.allDocs({ startkey: dStart, endkey: dEnd, include_docs: true, recursive: true }),
                    sSrc.db.allDocs({ startkey: fStart, endkey: fEnd, include_docs: true, recursive: true })
                ]);

                for (const row of dRes.rows) {
                    const p = FAR._parseDocId(row.id);
                    if (!p) continue;
                    const rel = p.path.substring(srcFolderPath.length + 1);
                    if (!rel) continue;
                    const dstPath = FAR.normPath(dstFolderPath + '/' + rel);
                    folderTasks.push({ srcPath: p.path, dstPath: dstPath });
                }
                for (const row of fRes.rows) {
                    const p = FAR._parseDocId(row.id);
                    if (!p) continue;
                    const rel = p.path.substring(srcFolderPath.length + 1);
                    if (!rel) continue;
                    const dstPath = FAR.normPath(dstFolderPath + '/' + rel);
                    fileTasks.push({ srcItem: row.doc, srcPath: p.path, dstPath: dstPath });
                }
            } catch (e) {
                console.warn('Failed to list dir:', srcFolderPath, e);
            }
        } else {
            const fileName = item.name;
            const dstPath = FAR.normPath(
                targetPath ? targetPath + '/' + fileName : fileName
            );
            fileTasks.push({ srcItem: item, srcPath: FAR.normPath(item.path), dstPath: dstPath });
        }
    }

    const folderSeen = new Set();
    const uniqueFolders = [];
    for (const f of folderTasks) {
        if (folderSeen.has(f.dstPath)) continue;
        folderSeen.add(f.dstPath);
        uniqueFolders.push(f);
    }
    uniqueFolders.sort(function (a, b) { return a.dstPath.length - b.dstPath.length; });

    const totalSteps = uniqueFolders.length + fileTasks.length;
    const actionLabel = mode === 'move' ? 'Перенос' : 'Копирование';

    const prog = FAR.startProgress(
        mode === 'move' ? '✂️' : '📋',
        actionLabel + ': ' + items.length + ' элем. (разные серверы)',
        totalSteps,
        function () {}
    );

    await FAR._nextPaint();
    let ok = 0, err = 0, step = 0;

    // ════════════════════════════════════════════════════════
    // Circuit breaker: если share сломан — не молотим сотни
    // файлов, а останавливаемся после 3 фатальных ошибок подряд.
    // ════════════════════════════════════════════════════════
    let fatalCount = 0;
    const MAX_FATAL = 3;
    let aborted = false;

    // 1. Папки
    for (const f of uniqueFolders) {
        if (prog.state.cancelled || aborted) break;
        step++;
        prog.update(step - 1, totalSteps, '📁 ' + f.dstPath, err);

        try {
            const docId = 'd:' + encodeURIComponent(f.dstPath);
            const folderName = f.dstPath.split('/').pop();
            let rev = null;
            try { const existing = await sDst.db.get(docId); rev = existing._rev; }
            catch (e) { if (e.status !== 404) throw e; }
            const doc = { _id: docId, type: 'folder', path: f.dstPath, name: folderName, mtime: Date.now() };
            if (rev) doc._rev = rev;
            await sDst.db.put(doc);
            ok++;
            fatalCount = 0;
            prog.log('✅ ' + f.dstPath, 'ok');
        } catch (e) {
            err++;
            prog.log('❌ ' + f.dstPath + ': ' + e.message, 'err');

            if (FAR._transferIsFatalError(e)) {
                fatalCount++;
                if (fatalCount >= MAX_FATAL) {
                    prog.log('⛔ Прерываю: share-приёмник недоступен. ' +
                        'Проверьте, вставлена ли SD-карта и совпадает ли путь в config.json.', 'err');
                    aborted = true;
                    break;
                }
            } else {
                fatalCount = 0;
            }
        }
        prog.update(step, totalSteps, '📁 ' + f.dstPath, err);
    }

    // 2. Файлы
    for (let i = 0; i < fileTasks.length && !aborted; i++) {
        if (prog.state.cancelled) break;
        const t = fileTasks[i];
        step++;
        prog.update(step - 1, totalSteps, t.dstPath, err);
        prog.log((mode === 'move' ? '✂️ ' : '📋 ') + t.dstPath, 'info');

        try {
            let att, ct;
            try {
                att = await sSrc.db.getAttachment(t.srcItem._id, 'b', { binary: true });
                ct = t.srcItem.contentType || 'application/octet-stream';
            } catch (e) {
                if (e.status !== 404) throw e;
                const doc = await sSrc.db.get(t.srcItem._id);
                const children = doc.children || t.srcItem.children || [];
                if (children.length === 0) throw new Error('Нет данных файла');

                const chunks = [];
                for (const chunkId of children) {
                    try {
                        const cAtt = await sSrc.db.getAttachment(chunkId, 'b', { binary: true });
                        chunks.push(cAtt);
                    } catch (e3) {}
                }
                if (chunks.length === 0) throw new Error('Не удалось прочитать чанки');

                // chunks — массив Blob'ов. Склеиваем в один Blob.
                att = new Blob(chunks, { type: t.srcItem.contentType || 'application/octet-stream' });
                ct = t.srcItem.contentType || 'application/octet-stream';
            }

            const dstDocId = 'f:' + encodeURIComponent(t.dstPath);
            await sDst.db.putAttachment(dstDocId, 'b', null, att, ct);

            if (mode === 'move') {
                srcItemsToRemove.push({
                    _id: t.srcItem._id,
                    path: t.srcPath
                });
            }

            ok++;
            fatalCount = 0;
            prog.log('✅ ' + t.dstPath, 'ok');
        } catch (e) {
            err++;
            prog.log('❌ ' + t.dstPath + ': ' + e.message, 'err');

            if (FAR._transferIsFatalError(e)) {
                fatalCount++;
                if (fatalCount >= MAX_FATAL) {
                    prog.log('⛔ Прерываю: цель недоступна. Проверьте/перемонтируйте диск.', 'err');
                    aborted = true;
                    break;
                }
            } else {
                fatalCount = 0;
            }
        }
        prog.update(step, totalSteps, t.dstPath, err);
    }

    // 3. Удаление исходников (только для move mode, если не было фатальных ошибок)
    if (mode === 'move' && !aborted && !prog.state.cancelled && ok > 0) {
        prog.log('✂️ Удаление исходных файлов...', 'info');
        const removedIds = new Set();

        for (const src of srcItemsToRemove) {
            if (removedIds.has(src._id)) continue;
            removedIds.add(src._id);
            try {
                await sSrc.db.remove(src._id);
            } catch (e) {
                console.warn('[move] remove file failed:', src.path, e);
            }
        }

        // Удаляем верхнеуровневые исходные папки (сервер удалит рекурсивно)
        for (const item of items) {
            if (!item.isFolder) continue;
            const itemId = 'd:' + encodeURIComponent(FAR.normPath(item.path));
            if (removedIds.has(itemId)) continue;
            removedIds.add(itemId);
            try {
                await sSrc.db.remove(itemId);
            } catch (e) {
                console.warn('[move] remove folder failed:', item.path, e);
            }
        }
    }

    prog.finish(err);
    FAR.toast(
        actionLabel + ': ' + ok + ' из ' + (uniqueFolders.length + fileTasks.length),
        ok > 0 ? 'success' : 'error'
    );
};

// ============================================================
// Хелпер: детектор "фатальных" ошибок переноса
// ============================================================
//
// Такие ошибки означают, что проблема не в отдельном файле,
// а в доступности share-приёмника. После 3 подряд — прерываемся.
FAR._transferIsFatalError = function (e) {
    if (!e) return false;
    if (e.status === 404) return true;  // share/file not found
    if (e.status === 507) return true;  // quota exceeded
    if (e.status === 403) return true;  // access denied

    const msg = String(e.message || '').toLowerCase();
    return (
        msg.includes('failed to fetch') ||
        msg.includes('not available') ||
        msg.includes('not found') ||
        msg.includes('no such') ||
        msg.includes('share ') ||
        msg.includes('invalid argument') ||
        msg.includes('einval') ||
        msg.includes('quota exceeded') ||
        msg.includes('access denied') ||
        msg.includes('forbidden')
    );
};