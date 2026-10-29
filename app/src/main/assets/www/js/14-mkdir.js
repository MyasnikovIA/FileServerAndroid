// ============================================================
// Создание папки в текущей директории активной панели.
// ============================================================

FAR.createFolder = async function() {
    if (!FAR.ensureDb()) return;

    const side = FAR.activePanel;
    const ctx = FAR.side[side];
    if (!ctx || !ctx.db) { FAR.toast('Панель не подключена', 'warning'); return; }

    const name = prompt('Имя папки:');
    if (!name || !name.trim()) return;
    const folderName = name.trim();

    const basePath = FAR.normPath(ctx.path);
    const folderPath = FAR.normPath(basePath === '' ? folderName : basePath + '/' + folderName);
    const docId = 'd:' + encodeURIComponent(folderPath);

    try {
        await ctx.db.put({
            _id: docId, type: 'folder', path: folderPath,
            name: folderName, mtime: Date.now()
        });
        FAR.toast(`Папка "${folderName}" создана`, 'success');
        await FAR.reloadPanel(side);
    } catch (e) {
        if (e.status === 409) FAR.toast('Папка уже существует', 'warning');
        else FAR.toast('Ошибка: ' + e.message, 'error');
    }
};