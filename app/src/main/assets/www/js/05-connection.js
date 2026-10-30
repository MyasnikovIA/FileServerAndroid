// ============================================================
// 05-connection.js — подключение к FileServer.
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
 * Подключение к FileServer (с поддержкой прокси-режима).
 *
 * @param {Object} cfg — { url, user, pass, proxy? }
 * @returns {Promise<{db: FsClient, info: Object, fullUrl: string, token: string, proxy: boolean}>}
 */
FAR.connectToDb = async function (cfg) {
    if (typeof FAR.FsClient !== 'function') throw new Error('FsClient не загружен');

    const originalUrl = FAR.normalizeServerUrl(cfg && cfg.url);
    if (!originalUrl) throw new Error('Не указан адрес FileServer');

    cfg.url = originalUrl;

    const attemptConnect = async (useProxy) => {
        let actualUrl = originalUrl;
        if (useProxy) {
            // Кодируем URL в Base64 URL-safe
            const b64 = btoa(unescape(encodeURIComponent(originalUrl)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            actualUrl = window.location.origin + '/api/proxy/' + b64;
        }

        let token = '';
        if (cfg.user) {
            // ВАЖНО: FAR.FsClient.login использует fetch внутри.
            // Нам нужно передать ему заголовок X-Proxy-Target-Token? Нет, login идет без токена,
            // мы просто авторизуемся на целевом сервере через прокси.
            // Для этого в login мы передаем actualUrl (с /api/proxy/.../api/login),
            // и fetch пойдет на наш прокси, который перенаправит на целевой сервер.
            const loginRes = await FAR.FsClient.login(actualUrl, cfg.user, cfg.pass || '');
            token = loginRes.token || '';
            if (!token) throw new Error('Сервер не выдал токен');
        }

        const client = new FAR.FsClient(actualUrl, {
            user: cfg.user || '',
            pass: cfg.pass || '',
            token: token,
            isProxy: useProxy
        });
        client._originalUrl = originalUrl;

        const info = await client.info();
        return { client, info, token };
    };

    let result;
    if (cfg.proxy) {
        console.log('[connect] Принудительное подключение через прокси...');
        result = await attemptConnect(true);
    } else {
        try {
            console.log('[connect] Попытка прямого подключения...');
            result = await attemptConnect(false);
        } catch (e) {
            console.warn('[connect] Прямое подключение не удалось:', e.message);
            // Если ошибка сети/CORS/таймаут, пробуем через прокси
            if (e.name === 'NetworkError' || e.name === 'TypeError' ||
                e.message === 'Failed to fetch' || e.message.includes('Таймаут') ||
                e.message.includes('CORS')) {
                console.log('[connect] Переключение на прокси-сервер...');
                result = await attemptConnect(true);
            } else {
                throw e; // Если ошибка авторизации (401) или другая, пробрасываем дальше
            }
        }
    }

    const info = result.info;
    const client = result.client;
    const token = result.token;

    FAR.consoleEnabled = !!info.console;
    FAR.videoChatEnabled = !!info.videoChatEnabled;
    FAR.videoChatPort = (typeof info.videoChatPort === 'number' && info.videoChatPort > 0) ? info.videoChatPort : 8081;

    FAR.hermesEnabled = !!info.hermesEnabled;
    FAR.hermesTitle   = info.hermesTitle || 'Hermes Agent';
    FAR.hermesIcon    = info.hermesIcon  || '☤';

    FAR.registerServer(originalUrl);

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
        token: token, proxy: client.isProxy
    };
};