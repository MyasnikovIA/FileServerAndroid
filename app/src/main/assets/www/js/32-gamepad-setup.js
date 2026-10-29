// ============================================================
// Настройка джойстика: маппинг кнопок → действия + эмуляция клавиш
// ============================================================
//
// Режимы (localStorage: filebd_gamepad_mode):
//   'files'    — только навигация по панелям FAR
//   'keyboard' — только эмуляция клавиш в активное окно/модалку
//   'both'     — и навигация, и эмуляция
//
// Маппинг (localStorage: filebd_gamepad_map):
//   { "<actionId>": { kind:'button'|'axis-neg'|'axis-pos',
//                     code:N, key:'Enter', keyCode:13 } }

FAR.GAMEPAD_LS_KEY = 'filebd_gamepad_map';
FAR.GP_MODE_LS     = 'filebd_gamepad_mode';

// Список действий. Каждому можно назначить:
//   - кнопку/ось джойстика (kind, code)
//   - клавишу (key, keyCode) — что эмулировать в активном окне
//   - опционально — действие навигации FAR (navId), чтобы
//     не дублировать код для режима 'files'
FAR.GAMEPAD_ACTIONS = [
    { id: 'key_a',      navId: 'enter',   label: '🎮 Слот A / Enter',
      kind: 'button',   code: 0,  key: 'Enter',       keyCode: 13 },
    { id: 'key_b',      navId: 'back',    label: '🎮 Слот B / Назад',
      kind: 'button',   code: 1,  key: 'Backspace',   keyCode: 8  },
    { id: 'key_x',      navId: 'toggle',  label: '🎮 Слот X / Выделить',
      kind: 'button',   code: 2,  key: ' ',           keyCode: 32 },
    { id: 'key_y',      navId: 'refresh', label: '🎮 Слот Y / Обновить',
      kind: 'button',   code: 3,  key: 'F5',          keyCode: 116 },
    { id: 'key_l1',     navId: null,      label: '🎮 Слот L1',
      kind: 'button',   code: 4,  key: 'q',           keyCode: 81 },
    { id: 'key_r1',     navId: null,      label: '🎮 Слот R1',
      kind: 'button',   code: 5,  key: 'e',           keyCode: 69 },
    { id: 'key_l2',     navId: null,      label: '🎮 Слот L2',
      kind: 'button',   code: 6,  key: 'r',           keyCode: 82 },
    { id: 'key_r2',     navId: null,      label: '🎮 Слот R2',
      kind: 'button',   code: 7,  key: 'f',           keyCode: 70 },
    { id: 'key_start',  navId: null,      label: '🎮 Start',
      kind: 'button',   code: 9,  key: 'Enter',       keyCode: 13 },
    { id: 'key_select', navId: null,      label: '🎮 Select',
      kind: 'button',   code: 8,  key: 'Escape',      keyCode: 27 },
    { id: 'key_up',     navId: 'up',      label: '🎮 D-Pad ↑',
      kind: 'axis-neg', code: 1,  key: 'ArrowUp',     keyCode: 38 },
    { id: 'key_down',   navId: 'down',    label: '🎮 D-Pad ↓',
      kind: 'axis-pos', code: 1,  key: 'ArrowDown',   keyCode: 40 },
    { id: 'key_left',   navId: 'left',    label: '🎮 D-Pad ←',
      kind: 'axis-neg', code: 0,  key: 'ArrowLeft',   keyCode: 37 },
    { id: 'key_right',  navId: 'right',   label: '🎮 D-Pad →',
      kind: 'axis-pos', code: 0,  key: 'ArrowRight',  keyCode: 39 }
];

// ============================================================
// Режим
// ============================================================

FAR.getGamepadMode = function() {
    try {
        const v = localStorage.getItem(FAR.GP_MODE_LS);
        if (v === 'files' || v === 'keyboard' || v === 'both') return v;
    } catch (e) {}
    return 'files';
};

FAR.setGamepadMode = function(mode) {
    if (mode !== 'files' && mode !== 'keyboard' && mode !== 'both') return;
    try { localStorage.setItem(FAR.GP_MODE_LS, mode); } catch (e) {}
    FAR.gamepadModeUpdateIndicator();
    FAR.toast('Режим джойстика: ' + FAR.gamepadModeLabel(mode), 'info');
};

FAR.gamepadModeLabel = function(mode) {
    if (mode === 'files')    return 'Файлы';
    if (mode === 'keyboard') return 'Клавиши';
    if (mode === 'both')     return 'Файлы + Клавиши';
    return '?';
};

FAR.gamepadModeCycle = function() {
    const order = ['files', 'keyboard', 'both'];
    const cur = FAR.getGamepadMode();
    FAR.setGamepadMode(order[(order.indexOf(cur) + 1) % order.length]);
};

// ============================================================
// Маппинг (localStorage)
// ============================================================

FAR.getGamepadMap = function() {
    let obj = null;
    try {
        const raw = localStorage.getItem(FAR.GAMEPAD_LS_KEY);
        if (raw) obj = JSON.parse(raw);
    } catch (e) {}

    if (!obj || typeof obj !== 'object') obj = {};

    // Дополняем недостающие действия дефолтными
    FAR.GAMEPAD_ACTIONS.forEach(function(a) {
        if (!(a.id in obj)) {
            obj[a.id] = { kind: a.kind, code: a.code, key: a.key, keyCode: a.keyCode };
        } else {
            // Дополняем недостающие поля
            const m = obj[a.id];
            if (m.key === undefined)     m.key = a.key;
            if (m.keyCode === undefined) m.keyCode = a.keyCode;
        }
    });

    return obj;
};

FAR.saveGamepadMapToLS = function(map) {
    try { localStorage.setItem(FAR.GAMEPAD_LS_KEY, JSON.stringify(map)); } catch (e) {}
};

// ============================================================
// Состояние обработчика
// ============================================================

FAR._gamepadState = {
    running: false,
    rafId: null,
    prevButtons: {},
    prevAxes: {},
    repeatTimers: {},
    repeatDelay: 350,
    repeatInterval: 80,
    debug: false
};

// ============================================================
// Хелперы для эмуляции клавиатуры
// ============================================================

FAR._gpFireKey = function(type, key, keyCode) {
    if (!key) return;

    const ev = new KeyboardEvent(type, {
        key: key,
        code: key.length === 1 ? 'Key' + key.toUpperCase() : key,
        bubbles: true,
        cancelable: true,
        composed: true
    });
    try { Object.defineProperty(ev, 'keyCode', { get: () => keyCode }); } catch (e) {}
    try { Object.defineProperty(ev, 'which',   { get: () => keyCode }); } catch (e) {}

    const targets = [];
    if (document.activeElement) targets.push(document.activeElement);
    targets.push(document, window);

    ['emulatorRoot', 'nesRoot', 'jsdosRoot', 'pdfRoot'].forEach(function(id) {
        const el = document.getElementById(id);
        if (!el) return;
        targets.push(el);
        const canvas = el.querySelector('canvas');
        if (canvas) targets.push(canvas);
    });

    const seen = new Set();
    for (const t of targets) {
        if (!t || seen.has(t)) continue;
        seen.add(t);
        try { t.dispatchEvent(ev); } catch (e) {}
    }
};

FAR._gpTapKey = function(key, keyCode) {
    FAR._gpFireKey('keydown', key, keyCode);
    setTimeout(function() {
        FAR._gpFireKey('keyup', key, keyCode);
    }, 30);
};

FAR._gpKeyRepeatable = function(m) {
    if (!m || !m.key) return false;
    const k = m.key;
    if (k.startsWith && k.startsWith('Arrow')) return true;
    if (k === ' ' || k === 'PageUp' || k === 'PageDown') return true;
    return false;
};

// ============================================================
// Автоповтор
// ============================================================

FAR._gpStartRepeat = function(padIndex, key, actionId, mapped) {
    const fullKey = padIndex + ':' + key;
    FAR._gpStopRepeat(padIndex, key);

    FAR._gamepadState.repeatTimers[fullKey] = setTimeout(function() {
        FAR._gamepadState.repeatTimers[fullKey + ':interval'] = setInterval(function() {
            const mode = FAR.getGamepadMode();
            if (mode === 'keyboard' || mode === 'both') {
                FAR._gpTapKey(mapped.key, mapped.keyCode);
            }
        }, FAR._gamepadState.repeatInterval);
    }, FAR._gamepadState.repeatDelay);
};

FAR._gpStopRepeat = function(padIndex, key) {
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

// ============================================================
// Навигация по панелям (для режима 'files' / 'both')
// ============================================================

FAR._gpDispatchNav = function(navId) {
    if (!navId) return;
    const side = FAR.activePanel;
    const items = side === 'left' ? FAR.leftFiles : FAR.rightFiles;

    switch (navId) {
        case 'up':      FAR.moveCursor(side, -1, {}); break;
        case 'down':    FAR.moveCursor(side, +1, {}); break;
        case 'left':    FAR.setActivePanel('left'); break;
        case 'right':   FAR.setActivePanel('right'); break;
        case 'enter': {
            const cursor = side === 'left' ? FAR.leftCursor : FAR.rightCursor;
            if (cursor === -1) FAR.goToParent(side);
            else if (cursor >= 0 && cursor < items.length) FAR.handleItemDblClick(side, cursor);
            break;
        }
        case 'back':    FAR.navigatePanel(side, '..'); break;
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
        case 'refresh': FAR.refreshFiles(); break;
    }
};

FAR._gpIsRepeatable = function(action) {
    return action === 'up' || action === 'down' ||
           action === 'pageUp' || action === 'pageDown';
};

// ============================================================
// Обработчик одного геймпада
// ============================================================

FAR._gamepadHandlePad = function(pad) {
    if (FAR._gamepadState.debug) {
        FAR._gamepadDebugLog(pad);
        return;
    }

    // Не мешаем открытым модалкам настройки
    const setup = document.getElementById('gamepadSetupModal');
    if (setup && !setup.classList.contains('hidden')) {
        FAR._gamepadState.prevButtons[pad.index] = null;
        FAR._gamepadState.prevAxes[pad.index] = null;
        return;
    }

    // Не эмулируем в окне прогресса/подключения
    const prog = document.getElementById('progressOverlay');
    if (prog && !prog.classList.contains('hidden')) {
        FAR._gamepadState.prevButtons[pad.index] = null;
        FAR._gamepadState.prevAxes[pad.index] = null;
        return;
    }
    const conn = document.getElementById('connModal');
    if (conn && !conn.classList.contains('hidden')) {
        FAR._gamepadState.prevButtons[pad.index] = null;
        FAR._gamepadState.prevAxes[pad.index] = null;
        return;
    }

    const mode = FAR.getGamepadMode();
    if (mode === 'files' && FAR._isAnyModalOpen()) {
        FAR._gamepadState.prevButtons[pad.index] = null;
        FAR._gamepadState.prevAxes[pad.index] = null;
        return;
    }

    const buttons = pad.buttons.map(function(b) { return b.pressed; });
    const axes    = pad.axes.slice();

    let prev     = FAR._gamepadState.prevButtons[pad.index];
    let prevAxes = FAR._gamepadState.prevAxes[pad.index];

    if (!prev || !prevAxes) {
        FAR._gamepadState.prevButtons[pad.index] = buttons.slice();
        FAR._gamepadState.prevAxes[pad.index]    = axes.slice();
        return;
    }

    const map = FAR.getGamepadMap();
    const AXIS_THRESHOLD = 0.5;

    FAR.GAMEPAD_ACTIONS.forEach(function(action) {
        const m = map[action.id];
        if (!m || m.code === null || m.code === undefined) return;

        // Если режим 'files' и в действии нет navId — пропускаем
        if (mode === 'files' && !action.navId) return;

        if (m.kind === 'button') {
            const idx = m.code;
            if (idx >= buttons.length) return;
            const pressed    = buttons[idx];
            const wasPressed = prev[idx];

            if (pressed && !wasPressed) {
                if (mode === 'keyboard' || mode === 'both') {
                    FAR._gpTapKey(m.key, m.keyCode);
                }
                if (mode === 'files' || mode === 'both') {
                    FAR._gpDispatchNav(action.navId);
                }
                if (FAR._gpKeyRepeatable(m)) {
                    FAR._gpStartRepeat(pad.index, 'b' + idx, action.id, m);
                }
            } else if (!pressed && wasPressed) {
                FAR._gpStopRepeat(pad.index, 'b' + idx);
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
                if (mode === 'keyboard' || mode === 'both') {
                    FAR._gpTapKey(m.key, m.keyCode);
                }
                if (mode === 'files' || mode === 'both') {
                    FAR._gpDispatchNav(action.navId);
                }
                if (FAR._gpKeyRepeatable(m)) {
                    FAR._gpStartRepeat(pad.index, key, action.id, m);
                }
            } else if (!curOn && oldOn) {
                FAR._gpStopRepeat(pad.index, key);
            }
        }
    });

    FAR._gamepadState.prevButtons[pad.index] = buttons.slice();
    FAR._gamepadState.prevAxes[pad.index]    = axes.slice();
};

FAR._isAnyModalOpen = function() {
    const ids = ['connModal', 'viewerModal', 'panoramaEditorModal',
        'dbPickerModal', 'progressOverlay', 'emulatorViewerModal',
        'nesViewerModal', 'jsdosViewerModal', 'pdfViewerModal',
        'gpuMonitorModal'];
    for (let i = 0; i < ids.length; i++) {
        const el = document.getElementById(ids[i]);
        if (el && !el.classList.contains('hidden')) return true;
    }
    return false;
};

// ============================================================
// Цикл опроса
// ============================================================

FAR._gamepadLoop = function() {
    if (!FAR._gamepadState.running) return;
    try {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i = 0; i < pads.length; i++) {
            const pad = pads[i];
            if (!pad) continue;
            FAR._gamepadHandlePad(pad);
        }
    } catch (e) { /* тихо */ }
    FAR._gamepadState.rafId = requestAnimationFrame(FAR._gamepadLoop);
};

FAR.setupGamepadAuto = function() {
    if (FAR._gamepadState.running) return;
    FAR._gamepadState.running = true;

    window.addEventListener('gamepadconnected', function(e) {
        FAR.toast('🎮 Геймпад подключён: ' + e.gamepad.id, 'info');
    });
    window.addEventListener('gamepaddisconnected', function(e) {
        FAR.toast('🎮 Геймпад отключён', 'warning');
    });

    FAR.gamepadModeUpdateIndicator();
    FAR._gamepadLoop();
};

// ============================================================
// Индикатор режима в тулбаре
// ============================================================

FAR.gamepadModeUpdateIndicator = function() {
    const el = document.getElementById('gpModeIndicator');
    if (!el) return;
    const mode = FAR.getGamepadMode();
    el.textContent = '🎮 ' + FAR.gamepadModeLabel(mode);
    el.title = 'Режим джойстика: ' + FAR.gamepadModeLabel(mode) +
               '\nЛКМ — переключить по кругу\nПКМ — открыть настройку';
    el.className = 'gp-mode-indicator gp-mode-' + mode;
};

// ============================================================
// Окно настройки
// ============================================================

FAR.gpSetupState = {
    draft: null,
    capturing: null,
    capturingKey: null,
    liveRaf: null,
    prev: null,
    bound: false,
    debug: false
};

FAR.openGamepadSetup = function() {
    FAR.gpSetupState.draft = JSON.parse(JSON.stringify(FAR.getGamepadMap()));
    FAR.gpSetupState.capturing = null;
    FAR.gpSetupState.capturingKey = null;

    const modal = document.getElementById('gamepadSetupModal');
    if (!modal) {
        console.error('[Gamepad Setup] #gamepadSetupModal не найден');
        return;
    }
    modal.classList.remove('hidden');
    FAR.gpSetupRender();
    FAR.gpSetupBindOnce();
    FAR.gpSetupStartLive();
    FAR.gpSetupSetStatus('Выберите слот и назначьте кнопку/клавишу.', 'waiting');
};

FAR.closeGamepadSetup = function() {
    FAR.gpSetupState.capturing = null;
    FAR.gpSetupState.capturingKey = null;
    FAR.gpSetupStopLive();
    const modal = document.getElementById('gamepadSetupModal');
    if (modal) modal.classList.add('hidden');
};

FAR.closeGamepadSetupOutside = function(e) {
    if (e.target === e.currentTarget) FAR.closeGamepadSetup();
};

FAR.gpSetupBindOnce = function() {
    if (FAR.gpSetupState.bound) return;
    FAR.gpSetupState.bound = true;

    document.addEventListener('keydown', function(e) {
        const modal = document.getElementById('gamepadSetupModal');
        if (!modal || modal.classList.contains('hidden')) return;

        // Захват клавиши
        if (FAR.gpSetupState.capturingKey) {
            e.preventDefault();
            e.stopPropagation();
            const actionId = FAR.gpSetupState.capturingKey;
            const key = e.key === ' ' ? 'Space' : (e.key.length === 1 ? e.key : e.key);
            const keyCode = e.keyCode || FAR.gpKeyToCode(key);
            FAR.gpSetupState.capturingKey = null;

            const cur = FAR.gpSetupState.draft[actionId] || {};
            FAR.gpSetupState.draft[actionId] = {
                kind: cur.kind || null,
                code: (cur.code !== null && cur.code !== undefined) ? cur.code : null,
                key: key,
                keyCode: keyCode
            };
            FAR.gpSetupSetStatus('Клавиша назначена: ' + key, '');
            FAR.gpSetupRender();
            return;
        }

        if (e.key === 'Escape') {
            FAR.closeGamepadSetup();
            e.stopPropagation();
        }
    }, true);
};

FAR.gpSetupSetStatus = function(text, cls) {
    const el = document.getElementById('gpSetupStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'gp-setup-status' + (cls ? ' ' + cls : '');
};

FAR.gpSetupRender = function() {
    const box = document.getElementById('gpSetupActionsList');
    if (!box) return;
    box.innerHTML = '';

    FAR.GAMEPAD_ACTIONS.forEach(function(action) {
        const m = FAR.gpSetupState.draft[action.id] || { kind: null, code: null, key: '', keyCode: 0 };
        const row = document.createElement('div');
        const assigned = m.code !== null && m.code !== undefined && m.key;
        const capturing = FAR.gpSetupState.capturing === action.id;
        const capturingKey = FAR.gpSetupState.capturingKey === action.id;
        row.className = 'gp-setup-row' +
            (assigned ? ' assigned' : '') +
            (capturing || capturingKey ? ' capturing' : '');

        const label = document.createElement('span');
        label.className = 'gp-setup-label';
        label.textContent = action.label;

        const mapping = document.createElement('span');
        mapping.className = 'gp-setup-mapping';
        mapping.textContent = FAR.gpSetupMapToString(m);

        const keyLabel = document.createElement('span');
        keyLabel.className = 'gp-setup-key';
        keyLabel.textContent = m.key || '—';

        const btnJoy = document.createElement('button');
        btnJoy.className = 'gp-setup-btn' + (capturing ? ' capture' : '');
        btnJoy.textContent = capturing ? '⏳ Ждём…' : '🎯 Джойстик';
        btnJoy.onclick = function() { FAR.gpSetupStartCapture(action.id); };

        const btnKey = document.createElement('button');
        btnKey.className = 'gp-setup-btn' + (capturingKey ? ' capture' : '');
        btnKey.textContent = capturingKey ? '⏳ Ждём…' : '⌨️ Клавиша';
        btnKey.onclick = function() { FAR.gpSetupCaptureKey(action.id); };

        const btnClear = document.createElement('button');
        btnClear.className = 'gp-setup-btn clear';
        btnClear.textContent = '✕';
        btnClear.title = 'Очистить';
        btnClear.onclick = function() {
            FAR.gpSetupState.draft[action.id] = { kind: null, code: null, key: '', keyCode: 0 };
            FAR.gpSetupRender();
        };

        row.appendChild(label);
        row.appendChild(mapping);
        row.appendChild(keyLabel);
        row.appendChild(btnJoy);
        row.appendChild(btnKey);
        row.appendChild(btnClear);
        box.appendChild(row);
    });
};

FAR.gpSetupMapToString = function(m) {
    if (!m || m.code === null || m.code === undefined) return '— не задано —';
    if (m.kind === 'button')   return 'Кнопка #' + m.code;
    if (m.kind === 'axis-neg') return 'Ось ' + m.code + ' «−»';
    if (m.kind === 'axis-pos') return 'Ось ' + m.code + ' «+»';
    return '—';
};

FAR.gpSetupStartCapture = function(actionId) {
    FAR.gpSetupState.capturing = actionId;
    FAR.gpSetupState.capturingKey = null;
    FAR.gpSetupSetStatus('Нажмите кнопку джойстика или двиньте ось…', 'waiting');
    FAR.gpSetupRender();
};

FAR.gpSetupCaptureKey = function(actionId) {
    FAR.gpSetupState.capturingKey = actionId;
    FAR.gpSetupState.capturing = null;
    FAR.gpSetupSetStatus('Нажмите клавишу на клавиатуре…', 'waiting');
    FAR.gpSetupRender();
};

FAR.gpKeyToCode = function(key) {
    const table = {
        'Enter': 13, 'Escape': 27, 'Space': 32, ' ': 32, 'Tab': 9, 'Backspace': 8,
        'ArrowUp': 38, 'ArrowDown': 40, 'ArrowLeft': 37, 'ArrowRight': 39,
        'Home': 36, 'End': 35, 'PageUp': 33, 'PageDown': 34,
        'Delete': 46, 'Insert': 45,
        'F1': 112, 'F2': 113, 'F3': 114, 'F4': 115,
        'F5': 116, 'F6': 117, 'F7': 118, 'F8': 119,
        'F9': 120, 'F10': 121, 'F11': 122, 'F12': 123
    };
    if (table[key] !== undefined) return table[key];
    if (key.length === 1) {
        const c = key.toUpperCase().charCodeAt(0);
        if (c >= 32 && c <= 126) return c;
    }
    return 0;
};

FAR.gpSetupHandleInput = function(kind, code) {
    if (!FAR.gpSetupState.capturing) return false;
    const actionId = FAR.gpSetupState.capturing;

    const cur = FAR.gpSetupState.draft[actionId] || {};
    FAR.gpSetupState.draft[actionId] = {
        kind: kind,
        code: code,
        key: cur.key || '',
        keyCode: cur.keyCode || 0
    };

    FAR.gpSetupState.capturing = null;
    FAR.gpSetupSetStatus('Джойстик назначен: ' + FAR.gpSetupMapToString({ kind: kind, code: code }), '');
    FAR.gpSetupRender();
    return true;
};

FAR.saveGamepadMap = function() {
    if (!FAR.gpSetupState.draft) return;
    FAR.saveGamepadMapToLS(FAR.gpSetupState.draft);
    FAR.toast('Маппинг джойстика сохранён', 'success');
    FAR.closeGamepadSetup();
};

FAR.resetGamepadMap = function() {
    if (!confirm('Сбросить маппинг джойстика к значениям по умолчанию?')) return;
    try { localStorage.removeItem(FAR.GAMEPAD_LS_KEY); } catch (e) {}
    FAR.gpSetupState.draft = FAR.getGamepadMap();
    FAR.gpSetupRender();
    FAR.toast('Маппинг сброшен', 'info');
};

// ============================================================
// Live-цикл
// ============================================================

FAR.gpSetupStartLive = function() {
    if (FAR.gpSetupState.liveRaf) return;
    FAR.gpSetupState.prev = null;
    FAR.gpSetupLiveLoop();
};

FAR.gpSetupStopLive = function() {
    if (FAR.gpSetupState.liveRaf) {
        cancelAnimationFrame(FAR.gpSetupState.liveRaf);
        FAR.gpSetupState.liveRaf = null;
    }
    FAR.gpSetupState.prev = null;
};

FAR.gpSetupLiveLoop = function() {
    const modal = document.getElementById('gamepadSetupModal');
    if (!modal || modal.classList.contains('hidden')) {
        FAR.gpSetupStopLive();
        return;
    }

    let pad = null;
    try {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i = 0; i < pads.length; i++) if (pads[i]) { pad = pads[i]; break; }
    } catch (e) {}

    if (pad) FAR.gpSetupUpdateLive(pad);
    else FAR.gpSetupSetStatus('Джойстик не найден. Нажмите любую кнопку.', 'waiting');

    FAR.gpSetupState.liveRaf = requestAnimationFrame(FAR.gpSetupLiveLoop);
};

FAR.gpSetupUpdateLive = function(pad) {
    const buttons = pad.buttons.map(function(b) { return b.pressed; });
    const axes = pad.axes.slice();

    if (!FAR.gpSetupState.prev) {
        FAR.gpSetupState.prev = { buttons: buttons.slice(), axes: axes.slice() };
        return;
    }
    const prev = FAR.gpSetupState.prev;

    if (FAR.gpSetupState.capturing) {
        for (let i = 0; i < buttons.length; i++) {
            if (buttons[i] && !prev.buttons[i]) {
                FAR.gpSetupHandleInput('button', i);
                FAR.gpSetupState.prev = { buttons: buttons.slice(), axes: axes.slice() };
                return;
            }
        }
        const TH = 0.5;
        for (let i = 0; i < axes.length; i++) {
            const cur = axes[i];
            const old = prev.axes[i] || 0;
            if (cur < -TH && old >= -TH) {
                FAR.gpSetupHandleInput('axis-neg', i);
                FAR.gpSetupState.prev = { buttons: buttons.slice(), axes: axes.slice() };
                return;
            }
            if (cur > TH && old <= TH) {
                FAR.gpSetupHandleInput('axis-pos', i);
                FAR.gpSetupState.prev = { buttons: buttons.slice(), axes: axes.slice() };
                return;
            }
        }
    }

    FAR.gpSetupState.prev = { buttons: buttons.slice(), axes: axes.slice() };
};

// ============================================================
// Диагностика
// ============================================================

FAR._gamepadLogEnabled = true;
FAR._gamepadLog = function(msg) {
    if (!FAR._gamepadLogEnabled) return;
    try { console.log('%c' + msg, 'color:#a6e3a1'); } catch (e) { console.log(msg); }
};

FAR._gamepadDebugLog = function(pad) {
    for (let i = 0; i < pad.buttons.length; i++) {
        const b = pad.buttons[i];
        if (b.pressed) {
            const key = 'btn-' + i;
            if (!FAR._gamepadState._dbgLast) FAR._gamepadState._dbgLast = {};
            if (!FAR._gamepadState._dbgLast[key]) {
                console.log('[Gamepad] КНОПКА #' + i + ' нажата (value=' + b.value.toFixed(2) + ')');
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
    for (let i = 0; i < pad.axes.length; i++) {
        const v = pad.axes[i];
        if (Math.abs(v) > 0.3) {
            if (!FAR._gamepadState._dbgAxes) FAR._gamepadState._dbgAxes = {};
            const key = 'axis-' + i;
            const prev = FAR._gamepadState._dbgAxes[key] || 0;
            if (Math.abs(v - prev) > 0.2) {
                console.log('[Gamepad] ОСЬ #' + i + ' = ' + v.toFixed(2));
                FAR._gamepadState._dbgAxes[key] = v;
            }
        } else {
            if (!FAR._gamepadState._dbgAxes) FAR._gamepadState._dbgAxes = {};
            FAR._gamepadState._dbgAxes['axis-' + i] = 0;
        }
    }
};

FAR.gamepadDebug = function() {
    FAR._gamepadState.debug = !FAR._gamepadState.debug;
    if (FAR._gamepadState.debug) {
        console.log('%c[Gamepad] Диагностика ВКЛЮЧЕНА', 'color:#a6e3a1');
    } else {
        console.log('[Gamepad] Диагностика ВЫКЛЮЧЕНА');
    }
};