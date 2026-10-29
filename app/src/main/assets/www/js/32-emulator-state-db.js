// ============================================================
// Сохранение/загрузка состояний эмулятора EmulatorJS в FileBD
// ============================================================

FAR.EMU_STATE_SAVE_DIR = '.saves';

FAR._emuStatePathForRom = function (romPath) {
    const p = FAR.normPath(romPath);
    if (!p) return '';

    const lastSlash = p.lastIndexOf('/');
    const dir  = lastSlash === -1 ? '' : p.substring(0, lastSlash);
    const file = lastSlash === -1 ? p : p.substring(lastSlash + 1);
    const base = file.replace(/\.[^/.]+$/, '');

    const parts = [];
    if (dir) parts.push(dir);
    parts.push(FAR.EMU_STATE_SAVE_DIR);
    parts.push(base + '.state');

    return parts.join('/');
};

FAR._emuStateSaveToDb = async function (statePath, bytes) {
    if (!FAR.db) throw new Error('Нет подключения к БД');
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);

    const docId = 'f:' + encodeURIComponent(statePath);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });

    let rev = null;
    try {
        const ex = await FAR.db.get(docId);
        rev = ex._rev;
    } catch (e) {
        if (e.status !== 404) throw e;
    }

    const doc = {
        _id: docId,
        type: 'file',
        path: statePath,
        name: statePath.split('/').pop(),
        size: bytes.length,
        mtime: Date.now(),
        binary: true,
        contentType: 'application/octet-stream'
    };
    if (rev) doc._rev = rev;
    await FAR.db.put(doc);

    const fresh = await FAR.db.get(docId);
    await FAR.db.putAttachment(docId, 'b', fresh._rev, blob, 'application/octet-stream');

    const existing = FAR.fileIndex.find(f => f._id === docId);
    if (existing) {
        existing.size = bytes.length;
        existing.mtime = doc.mtime;
        existing.path = statePath;
    } else {
        FAR.fileIndex.push({
            _id: docId,
            path: statePath,
            size: bytes.length,
            mtime: doc.mtime,
            binary: true,
            children: [],
            contentType: 'application/octet-stream',
            docType: 'file'
        });
    }
};

FAR._emuStateLoadFromDb = async function (statePath) {
    if (!FAR.db) throw new Error('Нет подключения к БД');
    const docId = 'f:' + encodeURIComponent(statePath);

    let doc;
    try {
        doc = await FAR.db.get(docId);
    } catch (e) {
        if (e.status === 404) return null;
        throw e;
    }

    try {
        const blob = await FAR.db.getAttachment(docId, 'b');
        return new Uint8Array(await blob.arrayBuffer());
    } catch (e) { /* fallthrough */ }

    const item = FAR.fileIndex.find(f => f._id === docId) || doc;
    try {
        const res = await FAR.readFileBody(item);
        return res.data;
    } catch (e) {
        throw new Error('Не удалось прочитать .state: ' + e.message);
    }
};

/**
 * Сохранение состояния эмулятора. Использует свой инстанс прогресса.
 */
FAR._emuStateOnSave = async function (data) {
    if (!FAR.db || !FAR._emulatorCurrentItem) return 0;

    const romPath = FAR._emulatorCurrentItem.path;
    const statePath = FAR._emuStatePathForRom(romPath);

    const bytes = data && data.state ? new Uint8Array(data.state) : null;
    if (!bytes || !bytes.length) {
        FAR.toast('Пустое состояние, сохранение отменено', 'error');
        return 1;
    }

    const prog = FAR.startProgress('💾', 'Сохранение состояния в БД', 1, null);
    prog.log(`ROM: ${romPath}`, 'info');
    prog.log(`State: ${statePath} (${FAR.formatSize(bytes.length)})`, 'info');

    try {
        await FAR._emuStateSaveToDb(statePath, bytes);
        prog.log('✅ Состояние записано в FileBD', 'ok');
        prog.update(1, 1, statePath, 0);
        prog.finish(0);
        FAR.setStatus('✅ Состояние сохранено: ' + statePath);
        FAR.toast('Состояние сохранено в БД', 'success');
    } catch (e) {
        console.error('EJS_onSaveState:', e);
        prog.log('❌ ' + e.message, 'err');
        prog.finish(1);
        FAR.toast('Ошибка сохранения состояния: ' + e.message, 'error');
    }

    return 1;
};

FAR._emuStateOnLoad = async function () {
    if (!FAR.db || !FAR._emulatorCurrentItem) return 0;

    const romPath = FAR._emulatorCurrentItem.path;
    const statePath = FAR._emuStatePathForRom(romPath);

    let bytes = null;
    try {
        bytes = await FAR._emuStateLoadFromDb(statePath);
    } catch (e) {
        console.error('EJS_onLoadState:', e);
        FAR.toast('Ошибка чтения состояния: ' + e.message, 'error');
        return 1;
    }

    if (!bytes || !bytes.length) {
        FAR.toast('Сохранение не найдено: ' + statePath, 'warning');
        FAR.setStatus('⚠️ Файл состояния не найден');
        return 1;
    }

    try {
        if (window.EJS_emulator && window.EJS_emulator.gameManager) {
            window.EJS_emulator.gameManager.loadState(bytes);
            FAR.toast('Состояние загружено из БД', 'success');
            FAR.setStatus('✅ Состояние загружено: ' + statePath);
        } else {
            FAR.toast('Эмулятор ещё не готов', 'warning');
        }
    } catch (e) {
        console.error('loadState:', e);
        FAR.toast('Ошибка применения состояния: ' + e.message, 'error');
    }

    return 1;
};

FAR._installEmulatorStateHooks = function () {
    if (window._farEmuStateHooksInstalled) return;
    window._farEmuStateHooksInstalled = true;

    window.EJS_onSaveState = FAR._emuStateOnSave;
    window.EJS_onLoadState = FAR._emuStateOnLoad;

    const attachNow = function () {
        if (!window.EJS_emulator) return false;
        if (window.EJS_emulator._farStateHooksAttached) return true;
        try {
            window.EJS_emulator.on('saveState', FAR._emuStateOnSave);
            window.EJS_emulator.on('loadState', FAR._emuStateOnLoad);
            window.EJS_emulator._farStateHooksAttached = true;
            console.log('[EmuState] хуки привязаны напрямую к EJS_emulator');
            return true;
        } catch (e) {
            console.warn('[EmuState] attach failed:', e);
            return false;
        }
    };

    if (attachNow()) return;

    let tries = 0;
    const iv = setInterval(function () {
        tries++;
        if (attachNow() || tries > 50) {
            clearInterval(iv);
        }
    }, 100);
};