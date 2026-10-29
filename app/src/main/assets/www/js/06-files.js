// ============================================================
// Работа с файлами: ленивая загрузка директорий, список файлов
// в пути, рекурсивный обход, чтение тела файла.
// ============================================================
//
// ВАЖНО (ленивая загрузка):
//   fileIndex панели — это кэш ТОЛЬКО текущей директории.
//   Полный список получается рекурсивным обходом (listRecursive).
//
// ФОРМАТ ID В БД (проверено вручную):
//   _id = 'd:' + encodeURIComponent(path)   для папок
//   _id = 'f:' + encodeURIComponent(path)   для файлов
//
// ДИАПАЗОНЫ allDocs:
//   startkey = 'd:' + encodeURIComponent(norm + '/')
//   endkey   = 'd:' + encodeURIComponent(norm + '/') + '\ufff0'
//
//   ВАЖНО: \ufff0 добавляется К УЖЕ ЗАКОДИРОВАННОЙ строке,
//   а не кодируется вместе с ней. Иначе CouchDB получит
//   многосимвольную строку '%EF%BF%B0' и диапазон сломается.
//
// ФОРМАТ ХРАНЕНИЯ ТЕЛА ФАЙЛА:
//   Современный формат — вложение 'b' в самом документе файла.
//   Устаревший формат (чанки) — массив ID дочерних документов
//   в поле children, каждый чанк хранится как вложение 'b'.
//   Данный модуль НЕ читает тела файлов напрямую — за это
//   отвечает FAR.readFileBodyFromSide в 35b-multi-db-load.js.
// ============================================================

// ============================================================
// 1. Разбор _id документа
// ============================================================

FAR._parseDocId = function (id) {
    if (typeof id !== 'string' || id.length < 2) return null;
    const prefix = id.substring(0, 2);
    if (prefix !== 'd:' && prefix !== 'f:') return null;
    let decoded;
    try { decoded = decodeURIComponent(id.substring(2)); }
    catch (e) { decoded = id.substring(2); }
    return {
        kind: prefix === 'd:' ? 'folder' : 'file',
        path: FAR.normPath(decoded)
    };
};

// ============================================================
// 2. Плоский список «дети пути» для одной БД (side-aware)
// ============================================================

FAR.listDirFromSide = async function (side, prefix, opts) {
    const s = FAR.side[side];
    if (!s || !s.db) return [];

    const norm = FAR.normPath(prefix);
    opts = opts || {};
    const includeDocs = opts.includeDocs !== false;

    const subPrefix = norm ? norm + '/' : '';
    const encBase = encodeURIComponent(subPrefix);
    const dStart = 'd:' + encBase;
    const dEnd   = 'd:' + encBase + '\ufff0';   // ← \ufff0 ДОБАВЛЯЕТСЯ к закодированной строке
    const fStart = 'f:' + encBase;
    const fEnd   = 'f:' + encBase + '\ufff0';

    const [foldersRes, filesRes] = await Promise.all([
        s.db.allDocs({ startkey: dStart, endkey: dEnd, include_docs: includeDocs }),
        s.db.allDocs({ startkey: fStart, endkey: fEnd, include_docs: includeDocs })
    ]);

    // --- Папки: только непосредственные дети ---
    const folders = [];
    for (const row of foldersRes.rows) {
        const parsed = FAR._parseDocId(row.id);
        if (!parsed || parsed.kind !== 'folder') continue;
        const rest = norm ? parsed.path.substring(norm.length + 1) : parsed.path;
        if (!rest || rest.includes('/')) continue;
        const doc = row.doc || {};
        folders.push({
            _id: row.id,
            path: parsed.path,
            name: rest,
            isFolder: true,
            size: 0,
            mtime: doc.mtime || 0,
            docType: 'folder',
            children: []
        });
    }

    // --- Файлы: только непосредственные дети ---
    const files = [];
    for (const row of filesRes.rows) {
        const parsed = FAR._parseDocId(row.id);
        if (!parsed || parsed.kind !== 'file') continue;
        const rest = norm ? parsed.path.substring(norm.length + 1) : parsed.path;
        if (!rest || rest.includes('/')) continue;
        const doc = row.doc || {};
        files.push({
            _id: row.id,
            path: parsed.path,
            name: rest,
            isFolder: false,
            size: doc.size || 0,
            mtime: doc.mtime || 0,
            binary: doc.binary || false,
            contentType: doc.contentType || '',
            children: doc.children || [],
            docType: 'file'
        });
    }

    folders.sort(function (a, b) { return a.name.localeCompare(b.name); });
    files.sort(function (a, b) { return a.name.localeCompare(b.name); });

    return folders.concat(files);
};

// ============================================================
// 3. Рекурсивный обход директории для одной БД
// ============================================================

FAR.listRecursiveFromSide = async function (side, prefix, opts) {
    const s = FAR.side[side];
    if (!s || !s.db) return [];

    opts = opts || {};
    const norm = FAR.normPath(prefix);

    const subPrefix = norm ? norm + '/' : '';
    const encBase = encodeURIComponent(subPrefix);
    const dStart = 'd:' + encBase;
    const dEnd   = 'd:' + encBase + '\ufff0';
    const fStart = 'f:' + encBase;
    const fEnd   = 'f:' + encBase + '\ufff0';

    const [dRes, fRes] = await Promise.all([
        s.db.allDocs({ startkey: dStart, endkey: dEnd, include_docs: true, recursive: true }),
        s.db.allDocs({ startkey: fStart, endkey: fEnd, include_docs: true, recursive: true })
    ]);

    const out = [];
    for (const row of dRes.rows) {
        const p = FAR._parseDocId(row.id);
        if (!p) continue;
        const doc = row.doc || {};
        out.push({
            _id: row.id, path: p.path, name: p.path.split('/').pop(),
            isFolder: true, size: 0, mtime: doc.mtime || 0,
            docType: 'folder', children: []
        });
    }
    for (const row of fRes.rows) {
        const p = FAR._parseDocId(row.id);
        if (!p) continue;
        const doc = row.doc || {};
        out.push({
            _id: row.id, path: p.path, name: p.path.split('/').pop(),
            isFolder: false, size: doc.size || 0, mtime: doc.mtime || 0,
            binary: doc.binary || false, contentType: doc.contentType || '',
            children: doc.children || [], docType: 'file'
        });
    }
    return out;
};

// ============================================================
// 4. Чтение тела файла (активная панель — обратная совместимость)
// ============================================================
//
// Реальная реализация — в 35b-multi-db-load.js
// (FAR.readFileBodyFromSide). Здесь только алиас для старого
// кода, который вызывает FAR.readFileBody(item) без side.

FAR.readFileBody = function (item) {
    return FAR.readFileBodyFromSide(FAR.activePanel, item);
};

// ============================================================
// 5. Совместимость: FAR.loadFiles() / FAR.refreshFiles()
// ============================================================

FAR.loadFiles = async function () {
    const side = FAR.activePanel;
    await FAR.loadFilesForSide(side);
};

FAR.refreshFiles = function () {
    const side = FAR.activePanel;
    return FAR.reloadPanel(side).then(function () {
        FAR.renderPanel('left');
        FAR.renderPanel('right');
    });
};

// ============================================================
// 6. Утилита: пересчёт размера/кол-ва для статус-бара
// ============================================================

FAR.getTotalSize = function () {
    let total = 0, files = 0, folders = 0;
    ['left', 'right'].forEach(function (s) {
        const ctx = FAR.side[s];
        if (!ctx) return;
        for (const f of ctx.fileIndex) {
            if (f.docType === 'file')   { total += (f.size || 0); files++; }
            if (f.docType === 'folder') { folders++; }
        }
    });
    return { total, files, folders };
};

FAR.updateTotalSize = function () {
    const { total, files, folders } = FAR.getTotalSize();
    const el = document.getElementById('totalSize');
    if (el) el.textContent = `💾 Видно: ${FAR.formatSize(total)} • файлов: ${files} • папок: ${folders}`;
};

// ============================================================
// 7. Совместимость: listFilesInPath (активная панель)
// ============================================================

FAR.listFilesInPath = function (path) {
    return FAR.listFilesInPathForSide(FAR.activePanel, path);
};