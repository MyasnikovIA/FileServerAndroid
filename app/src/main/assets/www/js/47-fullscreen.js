// ============================================================
// 47-fullscreen.js — управление полноэкранным режимом
// ============================================================

FAR.FS = FAR.FS || {};

FAR.FS.LS_KEY = 'filebd_fullscreen';

// ------------------------------------------------------------
// Утилиты определения поддержки
// ------------------------------------------------------------

FAR.FS._isSupported = function () {
    return !!(
        document.fullscreenEnabled ||
        document.webkitFullscreenEnabled ||
        document.mozFullScreenEnabled ||
        document.msFullscreenEnabled
    );
};

FAR.FS._isActive = function () {
    return !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
    );
};

FAR.FS._request = function (el) {
    el = el || document.documentElement;
    if (el.requestFullscreen) return el.requestFullscreen();
    if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
    if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
    if (el.msRequestFullscreen) return el.msRequestFullscreen();
    return Promise.reject(new Error('Fullscreen API не поддерживается'));
};

FAR.FS._exit = function () {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    if (document.mozCancelFullScreen) return document.mozCancelFullScreen();
    if (document.msExitFullscreen) return document.msExitFullscreen();
    return Promise.reject(new Error('Fullscreen API не поддерживается'));
};

// ------------------------------------------------------------
// Публичное API
// ------------------------------------------------------------

/**
 * Пытается войти в полноэкранный режим.
 *
 * ВАЖНО: requestFullscreen требует user gesture. Если вызов
 * происходит из setTimeout / автостарта — браузер бросит:
 *   • Chrome:   TypeError: Permissions check failed
 *   • Firefox:  NotAllowedError
 *   • Safari:   NotAllowedError
 * Это ожидаемое поведение, шуметь в консоль не надо.
 *
 * Автовосстановление после F5 сделано правильно: через
 * _installAutoRestore() ниже — обработчик вешается на первый
 * клик/нажатие. Здесь просто молча возвращаем false.
 */
FAR.FS.enter = async function () {
    if (!FAR.FS._isSupported()) return false;
    if (FAR.FS._isActive()) return true;

    try {
        await FAR.FS._request();
        return true;
    } catch (e) {
        const name = e && e.name;
        const msg  = (e && e.message) || '';

        // Все варианты "нельзя без user gesture":
        //   NotAllowedError                                  — стандарт
        //   TypeError: Permissions check failed              — Chrome
        //   TypeError: ... user gesture ...                  — Chrome (variants)
        const isGestureError =
            name === 'NotAllowedError' ||
            (name === 'TypeError' && /permission|user gesture|not allowed/i.test(msg));

        if (!isGestureError) {
            // Настоящая ошибка (нет API, политика sandbox и т.п.) — логируем
            console.warn('[FS] enter failed:', name, msg);
        }

        return false;
    }
};

FAR.FS.exit = async function () {
    if (!FAR.FS._isActive()) return true;
    try {
        await FAR.FS._exit();
        return true;
    } catch (e) {
        console.warn('[FS] exit failed:', e);
        return false;
    }
};

FAR.FS.toggle = async function () {
    if (FAR.FS._isActive()) return FAR.FS.exit();
    return FAR.FS.enter();
};

// ------------------------------------------------------------
// Сохранение желания пользователя
// ------------------------------------------------------------

FAR.FS._saveWanted = function (flag) {
    try {
        if (flag) localStorage.setItem(FAR.FS.LS_KEY, '1');
        else localStorage.removeItem(FAR.FS.LS_KEY);
    } catch (e) {}
};

FAR.FS._loadWanted = function () {
    try { return localStorage.getItem(FAR.FS.LS_KEY) === '1'; }
    catch (e) { return false; }
};

// ------------------------------------------------------------
// Слежение за состоянием
// ------------------------------------------------------------

FAR.FS._watchState = function () {
    const onChange = function () {
        FAR.FS._saveWanted(FAR.FS._isActive());
        FAR.FS._updateAllButtons();
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    document.addEventListener('mozfullscreenchange', onChange);
    document.addEventListener('MSFullscreenChange', onChange);
};

// ------------------------------------------------------------
// Автовосстановление после перезагрузки
// ------------------------------------------------------------
//
// Правильный способ: дождаться ПЕРВОГО пользовательского жеста
// и уже из него вызвать requestFullscreen. Здесь мы подписываемся
// на click/keydown/touchstart/pointerdown в capture-фазе, чтобы
// поймать даже клики, которые что-то отменяют/останавливают.
FAR.FS._installAutoRestore = function () {
    if (!FAR.FS._loadWanted()) return;   // пользователь отключил — не навязываем
    if (FAR.FS._isActive()) return;
    if (!FAR.FS._isSupported()) return;

    const removeHandlers = function () {
        document.removeEventListener('click', handler, true);
        document.removeEventListener('keydown', handler, true);
        document.removeEventListener('touchstart', handler, true);
        document.removeEventListener('pointerdown', handler, true);
    };

    const handler = async function (e) {
        const t = e.target;
        const tag = (t && t.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) {
            return;
        }
        const ok = await FAR.FS.enter();
        if (ok) {
            removeHandlers();
        }
    };

    document.addEventListener('click', handler, true);
    document.addEventListener('keydown', handler, true);
    document.addEventListener('touchstart', handler, true);
    document.addEventListener('pointerdown', handler, true);
};

// ------------------------------------------------------------
// Обновление текста на всех кнопках
// ------------------------------------------------------------

FAR.FS._updateAllButtons = function () {
    const isFs = FAR.FS._isActive();

    const tbBtn = document.getElementById('btnFullscreen');
    if (tbBtn) {
        tbBtn.textContent = isFs ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
        tbBtn.title = isFs ? 'Выйти из полноэкранного режима (F11)' : 'Войти в полноэкранный режим (F11)';
    }

    const trayEl = document.getElementById('wmTrayFullscreen');
    if (trayEl) {
        const spanEl = trayEl.querySelector('span');
        if (spanEl) spanEl.textContent = isFs ? 'On' : 'Off';
        trayEl.title = isFs ? 'Выйти из полноэкранного режима (F11)' : 'Войти в полноэкранный режим (F11)';
        trayEl.style.cursor = 'pointer';
    }
};

// ------------------------------------------------------------
// Кнопка в тулбаре
// ------------------------------------------------------------

FAR.FS.installToolbarButton = function () {
    const toolbar = document.querySelector('.toolbar');
    if (!toolbar) return;
    if (document.getElementById('btnFullscreen')) {
        FAR.FS._updateAllButtons();
        return;
    }

    const btn = document.createElement('button');
    btn.id = 'btnFullscreen';
    btn.type = 'button';
    btn.title = 'Полноэкранный режим (F11)';
    btn.textContent = '⛶ Fullscreen';
    btn.addEventListener('click', function () {
        FAR.FS.toggle();
    });

    const authBtn = document.getElementById('btnAuth');
    if (authBtn && authBtn.parentNode === toolbar) {
        toolbar.insertBefore(btn, authBtn);
    } else {
        toolbar.appendChild(btn);
    }
    FAR.FS._updateAllButtons();
};

// ------------------------------------------------------------
// Кнопка в трее WM
// ------------------------------------------------------------

FAR.FS.installWmTrayButton = function () {
    const trayEl = document.getElementById('wmTrayFullscreen');
    if (!trayEl) return;
    if (trayEl._farFsBound) {
        FAR.FS._updateAllButtons();
        return;
    }
    trayEl._farFsBound = true;

    trayEl.style.cursor = 'pointer';
    trayEl.addEventListener('click', function (e) {
        e.stopPropagation();
        FAR.FS.toggle();
    });

    FAR.FS._updateAllButtons();
};

// ------------------------------------------------------------
// F11 — переключатель
// ------------------------------------------------------------

document.addEventListener('keydown', function (e) {
    if (e.key === 'F11') {
        e.preventDefault();
        e.stopPropagation();
        FAR.FS.toggle();
    }
}, true);

// ------------------------------------------------------------
// Обёртка над FAR.WM.enter
// ------------------------------------------------------------
//
// При входе в WM НЕ пытаемся автоматически запросить fullscreen —
// это будет "не user gesture", браузер заблокирует.
// Обновляем только кнопку в трее.
(function wrapWMEnter() {
    if (typeof FAR.WM === 'undefined' || typeof FAR.WM.enter !== 'function') {
        setTimeout(wrapWMEnter, 50);
        return;
    }
    if (FAR.WM._fsWrapped) return;
    FAR.WM._fsWrapped = true;

    const origEnter = FAR.WM.enter;
    FAR.WM.enter = function () {
        const r = origEnter.apply(this, arguments);

        setTimeout(function () {
            FAR.FS.installWmTrayButton();
            FAR.FS._updateAllButtons();
        }, 50);

        return r;
    };
})();

// ------------------------------------------------------------
// Восстановление при загрузке страницы
// ------------------------------------------------------------

FAR.FS.init = function () {
    FAR.FS._watchState();
    FAR.FS._installAutoRestore();
    FAR.FS._updateAllButtons();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        FAR.FS.init();
        FAR.FS.installToolbarButton();
        FAR.FS.installWmTrayButton();
    });
} else {
    FAR.FS.init();
    FAR.FS.installToolbarButton();
    FAR.FS.installWmTrayButton();
}