// ============================================================
// Модалка подключения к FileServer (глобально или для панели).
// ============================================================

FAR.connModalSide = null;

FAR.openConnModal = function (required, side) {
    FAR.connModalRequired = !!required;
    FAR.connModalSide = side || null;

    const modal = document.getElementById('connModal');
    const def = FAR.getConnDefaultsForSide(FAR.connModalSide);

    document.getElementById('connUrl').value  = def.url  || '';
    document.getElementById('connUser').value = def.user || '';
    document.getElementById('connPass').value = def.pass || '';
    document.getElementById('connError').textContent = '';
    document.getElementById('connConnectBtn').disabled = false;
    document.getElementById('connConnectBtn').textContent = 'Подключиться';
    document.getElementById('connCloseBtn').style.display  = required ? 'none' : '';
    document.getElementById('connCancelBtn').style.display = required ? 'none' : '';

    // Режим работы — только для глобального подключения
    const modeRow = document.getElementById('connUiModeRow');
    const modeSel = document.getElementById('connUiMode');
    if (modeRow && modeSel) {
        if (FAR.connModalSide) {
            modeRow.style.display = 'none';
        } else {
            modeRow.style.display = '';
            let saved = 'panel';
            if (typeof FAR.WM !== 'undefined' && typeof FAR.WM.getSavedMode === 'function') {
                saved = FAR.WM.getSavedMode();
            }
            modeSel.value = saved;
        }
    }

    const titleEl = document.getElementById('connTitle');
    const tgtEl = document.getElementById('connTarget');
    const tgtNameEl = document.getElementById('connTargetName');
    if (FAR.connModalSide) {
        if (titleEl) titleEl.textContent = '🔐 Подключение панели';
        if (tgtEl) tgtEl.style.display = '';
        if (tgtNameEl) tgtNameEl.textContent =
            FAR.connModalSide === 'left' ? 'Левая' : 'Правая';
    } else {
        if (titleEl) titleEl.textContent = '🔐 Подключение к FileServer';
        if (tgtEl) tgtEl.style.display = 'none';
    }

    modal.classList.remove('hidden');
    setTimeout(function () { document.getElementById('connUrl').focus(); }, 50);
};

FAR.closeConnModal = function () {
    if (FAR.connModalRequired) return;
    document.getElementById('connModal').classList.add('hidden');
};

FAR.submitConnModal = async function () {
    const url  = document.getElementById('connUrl').value.trim();
    const user = document.getElementById('connUser').value.trim();
    const pass = document.getElementById('connPass').value;

    let uiMode = 'panel';
    if (!FAR.connModalSide) {
        const modeSel = document.getElementById('connUiMode');
        if (modeSel) uiMode = modeSel.value || 'panel';
    }

    const errEl = document.getElementById('connError');
    errEl.textContent = '';

    if (!url) { errEl.textContent = 'Укажите адрес FileServer'; return; }

    const cfg = { url: url, user: user, pass: pass };
    const btn = document.getElementById('connConnectBtn');
    btn.disabled = true;
    btn.textContent = 'Подключение…';

    try {
        const res = await FAR.connectToDb(cfg);

        if (FAR.connModalSide) {
            FAR.applyConnectionToSide(FAR.connModalSide, cfg, res.db, res.fullUrl);
            FAR.saveSideConnToLS(FAR.connModalSide, cfg);
        } else {
            FAR.applyConnectionToBoth(cfg, res.db, res.fullUrl);
            FAR.saveConnToLS(cfg);
        }

        FAR.updateAuthUI();
        FAR.connModalRequired = false;
        document.getElementById('connModal').classList.add('hidden');

        FAR.setStatus('✅ Подключено: ' + res.fullUrl);
        FAR.toast('Подключение установлено', 'success');

        if (FAR.connModalSide) {
            await FAR.loadFilesForSide(FAR.connModalSide, { path: '/', silent: true });
            FAR.renderPanel(FAR.connModalSide, { skipLoad: true });
        } else {
            await FAR.loadFilesForSide('left',  { path: '/', silent: true });
            await FAR.loadFilesForSide('right', { path: '/', silent: true });
            FAR.renderPanel('left',  { skipLoad: true });
            FAR.renderPanel('right', { skipLoad: true });
        }
        FAR.updateConnIndicators();

        if (!FAR.connModalSide && typeof FAR.WM !== 'undefined') {
            if (typeof FAR.WM.saveMode === 'function') FAR.WM.saveMode(uiMode);
            if (uiMode === 'wm') {
                if (!FAR.WM.state.active) FAR.WM.enter();
            } else {
                if (FAR.WM.state.active) FAR.WM.exit();
            }
        }
    } catch (e) {
        console.error('connect error:', e);
        let msg = e && e.message ? e.message : String(e);
        if (e && e.status === 401) msg = 'Неверный логин или пароль (401)';
        if (e && e.status === 404) msg = 'Не найдено (404). Проверьте адрес.';
        if (e && e.name === 'TypeError') msg = 'Не удалось подключиться (сеть/CORS).';
        errEl.textContent = '❌ ' + msg;
        btn.disabled = false;
        btn.textContent = 'Подключиться';
    }
};