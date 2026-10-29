// ============================================================
// Мульти-БД: ленивая загрузка директории для конкретной стороны,
// чтение тела файла, список файлов в пути.
// ============================================================
//
// Модуль подключается ПОСЛЕ 35a-multi-db-core.js, т.к. использует
// FAR.side[side] / FAR.decryptString / FAR.normPath.
//
// ВАЖНО: раньше loadFilesForSide() тянул ВСЮ базу в s.fileIndex.
// Теперь это ленивая функция: подгружает ТОЛЬКО содержимое
// одной директории (по allDocs с startkey/endkey).

// ============================================================
// 1. Ленивая загрузка директории стороны
// ============================================================
//
// Загружает только непосредственных детей пути `path` в
// s.fileIndex (заменяя его). Для этого используется
// FAR.listDirFromSide(side, path) из 06-files.js.
//
// ВАЖНО: сигнатура сохранена (side, opts), чтобы не ломать
// существующие вызовы в 23-main.js / 10-connection-modal.js.
// Второй аргумент opts теперь может содержать { path, silent }.

FAR.loadFilesForSide = async function (side, opts) {
    opts = opts || {};
    const s = FAR.side[side];
    if (!s || !s.db) return [];

    const path = (opts.path !== undefined) ? opts.path : s.path;
    const norm = FAR.normPath(path);

    s.loading = true;
    if (!opts.silent) {
        FAR.setStatus('📥 Загрузка /' + norm + ' (' + side + ')…');
    }

    try {
        const items = await FAR.listDirFromSide(side, norm, { includeDocs: true });
        s.fileIndex = items;
        s.path = '/' + norm;
        s.loading = false;
        return items;
    } catch (e) {
        s.loading = false;
        if (!opts.silent) {
            console.error('loadFilesForSide(' + side + '):', e);
        }
        throw e;
    }
};

/**
 * Загружает директорию стороны, если путь изменился или кэш пуст.
 * Возвращает true, если что-то грузили.
 */
FAR.ensureDirLoaded = async function (side, path, opts) {
    opts = opts || {};
    const s = FAR.side[side];
    if (!s || !s.db) return false;

    const norm = FAR.normPath(path);
    const cur  = FAR.normPath(s.path);

    if (!opts.force && norm === cur && s.fileIndex && s.fileIndex.length >= 0 && s._loadedDir === norm) {
        return false;
    }

    await FAR.loadFilesForSide(side, { path: norm, silent: opts.silent });
    s._loadedDir = norm;
    return true;
};

/**
 * Полная перезагрузка панели: подтянуть директорию, отрисовать,
 * обновить статус/кнопки.
 */
FAR.reloadPanel = async function (side) {
    const s = FAR.side[side];
    if (!s || !s.db) return;

    await FAR.ensureDirLoaded(side, s.path, { force: true });
    FAR.renderPanel(side);
};

// ============================================================
// 2. Чтение тела файла из БД конкретной стороны
// ============================================================
//
// ВАЖНО: PouchDB.getAttachment может вернуть:
//   • Blob (если браузер поддерживает Blob и опция binary:true)
//   • ArrayBuffer
//   • base64-строку (если Blob недоступен или binary не передан)
// Поэтому раньше код падал на `blob.arrayBuffer is not a function`.
// Ниже — универсальный декодер.

/**
 * Приводит вложение, полученное из PouchDB, к Uint8Array.
 * @param {Blob|ArrayBuffer|string} att
 * @param {string} label — для сообщения об ошибке
 * @returns {Uint8Array}
 */
FAR._attachmentToBytes = function (att, label) {
    if (att == null) {
        throw new Error('Пустое вложение ' + (label || ''));
    }

    // 1. Blob
    if (typeof Blob !== 'undefined' && att instanceof Blob) {
        // Синхронно получить нельзя — эта ветка обрабатывается
        // в вызывающем коде через await att.arrayBuffer().
        throw new Error('_attachmentToBytes: Blob требует async-обработки');
    }

    // 2. ArrayBuffer
    if (att instanceof ArrayBuffer) {
        return new Uint8Array(att);
    }

    // 3. TypedArray / Buffer
    if (ArrayBuffer.isView(att)) {
        return new Uint8Array(att.buffer, att.byteOffset, att.byteLength);
    }

    // 4. base64-строка
    if (typeof att === 'string') {
        let bin;
        try {
            bin = atob(att);
        } catch (e) {
            throw new Error('Некорректная base64-строка вложения ' + (label || ''));
        }
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    throw new Error('Неизвестный тип вложения ' + (label || '') +
        ': ' + (att && att.constructor && att.constructor.name));
};

/**
 * Асинхронная обёртка: принимает результат getAttachment и
 * возвращает { bytes: Uint8Array, contentType: string }.
 */
FAR._attachmentToBytesAsync = async function (att, fallbackContentType) {
    if (att == null) {
        throw new Error('Пустое вложение');
    }

    // Blob — самый частый случай
    if (typeof Blob !== 'undefined' && att instanceof Blob) {
        const buf = await att.arrayBuffer();
        return {
            bytes: new Uint8Array(buf),
            contentType: att.type || fallbackContentType || 'application/octet-stream'
        };
    }

    // ArrayBuffer
    if (att instanceof ArrayBuffer) {
        return {
            bytes: new Uint8Array(att),
            contentType: fallbackContentType || 'application/octet-stream'
        };
    }

    // TypedArray / Buffer
    if (ArrayBuffer.isView(att)) {
        return {
            bytes: new Uint8Array(att.buffer, att.byteOffset, att.byteLength),
            contentType: fallbackContentType || 'application/octet-stream'
        };
    }

    // base64-строка
    if (typeof att === 'string') {
        let bin;
        try {
            bin = atob(att);
        } catch (e) {
            throw new Error('Некорректная base64-строка вложения');
        }
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return {
            bytes: out,
            contentType: fallbackContentType || 'application/octet-stream'
        };
    }

    throw new Error('Неизвестный тип вложения: ' +
        (att && att.constructor && att.constructor.name));
};

FAR.readFileBodyFromSide = async function (side, item) {
    const s = FAR.side[side];
    if (!s || !s.db) throw new Error('Нет БД для панели ' + side);

    const contentType = item.contentType || 'application/octet-stream';

    // Уточняет MIME:
    //   1. Если сервер вернул generic — пробуем определить по имени.
    //   2. Если это ROM-файл эмулятора — принудительно octet-stream.
    const finalize = function (bytes, ct) {
        let result = ct;

        // 1. Догадка по имени, если тип generic
        if (!result || result === 'application/octet-stream') {
            const guessed = FAR.guessMimeByName(item.name);
            if (guessed) result = guessed;
        }

        // 2. ROM-файлы — всегда octet-stream
        //    (Snes9x / другие ядра не должны видеть text/plain
        //    или application/x-snes-rom).
        if (typeof FAR.isEmulatorFile === 'function' && FAR.isEmulatorFile(item)) {
            result = 'application/octet-stream';
        }

        return { data: bytes, contentType: result || 'application/octet-stream' };
    };

    // 1. Основной путь: вложение 'b' в самом документе.
    try {
        const att = await s.db.getAttachment(item._id, 'b', { binary: true });
        const { bytes, contentType: ct } =
            await FAR._attachmentToBytesAsync(att, contentType);
        return finalize(bytes, ct);
    } catch (e) {
        if (e.status !== 404) throw e;
    }

    // 2. Fallback: открытые чанки (без шифрования).
    const doc = await s.db.get(item._id);
    const children = doc.children || item.children || [];

    if (children.length === 0) {
        throw new Error('Файл не содержит данных (нет вложения b и нет чанков)');
    }

    const chunks = [];
    for (const chunkId of children) {
        try {
            const att = await s.db.getAttachment(chunkId, 'b', { binary: true });
            const { bytes } = await FAR._attachmentToBytesAsync(att, contentType);
            chunks.push(bytes);
        } catch (e3) {
            if (e3.status !== 404) throw e3;
        }
    }

    if (chunks.length === 0) {
        throw new Error('Чанки найдены, но данные прочитать не удалось');
    }

    const total = chunks.reduce(function (sum, c) { return sum + c.length; }, 0);
    const data = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        data.set(c, off);
        off += c.length;
    }

    return finalize(data, contentType);
};

// ============================================================
// 3. Список файлов в пути для конкретной стороны
// ============================================================
//
// Синхронная функция: возвращает детей пути из УЖЕ ЗАГРУЖЕННОГО
// s.fileIndex. НЕ ходит в БД. Если s.fileIndex пуст — вернёт [].
//
// Правильный async-вариант: FAR.loadFilesForSide(side, {path}) +
// FAR.listFilesInPathForSide(side, path).

FAR.listFilesInPathForSide = function (side, path) {
    const ctx = FAR.side[side];
    if (!ctx) return [];

    const curPath = FAR.normPath(path);
    const prefix = curPath ? curPath + '/' : '';

    const folders = new Set();
    const files = [];

    for (const item of ctx.fileIndex) {
        if (item.docType !== 'folder') continue;
        const fp = FAR.normPath(item.path);
        if (!fp) continue;
        if (!curPath) {
            if (!fp.includes('/')) folders.add(fp);
        } else if (fp.startsWith(prefix)) {
            const rest = fp.substring(prefix.length);
            if (rest && !rest.includes('/')) folders.add(rest);
        }
    }

    for (const item of ctx.fileIndex) {
        if (item.docType !== 'file') continue;
        const fp = FAR.normPath(item.path);
        if (!fp) continue;
        if (fp.startsWith('[file] ')) continue;

        const lastSlash = fp.lastIndexOf('/');
        const parent = lastSlash === -1 ? '' : fp.substring(0, lastSlash);
        const name   = lastSlash === -1 ? fp : fp.substring(lastSlash + 1);

        if (parent === curPath) {
            files.push(Object.assign({}, item, { name: name, isFolder: false }));
        } else if (curPath === '' && parent !== '') {
            folders.add(parent.split('/')[0]);
        } else if (parent.startsWith(prefix)) {
            const rest = parent.substring(prefix.length);
            if (rest) folders.add(rest.split('/')[0]);
        }
    }

    return [
        ...Array.from(folders).sort().map(function (name) {
            return {
                isFolder: true, name: name,
                path: curPath ? curPath + '/' + name : name,
                size: 0, mtime: 0
            };
        }),
        ...files.sort(function (a, b) { return a.name.localeCompare(b.name); })
    ];
};

// ============================================================
// 4. Обратная совместимость
// ============================================================

FAR.listFilesInPath = function (path) {
    return FAR.listFilesInPathForSide(FAR.activePanel, path);
};