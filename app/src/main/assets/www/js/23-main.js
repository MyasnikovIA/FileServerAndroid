// ============================================================
// Точка входа: WM-режим, автоподключение.
// WM активируется ТОЛЬКО после успешного подключения.
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

// ============================================================
// Старт
// ============================================================
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

    if (saved) {
        FAR.showLoading('Подключение к FileServer…', saved.url);
        try {
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Таймаут подключения к серверу (10 сек)')), 10000)
            );
            const res = await Promise.race([FAR.connectToDb(saved), timeoutPromise]);

            FAR.applyConnectionToBoth(saved, res.db, res.fullUrl);
            FAR.hideLoading();
            FAR.updateAuthUI();
            FAR.toast('Подключение восстановлено', 'success');

            await FAR.loadFilesForSide('left',  { path: '/', silent: true });
            await FAR.loadFilesForSide('right', { path: '/', silent: true });

            // ── ВХОДИМ В WM только после успешного подключения ──
            if (typeof FAR.WM !== 'undefined') {
                try {
                    FAR.WM.enter();
                } catch (e) {
                    console.warn('[WM] enter on startup failed:', e);
                }
            }
        } catch (e) {
            FAR.hideLoading();
            console.error('auto-connect error:', e);

            FAR.side.left  = FAR.createSideContext('left');
            FAR.side.right = FAR.createSideContext('right');
            FAR.currentConn = null;

            FAR.updateAuthUI();
            FAR.toast('Не удалось подключиться: ' + e.message, 'error');
            FAR.openConnModal(true);
            // WM не активируем — пусть пользователь видит модалку логина
        }
    } else {
        // Нет сохранённого соединения — только модалка логина, WM скрыт
        FAR.openConnModal(true);
    }
});