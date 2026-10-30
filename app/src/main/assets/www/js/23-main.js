// ============================================================
// Точка входа: WM-режим, автоподключение.
// WM активируется ТОЛЬКО после успешного подключения, у которого
// есть хотя бы один доступный диск (проверка в connectToDb).
// ============================================================

FAR.loadModalFragment = function (path) {
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', path, false);
        xhr.send(null);
        if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
            return xhr.responseText;
        }
        throw new Error('HTTP ' + xhr.status);
    } catch (e) {
        console.error('Не удалось загрузить ' + path + ':', e);
        return '<!-- Ошибка загрузки ' + path + ' -->';
    }
};

FAR.injectModals = function () {
    const root = document.getElementById('modalRoot');
    if (!root) {
        console.error('[injectModals] #modalRoot не найден в DOM');
        return;
    }
    const files = [
        'modals/connection.html',
        'modals/progress.html',
        'modals/loading.html',
        'modals/desktop.html'
    ];
    let html = '';
    for (const f of files) {
        html += FAR.loadModalFragment(f) + '\n';
    }
    root.innerHTML = html;
};

document.addEventListener('DOMContentLoaded', async function () {
    FAR.injectModals();

    FAR.updateAuthUI();
    FAR.setupKeyboard();

    if (typeof FAR.initBrowser === 'function') FAR.initBrowser();
    if (typeof FAR.initConsole === 'function') FAR.initConsole();

    FAR._installPannellumDbWrapper();

    if (typeof FAR.restoreAuthTokenFromCookie === 'function') {
        FAR.restoreAuthTokenFromCookie();
    }

    if (typeof FAR.Autostart !== 'undefined') {
        setTimeout(() => { FAR.Autostart.run(); }, 1500);
    }

    // ── Автоподключение ──
    const savedGlobal = FAR.loadConnFromLS();
    const savedLeft   = (typeof FAR.loadSideConnFromLS === 'function')
        ? FAR.loadSideConnFromLS('left')  : null;
    const savedRight  = (typeof FAR.loadSideConnFromLS === 'function')
        ? FAR.loadSideConnFromLS('right') : null;

    let saved = savedGlobal || savedLeft || savedRight;

    if (saved && saved.url) {
        if (saved.url.includes('127.0.0.1') &&
            location.hostname !== '127.0.0.1' &&
            location.hostname !== 'localhost') {
            console.log('[AutoConnect] Replacing 127.0.0.1 with current origin:', location.origin);
            saved.url = location.origin;
        }
    }

    // Пустой user → даже не пытаемся. Сервер вернёт info без шар,
    // connectToDb выбросит NoAccessError. Лучше сразу показать
    // модалку — без лишнего сетевого запроса и с понятным UX.
    if (!saved || !saved.user) {
        FAR.openConnModal(true);
        return;
    }

    FAR.showLoading('Подключение к FileServer…', saved.url);

    let autoError = null;
    let autoResult = null;
    try {
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Таймаут подключения к серверу (10 сек)')), 10000)
        );
        autoResult = await Promise.race([FAR.connectToDb(saved), timeoutPromise]);
    } catch (e) {
        autoError = e;
    }

    FAR.hideLoading();

    if (autoError) {
        // ── АВТОПОДКЛЮЧЕНИЕ НЕ УДАЛОСЬ ──
        console.error('auto-connect error:', autoError);

        FAR.side.left  = FAR.createSideContext('left');
        FAR.side.right = FAR.createSideContext('right');
        FAR.currentConn = null;

        FAR.updateAuthUI();
        FAR.openConnModal(true);

        const errEl  = document.getElementById('connError');
        const passEl = document.getElementById('connPass');
        const urlEl  = document.getElementById('connUrl');
        const userEl = document.getElementById('connUser');

        let msg = autoError.message || String(autoError);
        let focusEl = urlEl;
        let clearPassword = false;

        if (autoError.name === 'NoAccessError') {
            // У пользователя нет доступных дисков — сообщение уже
            // сформулировано в connectToDb.
            msg = autoError.message;
            focusEl = autoError.userMissing ? userEl : passEl;
        } else if (autoError.status === 401) {
            msg = 'Неверный логин или пароль (сохранённые данные устарели). ' +
                  'Введите корректные данные.';
            focusEl = passEl;
            clearPassword = true;
        } else if (autoError.status === 404) {
            msg = 'Адрес не найден (404). Проверьте URL FileServer.';
        } else if (autoError.name === 'NetworkError' || msg === 'Failed to fetch') {
            msg = 'Сервер недоступен (сеть/CORS). Проверьте адрес и доступность.';
        }

        if (errEl) errEl.textContent = '❌ ' + msg;

        // При 401 — очищаем неверный пароль в модалке и в LS
        if (clearPassword) {
            if (passEl) passEl.value = '';
            try {
                const raw = localStorage.getItem(FAR.LS_KEY);
                if (raw) {
                    const obj = JSON.parse(raw);
                    if (obj && obj.pass) {
                        obj.pass = '';
                        localStorage.setItem(FAR.LS_KEY, JSON.stringify(obj));
                    }
                }
            } catch (e) { /* ignore */ }
        }

        setTimeout(function () {
            try {
                if (focusEl && focusEl.focus) {
                    focusEl.focus();
                    if (focusEl.tagName === 'INPUT') focusEl.select();
                }
            } catch (e) { /* ignore */ }
        }, 100);

        FAR.toast('Не удалось автоподключиться — введите данные заново', 'warning');
        return;
    }

    // ── АВТОПОДКЛЮЧЕНИЕ УСПЕШНО ──
    FAR.applyConnectionToBoth(saved, autoResult.db, autoResult.fullUrl);
    FAR.updateAuthUI();
    FAR.toast('Подключение восстановлено', 'success');

    await FAR.loadFilesForSide('left',  { path: '/', silent: true });
    await FAR.loadFilesForSide('right', { path: '/', silent: true });

    if (typeof FAR.WM !== 'undefined') {
        try {
            FAR.WM.enter();
        } catch (e) {
            console.warn('[WM] enter on startup failed:', e);
        }
    }
});