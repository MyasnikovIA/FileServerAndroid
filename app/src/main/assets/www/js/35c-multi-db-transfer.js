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

/**
 * Универсальный перенос/копирование между двумя контекстами БД.
 */
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

    for (let i = 0; i < items.length; i++) {
        if (prog.state.cancelled) break;
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
            prog.log('✅ ' + dstPath, 'ok');
        } catch (e) {
            err++;
            prog.log('❌ ' + srcPath + ': ' + e.message, 'err');
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

            // Рекурсивный обход
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

    // 1. Папки
    for (const f of uniqueFolders) {
        if (prog.state.cancelled) break;
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
            prog.log('✅ ' + f.dstPath, 'ok');
        } catch (e) {
            err++;
            prog.log('❌ ' + f.dstPath + ': ' + e.message, 'err');
        }
        prog.update(step, totalSteps, '📁 ' + f.dstPath, err);
    }

    // 2. Файлы
    for (let i = 0; i < fileTasks.length; i++) {
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
                const total = chunks.reduce(function (sum, c) { return sum + (c.size || 0); }, 0);
                const data = new Uint8Array(total);
                let off = 0;
                for (const c of chunks) {
                    const arr = new Uint8Array(await c.arrayBuffer());
                    data.set(arr, off);
                    off += arr.length;
                }
                att = new Blob([data], { type: ct });
            }

            const blob = att instanceof Blob ? att : new Blob([att], { type: ct });
            const newId = 'f:' + encodeURIComponent(t.dstPath);
            await sDst.db.putAttachment(newId, 'b', null, blob, ct);

            if (mode === 'move') srcItemsToRemove.push(t.srcItem._id);
            ok++;
            prog.log('✅ ' + t.dstPath, 'ok');
        } catch (e) {
            err++;
            prog.log('❌ ' + t.dstPath + ': ' + e.message, 'err');
        }
        prog.update(step, totalSteps, t.dstPath, err);
    }

    // 3. Удаление из источника
    if (mode === 'move' && !prog.state.cancelled && srcItemsToRemove.length > 0) {
        prog.log('🗑️ Удаление из источника: ' + srcItemsToRemove.length + ' док.', 'info');
        for (const srcId of srcItemsToRemove) {
            try {
                const doc = await sSrc.db.get(srcId);
                await sSrc.db.remove(doc);
            } catch (e) {
                err++;
                prog.log('⚠️ не удалён ' + srcId + ': ' + e.message, 'warn');
            }
        }
        const folderIdsToRemove = items
            .filter(function (item) { return item.isFolder; })
            .map(function (item) { return item._id; });
        folderIdsToRemove.sort(function (a, b) { return b.length - a.length; });
        for (const fid of folderIdsToRemove) {
            try { const doc = await sSrc.db.get(fid); await sSrc.db.remove(doc); }
            catch (e) {}
        }
    }

    prog.finish(err);
    FAR.toast(actionLabel + ' ' + ok + ' из ' + totalSteps, ok ? 'success' : 'error');
};