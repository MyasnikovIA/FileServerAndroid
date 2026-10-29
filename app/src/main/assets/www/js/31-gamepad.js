// ============================================================
// Управление файловым менеджером с геймпада (Gamepad API)
// ============================================================
//
// Раскладка (Xbox / DualShock / DualSense / 8BitDo):
//   D-Pad ↑ / ↓        — перемещение курсора вверх/вниз
//   D-Pad ← / →        — смена активной панели (левая/правая)
//   A (кнопка 0)       — войти в папку / открыть файл (двойной клик)
//   B (кнопка 1)       — выйти на уровень выше (Backspace)
//   X (кнопка 2)       — переключить выделение (Ctrl+клик)
//   Y (кнопка 3)       — обновить список (F5)
//   LB / RB (4 / 5)    — PageUp / PageDown
//   Start (9)          — открыть/закрыть LogIn-модалку
//   Back (8)           — Delete (удалить выделенное)
//
// ВАЖНО:
//   • Работает только когда НЕ открыта модалка эмулятора/NES/JSDOS,
//     чтобы не забирать ввод у игры.
//   • Работает и когда НЕ открыт обычный viewer — иначе блокируем,
//     чтобы случайно не выйти из просмотра.
//   • Авто-повтор: кнопка срабатывает один раз при нажатии +
//     повторяется, пока удерживается (как клавиатура).

FAR._gamepadState = {
    running: false,
    rafId: null,
    prevButtons: {},
    prevAxes: {},          // ← добавили
    repeatTimers: {},
    repeatDelay: 350,
    repeatInterval: 90,
    debug: false           // ← добавили
};

/**
 * Запускает цикл опроса геймпада.
 * Вызывается один раз при старте приложения.
 */
FAR.setupGamepad = function() {
    if (FAR._gamepadState.running) return;
    FAR._gamepadState.running = true;

    // Слушаем подключение/отключение геймпада (для логов)
    window.addEventListener('gamepadconnected', function(e) {
        FAR.toast('🎮 Геймпад подключён: ' + e.gamepad.id, 'info');
        console.log('[Gamepad] connected:', e.gamepad.id, 'index:', e.gamepad.index);
    });
    window.addEventListener('gamepaddisconnected', function(e) {
        FAR.toast('🎮 Геймпад отключён', 'warning');
        console.log('[Gamepad] disconnected:', e.gamepad.id);
    });

    FAR._gamepadLoop();
};

/**
 * Основной цикл опроса.
 */
FAR._gamepadLoop = function() {
    if (!FAR._gamepadState.running) return;

    try {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let found = 0;
        for (let i = 0; i < pads.length; i++) {
            const pad = pads[i];
            if (!pad) continue;
            found++;
            FAR._gamepadHandlePad(pad);
        }
        if (found > 0 && !FAR._gamepadState._loggedFound) {
            FAR._gamepadState._loggedFound = true;
            FAR._gamepadLog('🎮 Геймпад найден в getGamepads(), обрабатываем.');
        }
        if (found === 0) {
            FAR._gamepadState._loggedFound = false;
        }
    } catch (e) {
        console.warn('[Gamepad] loop error:', e);
    }

    FAR._gamepadState.rafId = requestAnimationFrame(FAR._gamepadLoop);
};

/**
 * Обрабатывает один геймпад.
 */
FAR._gamepadHandlePad = function(pad) {
    // ===== ДИАГНОСТИКА =====
    if (FAR._gamepadState.debug) {
        FAR._gamepadDebugLog(pad);
        return;
    }

    // Не мешаем игре
    if (FAR._isGameModalOpen()) {
        FAR._gamepadState.prevButtons[pad.index] = null;
        FAR._gamepadState.prevAxes[pad.index] = null;
        return;
    }
    if (FAR._isAnyModalOpen()) {
        FAR._gamepadState.prevButtons[pad.index] = null;
        FAR._gamepadState.prevAxes[pad.index] = null;
        return;
    }

    // Окно настройки джойстика — весь ввод идёт туда
    const setupModal = document.getElementById('gamepadSetupModal');
    if (setupModal && !setupModal.classList.contains('hidden')) {
        FAR._gamepadState.prevButtons[pad.index] = null;
        FAR._gamepadState.prevAxes[pad.index] = null;
        return;
    }

    const dbReady = !!FAR.db;
    const buttons = pad.buttons.map(function(b) { return b.pressed; });
    const axes    = pad.axes.slice();

    let prev     = FAR._gamepadState.prevButtons[pad.index];
    let prevAxes = FAR._gamepadState.prevAxes[pad.index];

    if (!prev || !prevAxes) {
        FAR._gamepadState.prevButtons[pad.index] = buttons.slice();
        FAR._gamepadState.prevAxes[pad.index]    = axes.slice();
        return;
    }

    // ===== ЗАЩИТА ОТ КОНФЛИКТА auth/enter =====
    let map = FAR._gamepadMap || FAR.getGamepadMap();

    const enterM = map['enter'];
    const authM  = map['auth'];
    if (enterM && authM &&
        enterM.kind === authM.kind &&
        enterM.code !== null && enterM.code !== undefined &&
        enterM.code === authM.code) {
        map = JSON.parse(JSON.stringify(map));
        map['auth'] = { kind: 'button', code: null };
    }

    const AXIS_THRESHOLD = 0.5;

    // ===== ОБХОД ВСЕХ ДЕЙСТВИЙ =====
    FAR.GAMEPAD_ACTIONS.forEach(function(action) {
        const m = map[action.id];
        if (!m || m.code === null || m.code === undefined) return;

        if (m.kind === 'button') {
            const idx = m.code;
            if (idx >= buttons.length) return;

            const pressed    = buttons[idx];
            const wasPressed = prev[idx];

            if (pressed && !wasPressed) {
                // ===== ЛОГ В КОНСОЛЬ =====
                FAR._gamepadLog('🎮 [Button] #' + idx + ' PRESSED  → действие: ' + action.id);
                FAR._gamepadDispatch(action.id);
                if (FAR._gamepadIsRepeatable(action.id)) {
                    FAR._gamepadStartRepeat(pad.index, 'b' + idx, action.id);
                }
            } else if (!pressed && wasPressed) {
                FAR._gamepadLog('🎮 [Button] #' + idx + ' released');
                FAR._gamepadStopRepeat(pad.index, 'b' + idx);
            }
        } else if (m.kind === 'axis-neg' || m.kind === 'axis-pos') {
            const idx = m.code;
            if (idx >= axes.length || idx >= prevAxes.length) return;

            const cur = axes[idx];
            const old = prevAxes[idx];
            const isNeg = (m.kind === 'axis-neg');
            const curOn = isNeg ? (cur < -AXIS_THRESHOLD) : (cur >  AXIS_THRESHOLD);
            const oldOn = isNeg ? (old < -AXIS_THRESHOLD) : (old >  AXIS_THRESHOLD);

            const key = 'a' + idx + (isNeg ? '-' : '+');

            if (curOn && !oldOn) {
                // ===== ЛОГ В КОНСОЛЬ =====
                FAR._gamepadLog(
                    '🎮 [Axis ' + idx + '] ' + (isNeg ? 'NEGATIVE' : 'POSITIVE') +
                    ' (' + cur.toFixed(2) + ') → действие: ' + action.id
                );
                FAR._gamepadDispatch(action.id);
                if (FAR._gamepadIsRepeatable(action.id)) {
                    FAR._gamepadStartRepeat(pad.index, key, action.id);
                }
            } else if (!curOn && oldOn) {
                FAR._gamepadLog('🎮 [Axis ' + idx + '] released (значение ' + cur.toFixed(2) + ')');
                FAR._gamepadStopRepeat(pad.index, key);
            }
        }
    });

    FAR._gamepadState.prevButtons[pad.index] = buttons.slice();
    FAR._gamepadState.prevAxes[pad.index]    = axes.slice();
};

/**
 * Возвращает true, если для действия нужен авто-повтор при удержании.
 */
FAR._gamepadIsRepeatable = function(action) {
    return action === 'up' || action === 'down' ||
           action === 'pageUp' || action === 'pageDown';
};

/**
 * Запускает таймер авто-повтора для удержания кнопки.
 */
FAR._gamepadStartRepeat = function(padIndex, key, action) {
    const fullKey = padIndex + ':' + key;
    FAR._gamepadStopRepeat(padIndex, key);

    FAR._gamepadState.repeatTimers[fullKey] = setTimeout(function() {
        FAR._gamepadState.repeatTimers[fullKey + ':interval'] = setInterval(function() {
            FAR._gamepadDispatch(action);
        }, FAR._gamepadState.repeatInterval);
    }, FAR._gamepadState.repeatDelay);
};

/**
 * Останавливает таймер авто-повтора.
 */
FAR._gamepadStopRepeat = function(padIndex, key) {
    const fullKey = padIndex + ':' + key;
    if (FAR._gamepadState.repeatTimers[fullKey]) {
        clearTimeout(FAR._gamepadState.repeatTimers[fullKey]);
        delete FAR._gamepadState.repeatTimers[fullKey];
    }
    const intKey = fullKey + ':interval';
    if (FAR._gamepadState.repeatTimers[intKey]) {
        clearInterval(FAR._gamepadState.repeatTimers[intKey]);
        delete FAR._gamepadState.repeatTimers[intKey];
    }
};

/**
 * Выполняет действие.
 */
FAR._gamepadDispatch = function(action) {
    if (!FAR.db && action !== 'auth') return;

    const side = FAR.activePanel;

    switch (action) {
        case 'up':
            FAR.moveCursor(side, -1, {});
            break;
        case 'down':
            FAR.moveCursor(side, +1, {});
            break;
        case 'pageUp':
            FAR.moveCursor(side, -1, { page: true });
            break;
        case 'pageDown':
            FAR.moveCursor(side, +1, { page: true });
            break;
        case 'left':
            FAR.setActivePanel('left');
            break;
        case 'right':
            FAR.setActivePanel('right');
            break;
        case 'enter': {
            const items = side === 'left' ? FAR.leftFiles : FAR.rightFiles;
            const cursor = side === 'left' ? FAR.leftCursor : FAR.rightCursor;
            if (cursor === -1) {
                FAR.goToParent(side);
            } else if (cursor >= 0 && cursor < items.length) {
                FAR.handleItemDblClick(side, cursor);
            }
            break;
        }
        case 'back':
            FAR.navigatePanel(side, '..');
            break;
        case 'toggle': {
            const cursor = side === 'left' ? FAR.leftCursor : FAR.rightCursor;
            if (cursor === -1) break;
            const selSet = side === 'left' ? FAR.leftSelectedIdx : FAR.rightSelectedIdx;
            if (selSet.has(cursor)) selSet.delete(cursor);
            else selSet.add(cursor);
            if (side === 'left') FAR.leftAnchor = cursor;
            else FAR.rightAnchor = cursor;
            FAR.renderPanel(side);
            break;
        }
        case 'refresh':
            FAR.refreshFiles();
            break;
        case 'delete':
            FAR.deleteSelected();
            break;
        case 'auth':
            FAR.onAuthButton();
            break;
    }
};

/**
 * Возвращает true, если открыта «игровая» модалка
 * (эмулятор / NES / JSDOS / панорама), где геймпад нужен самой игре.
 */
FAR._isGameModalOpen = function() {
    const ids = [
        'emulatorViewerModal',
        'nesViewerModal',
        'jsdosViewerModal',
        'panoramaViewerModal'
    ];
    for (let i = 0; i < ids.length; i++) {
        const el = document.getElementById(ids[i]);
        if (el && !el.classList.contains('hidden')) return true;
    }
    return false;
};

/**
 * Возвращает true, если открыта любая модалка файлового менеджера.
 */
FAR._isAnyModalOpen = function() {
    const ids = [
        'connModal',
        'viewerModal',
        'panoramaEditorModal',
        'dbPickerModal',
        'progressOverlay'
    ];
    for (let i = 0; i < ids.length; i++) {
        const el = document.getElementById(ids[i]);
        if (el && !el.classList.contains('hidden')) return true;
    }
    return false;
};


// ============================================================
// Диагностика геймпада
// ============================================================

/**
 * Включает/выключает диагностический режим.
 * В консоли показываются все кнопки и оси, которые меняются.
 */
FAR.gamepadDebug = function() {
    FAR._gamepadState.debug = !FAR._gamepadState.debug;
    if (FAR._gamepadState.debug) {
        console.log('%c[Gamepad] Диагностика ВКЛЮЧЕНА. Нажимайте кнопки и двигайте стики — индексы будут в консоли.', 'color:#a6e3a1;font-weight:bold');
        console.log('[Gamepad] Откройте консоль (F12), нажмите кнопки, посмотрите индексы, затем вызовите FAR.gamepadDebug() снова чтобы выключить.');
    } else {
        console.log('[Gamepad] Диагностика ВЫКЛЮЧЕНА.');
    }
};

/**
 * Логирует изменения кнопок/осей.
 */
FAR._gamepadDebugLog = function(pad) {
    const now = performance.now();

    // Проверяем кнопки
    for (let i = 0; i < pad.buttons.length; i++) {
        const b = pad.buttons[i];
        if (b.pressed) {
            const key = 'btn-' + i;
            if (!FAR._gamepadState._dbgLast) FAR._gamepadState._dbgLast = {};
            if (!FAR._gamepadState._dbgLast[key]) {
                console.log(
                    '%c[Gamepad] КНОПКА #' + i + ' нажата (value=' + b.value.toFixed(2) + ')',
                    'color:#89b4fa'
                );
                FAR._gamepadState._dbgLast[key] = true;
            }
        } else {
            const key = 'btn-' + i;
            if (FAR._gamepadState._dbgLast && FAR._gamepadState._dbgLast[key]) {
                console.log('[Gamepad] КНОПКА #' + i + ' отпущена');
                delete FAR._gamepadState._dbgLast[key];
            }
        }
    }

    // Проверяем оси
    if (!FAR._gamepadState._dbgAxes) FAR._gamepadState._dbgAxes = {};
    for (let i = 0; i < pad.axes.length; i++) {
        const v = pad.axes[i];
        if (Math.abs(v) > 0.3) {
            const key = 'axis-' + i;
            const prev = FAR._gamepadState._dbgAxes[key] || 0;
            // Логируем, только если значение заметно изменилось
            if (Math.abs(v - prev) > 0.2) {
                console.log(
                    '%c[Gamepad] ОСЬ #' + i + ' = ' + v.toFixed(2),
                    'color:#f9e2af'
                );
                FAR._gamepadState._dbgAxes[key] = v;
            }
        } else {
            FAR._gamepadState._dbgAxes['axis-' + i] = 0;
        }
    }
};
/**
 * Пишет строку в консоль. Логи всегда включены — помогают отладить
 * отсутствие реакции. Если надоест — выставь FAR._gamepadLogEnabled = false.
 */
FAR._gamepadLogEnabled = true;

FAR._gamepadLog = function(msg) {
    if (!FAR._gamepadLogEnabled) return;
    try {
        console.log('%c' + msg, 'color:#a6e3a1');
    } catch (e) {
        console.log(msg);
    }
};