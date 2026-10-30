// ============================================================
// 05-connection.js — подключение к FileServer.
// ============================================================
//
// Клиент работает ТОЛЬКО с FileServer (REST + SSE).
// Все запросы идут через FAR.FsClient с Bearer-токеном.
// PouchDB / CouchDB не поддерживаются.
//
// ВАЖНО: убрана логика использования прокси (buildProxyUrl),
// так как на Android-сервере этот обработчик не реализован.
// Подключение к внешним серверам выполняется напрямую (CORS).
// ============================================================


FAR.getDefaultConn = function () {
    const proto = location.protocol === 'file:' ? 'http:' : location.protocol;
    const host  = location.hostname || '127.0.0.1';
    return { url:  proto + '//' + host + ':8080', user: '', pass: '' };
};


FAR.loadConnFromLS = function () {
    try {
        const raw = localStorage.getItem(FAR.LS_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || !obj.url) return null;
        if (obj.db) return null;
        return obj;
    } catch (e) {
        return null;
    }
};

FAR.saveConnToLS = function (cfg) {
    const safe = {
        url:  FAR.normalizeServerUrl(cfg.url),
        user: cfg.user || '',
        pass: cfg.pass || ''
    };
    try {
        localStorage.setItem(FAR.LS_KEY, JSON.stringify(safe));
    } catch (e) { /* ignore */ }
};

FAR.clearConnFromLS = function () {
    try { localStorage.removeItem(FAR.LS_KEY); } catch (e) {}
};


FAR.ensureDb = function () {
    if (!FAR.db) {
        FAR.toast('Нет подключения к FileServer. Войдите в систему.', 'warning');
        FAR.openConnModal();
        return false;
    }
    return true;
};

/**
 * Подключение к FileServer.
 *
 * @param {Object} cfg — { url, user, pass }
 * @returns {Promise<{db: FsClient, info: Object, fullUrl: string, token: string}>}
 */
FAR.connectToDb = async function (cfg) {
    if (typeof FAR.FsClient !== 'function') throw new Error('FsClient не загружен');

    const originalUrl = FAR.normalizeServerUrl(cfg && cfg.url);
    if (!originalUrl) throw new Error('Не указан адрес FileServer');

    cfg.url = originalUrl;

    // Подключаемся напрямую. Если удалённый сервер имеет CORS,
    // браузер сам выполнит запросы без прокси.
    let actualUrl = originalUrl;
    let token = '';

    if (cfg.user) {
        let loginRes;
        try {
            loginRes = await FAR.FsClient.login(actualUrl, cfg.user, cfg.pass || '');
        } catch (e) {
            if (e.status === 401) {
                const err = new Error('Неверный логин или пароль (401)');
                err.status = 401;
                throw err;
            }
            if (e.name === 'NetworkError' || e.name === 'TypeError' || e.message === 'Failed to fetch') {
                const err = new Error('Не удалось подключиться (сеть/CORS). Проверьте адрес и доступность сервера.');
                err.name = 'NetworkError';
                throw err;
            }
            throw e;
        }
        token = loginRes.token || '';
        if (!token) throw new Error('Сервер не выдал токен');
    }

    const client = new FAR.FsClient(actualUrl, { user: cfg.user || '', pass: cfg.pass || '', token: token });
    client._isProxy = false;
    client._originalUrl = originalUrl;

    const info = await client.info();

    FAR.consoleEnabled = !!info.console;
    FAR.videoChatEnabled = !!info.videoChatEnabled;
    FAR.videoChatPort = (typeof info.videoChatPort === 'number' && info.videoChatPort > 0) ? info.videoChatPort : 8081;

    FAR.hermesEnabled = !!info.hermesEnabled;
    FAR.hermesTitle   = info.hermesTitle || 'Hermes Agent';
    FAR.hermesIcon    = info.hermesIcon  || '☤';

    FAR.registerServer(actualUrl);

    if (FAR.consoleEnabled && typeof FAR.WM !== 'undefined' && typeof FAR.WM.registerConsoleApp === 'function') {
        FAR.WM.registerConsoleApp();
    } else if (typeof FAR.WM !== 'undefined' && typeof FAR.WM.unregisterConsoleApp === 'function') {
        FAR.WM.unregisterConsoleApp();
    }

    if (typeof FAR.WM !== 'undefined') {
        if (FAR.hermesEnabled && typeof FAR.WM.registerHermesApp === 'function') {
            try { FAR.WM.registerHermesApp(); } catch (e) { /* ignore */ }
            if (FAR.WM.state && FAR.WM.state.active
                && typeof FAR.WM._scheduleDesktopRender === 'function') {
                try { FAR.WM._scheduleDesktopRender(); } catch (e) { /* ignore */ }
            }
        } else if (typeof FAR.WM.unregisterHermesApp === 'function') {
            try { FAR.WM.unregisterHermesApp(); } catch (e) { /* ignore */ }
            if (FAR.WM.state && FAR.WM.state.active
                && typeof FAR.WM._scheduleDesktopRender === 'function') {
                try { FAR.WM._scheduleDesktopRender(); } catch (e) { /* ignore */ }
            }
        }
    }

    if (typeof FAR._updateHermesButton === 'function') {
        try { FAR._updateHermesButton(); } catch (e) { /* ignore */ }
    }

    await client.allDocs({ limit: 1 });

    return {
        db: client, info: info,
        fullUrl: FAR.connLabel({ url: originalUrl, user: cfg.user || '' }),
        token: token, proxy: false
    };
};