// ============================================================
// Модалка подключения к FileServer.
//
// Валидация:
//   • Пустые user/pass → сообщение, фокус в поле, connectToDb
//     НЕ вызывается.
//   • connectToDb бросает NoAccessError (нет шар) → сообщение,
//     модалка остаётся открытой, WM не активируется.
//   • 401 от сервера → «Неверный логин или пароль».
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
    const btn = document.getElementById('connConnectBtn');
    if (btn && btn.disabled) return;

    const urlEl  = document.getElementById('connUrl');
    const userEl = document.getElementById('connUser');
    const passEl = document.getElementById('connPass');
    const errEl  = document.getElementById('connError');

    if (!urlEl) return;

    const url  = urlEl.value.trim();
    const user = userEl ? userEl.value.trim() : '';
    const pass = passEl ? passEl.value : '';

    if (errEl) errEl.textContent = '';

    // ── РАННЯЯ КЛИЕНТСКАЯ ВАЛИДАЦИЯ ──
    // Без неё connectToDb с пустым user пропускает login, а /api/info
    // отвечает 200 с пустым shares → раньше это считалось успехом.
    // Теперь — нет.
    if (!url) {
        if (errEl) errEl.textContent = 'Укажите адрес FileServer';
        urlEl.focus();
        return;
    }
    if (!user) {
        if (errEl) errEl.textContent = 'Укажите имя пользователя';
        if (userEl) userEl.focus();
        return;
    }
    if (!pass) {
        if (errEl) errEl.textContent = 'Укажите пароль';
        if (passEl) passEl.focus();
        return;
    }

    const cfg = { url: url, user: user, pass: pass };

    if (btn) { btn.disabled = true; btn.textContent = 'Подключение…'; }

    let res = null;
    let error = null;
    try {
        res = await FAR.connectToDb(cfg);
    } catch (e) {
        error = e;
    }

    // ─────────── ОШИБКА ───────────
    if (error) {
        console.error('connect error:', error);

        let msg = error.message || String(error);
        let focusEl = urlEl;
        let clearPassword = false;

        if (error.name === 'NoAccessError') {
            // У пользователя нет доступа ни к одному диску
            msg = error.message;
            focusEl = error.userMissing ? userEl : passEl;
        } else if (error.status === 401 || /unauthor|неверн.*(логин|парол)/i.test(msg)) {
            msg = 'Неверный логин или пароль. Проверьте данные и попробуйте снова.';
            focusEl = passEl;
            clearPassword = true;
        } else if (error.status === 404) {
            msg = 'Адрес не найден (404). Проверьте URL FileServer.';
        } else if (error.name === 'NetworkError' || msg === 'Failed to fetch') {
            msg = 'Сервер недоступен (сеть/CORS). Проверьте адрес и доступность.';
        }

        if (errEl) errEl.textContent = '❌ ' + msg;
        if (btn) { btn.disabled = false; btn.textContent = 'Подключиться'; }

        // При явной ошибке пароля очищаем поле — не нужно каждый раз
        // заставлять пользователя стирать неверный символ.
        if (clearPassword && passEl) passEl.value = '';

        setTimeout(function () {
            try {
                if (focusEl && focusEl.focus) {
                    focusEl.focus();
                    if (focusEl.tagName === 'INPUT') focusEl.select();
                }
            } catch (e) { /* ignore */ }
        }, 50);

        // WM НЕ активируем — пользователь остаётся в модалке.
        return;
    }

    // ─────────── УСПЕХ ───────────
    try {
        if (FAR.connModalSide) {
            FAR.applyConnectionToSide(FAR.connModalSide, cfg, res.db, res.fullUrl);
            FAR.saveSideConnToLS(FAR.connModalSide, cfg);
        } else {
            FAR.applyConnectionToBoth(cfg, res.db, res.fullUrl);
            FAR.saveConnToLS(cfg);
        }

        FAR.updateAuthUI();
        FAR.connModalRequired = false;

        FAR.toast('Подключение установлено', 'success');

        if (FAR.connModalSide) {
            await FAR.loadFilesForSide(FAR.connModalSide, { path: '/', silent: true });
        } else {
            await FAR.loadFilesForSide('left',  { path: '/', silent: true });
            await FAR.loadFilesForSide('right', { path: '/', silent: true });
        }

        // Вход в WM. _closeAllModals() внутри WM.enter() скрывает
        // все .modal-overlay, включая connModal.
        if (typeof FAR.WM !== 'undefined' && !FAR.WM.state.active) {
            try {
                FAR.WM.enter();
            } catch (e) {
                console.warn('[WM] enter after connect failed:', e);
            }
        } else {
            const modalEl = document.getElementById('connModal');
            if (modalEl) modalEl.classList.add('hidden');
        }

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
    } catch (e2) {
        console.error('post-connect error:', e2);
        if (btn) { btn.disabled = false; btn.textContent = 'Подключиться'; }
        if (errEl) errEl.textContent = '❌ ' + (e2.message || String(e2));
    }
};

// Enter в INPUT модалки = Submit
(function bindEnterSubmit() {
    if (FAR._connEnterBound) return;
    FAR._connEnterBound = true;

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        const modal = document.getElementById('connModal');
        if (!modal || modal.classList.contains('hidden')) return;
        const t = e.target;
        if (!t) return;
        if (t.tagName !== 'INPUT') return;
        if (t.type === 'button' || t.type === 'submit') return;

        e.preventDefault();
        e.stopPropagation();
        FAR.submitConnModal();
    }, true);
})();