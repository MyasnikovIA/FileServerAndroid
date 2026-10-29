// ============================================================
// Загрузка файлов и папок в текущую директорию панели.
// ============================================================
//
// Каждый вызов uploadFilesToPath создаёт СВОЙ инстанс прогресса —
// параллельные загрузки не конфликтуют.
//
// ВАЖНО: файлы записываются ОДНИМ запросом PUT /api/write
// (FsClient.putAttachment). Атомарность: либо файл создан
// полностью, либо не создан вовсе.

FAR.uploadFilesToPath = async function(files, targetPath) {
    if (!FAR.ensureDb()) return { ok: 0, err: 0 };
    if (!files.length) return { ok: 0, err: 0 };

    const side = FAR.activePanel;
    const ctx = FAR.side[side];
    if (!ctx || !ctx.db) { FAR.toast('Панель не подключена', 'warning'); return { ok: 0, err: 0 }; }

    const baseTarget = FAR.normPath(targetPath);
    const targetName = baseTarget === '' ? 'корень' : baseTarget;

    const foldersToCreate = new Set();
    for (const f of files) {
        const rel = FAR.normPath(f.relativePath || '');
        if (!rel) continue;
        const parts = rel.split('/').filter(Boolean);
        let acc = '';
        for (const p of parts) { acc = acc ? acc + '/' + p : p; foldersToCreate.add(acc); }
    }

    const totalSteps = foldersToCreate.size + files.length;

    const prog = FAR.startProgress(
        '📤',
        `Загрузка ${files.length} файлов${foldersToCreate.size ? ` + ${foldersToCreate.size} папок` : ''} в "${targetName}"`,
        totalSteps,
        function() {}
    );

    await FAR._nextPaint();

    let ok = 0, err = 0, step = 0;

    // 1. Создание папок (сначала родительские — сортировка по длине пути)
    const sortedFolders = Array.from(foldersToCreate).sort((a, b) => a.length - b.length);
    for (const relFolder of sortedFolders) {
        if (prog.state.cancelled) break;
        step++;
        const fullPath = FAR.normPath(baseTarget === '' ? relFolder : baseTarget + '/' + relFolder);
        const docId = 'd:' + encodeURIComponent(fullPath);
        const folderName = relFolder.split('/').pop();
        prog.update(step - 1, totalSteps, `📁 ${fullPath}`, err);

        try {
            let rev = null;
            try { const existing = await ctx.db.get(docId); rev = existing._rev; }
            catch (e) { if (e.status !== 404) throw e; }
            const doc = { _id: docId, type: 'folder', path: fullPath, name: folderName, mtime: Date.now() };
            if (rev) doc._rev = rev;
            await ctx.db.put(doc);
            prog.log(`📁 ✅ ${fullPath}`, 'ok');
        } catch (e) {
            err++;
            prog.log(`📁 ❌ ${fullPath}: ${e.message}`, 'err');
        }
    }

    // 2. Загрузка файлов — одним запросом через putAttachment
    for (let i = 0; i < files.length; i++) {
        if (prog.state.cancelled) break;
        const f = files[i]; step++;
        const rel = FAR.normPath(f.relativePath || '');
        const parts = [];
        if (baseTarget) parts.push(baseTarget);
        if (rel) parts.push(rel);
        parts.push(f.name);
        const cleanPath = FAR.normPath(parts.filter(Boolean).join('/'));
        prog.update(step - 1, totalSteps, cleanPath, err);
        prog.log(`↑ ${cleanPath} (${FAR.formatSize(f.blob.size)})`, 'info');

        try {
            const contentType = f.contentType || f.blob.type || 'application/octet-stream';
            const docId = 'f:' + encodeURIComponent(cleanPath);
            await ctx.db.putAttachment(docId, 'b', null, f.blob, contentType);
            ok++;
            prog.log(`✅ ${cleanPath}`, 'ok');
        } catch (e) {
            err++;
            prog.log(`❌ ${f.name}: ${e.message}`, 'err');
        }
        prog.update(step, totalSteps, cleanPath, err);
    }

    prog.finish(err);
    prog.log(`━━━ Готово: ${ok} файлов, ${foldersToCreate.size} папок, ${err} ошибок`, ok > 0 ? 'ok' : 'err');

    await FAR.reloadPanel(side);
    FAR.setStatus(`✅ Загружено: ${ok} файлов, ${err} ошибок`);
    FAR.toast(`Загружено ${ok} файлов, ${err} ошибок`, ok ? 'success' : 'error');
    return { ok, err };
};

FAR.uploadFile = function() {
    if (!FAR.ensureDb()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async function(e) {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const side = FAR.activePanel;
        const ctx = FAR.side[side];
        const targetPath = ctx ? ctx.path : '/';
        const converted = files.map(function(f) {
            return {
                name: f.name, blob: f,
                contentType: f.type || 'application/octet-stream',
                relativePath: ''
            };
        });
        await FAR.uploadFilesToPath(converted, targetPath);
    };
    input.click();
};