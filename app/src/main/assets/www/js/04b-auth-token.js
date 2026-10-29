// ============================================================
// 04b-auth-token.js — глобальный менеджер токена авторизации.
// ============================================================
//
// Единственная точка правды о токене и адресах FileServer.
//
// Механика:
//   1. При логине (FAR.connectToDb) вызывается FAR.setAuthToken(token).
//   2. Токен сохраняется:
//        • в памяти   — FAR.authToken
//        • в cookie   — filebd_token (для прямых URL, img, video,
//                       EventSource, переходов по ссылкам)
//   3. window.fetch обёрнут: для запросов к зарегистрированным
//      FileServer-ам автоматически подставляется
//      Authorization: Bearer <token>.
//   4. Cookie отправляется браузером ВСЕГДА, поэтому прямая
//      ссылка на файл (без JS) тоже авторизуется.
//   5. При логауте токен отзывается и cookie удаляется.
//
// ВАЖНО: blob:, data:, file:, about: — НЕ сетевые запросы.
//   • credentials: 'include' на них ломает Chrome (ERR_FILE_NOT_FOUND)
//   • Authorization на них не имеет смысла
//   Поэтому для локальных протоколов обёртка ничего не делает.
// ============================================================

FAR.authToken = '';
FAR._knownServers = new Set();

// ============================================================
// Cookie helpers
// ============================================================

FAR.AUTH_COOKIE_NAME = 'filebd_token';

FAR._writeAuthCookie = function (token) {
    try {
        if (token) {
            document.cookie = FAR.AUTH_COOKIE_NAME + '=' +
                encodeURIComponent(token) +
                '; Path=/; Max-Age=86400; SameSite=Lax';
        } else {
            document.cookie = FAR.AUTH_COOKIE_NAME +
                '=; Path=/; Max-Age=0; SameSite=Lax';
        }
    } catch (e) { /* ignore */ }
};

FAR.readCookieToken = function () {
    try {
        const name = FAR.AUTH_COOKIE_NAME + '=';
        const parts = (document.cookie || '').split(';');
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i].trim();
            if (p.indexOf(name) === 0) {
                return decodeURIComponent(p.substring(name.length));
            }
        }
    } catch (e) { /* ignore */ }
    return '';
};

// ============================================================
// Серверы
// ============================================================

FAR.registerServer = function (url) {
    if (!url) return;
    const clean = String(url).replace(/\/+$/, '');
    if (clean) FAR._knownServers.add(clean);
};

FAR.unregisterServer = function (url) {
    if (!url) return;
    const clean = String(url).replace(/\/+$/, '');
    FAR._knownServers.delete(clean);
};

FAR._isOurServer = function (url) {
    if (!url || typeof url !== 'string') return false;
    for (const srv of FAR._knownServers) {
        if (url === srv || url.startsWith(srv + '/') || url.startsWith(srv + '?')) {
            return true;
        }
    }
    return false;
};

// ============================================================
// Токен
// ============================================================

FAR.setAuthToken = function (token) {
    FAR.authToken = token || '';

    FAR._writeAuthCookie(FAR.authToken);

    if (FAR.side) {
        ['left', 'right'].forEach(function (side) {
            const ctx = FAR.side[side];
            if (ctx && ctx.db && typeof ctx.db === 'object') {
                try { ctx.db.token = FAR.authToken; } catch (e) {}
            }
        });
    }

    console.log('[auth] token ' +
        (FAR.authToken
            ? 'set (' + FAR.authToken.substring(0, 8) + '…)'
            : 'cleared'));
};

FAR.clearAuthToken = function () {
    FAR.setAuthToken('');
};

FAR.restoreAuthTokenFromCookie = function () {
    const fromCookie = FAR.readCookieToken();
    if (fromCookie) {
        FAR.authToken = fromCookie;
        console.log('[auth] token restored from cookie (' +
            fromCookie.substring(0, 8) + '…)');
        return true;
    }
    return false;
};

// ============================================================
// Глобальная обёртка над window.fetch
// ============================================================
//
// Подставляет Authorization: Bearer <token> для HTTP(S)-запросов
// к нашим FileServer-ам.
//
// НЕ трогает:
//   • blob:, data:, file:, about:   — локальные протоколы
//   • сторонние origin-ы            — CDN, внешние API
//
// Это важно: fetch(blob:..., {credentials:'include'}) в Chrome
// падает с ERR_FILE_NOT_FOUND (EmulatorJS/MSE это ломает).

(function installFetchAuthWrapper() {
    if (window._farFetchWrapped) return;
    window._farFetchWrapped = true;

    const origFetch = window.fetch.bind(window);

    const LOCAL_PROTO = /^(blob:|data:|file:|about:)/i;

    window.fetch = function (input, init) {
        init = init || {};

        const url = (typeof input === 'string')
            ? input
            : (input && input.url) || '';

        // ---- Локальные протоколы: не трогаем ----
        if (LOCAL_PROTO.test(url)) {
            return origFetch(input, init);
        }

        // ---- HTTP(S) к нашему FileServer: добавляем Bearer ----
        if (FAR.authToken && FAR._isOurServer(url)) {
            const headers = new Headers(init.headers || {});
            if (!headers.has('Authorization')) {
                headers.set('Authorization', 'Bearer ' + FAR.authToken);
            }
            init.headers = headers;
        }

        // ---- Cookie отправляем только для HTTP(S) ----
        if (!init.credentials) {
            init.credentials = 'include';
        }

        return origFetch(input, init);
    };
})();