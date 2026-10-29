// ============================================================
// Точка входа: загрузка модалок, инициализация, автоподключение
// ============================================================

FAR.loadModalFragment = function(path) {
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

FAR.injectModals = function() {
    const root = document.getElementById('modalRoot');
    const files = [
        'modals/connection.html',
        'modals/viewer.html',
        'modals/panorama-viewer.html',
        'modals/panorama-editor.html',
        'modals/db-picker.html',
        'modals/mp3-viewer.html',
        'modals/video-viewer.html',
        'modals/jsdos-viewer.html',
        'modals/console.html',
        'modals/videochat-viewer.html',
        'modals/videochat-broadcaster.html',
        // 'modals/nes-viewer.html',  <-- УДАЛЕНО
        'modals/emulator-viewer.html',
        'modals/pdf-viewer.html',
        'modals/lbrn2-viewer.html',
        'modals/gcode-viewer.html',
        'modals/browser.html',
        'modals/gamepad-setup.html',
        'modals/gpu-monitor.html',
        'modals/ollama.html',
        'modals/progress.html',
        'modals/loading.html',
        'modals/debug.html',
        'modals/desktop.html',
        'modals/wm-file-dialog.html'
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
document.addEventListener('DOMContentLoaded', async function() {
    FAR.injectModals();

    if (typeof FAR.setupPanelDbSwitcher === 'function') {
        FAR.setupPanelDbSwitcher();
    }
    if (typeof FAR.updateConnIndicators === 'function') {
        FAR.updateConnIndicators();
    }

    FAR.updateAuthUI();
    FAR.renderPanel('left');
    FAR.renderPanel('right');

    FAR.setupPanelDragDrop('panelLeft');
    FAR.setupPanelDragDrop('panelRight');

    window.addEventListener('dragover', function(e) { e.preventDefault(); });
    window.addEventListener('drop',     function(e) { e.preventDefault(); });

    FAR.setupKeyboard();
    FAR.setupGamepadAuto();
    FAR.setupPanelContextMenu();

    if (typeof FAR.initBrowser === 'function') {
        FAR.initBrowser();
    }
    if (typeof FAR.initConsole === 'function') FAR.initConsole();

    if (typeof FAR.WM !== 'undefined') {
        setTimeout(function () {
            if (typeof FAR.WM.updateTray === 'function') {
                FAR.WM.updateTray();
            }
        }, 500);
    }

    FAR._installPannellumDbWrapper();

    if (typeof FAR.restoreAuthTokenFromCookie === 'function') {
        FAR.restoreAuthTokenFromCookie();
    }

    const savedGlobal = FAR.loadConnFromLS();
    const savedLeft   = (typeof FAR.loadSideConnFromLS === 'function')
        ? FAR.loadSideConnFromLS('left')  : null;
    const savedRight  = (typeof FAR.loadSideConnFromLS === 'function')
        ? FAR.loadSideConnFromLS('right') : null;

    const saved = savedGlobal || savedLeft || savedRight;

    if (saved) {
        FAR.setStatus('🔌 Подключение с сохранёнными данными…');
        FAR.showLoading('Подключение к FileServer…', saved.url);
        try {
            const res = await FAR.connectToDb(saved);

            FAR.applyConnectionToBoth(saved, res.db, res.fullUrl);

            FAR.hideLoading();
            FAR.updateAuthUI();
            FAR.setStatus(`✅ Подключено: ${res.fullUrl}`);
            FAR.toast('Подключение восстановлено', 'success');

            await FAR.loadFilesForSide('left',  { path: '/', silent: true });
            await FAR.loadFilesForSide('right', { path: '/', silent: true });

            FAR.renderPanel('left',  { skipLoad: true });
            FAR.renderPanel('right', { skipLoad: true });

            FAR.restoreUiState();

            if (typeof FAR.updateConnIndicators === 'function') {
                FAR.updateConnIndicators();
            }

            if (typeof FAR.WM !== 'undefined' && typeof FAR.WM.getSavedMode === 'function') {
                const savedMode = FAR.WM.getSavedMode();
                if (savedMode === 'wm' && !FAR.WM.state.active) {
                    setTimeout(function () {
                        try {
                            FAR.WM.enter();
                        } catch (e) {
                            console.warn('[WM] restore mode failed:', e);
                        }
                    }, 200);
                }
            }
        } catch (e) {
            FAR.hideLoading();
            console.error('auto-connect error:', e);

            FAR.side.left  = FAR.createSideContext('left');
            FAR.side.right = FAR.createSideContext('right');
            FAR.currentConn = null;

            FAR.updateAuthUI();
            FAR.setStatus('❌ Ошибка автоподключения: ' + e.message);
            FAR.toast('Не удалось подключиться с сохранёнными данными', 'error');
            FAR.openConnModal(true);
        }
    } else {
        FAR.setStatus('🔐 Требуется вход');
        FAR.openConnModal(true);
    }
});