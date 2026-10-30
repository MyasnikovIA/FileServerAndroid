// ============================================================
// js/09-auth.js — UI авторизации и logout.
// В WM-only режиме элементов тулбара нет, поэтому все DOM-
// обращения — null-safe. После logout WM остаётся скрытым:
// пользователь должен видеть только модалку логина.
// ============================================================

FAR.updateAuthUI = function () {
    const btn = document.getElementById('btnAuth');
    if (btn) {
        if (FAR.db) {
            btn.textContent = '🔓 LogOut';
            btn.title = 'Выйти и очистить сохранённые данные подключения';
        } else {
            btn.textContent = '🔐 LogIn';
            btn.title = 'Войти в базу данных';
        }
    }

    const ids = ['btnUpload', 'btnMkdir', 'btnCopy', 'btnMove', 'btnDownload',
        'btnZip', 'btnDelete', 'btnRefresh', 'btnDebug', 'btnMigrate'];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (id === 'btnRefresh' || id === 'btnDebug' || id === 'btnMigrate'
            || id === 'btnUpload' || id === 'btnMkdir') {
            el.disabled = !FAR.db;
        } else {
            if (!FAR.db) el.disabled = true;
        }
    }

    const btnConsole = document.getElementById('btnConsole');
    if (btnConsole) btnConsole.style.display = FAR.consoleEnabled ? '' : 'none';

    if (typeof FAR._updateHermesButton === 'function') {
        try { FAR._updateHermesButton(); } catch (e) { /* ignore */ }
    }

    const btnVideoChat = document.getElementById('btnVideoChat');
    if (btnVideoChat) btnVideoChat.style.display = FAR.videoChatEnabled ? '' : 'none';
    const btnBroadcast = document.getElementById('btnBroadcast');
    if (btnBroadcast) btnBroadcast.style.display = FAR.videoChatEnabled ? '' : 'none';

    if (FAR.db && typeof FAR.updateButtons === 'function') {
        FAR.updateButtons();
    }
};

// ============================================================
// Logout. Вызывается из меню Пуск: FAR.WM.logout() → onAuthButton().
// ============================================================

FAR.onAuthButton = function () {
    if (!FAR.db) {
        FAR.openConnModal(true);
        return;
    }

    if (!confirm('Выйти из системы?\nСохранённые данные подключения будут удалены.')) {
        return;
    }

    // Закрываем меню Пуск (если logout вызван из него)
    if (typeof FAR.WM !== 'undefined' && typeof FAR.WM.closeStartMenu === 'function') {
        try { FAR.WM.closeStartMenu(); } catch (e) { /* ignore */ }
    }

    FAR.clearConnFromLS();
    try { localStorage.removeItem(FAR.LS_CONN_LEFT); } catch (e) {}
    try { localStorage.removeItem(FAR.LS_CONN_RIGHT); } catch (e) {}

    // Сброс токена/cookie, чтобы следующий логин не унаследовал Bearer
    if (typeof FAR.clearAuthToken === 'function') {
        try { FAR.clearAuthToken(); } catch (e) { /* ignore */ }
    }

    // Выходим из WM — скрывает #wmRoot и закрывает все окна
    if (typeof FAR.WM !== 'undefined' && FAR.WM.state && FAR.WM.state.active) {
        try { FAR.WM.exit(); } catch (e) { /* ignore */ }
    }

    // Сбрасываем сохранённые окна — после следующего входа
    // должен быть чистый рабочий стол (explorer в корне).
    if (typeof FAR.WM !== 'undefined' && typeof FAR.WM.clearWindowState === 'function') {
        try { FAR.WM.clearWindowState(); } catch (e) { /* ignore */ }
    }
    if (typeof FAR.WM !== 'undefined' && typeof FAR.WM.clearMode === 'function') {
        try { FAR.WM.clearMode(); } catch (e) { /* ignore */ }
    }

    // Снимаем флаги
    FAR.consoleEnabled = false;
    if (typeof FAR.WM !== 'undefined' && typeof FAR.WM.unregisterConsoleApp === 'function') {
        try { FAR.WM.unregisterConsoleApp(); } catch (e) {}
    }

    FAR.hermesEnabled = false;
    FAR.hermesTitle = 'Hermes Agent';
    FAR.hermesIcon = '☤';
    if (typeof FAR.WM !== 'undefined' && typeof FAR.WM.unregisterHermesApp === 'function') {
        try { FAR.WM.unregisterHermesApp(); } catch (e) {}
    }
    if (typeof FAR._updateHermesButton === 'function') {
        try { FAR._updateHermesButton(); } catch (e) {}
    }

    FAR.videoChatEnabled = false;
    FAR.videoChatPort = 8081;

    // Сбрасываем контексты панелей (используются WM-проводником)
    FAR.side.left  = FAR.createSideContext('left');
    FAR.side.right = FAR.createSideContext('right');
    FAR.currentConn = null;

    FAR.updateAuthUI();
    if (typeof FAR.updateTotalSize === 'function') FAR.updateTotalSize();
    if (typeof FAR.updateConnIndicators === 'function') FAR.updateConnIndicators();

    // Ключевой момент: WM НЕ входим. Показываем только модалку
    // логина поверх пустого фона. WM.enter() будет вызван из
    // FAR.submitConnModal() после успешного подключения.
    FAR.openConnModal(true);
};