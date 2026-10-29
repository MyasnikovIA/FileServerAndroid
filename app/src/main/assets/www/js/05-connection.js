// ============================================================
// 05-connection.js — подключение к FileServer.
// ============================================================
//
// Клиент работает ТОЛЬКО с FileServer (REST + SSE).
// Все запросы идут через FAR.FsClient с Bearer-токеном.
// PouchDB / CouchDB не поддерживаются.
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


/**
 * Проверка доступности сервера. Возвращает true, если сервер ответил (любым статусом).
 * Использует mode: 'no-cors' — если сервер на другом origin, ответ opaque,
 * но главное — если запрос дошёл, значит сервер доступен.
 */
FAR._testReachability = async function (baseUrl) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        await fetch(baseUrl + '/api/info?ping=' + Date.now(), {
            method: 'GET', mode: 'no-cors', credentials: 'omit', signal: controller.signal, cache: 'no-store'
        });
        clearTimeout(timer);
        return true;
    } catch (e) {
        return false;
    }
};

/**
 * Строит URL прокси через текущий origin.
 */
FAR.buildProxyUrl = function (targetUrl) {
    const origin = window.location.origin;
    const b64 = FAR._base64UrlEncode(targetUrl);
    return origin + '/api/proxy/' + b64;
};

/**
 * URL-safe Base64 от UTF-8 строки без padding.
 */
FAR._base64UrlEncode = function (str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
 *
 * ВАЖНО: URL в cfg может прийти БЕЗ схемы — пользователь вводит
 * "www.example.com:8080" вместо "http://www.example.com:8080".
 * Мы нормализуем его здесь и МУТИРУЕМ cfg.url, чтобы вызывающий
 * код, который после await использует cfg (applyConnectionToSide,
 * saveSideConnToLS, saveConnToLS), сохранил уже корректный URL.
 *
 * Без этого fetch() падает:
 *   "URL scheme 'www.example.com' is not supported"
 */

FAR.connectToDb = async function (cfg) {
    if (typeof FAR.FsClient !== 'function') throw new Error('FsClient не загружен');

    const originalUrl = FAR.normalizeServerUrl(cfg && cfg.url);
    if (!originalUrl) throw new Error('Не указан адрес FileServer');

    cfg.url = originalUrl;

    let actualUrl = originalUrl;
    let usedProxy = false;

    const currentOrigin = window.location.origin;
    let targetOrigin = '';
    try { targetOrigin = new URL(originalUrl).origin; } catch (e) {}

    if (targetOrigin && targetOrigin !== currentOrigin) {
        if (typeof FAR.updateLoadingSub === 'function') {
            FAR.updateLoadingSub('Проверка доступности ' + originalUrl + '…');
        }
        const reachable = await FAR._testReachability(originalUrl);
        if (!reachable) {
            actualUrl = FAR.buildProxyUrl(originalUrl);
            usedProxy = true;
            console.log('[connect] Прямое подключение недоступно, используем прокси:', actualUrl);
            if (typeof FAR.setStatus === 'function') FAR.setStatus('🔀 Подключение через прокси…');
        }
    }

    cfg._proxy = usedProxy;
    let token = '';

    if (cfg.user) {
        let loginRes;
        try {
            loginRes = await FAR.FsClient.login(actualUrl, cfg.user, cfg.pass || '');
        } catch (e) {
            if (e.status === 401) { const err = new Error('Неверный логин или пароль (401)'); err.status = 401; throw err; }
            if (e.name === 'NetworkError') { const err = new Error('Не удалось подключиться (сеть/CORS)'); err.name = 'NetworkError'; throw err; }
            throw e;
        }
        token = loginRes.token || '';
        if (!token) throw new Error('Сервер не выдал токен');
    }

    const client = new FAR.FsClient(actualUrl, { user: cfg.user || '', pass: cfg.pass || '', token: token });
    client._isProxy = usedProxy;
    client._originalUrl = originalUrl;

    const info = await client.info();

    FAR.consoleEnabled = !!info.console;
    FAR.videoChatEnabled = !!info.videoChatEnabled;
    FAR.videoChatPort = (typeof info.videoChatPort === 'number' && info.videoChatPort > 0) ? info.videoChatPort : 8081;

    // ---- Hermes Agent (профиль консоли) ----
    FAR.hermesEnabled = !!info.hermesEnabled;
    FAR.hermesTitle   = info.hermesTitle || 'Hermes Agent';
    FAR.hermesIcon    = info.hermesIcon  || '☤';

    if (!usedProxy) FAR.registerServer(actualUrl);

    if (FAR.consoleEnabled && typeof FAR.WM !== 'undefined' && typeof FAR.WM.registerConsoleApp === 'function') {
        FAR.WM.registerConsoleApp();
    } else if (typeof FAR.WM !== 'undefined' && typeof FAR.WM.unregisterConsoleApp === 'function') {
        FAR.WM.unregisterConsoleApp();
    }

    // ---- Hermes: регистрация WM-приложения ----
    if (typeof FAR.WM !== 'undefined') {
        if (FAR.hermesEnabled && typeof FAR.WM.registerHermesApp === 'function') {
            try { FAR.WM.registerHermesApp(); } catch (e) { /* ignore */ }
            // Обновить иконки рабочего стола, если WM уже активен
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

    // Обновить видимость кнопки «Hermes Agent» в тулбаре
    if (typeof FAR._updateHermesButton === 'function') {
        try { FAR._updateHermesButton(); } catch (e) { /* ignore */ }
    }

    await client.allDocs({ limit: 1 });

    return {
        db: client, info: info,
        fullUrl: FAR.connLabel({ url: originalUrl, user: cfg.user || '' }),
        token: token, proxy: usedProxy
    };
};