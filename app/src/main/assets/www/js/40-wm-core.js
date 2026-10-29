// ============================================================
// 40-wm-core.js — ядро оконного менеджера
// ============================================================

FAR.WM = FAR.WM || {};
FAR.WM.LS_MODE_KEY = 'filebd_ui_mode';
FAR.WM.LS_WINDOWS_KEY = 'filebd_wm_windows';

FAR.WM._SKIP_RESTORE_APPS = {
    'jsdos': 1,
    'nes': 1,
    'emulator': 1
};

FAR.WM.state = {
    active: false,
    windows: [],
    nextId: 1,
    activeWindowId: null,
    zTop: 6000,
    dragState: null,
    resizeState: null,
    snapZone: 40,
    snapPreviewEl: null,
    taskbarHeight: 48,
    lastDesktopIconPos: 0
};

// ============================================================
// Публичный API
// ============================================================

FAR.WM.enter = function () {
    if (FAR.WM.state.active) return;

    FAR.WM._closeAllModals();

    const root = document.getElementById('wmRoot');
    if (!root) {
        console.error('[WM] #wmRoot не найден. Проверь modals/desktop.html и injectModals.');
        return;
    }
    root.classList.add('active');
    FAR.WM.state.active = true;

    FAR.WM.saveMode('wm');

    FAR.WM._bindGlobalEvents();
    FAR.WM._renderDesktopIcons();
    FAR.WM._renderStartMenu();
    FAR.WM._startClock();

    FAR.WM._restoreWindows().catch(function (e) {
        console.warn('[WM restore] failed:', e);
    });

    FAR.toast('Оконный режим включён', 'info');
};

FAR.WM.exit = function () {
    if (!FAR.WM.state.active) return;

    FAR.WM._saveWindowState();

    const ids = FAR.WM.state.windows.map(w => w.id);
    for (const id of ids) FAR.WM.closeWindow(id, true);

    const root = document.getElementById('wmRoot');
    if (root) root.classList.remove('active');

    FAR.WM.state.active = false;
    FAR.WM.state.activeWindowId = null;
    FAR.WM.state.zTop = 6000;

    FAR.WM.saveMode('panel');

    FAR.WM._stopClock();
    FAR.toast('Возврат в классический режим', 'info');
};

FAR.WM.toggle = function () {
    if (FAR.WM.state.active) FAR.WM.exit();
    else FAR.WM.enter();
};

// ============================================================
// Создание окна
// ============================================================

FAR.WM.openWindow = function (opts) {
    opts = opts || {};
    const id = 'wm-win-' + (FAR.WM.state.nextId++);

    const desktop = document.getElementById('wmDesktop');
    const layer = document.getElementById('wmWindowsLayer') || desktop;
    const rect = FAR.WM._getDesktopRect();

    // ============================================================
    // Клампим размеры окна к размеру вьюпорта — чтобы окно,
    // сохранённое на большом экране, не вылезало за границы
    // маленького (мобильного) экрана.
    // ============================================================
    const maxW = Math.max(280, rect.width  - 40);
    const maxH = Math.max(160, rect.height - 40);

    let w = opts.width  || Math.min(1000, maxW);
    let h = opts.height || Math.min(680,  maxH);
    if (w > maxW) w = maxW;
    if (h > maxH) h = maxH;
    if (w < 100) w = 100;
    if (h <  80) h =  80;

    let x = opts.x, y = opts.y;
    if (x === undefined || y === undefined) {
        const offset = (FAR.WM.state.windows.length % 8) * 24;
        x = Math.max(20, Math.round((rect.width  - w) / 2) - 80 + offset);
        y = Math.max(20, Math.round((rect.height - h) / 2) - 60 + offset);
    }

    // Клампим позицию: заголовок окна должен быть в пределах вьюпорта
    if (x + w > rect.width)  x = Math.max(0, rect.width  - w);
    if (y + h > rect.height) y = Math.max(0, rect.height - h);
    if (x < 0) x = 0;
    if (y < 0) y = 0;

    const el = document.createElement('div');
    el.className = 'wm-window';
    el.id = id;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.style.width  = w + 'px';
    el.style.height = h + 'px';

    const icon = opts.icon || '🪟';
    const title = opts.title || 'Окно';

    el.innerHTML =
        '<div class="wm-titlebar" data-role="titlebar">' +
        '<span class="wm-title-text">' + FAR.escapeHtml(title) + '</span>' +
        '<div class="wm-title-actions">' +
        '<button class="wm-title-btn wm-btn-min" title="Свернуть">─</button>' +
        '<button class="wm-title-btn wm-btn-max" title="Развернуть">□</button>' +
        '<button class="wm-title-btn wm-btn-close" title="Закрыть">✕</button>' +
        '</div>' +
        '</div>' +
        '<div class="wm-body" data-role="body"></div>' +
        '<div class="wm-resize wm-resize-n"  data-dir="n"></div>' +
        '<div class="wm-resize wm-resize-s"  data-dir="s"></div>' +
        '<div class="wm-resize wm-resize-w"  data-dir="w"></div>' +
        '<div class="wm-resize wm-resize-e"  data-dir="e"></div>' +
        '<div class="wm-resize wm-resize-nw" data-dir="nw"></div>' +
        '<div class="wm-resize wm-resize-ne" data-dir="ne"></div>' +
        '<div class="wm-resize wm-resize-sw" data-dir="sw"></div>' +
        '<div class="wm-resize wm-resize-se" data-dir="se"></div>';

    const bodyEl = el.querySelector('[data-role="body"]');
    FAR.WM._fillBody(bodyEl, opts.content);

    el.querySelector('.wm-btn-min').addEventListener('click', function (e) {
        e.stopPropagation();
        FAR.WM.minimizeWindow(id);
    });
    el.querySelector('.wm-btn-max').addEventListener('click', function (e) {
        e.stopPropagation();
        FAR.WM.toggleMaximize(id);
    });
    el.querySelector('.wm-btn-close').addEventListener('click', function (e) {
        e.stopPropagation();
        FAR.WM.closeWindow(id);
    });

    el.addEventListener('mousedown', function () {
        FAR.WM.focusWindow(id);
    }, true);

    const titlebar = el.querySelector('[data-role="titlebar"]');
    titlebar.addEventListener('mousedown', function (e) {
        if (e.target.closest('.wm-title-btn')) return;
        FAR.WM._startDrag(e, id);
    });

    // ============================================================
    // Двойной клик по заголовку → развернуть/восстановить.
    // Эмулируем клик по кнопке .wm-btn-max, чтобы срабатывало
    // ровно то же событие, что и при явном нажатии кнопки
    // (см. требование: «срабатывает событие кнопки wm-btn-max»).
    // ============================================================
    titlebar.addEventListener('dblclick', function (e) {
        if (e.target.closest('.wm-title-btn')) return;
        e.preventDefault();
        e.stopPropagation();

        const maxBtn = el.querySelector('.wm-btn-max');
        if (maxBtn) {
            maxBtn.click();
        } else {
            FAR.WM.toggleMaximize(id);
        }
    });

    el.querySelectorAll('.wm-resize').forEach(function (handle) {
        handle.addEventListener('mousedown', function (e) {
            FAR.WM._startResize(e, id, handle.dataset.dir);
        });
    });

    layer.appendChild(el);

    const win = {
        id: id,
        title: title,
        icon: icon,
        appId: opts.appId || null,
        el: el,
        bodyEl: bodyEl,
        x: x, y: y, w: w, h: h,
        prevRect: null,
        minimized: false,
        maximized: false,
        snap: null,
        modalParent: opts.parentId || null,
        onClose: opts.onClose || null,
        props: opts.props || {},
        createdAt: Date.now()
    };
    FAR.WM.state.windows.push(win);

    FAR.WM.focusWindow(id);
    FAR.WM._renderTaskbar();

    if (opts.modal && opts.parentId) {
        const parent = FAR.WM.getWindow(opts.parentId);
        if (parent) parent.el.classList.add('modal-locked');
    }

    FAR.WM._saveWindowStateDebounced();

    return win;
};

FAR.WM.closeWindow = function (id, force) {
    const idx = FAR.WM.state.windows.findIndex(w => w.id === id);
    if (idx < 0) return;
    const win = FAR.WM.state.windows[idx];

    if (win.modalParent) {
        const parent = FAR.WM.getWindow(win.modalParent);
        if (parent) parent.el.classList.remove('modal-locked');
    }

    if (win.props && win.props._stash && typeof FAR.WM._unstashModalIds === 'function') {
        FAR.WM._unstashModalIds(win.props._stash);
        win.props._stash = null;
    }

    if (win.appId === 'explorer' && typeof FAR.WM._cleanupExplorerPanel === 'function') {
        try { FAR.WM._cleanupExplorerPanel(win); } catch (e) { /* ignore */ }
    }

    if (!force && typeof win.onClose === 'function') {
        try { win.onClose(win); } catch (e) { console.warn('[WM] onClose:', e); }
    }

    win.el.remove();
    FAR.WM.state.windows.splice(idx, 1);

    if (FAR.WM.state.activeWindowId === id) {
        const next = FAR.WM.state.windows
            .filter(w => !w.minimized)
            .sort((a, b) => (b.zTop || 0) - (a.zTop || 0))[0];
        FAR.WM.state.activeWindowId = next ? next.id : null;
        if (next) FAR.WM.focusWindow(next.id);
    }

    FAR.WM._renderTaskbar();

    if (!force) {
        FAR.WM._saveWindowStateDebounced();
    }
};

// ============================================================
// Перетаскивание
// ============================================================

FAR.WM._startDrag = function (e, id) {
    const win = FAR.WM.getWindow(id);
    if (!win || win.maximized) return;
    if (e.button !== 0) return;

    let startX = e.clientX, startY = e.clientY;
    let origX = win.x, origY = win.y;
    let wasSnapped = win.snap;

    if (wasSnapped) {
        const r = win.prevRect || { x: 100, y: 100, w: 800, h: 600 };
        FAR.WM._applyRect(win, { x: e.clientX - r.w / 2, y: e.clientY - 15, w: r.w, h: r.h });
        win.el.classList.remove('snapped-left', 'snapped-right');
        win.snap = null;
        origX = win.x; origY = win.y;
    }

    FAR.WM.state.dragState = {
        id: id,
        offsetX: startX - origX,
        offsetY: startY - origY,
        snapCandidate: null
    };
    win.el.classList.add('dragging');

    const onMove = FAR.WM._onDragMove;
    const onUp = FAR.WM._onDragUp;

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
};

FAR.WM._onDragMove = function (e) {
    const st = FAR.WM.state.dragState;
    if (!st) return;
    const win = FAR.WM.getWindow(st.id);
    if (!win) return;

    const rect = FAR.WM._getDesktopRect();
    let newX = e.clientX - st.offsetX;
    let newY = e.clientY - st.offsetY;

    newX = Math.max(-win.w + 100, Math.min(rect.width  - 100, newX));
    newY = Math.max(0, Math.min(rect.height - 30, newY));

    win.x = newX;
    win.y = newY;
    win.el.style.left = newX + 'px';
    win.el.style.top  = newY + 'px';

    const zone = FAR.WM.state.snapZone;
    let snap = null;
    if (e.clientX < zone) snap = 'left';
    else if (e.clientX > rect.width - zone + rect.left) snap = 'right';

    st.snapCandidate = snap;
    FAR.WM._showSnapPreview(snap);
};

FAR.WM._onDragUp = function () {
    const st = FAR.WM.state.dragState;
    document.removeEventListener('mousemove', FAR.WM._onDragMove);
    document.removeEventListener('mouseup',   FAR.WM._onDragUp);
    if (!st) return;
    const win = FAR.WM.getWindow(st.id);
    if (win) win.el.classList.remove('dragging');

    const snap = st.snapCandidate;
    FAR.WM.state.dragState = null;
    FAR.WM._hideSnapPreview();

    if (snap && win) FAR.WM.snapWindow(win.id, snap);
};

FAR.WM._showSnapPreview = function (side) {
    const el = document.getElementById('wmSnapPreview');
    if (!el) return;
    if (!side) {
        el.style.display = 'none';
        return;
    }
    const rect = FAR.WM._getDesktopRect();
    if (side === 'left') {
        el.style.left = '0px';
        el.style.top  = '0px';
        el.style.width  = Math.floor(rect.width / 2) + 'px';
        el.style.height = rect.height + 'px';
    } else {
        el.style.left = Math.floor(rect.width / 2) + 'px';
        el.style.top  = '0px';
        el.style.width  = Math.ceil(rect.width / 2) + 'px';
        el.style.height = rect.height + 'px';
    }
    el.style.display = 'block';
};

FAR.WM._hideSnapPreview = function () {
    const el = document.getElementById('wmSnapPreview');
    if (el) el.style.display = 'none';
};

// ============================================================
// Ресайз
// ============================================================

FAR.WM._startResize = function (e, id, dir) {
    const win = FAR.WM.getWindow(id);
    if (!win || win.maximized) return;
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    FAR.WM.state.resizeState = {
        id: id,
        dir: dir,
        startX: e.clientX,
        startY: e.clientY,
        origX: win.x, origY: win.y,
        origW: win.w, origH: win.h
    };
    win.el.classList.add('resizing');
    FAR.WM.focusWindow(id);

    document.addEventListener('mousemove', FAR.WM._onResizeMove);
    document.addEventListener('mouseup',   FAR.WM._onResizeUp);
};

FAR.WM._onResizeMove = function (e) {
    const st = FAR.WM.state.resizeState;
    if (!st) return;
    const win = FAR.WM.getWindow(st.id);
    if (!win) return;

    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    const minW = 320, minH = 180;

    let nx = st.origX, ny = st.origY, nw = st.origW, nh = st.origH;

    if (st.dir.includes('e')) nw = Math.max(minW, st.origW + dx);
    if (st.dir.includes('s')) nh = Math.max(minH, st.origH + dy);
    if (st.dir.includes('w')) {
        nw = Math.max(minW, st.origW - dx);
        nx = st.origX + (st.origW - nw);
    }
    if (st.dir.includes('n')) {
        nh = Math.max(minH, st.origH - dy);
        ny = st.origY + (st.origH - nh);
    }

    FAR.WM._applyRect(win, { x: nx, y: ny, w: nw, h: nh });
};

FAR.WM._onResizeUp = function () {
    document.removeEventListener('mousemove', FAR.WM._onResizeMove);
    document.removeEventListener('mouseup',   FAR.WM._onResizeUp);
    const st = FAR.WM.state.resizeState;
    if (st) {
        const win = FAR.WM.getWindow(st.id);
        if (win) win.el.classList.remove('resizing');
    }
    FAR.WM.state.resizeState = null;
};

// ============================================================
// Вспомогательные
// ============================================================

FAR.WM._applyRect = function (win, r) {
    win.x = r.x; win.y = r.y; win.w = r.w; win.h = r.h;
    win.el.style.left   = r.x + 'px';
    win.el.style.top    = r.y + 'px';
    win.el.style.width  = r.w + 'px';
    win.el.style.height = r.h + 'px';

    if (typeof win.props.onResize === 'function') {
        try { win.props.onResize(win, r); } catch (e) {}
    }
};

FAR.WM._getDesktopRect = function () {
    const el = document.getElementById('wmDesktop');
    if (!el) return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight - 48, left: 0, top: 0 };
    const r = el.getBoundingClientRect();
    return {
        x: 0, y: 0,
        left: r.left, top: r.top,
        width: r.width, height: r.height
    };
};

FAR.WM._fillBody = function (bodyEl, content) {
    if (!content) return;
    if (typeof content === 'string') {
        bodyEl.innerHTML = content;
    } else if (content instanceof HTMLElement) {
        bodyEl.appendChild(content);
    }
};

// ============================================================
// Глобальные события (keydown, resize)
// ============================================================

FAR.WM._bound = false;

FAR.WM._bindGlobalEvents = function () {
    if (FAR.WM._bound) return;
    FAR.WM._bound = true;

    document.addEventListener('keydown', function (e) {
        if (!FAR.WM.state.active) return;

        if (e.altKey && e.key === 'Tab') {
            e.preventDefault();
            FAR.WM._cycleWindows(e.shiftKey ? -1 : +1);
            return;
        }

        if (e.altKey && (e.key === 'F4' || e.keyCode === 115)) {
            e.preventDefault();
            if (FAR.WM.state.activeWindowId) {
                FAR.WM.closeWindow(FAR.WM.state.activeWindowId);
            }
            return;
        }

        if (e.ctrlKey && e.key === 'Escape') {
            e.preventDefault();
            FAR.WM.toggleStartMenu();
            return;
        }

        if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
            e.preventDefault();
            FAR.WM.openApp('explorer');
            return;
        }

        if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
            e.preventDefault();
            FAR.WM.state.windows.forEach(w => FAR.WM.minimizeWindow(w.id));
            return;
        }

        if (e.key === 'Escape') {
            FAR.WM._hideContextMenu();
            FAR.WM.closeStartMenu();
        }
    }, true);

    // ============================================================
    // Resize вьюпорта: пересчитываем maximized/snapped окна
    // И клампим обычные окна, чтобы они не вылезали за экран.
    // ============================================================
    window.addEventListener('resize', function () {
        if (!FAR.WM.state.active) return;
        const rect = FAR.WM._getDesktopRect();
        FAR.WM.state.windows.forEach(function (w) {
            if (w.maximized) {
                FAR.WM._applyRect(w, { x: 0, y: 0, w: rect.width, h: rect.height });
            } else if (w.snap === 'left') {
                FAR.WM.snapWindow(w.id, 'left');
            } else if (w.snap === 'right') {
                FAR.WM.snapWindow(w.id, 'right');
            } else {
                // Клампим обычные окна к новому размеру вьюпорта
                let nx = w.x, ny = w.y, nw = w.w, nh = w.h;
                const maxW = Math.max(280, rect.width  - 20);
                const maxH = Math.max(160, rect.height - 20);
                if (nw > maxW) nw = maxW;
                if (nh > maxH) nh = maxH;
                if (nx + nw > rect.width)  nx = Math.max(0, rect.width  - nw);
                if (ny + nh > rect.height) ny = Math.max(0, rect.height - nh);
                if (nx < 0) nx = 0;
                if (ny < 0) ny = 0;
                if (nx !== w.x || ny !== w.y || nw !== w.w || nh !== w.h) {
                    FAR.WM._applyRect(w, { x: nx, y: ny, w: nw, h: nh });
                }
            }
        });
    });

    document.addEventListener('mousedown', function (e) {
        if (!FAR.WM.state.active) return;
        const sm = document.getElementById('wmStartMenu');
        const btn = document.getElementById('wmStartBtn');
        if (sm && sm.classList.contains('open') &&
            !sm.contains(e.target) && !btn.contains(e.target)) {
            FAR.WM.closeStartMenu();
        }
        const cm = document.getElementById('wmContextMenu');
        if (cm && cm.classList.contains('open') && !cm.contains(e.target)) {
            FAR.WM._hideContextMenu();
        }
    }, true);
};

FAR.WM._cycleWindows = function (dir) {
    const list = FAR.WM.state.windows.filter(w => !w.minimized);
    if (list.length < 2) return;
    list.sort((a, b) => (b.zTop || 0) - (a.zTop || 0));
    const curIdx = list.findIndex(w => w.id === FAR.WM.state.activeWindowId);
    let nextIdx = (curIdx + dir + list.length) % list.length;
    FAR.WM.focusWindow(list[nextIdx].id);
};

// ============================================================
// Закрытие всех модалок-оверлеев (перед входом в WM)
// ============================================================

FAR.WM._closeAllModals = function () {
    const closers = [
        'closeViewer', 'closePanoramaViewer', 'closePdfViewer',
        'closeMp3Viewer', 'closeVideoViewer', 'closeJsdosViewer',
        'closeNesViewer', 'closeEmulatorViewer', 'closeDbPicker',
        'closePanoramaEditor', 'closeGamepadSetup', 'closeConnModal'
    ];
    for (const fn of closers) {
        try {
            if (typeof FAR[fn] === 'function') FAR[fn]();
        } catch (e) { /* ignore */ }
    }
    document.querySelectorAll('.modal-overlay').forEach(function (el) {
        el.classList.add('hidden');
    });
};

// ============================================================
// Часы
// ============================================================

FAR.WM._clockTimer = null;

FAR.WM._startClock = function () {
    FAR.WM._stopClock();
    FAR.WM._tickClock();
    FAR.WM._clockTimer = setInterval(FAR.WM._tickClock, 1000);
};

FAR.WM._stopClock = function () {
    if (FAR.WM._clockTimer) {
        clearInterval(FAR.WM._clockTimer);
        FAR.WM._clockTimer = null;
    }
};

FAR.WM._tickClock = function () {
    const el = document.getElementById('wmTrayClock');
    if (!el) return;
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    el.innerHTML = '<div>' + hh + ':' + mm + '</div>' +
        '<div class="wm-clock-date">' + dd + '.' + mo + '.' + yy + '</div>';
};

/**
 * Обновляет трей. Прогресс агрегируется по всем активным инстансам.
 */
FAR.WM.updateTray = function () {
    // БД
    const dbEl = document.getElementById('wmTrayDb');
    if (dbEl) {
        const ctx = FAR.side[FAR.activePanel];
        const txt = (ctx && ctx.conn) ? FAR.connLabel(ctx.conn) : '— нет —';
        const span = dbEl.querySelector('span');
        if (span) span.textContent = txt;
        dbEl.title = 'Источник активной панели: ' + txt;
    }

    // Джойстик
    const gpEl = document.getElementById('wmTrayGamepad');
    if (gpEl) {
        const mode = (typeof FAR.getGamepadMode === 'function') ? FAR.getGamepadMode() : 'files';
        const label = (typeof FAR.gamepadModeLabel === 'function')
            ? FAR.gamepadModeLabel(mode) : mode;
        const span = gpEl.querySelector('span');
        if (span) span.textContent = label;
    }

    // Прогресс — агрегация по всем активным инстансам
    const prEl = document.getElementById('wmTrayProgress');
    if (prEl) {
        let activeCount = 0;
        let lastActive = null;
        if (FAR.progressManager && FAR.progressManager.instances) {
            for (const inst of FAR.progressManager.instances.values()) {
                if (inst.state.active) {
                    activeCount++;
                    lastActive = inst;
                }
            }
        }
        if (activeCount === 0) {
            prEl.style.display = 'none';
        } else {
            prEl.style.display = '';
            const span = prEl.querySelector('span');
            if (span) {
                if (activeCount === 1 && lastActive) {
                    const pct = lastActive.state.total > 0
                        ? Math.round((lastActive.state.current / lastActive.state.total) * 100)
                        : 0;
                    span.textContent = pct + '%';
                } else {
                    span.textContent = activeCount + ' задач';
                }
            }
        }
    }
};

FAR.WM.getSavedMode = function () {
    try {
        const v = localStorage.getItem(FAR.WM.LS_MODE_KEY);
        if (v === 'wm' || v === 'panel') return v;
    } catch (e) { /* ignore */ }
    return 'panel';
};

FAR.WM.saveMode = function (mode) {
    try {
        if (mode === 'wm' || mode === 'panel') {
            localStorage.setItem(FAR.WM.LS_MODE_KEY, mode);
        }
    } catch (e) { /* ignore */ }
};

FAR.WM.clearMode = function () {
    try { localStorage.removeItem(FAR.WM.LS_MODE_KEY); } catch (e) {}
    try { FAR.WM.clearWindowState(); } catch (e) {}
    try { localStorage.removeItem(FAR.WM.PICKER_LAST_DIR); } catch (e) {}
};

FAR.WM.exitToPanelMode = function () {
    try { FAR.WM.closeStartMenu(); } catch (e) { /* ignore */ }
    FAR.WM.saveMode('panel');
    if (FAR.WM.state.active) {
        FAR.WM.exit();
    }
    FAR.toast('Режим: панельный', 'info');
};

FAR.WM._serializableProps = function (props) {
    const out = {};
    if (!props) return out;

    if (props.side === 'left' || props.side === 'right') {
        out.side = props.side;
    }

    if (props.file && typeof props.file === 'object') {
        out.file = {
            _id: props.file._id || '',
            name: props.file.name || '',
            path: props.file.path || '',
            size: props.file.size || 0,
            isFolder: !!props.file.isFolder,
            docType: props.file.docType || 'file',
            binary: !!props.file.binary,
            contentType: props.file.contentType || '',
            children: Array.isArray(props.file.children) ? props.file.children.slice() : []
        };
    }

    if (props.filter) out.filter = String(props.filter);

    return out;
};

FAR.WM._serializeWindow = function (win) {
    if (!win || !win.appId) return null;
    if (win.modalParent) return null;
    if (FAR.WM._SKIP_RESTORE_APPS[win.appId]) return null;

    return {
        appId: win.appId,
        title: win.title || '',
        icon: win.icon || '🪟',
        x: win.x,
        y: win.y,
        w: win.w,
        h: win.h,
        minimized: !!win.minimized,
        maximized: !!win.maximized,
        snap: win.snap || null,
        zTop: win.zTop || 0,
        props: FAR.WM._serializableProps(win.props)
    };
};

FAR.WM._saveWindowState = function () {
    try {
        const snaps = [];
        FAR.WM.state.windows.forEach(function (w) {
            const s = FAR.WM._serializeWindow(w);
            if (s) snaps.push(s);
        });
        localStorage.setItem(FAR.WM.LS_WINDOWS_KEY, JSON.stringify(snaps));
    } catch (e) { /* ignore */ }
};

FAR.WM._saveWindowStateTimer = null;
FAR.WM._saveWindowStateDebounced = function () {
    if (FAR.WM._saveWindowStateTimer) return;
    FAR.WM._saveWindowStateTimer = setTimeout(function () {
        FAR.WM._saveWindowStateTimer = null;
        FAR.WM._saveWindowState();
    }, 200);
};

FAR.WM._loadWindowState = function () {
    try {
        const raw = localStorage.getItem(FAR.WM.LS_WINDOWS_KEY);
        if (raw === null) return null;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return null;
        return arr;
    } catch (e) {
        return null;
    }
};

FAR.WM.clearWindowState = function () {
    try { localStorage.removeItem(FAR.WM.LS_WINDOWS_KEY); } catch (e) {}
};

FAR.WM._restoreWindows = async function () {
    const snaps = FAR.WM._loadWindowState();

    if (snaps === null) {
        FAR.WM.openApp('explorer');
        return;
    }

    if (snaps.length === 0) {
        return;
    }

    snaps.sort(function (a, b) {
        return (a.zTop || 0) - (b.zTop || 0);
    });

    FAR.WM._restoring = true;

    for (const snap of snaps) {
        try {
            const props = Object.assign({}, snap.props || {});
            if (props.file && props.file._id && props.side) {
                const ctx = FAR.side[props.side];
                if (ctx && Array.isArray(ctx.fileIndex)) {
                    const found = ctx.fileIndex.find(function (f) {
                        return f && f._id === props.file._id;
                    });
                    if (found) {
                        props.file = found;
                    }
                }
            }

            const win = await FAR.WM.openApp(snap.appId, {
                props: props,
                x: snap.x,
                y: snap.y,
                width: snap.w,
                height: snap.h,
                title: snap.title || undefined,
                _restoring: true
            });

            if (!win) continue;

            if (snap.maximized) {
                FAR.WM.toggleMaximize(win.id);
            } else if (snap.snap === 'left' || snap.snap === 'right') {
                FAR.WM.snapWindow(win.id, snap.snap);
            }
            if (snap.minimized) {
                FAR.WM.minimizeWindow(win.id);
            }

            if (snap.zTop) win.zTop = snap.zTop;
        } catch (e) {
            console.warn('[WM restore] failed:', snap.appId, e);
        }
    }

    FAR.WM._restoring = false;

    FAR.WM._saveWindowState();
};

FAR.WM.focusWindow = function (id) {
    const win = FAR.WM.getWindow(id);
    if (!win) return;

    if (win.modalParent) {
        const parent = FAR.WM.getWindow(win.modalParent);
        if (parent) {
            FAR.WM.state.zTop++;
            parent.el.style.zIndex = FAR.WM.state.zTop;
        }
    }

    FAR.WM.state.zTop++;
    win.el.style.zIndex = FAR.WM.state.zTop;
    win.zTop = FAR.WM.state.zTop;

    FAR.WM.state.windows.forEach(function (w) {
        w.el.classList.toggle('focused', w.id === id);
    });

    if (win.minimized) {
        win.minimized = false;
        win.el.classList.remove('minimized');
    }

    FAR.WM.state.activeWindowId = id;
    FAR.WM._renderTaskbar();

    if (win.appId === 'explorer' && win.props && win.props.side) {
        FAR.activePanel = win.props.side;
        try {
            const pl = document.getElementById('panelLeft');
            const pr = document.getElementById('panelRight');
            if (pl && pr) {
                pl.classList.toggle('active', FAR.activePanel === 'left');
                pr.classList.toggle('active', FAR.activePanel === 'right');
            }
        } catch (e) { /* ignore */ }
    }

    if (typeof win.props.onFocus === 'function') {
        try { win.props.onFocus(win); } catch (e) {}
    }

    FAR.WM._saveWindowStateDebounced();
};

FAR.WM.minimizeWindow = function (id) {
    const win = FAR.WM.getWindow(id);
    if (!win) return;
    win.minimized = true;
    win.el.classList.add('minimized');

    if (FAR.WM.state.activeWindowId === id) {
        const next = FAR.WM.state.windows
            .filter(w => !w.minimized)
            .sort((a, b) => (b.zTop || 0) - (a.zTop || 0))[0];
        FAR.WM.state.activeWindowId = next ? next.id : null;
        if (next) FAR.WM.focusWindow(next.id);
    }
    FAR.WM._renderTaskbar();
    FAR.WM._saveWindowStateDebounced();
};

FAR.WM.restoreWindow = function (id) {
    const win = FAR.WM.getWindow(id);
    if (!win) return;
    win.minimized = false;
    win.el.classList.remove('minimized');
    FAR.WM.focusWindow(id);
    FAR.WM._saveWindowStateDebounced();
};

FAR.WM.toggleMaximize = function (id) {
    const win = FAR.WM.getWindow(id);
    if (!win) return;

    if (win.maximized) {
        const r = win.prevRect || { x: 100, y: 100, w: 800, h: 600 };
        FAR.WM._applyRect(win, r);
        win.el.classList.remove('maximized');
        win.maximized = false;
    } else {
        win.prevRect = { x: win.x, y: win.y, w: win.w, h: win.h };
        const rect = FAR.WM._getDesktopRect();
        FAR.WM._applyRect(win, { x: 0, y: 0, w: rect.width, h: rect.height });
        win.el.classList.add('maximized');
        win.maximized = true;
    }
    FAR.WM.focusWindow(id);
    FAR.WM._saveWindowStateDebounced();
};

FAR.WM.snapWindow = function (id, side) {
    const win = FAR.WM.getWindow(id);
    if (!win) return;

    if (side === 'restore') {
        const r = win.prevRect || { x: 100, y: 100, w: 800, h: 600 };
        FAR.WM._applyRect(win, r);
        win.el.classList.remove('snapped-left', 'snapped-right');
        win.snap = null;
        FAR.WM._saveWindowStateDebounced();
        return;
    }

    if (!win.snap) {
        win.prevRect = { x: win.x, y: win.y, w: win.w, h: win.h };
    }
    const rect = FAR.WM._getDesktopRect();
    if (side === 'left') {
        FAR.WM._applyRect(win, { x: 0, y: 0, w: Math.floor(rect.width / 2), h: rect.height });
        win.el.classList.add('snapped-left');
        win.el.classList.remove('snapped-right');
        win.snap = 'left';
    } else if (side === 'right') {
        FAR.WM._applyRect(win, { x: Math.floor(rect.width / 2), y: 0,
            w: Math.ceil(rect.width / 2), h: rect.height });
        win.el.classList.add('snapped-right');
        win.el.classList.remove('snapped-left');
        win.snap = 'right';
    }
    FAR.WM.focusWindow(id);
    FAR.WM._saveWindowStateDebounced();
};

FAR.WM._applyRect = function (win, r) {
    win.x = r.x; win.y = r.y; win.w = r.w; win.h = r.h;
    win.el.style.left   = r.x + 'px';
    win.el.style.top    = r.y + 'px';
    win.el.style.width  = r.w + 'px';
    win.el.style.height = r.h + 'px';

    if (typeof win.props.onResize === 'function') {
        try { win.props.onResize(win, r); } catch (e) {}
    }

    FAR.WM._saveWindowStateDebounced();
};

window.addEventListener('beforeunload', function () {
    if (FAR.WM.state.active) {
        FAR.WM._saveWindowState();
    }
});

FAR.WM.getWindow = function (id) {
    return FAR.WM.state.windows.find(function (w) {
        return w.id === id;
    }) || null;
};

FAR.WM.getActiveWindow = function () {
    return FAR.WM.getWindow(FAR.WM.state.activeWindowId);
};