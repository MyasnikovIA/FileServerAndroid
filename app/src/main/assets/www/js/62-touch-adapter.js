// ============================================================
// 62-touch-adapter.js — поддержка тач-экранов (тачпад)
// ============================================================
//
// Преобразует касания в события, которых ждёт существующий код:
//   • одиночный тап        → нативный click (не трогаем)
//   • двойной тап          → нативный dblclick (через touch-action)
//   • долгое нажатие 500мс → синтетический contextmenu
//   • свайп по drag-source → синтетические mousedown/mousemove/mouseup
//   • касание края .wm-window → resize через существующие .wm-resize-*
//
// На ПК (mouse/trackpad) НИЧЕГО не меняет.
// ============================================================

(function () {
    'use strict';

    if (window.FAR && window.FAR.Touch) return;
    window.FAR = window.FAR || {};

    // ============================================================
    // Настройки
    // ============================================================

    const LONG_PRESS_MS   = 500;   // долгое нажатие → контекстное меню
    const DRAG_THRESHOLD  = 8;     // минимальный сдвиг для старта drag
    const MOVE_TOLERANCE  = 10;    // допуск "дрожания" во время тапа
    const HORIZONTAL_BIAS = 1.5;   // горизонталь / вертикаль для drag файла

    // Хит-зоны для resize окна (пиксели):
    //   OUT_HIT — снаружи окна (пользователь тянет за бортик)
    //   IN_HIT  — внутри окна (торец бортика)
    const RESIZE_OUT_HIT  = 20;
    const RESIZE_IN_HIT   = 10;

    // ============================================================
    // Селекторы
    // ============================================================

    const DRAG_SELECTORS = [
        '.file-item',        // файлы в панелях FAR
        '.wm-fd-item',       // файлы в диалогах WM
        '.wm-titlebar',      // заголовок окна WM
        '.wm-desktop-icon',  // иконка рабочего стола
        '.progress-header'   // шапка карточки прогресса
    ];

    const CONTEXT_SELECTORS = [
        '.file-item',
        '.panel',
        '.wm-desktop-icon',
        '#wmDesktop',
        '.wm-window',
        '.db-picker-item',
        '.ollama-file-item',
        '.wm-fd-item',
        '.wm-tb-btn'
    ];

    // ============================================================
    // Состояние
    // ============================================================

    const state = {
        isTouch: false,
        active: false,
        startX: 0,
        startY: 0,
        startTime: 0,
        target: null,
        dragTarget: null,
        dragStarted: false,
        preMousedown: false,
        resizeMode: false,
        resizeWin: null,
        resizeDir: '',
        longPressTimer: null
    };

    // ============================================================
    // Утилиты
    // ============================================================

    function isTouchDevice() {
        return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
            || ('ontouchstart' in window)
            || (navigator.maxTouchPoints > 0);
    }

    function findClosest(el, selectors) {
        if (!el || !el.closest) return null;
        for (let i = 0; i < selectors.length; i++) {
            const found = el.closest(selectors[i]);
            if (found) return found;
        }
        return null;
    }

    function fireMouseEvent(type, pos, target) {
        if (!target) target = document;
        const evt = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: pos.clientX,
            clientY: pos.clientY,
            screenX: pos.screenX || pos.clientX,
            screenY: pos.screenY || pos.clientY,
            button: 0,
            buttons: (type === 'mouseup') ? 0 : 1
        });
        try { target.dispatchEvent(evt); } catch (e) { /* ignore */ }
    }

    function fireContextMenu(el, x, y) {
        if (navigator.vibrate) {
            try { navigator.vibrate(30); } catch (e) {}
        }
        const evt = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            button: 2,
            buttons: 2
        });
        try { Object.defineProperty(evt, '_farTouch', { value: true }); }
        catch (e) {}
        try { el.dispatchEvent(evt); } catch (e) { /* ignore */ }
    }

    // ============================================================
    // Resize: поиск края WM-окна под касанием
    // ============================================================

    function detectResizeTarget(x, y) {
        if (!window.FAR || !FAR.WM || !FAR.WM.state || !FAR.WM.state.active) return null;

        // Окна сортируем по z-order — верхнее проверяем первым
        const wins = FAR.WM.state.windows.slice().sort(
            (a, b) => (b.zTop || 0) - (a.zTop || 0)
        );

        for (let i = 0; i < wins.length; i++) {
            const win = wins[i];
            if (win.minimized || win.maximized) continue;
            if (win.modalParent && win.minimized) continue;

            const el = win.el;
            if (!el) continue;

            // Пропускаем окна, которые сейчас в процессе drag/resize
            if (el.classList.contains('dragging') ||
                el.classList.contains('resizing')) continue;

            const rect = el.getBoundingClientRect();

            // Проверка попадания в расширенный прямоугольник
            const inX = x >= rect.left - RESIZE_OUT_HIT
                     && x <= rect.right + RESIZE_OUT_HIT;
            const inY = y >= rect.top - RESIZE_OUT_HIT
                     && y <= rect.bottom + RESIZE_OUT_HIT;
            if (!inX || !inY) continue;

            // Определяем сторону/угол
            const nearLeft   = x >= rect.left - RESIZE_OUT_HIT
                            && x <= rect.left + RESIZE_IN_HIT;
            const nearRight  = x >= rect.right - RESIZE_IN_HIT
                            && x <= rect.right + RESIZE_OUT_HIT;
            const nearTop    = y >= rect.top - RESIZE_OUT_HIT
                            && y <= rect.top + RESIZE_IN_HIT;
            const nearBottom = y >= rect.bottom - RESIZE_IN_HIT
                            && y <= rect.bottom + RESIZE_OUT_HIT;

            let dir = '';
            if (nearTop)    dir += 'n';
            if (nearBottom) dir += 's';
            if (nearLeft)   dir += 'w';
            if (nearRight)  dir += 'e';

            if (!dir) continue;

            // Приоритет кнопкам окна: если касание над .wm-title-actions,
            // отдаём событие кнопке (min/max/close), не ресайзу
            if (nearTop) {
                const tb = el.querySelector('.wm-titlebar');
                const actions = el.querySelector('.wm-title-actions');
                if (tb && actions) {
                    const tbRect = tb.getBoundingClientRect();
                    const aRect = actions.getBoundingClientRect();
                    if (y >= tbRect.top && y <= tbRect.bottom
                        && x >= aRect.left && x <= aRect.right) {
                        continue;
                    }
                }
            }

            // Приоритет интерактивным элементам внутри окна
            // (кнопки, поля ввода, ссылки) — их касание не должно
            // превращаться в resize
            const inside = x >= rect.left && x <= rect.right
                        && y >= rect.top && y <= rect.bottom;
            if (inside) {
                const hitEl = document.elementFromPoint(x, y);
                if (hitEl && hitEl.closest) {
                    if (hitEl.closest('button, input, textarea, select, a')) {
                        continue;
                    }
                }
            }

            return { win: win, el: el, dir: dir };
        }

        return null;
    }

    // ============================================================
    // Проверки допустимости drag
    // ============================================================

    function canStartDrag(el) {
        if (el.classList.contains('file-item')) {
            const idx = parseInt(el.getAttribute('data-index'), 10);
            const side = el.getAttribute('data-side');
            if (isNaN(idx) || idx < 0) return false;
            const ctx = window.FAR && FAR.side && FAR.side[side];
            if (!ctx || !ctx.selectedIdx) return false;
            return ctx.selectedIdx.has(idx);
        }

        if (el.classList.contains('wm-fd-item')) {
            return el.classList.contains('selected');
        }

        if (el.classList.contains('wm-titlebar')) {
            const win = el.closest('.wm-window');
            if (win && win.classList.contains('maximized')) return false;
            return true;
        }

        if (el.classList.contains('wm-desktop-icon')) return true;
        if (el.classList.contains('progress-header')) return true;

        return false;
    }

    function requiresHorizontalDrag(el) {
        return el.classList.contains('file-item')
            || el.classList.contains('wm-fd-item');
    }

    // ============================================================
    // Touch-обработчики
    // ============================================================

    function onTouchStart(e) {
        if (e.touches.length !== 1) {
            cancelActive(e);
            return;
        }

        const touch = e.touches[0];
        const target = e.target;

        state.active = true;
        state.startX = touch.clientX;
        state.startY = touch.clientY;
        state.startTime = Date.now();
        state.target = target;
        state.dragTarget = null;
        state.dragStarted = false;
        state.preMousedown = false;
        state.resizeMode = false;
        state.resizeWin = null;
        state.resizeDir = '';

        // === 1. Resize (высший приоритет) ===
        const resizeHit = detectResizeTarget(touch.clientX, touch.clientY);
        if (resizeHit) {
            state.resizeMode = true;
            state.resizeWin = resizeHit.el;
            state.resizeDir = resizeHit.dir;

            // Синтетический mousedown на нужном .wm-resize-*
            const handle = resizeHit.el.querySelector('.wm-resize-' + resizeHit.dir);
            if (handle) {
                fireMouseEvent('mousedown', touch, handle);
            }
            return;
        }

        // === 2. Drag ===
        const dragEl = findClosest(target, DRAG_SELECTORS);
        if (dragEl && canStartDrag(dragEl)) {
            state.dragTarget = dragEl;
            state.preMousedown = true;
            fireMouseEvent('mousedown', {
                clientX: state.startX,
                clientY: state.startY
            }, dragEl);
        }

        // === 3. Long-press → contextmenu ===
        const ctxEl = findClosest(target, CONTEXT_SELECTORS);
        if (ctxEl) {
            state.longPressTimer = setTimeout(function () {
                state.longPressTimer = null;
                if (state.preMousedown && !state.dragStarted) {
                    fireMouseEvent('mouseup', {
                        clientX: state.startX,
                        clientY: state.startY
                    }, document);
                    state.preMousedown = false;
                }
                state.dragTarget = null;
                fireContextMenu(ctxEl, state.startX, state.startY);
            }, LONG_PRESS_MS);
        }
    }

    function onTouchMove(e) {
        if (!state.active) return;
        if (e.touches.length !== 1) {
            cancelActive(e);
            return;
        }

        const touch = e.touches[0];

        // === Resize ===
        if (state.resizeMode) {
            e.preventDefault();
            e.stopPropagation();
            fireMouseEvent('mousemove', touch, document);
            return;
        }

        const dx = touch.clientX - state.startX;
        const dy = touch.clientY - state.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Отменяем long-press при движении
        if (dist > MOVE_TOLERANCE && state.longPressTimer) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
        }

        // === Drag ===
        if (state.preMousedown && !state.dragStarted && state.dragTarget) {
            let startDrag = false;

            if (requiresHorizontalDrag(state.dragTarget)) {
                if (Math.abs(dx) > DRAG_THRESHOLD &&
                    Math.abs(dx) > Math.abs(dy) * HORIZONTAL_BIAS) {
                    startDrag = true;
                }
            } else {
                if (dist > DRAG_THRESHOLD) startDrag = true;
            }

            if (startDrag) {
                state.dragStarted = true;
                if (navigator.vibrate) {
                    try { navigator.vibrate(15); } catch (err) {}
                }
                fireMouseEvent('mousemove', touch, document);
            }
        }

        if (state.dragStarted) {
            e.preventDefault();
            e.stopPropagation();
            fireMouseEvent('mousemove', touch, document);
        }
        // иначе — нативный скролл
    }

    function onTouchEnd(e) {
        if (!state.active) return;
        const touch = (e.changedTouches && e.changedTouches[0]) || null;

        if (state.longPressTimer) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
        }

        if (state.resizeMode && touch) {
            try { e.preventDefault(); } catch (err) {}
            fireMouseEvent('mouseup', touch, document);
        } else if ((state.dragStarted || state.preMousedown) && touch) {
            if (state.dragStarted) {
                try { e.preventDefault(); } catch (err) {}
            }
            fireMouseEvent('mouseup', touch, document);
        }

        resetState();
    }

    function onTouchCancel(e) {
        cancelActive(e);
    }

    function cancelActive(e) {
        if (state.longPressTimer) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
        }
        if (state.resizeMode || state.dragStarted || state.preMousedown) {
            const touch = e.changedTouches && e.changedTouches[0];
            const pos = touch || { clientX: state.startX, clientY: state.startY };
            fireMouseEvent('mouseup', pos, document);
        }
        resetState();
    }

    function resetState() {
        state.active = false;
        state.target = null;
        state.dragTarget = null;
        state.dragStarted = false;
        state.preMousedown = false;
        state.resizeMode = false;
        state.resizeWin = null;
        state.resizeDir = '';
        if (state.longPressTimer) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
        }
    }

    // ============================================================
    // Тап снаружи — закрытие меню
    // ============================================================

    function onGlobalTapForClose(e) {
        const t = e.target;

        if (window.FAR && FAR.ctxState && FAR.ctxState.visible &&
            FAR.ctxState.menuEl && !FAR.ctxState.menuEl.contains(t)) {
            try { FAR.closeContextMenu(); } catch (err) {}
        }

        const wmMenu = document.getElementById('wmContextMenu');
        if (wmMenu && wmMenu.classList.contains('open') && !wmMenu.contains(t)) {
            try { FAR.WM && FAR.WM._hideContextMenu && FAR.WM._hideContextMenu(); }
            catch (err) {}
        }

        const startMenu = document.getElementById('wmStartMenu');
        const startBtn = document.getElementById('wmStartBtn');
        if (startMenu && startMenu.classList.contains('open') &&
            !startMenu.contains(t) &&
            !(startBtn && startBtn.contains(t))) {
            try { FAR.WM && FAR.WM.closeStartMenu && FAR.WM.closeStartMenu(); }
            catch (err) {}
        }

        if (window.FAR && FAR.BookmarksMenu && FAR.BookmarksMenu.el &&
            !FAR.BookmarksMenu.el.contains(t)) {
            try { FAR.BookmarksMenu.hide(); } catch (err) {}
        }
    }

    // ============================================================
    // CSS
    // ============================================================

    function injectStyles() {
        if (document.getElementById('far-touch-styles')) return;
        const style = document.createElement('style');
        style.id = 'far-touch-styles';
        style.textContent = `
body.touch-device {
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    user-select: none;
    touch-action: manipulation;
}
body.touch-device input,
body.touch-device textarea,
body.touch-device pre,
body.touch-device code,
body.touch-device .code-block pre,
body.touch-device .ollama-msg-body pre,
body.touch-device .console-output {
    -webkit-user-select: text;
    user-select: text;
}
body.touch-device .file-item {
    padding-top: 6px;
    padding-bottom: 6px;
    min-height: 32px;
}
body.touch-device button,
body.touch-device .toolbar button {
    min-height: 36px;
}
body.touch-device .ctx-menu .ctx-item {
    padding-top: 10px;
    padding-bottom: 10px;
}
body.touch-device .wm-title-btn {
    width: 46px;
    height: 36px;
}
`;
        document.head.appendChild(style);
    }

    // ============================================================
    // Инициализация
    // ============================================================

    function init() {
        state.isTouch = isTouchDevice();
        if (!state.isTouch) return;

        document.body.classList.add('touch-device');
        injectStyles();

        document.addEventListener('touchstart',  onTouchStart,  { capture: true, passive: false });
        document.addEventListener('touchmove',   onTouchMove,   { capture: true, passive: false });
        document.addEventListener('touchend',    onTouchEnd,    { capture: true, passive: false });
        document.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: false });
        document.addEventListener('touchend',    onGlobalTapForClose, { capture: true, passive: true });

        document.addEventListener('contextmenu', function (e) {
            if (!e._farTouch) {
                e.preventDefault();
            }
        }, { capture: true });

        console.log('[Touch] адаптер активен');
    }

    // Публичный API
    window.FAR.Touch = {
        isTouch: function () { return state.isTouch; },
        LONG_PRESS_MS: LONG_PRESS_MS,
        DRAG_THRESHOLD: DRAG_THRESHOLD,
        RESIZE_OUT_HIT: RESIZE_OUT_HIT,
        RESIZE_IN_HIT: RESIZE_IN_HIT
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();