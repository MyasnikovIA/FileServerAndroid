// ============================================================
// Модалка подключения к FileServer.
// ============================================================

FAR.connModalSide = null;

FAR.openConnModal = function (required, side) {
    FAR.connModalRequired = !!required;
    FAR.connModalSide = side || null;

    const modal = document.getElementById('connModal');
    if (!modal) {
        console.error('[openConnModal] #connModal не вставлен в DOM');
        return;
    }

    const def = FAR.getConnDefaultsForSide(FAR.connModalSide);

    const urlEl  = document.getElementById('connUrl');
    const userEl = document.getElementById('connUser');
    const passEl = document.getElementById('connPass');
    const errEl  = document.getElementById('connError');
    const connectBtn = document.getElementById('connConnectBtn');
    const closeBtn   = document.getElementById('connCloseBtn');
    const cancelBtn  = document.getElementById('connCancelBtn');

    if (urlEl)  urlEl.value  = def.url  || '';
    if (userEl) userEl.value = def.user || '';
    if (passEl) passEl.value = def.pass || '';
    if (errEl)  errEl.textContent = '';
    if (connectBtn) {
        connectBtn.disabled = false;
        connectBtn.textContent = 'Подключиться';
    }
    if (closeBtn)  closeBtn.style.display  = required ? 'none' : '';
    if (cancelBtn) cancelBtn.style.display = required ? 'none' : '';

    const titleEl   = document.getElementById('connTitle');
    const tgtEl     = document.getElementById('connTarget');
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
    setTimeout(function () { if (urlEl) urlEl.focus(); }, 50);
};

FAR.closeConnModal = function () {
    if (FAR.connModalRequired) return;
    const modal = document.getElementById('connModal');
    if (modal) modal.classList.add('hidden');
};

FAR.submitConnModal = async function () {
    const urlEl = document.getElementById('connUrl');
    if (!urlEl) return;
    const url  = urlEl.value.trim();
    const user = (document.getElementById('connUser') || {}).value || '';
    const pass = (document.getElementById('connPass') || {}).value || '';

    const errEl = document.getElementById('connError');
    if (errEl) errEl.textContent = '';

    if (!url) {
        if (errEl) errEl.textContent = 'Укажите адрес FileServer';
        return;
    }

    const cfg = { url: url, user: user.trim(), pass: pass };
    const btn = document.getElementById('connConnectBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Подключение…'; }

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

        // Скрываем модалку ДО WM.enter(), чтобы _closeAllModals не
        // делал лишних телодвижений.
        const modalEl = document.getElementById('connModal');
        if (modalEl) modalEl.classList.add('hidden');

        FAR.toast('Подключение установлено', 'success');

        if (FAR.connModalSide) {
            await FAR.loadFilesForSide(FAR.connModalSide, { path: '/', silent: true });
        } else {
            await FAR.loadFilesForSide('left',  { path: '/', silent: true });
            await FAR.loadFilesForSide('right', { path: '/', silent: true });
        }

        // ── ВХОДИМ В WM (если ещё не вошли) ──
        if (typeof FAR.WM !== 'undefined' && !FAR.WM.state.active) {
            try {
                FAR.WM.enter();
            } catch (e) {
                console.warn('[WM] enter after connect failed:', e);
            }
        }

        // Обновляем explorer-окна в WM
        if (FAR.WM && FAR.WM.state && FAR.WM.state.windows) {
            FAR.WM.state.windows.forEach(function (w) {
                if (w.appId === 'explorer' && w.props && w.props.side) {
                    try { FAR.renderPanel(w.props.side, { skipLoad: true }); } catch (e) {}
                }
            });
        }

        if (typeof FAR.updateConnIndicators === 'function') {
            FAR.updateConnIndicators();
        }

    } catch (e) {
        console.error('connect error:', e);
        let msg = e && e.message ? e.message : String(e);
        if (e && e.status === 401) msg = 'Неверный логин или пароль (401)';
        if (e && e.status === 404) msg = 'Не найдено (404). Проверьте адрес.';
        if (e && e.name === 'NetworkError' || msg === 'Failed to fetch') {
            msg = 'Не удалось подключиться (сеть/CORS). Проверьте доступность сервера.';
        }
        if (errEl) errEl.textContent = '❌ ' + msg;
        if (btn) { btn.disabled = false; btn.textContent = 'Подключиться'; }
    }
};