FAR.updateAuthUI = function() {
    const btn = document.getElementById('btnAuth');
    if (FAR.db) {
        btn.textContent = '🔓 LogOut';
        btn.title = 'Выйти и очистить сохранённые данные подключения';
    } else {
        btn.textContent = '🔐 LogIn';
        btn.title = 'Войти в базу данных';
    }

    const ids = ['btnUpload','btnMkdir','btnCopy','btnMove','btnDownload',
        'btnZip','btnDelete','btnRefresh','btnDebug','btnMigrate'];
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

    // ---- Кнопка «Консоль» видна только пользователям с console:true ----
    const btnConsole = document.getElementById('btnConsole');
    if (btnConsole) {
        btnConsole.style.display = FAR.consoleEnabled ? '' : 'none';
    }

    // ---- Кнопка «Hermes Agent» (профиль консоли) ----
    if (typeof FAR._updateHermesButton === 'function') {
        try { FAR._updateHermesButton(); } catch (e) { /* ignore */ }
    }

    // ---- Кнопки VideoChat (просмотр и вещание) — если включены на сервере ----
    const btnVideoChat = document.getElementById('btnVideoChat');
    if (btnVideoChat) {
        btnVideoChat.style.display = FAR.videoChatEnabled ? '' : 'none';
    }
    const btnBroadcast = document.getElementById('btnBroadcast');
    if (btnBroadcast) {
        btnBroadcast.style.display = FAR.videoChatEnabled ? '' : 'none';
    }

    if (FAR.db) FAR.updateButtons();
};

FAR.onAuthButton = function () {
    if (FAR.db) {
        if (!confirm('Выйти из системы?\nСохранённые данные подключения будут удалены.')) return;
        FAR.clearConnFromLS();
        try { localStorage.removeItem(FAR.LS_CONN_LEFT); } catch (e) {}
        try { localStorage.removeItem(FAR.LS_CONN_RIGHT); } catch (e) {}

        // ============================================================
        // КРИТИЧНО: очищаем глобальный токен и cookie.
        // Без этого следующий логин оставит в FAR.authToken
        // старый токен, обёртка над fetch продолжит подставлять
        // его в Authorization, и сервер будет отвечать 401
        // (см. AuthService.authenticate, шаг «Bearer»).
        // ============================================================
        if (typeof FAR.clearAuthToken === 'function') {
            try { FAR.clearAuthToken(); } catch (e) { /* ignore */ }
        }

        // Если открыт оконный режим — выходим в панельный
        if (typeof FAR.WM !== 'undefined' && FAR.WM.state && FAR.WM.state.active) {
            try { FAR.WM.exit(); } catch (e) {}
        }
        // Сбрасываем сохранённый режим: следующий вход — с дефолта
        if (typeof FAR.WM !== 'undefined' && typeof FAR.WM.clearMode === 'function') {
            FAR.WM.clearMode();
        }

        // ---- Снимаем флаг console и выгружаем приложение ----
        FAR.consoleEnabled = false;
        if (typeof FAR.WM !== 'undefined' && typeof FAR.WM.unregisterConsoleApp === 'function') {
            try { FAR.WM.unregisterConsoleApp(); } catch (e) {}
        }

        // ---- Снимаем флаг Hermes ----
        FAR.hermesEnabled = false;
        FAR.hermesTitle = 'Hermes Agent';
        FAR.hermesIcon = '☤';
        if (typeof FAR.WM !== 'undefined' && typeof FAR.WM.unregisterHermesApp === 'function') {
            try { FAR.WM.unregisterHermesApp(); } catch (e) {}
        }
        if (typeof FAR._updateHermesButton === 'function') {
            try { FAR._updateHermesButton(); } catch (e) {}
        }

        // ---- Снимаем флаги VideoChat ----
        FAR.videoChatEnabled = false;
        FAR.videoChatPort = 8081;

        FAR.side.left  = FAR.createSideContext('left');
        FAR.side.right = FAR.createSideContext('right');
        FAR.currentConn = null;

        FAR.renderPanel('left');
        FAR.renderPanel('right');
        FAR.updateAuthUI();
        FAR.updateTotalSize();
        FAR.updateConnIndicators();
        FAR.setStatus('🔓 Вы вышли из системы');
        FAR.openConnModal();
    } else {
        FAR.openConnModal();
    }
};