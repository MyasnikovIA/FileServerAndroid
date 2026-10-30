// ============================================================
// 43-wm-desktop.js — рабочий стол: иконки, drag, контекстное меню
// ============================================================

FAR.WM.LS_ICONS_KEY = 'filebd_wm_desktop_icons';

FAR.WM.DESKTOP_DEFAULT = [
    { id: 'explorer',   x: 20,  y: 20  },
    { id: 'viewer',     x: 20,  y: 130 },
    { id: 'panorama',   x: 20,  y: 240 },
    { id: 'pdf',        x: 20,  y: 350 },
    { id: 'mp3',        x: 20,  y: 460 },
    { id: 'video',      x: 130, y: 20  },
    { id: 'connect',    x: 130, y: 130 },
    { id: 'debug',      x: 130, y: 240 },
    { id: 'texteditor', x: 240, y: 20  },
    { id: 'browser',    x: 240, y: 130 }
];

FAR.WM.DESKTOP_CONDITIONAL = [
    { id: 'console',     x: 240, y: 240 },
    { id: 'hermes',      x: 240, y: 460 },
    { id: 'videochat',   x: 240, y: 350 },
    { id: 'broadcaster', x: 350, y: 20  }
];

FAR.WM._loadDesktopIcons = function () {
    try {
        const raw = localStorage.getItem(FAR.WM.LS_ICONS_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!Array.isArray(obj)) return null;
        return obj;
    } catch (e) {
        return null;
    }
};

FAR.WM._saveDesktopIcons = function (list) {
    try {
        localStorage.setItem(FAR.WM.LS_ICONS_KEY, JSON.stringify(list));
    } catch (e) { /* ignore */ }
};

FAR.WM._ensureConditionalAppOnDesktop = function (layout) {
    if (!Array.isArray(layout)) return false;
    const existingIds = new Set(
        layout.map(function (e) { return e && e.id; }).filter(Boolean)
    );
    let changed = false;

    FAR.WM.DESKTOP_CONDITIONAL.forEach(function (def) {
        if (existingIds.has(def.id)) return;
        if (!FAR.WM.getApp || !FAR.WM.getApp(def.id)) return;
        layout.push({ id: def.id, x: def.x, y: def.y });
        existingIds.add(def.id);
        changed = true;
    });

    return changed;
};

FAR.WM._renderDesktopIcons = function () {
    const container = document.getElementById('wmDesktopIcons');
    if (!container) return;

    let layout = FAR.WM._loadDesktopIcons();
    let changed = false;

    if (!layout) {
        layout = FAR.WM.DESKTOP_DEFAULT.slice();
        changed = true;
    } else {
        const existingIds = new Set(layout.map(function (e) { return e.id; }));
        FAR.WM.DESKTOP_DEFAULT.forEach(function (def) {
            if (existingIds.has(def.id)) return;
            layout.push({ id: def.id, x: def.x, y: def.y });
            existingIds.add(def.id);
            changed = true;
        });
    }

    if (FAR.WM._ensureConditionalAppOnDesktop(layout)) {
        changed = true;
    }

    if (changed) {
        FAR.WM._saveDesktopIcons(layout);
    }

    container.innerHTML = '';

    layout.forEach(function (entry, idx) {
        const app = FAR.WM.getApp ? FAR.WM.getApp(entry.id) : null;
        if (!app) return;

        const el = document.createElement('div');
        el.className = 'wm-desktop-icon';
        el.style.left = entry.x + 'px';
        el.style.top  = entry.y + 'px';
        el.dataset.appId = entry.id;
        el.dataset.iconIndex = idx;

        el.innerHTML =
            '<span class="wm-di-emoji">' + FAR.WM._renderAppIcon(app, 48) + '</span>' +
            '<span class="wm-di-label">' + FAR.escapeHtml(app.title) + '</span>';

        el.addEventListener('dblclick', function () {
            FAR.WM._invokeApp(app);
        });

        el.addEventListener('pointerdown', function (e) {
            if (e.button !== 0 && e.pointerType === 'mouse') return;

            e.stopPropagation();
            document.querySelectorAll('.wm-desktop-icon.selected').forEach(function (x) {
                x.classList.remove('selected');
            });
            el.classList.add('selected');

            const startX = e.clientX;
            const startY = e.clientY;
            const origLeft = parseInt(el.style.left, 10) || 0;
            const origTop  = parseInt(el.style.top, 10)  || 0;
            let moved = false;
            let longPressTriggered = false;

            const longPressTimer = setTimeout(function () {
                longPressTriggered = true;
                FAR.WM._showIconContextMenu(startX, startY, entry.id);
                if (navigator.vibrate) { try { navigator.vibrate(30); } catch (err) {} }
            }, 500);

            const onMove = function (ev) {
                if (longPressTriggered) return;
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;

                if (!moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                    clearTimeout(longPressTimer);
                    moved = true;
                    el.classList.add('dragging');
                }

                if (!moved) return;

                const nx = Math.max(0, origLeft + dx);
                const ny = Math.max(0, origTop + dy);
                el.style.left = nx + 'px';
                el.style.top  = ny + 'px';
            };

            const onUp = function () {
                clearTimeout(longPressTimer);
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                el.classList.remove('dragging');

                if (longPressTriggered) return;

                if (moved) {
                    const l = FAR.WM._loadDesktopIcons() || FAR.WM.DESKTOP_DEFAULT.slice();
                    const curEntry = l[idx];
                    if (curEntry) {
                        curEntry.x = parseInt(el.style.left, 10) || 0;
                        curEntry.y = parseInt(el.style.top, 10)  || 0;
                        FAR.WM._saveDesktopIcons(l);
                    }
                }
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        });

        container.appendChild(el);
    });
};

FAR.WM._scheduleDesktopRender = function () {
    if (FAR.WM._desktopRenderTimer) return;
    FAR.WM._desktopRenderTimer = setTimeout(function () {
        FAR.WM._desktopRenderTimer = null;
        if (FAR.WM.state && FAR.WM.state.active) {
            try { FAR.WM._renderDesktopIcons(); }
            catch (e) { console.warn('[WM] renderDesktopIcons:', e); }
        }
    }, 50);
};

// ============================================================
// Контекстное меню рабочего стола
// ============================================================

FAR.WM._showDesktopContextMenu = function (x, y) {
    const menu = document.getElementById('wmContextMenu');
    if (!menu) return;
    menu.innerHTML = '';

    FAR.WM._addCtxItem(menu, '🔄 Обновить', function () {
        FAR.WM._renderDesktopIcons();
    });
    FAR.WM._addCtxItem(menu, '📁 Открыть Проводник', function () {
        FAR.WM.openApp('explorer');
    });
    FAR.WM._addCtxSep(menu);
    FAR.WM._addCtxItem(menu, '🗄️ Подключение к БД', function () {
        FAR.WM.openApp('connect');
    });
    FAR.WM._addCtxItem(menu, '🎮 Настройка джойстика', function () {
        FAR.WM.openApp('gamepad');
    });
    FAR.WM._addCtxItem(menu, '🚀 Настройки автозапуска', function () {
        FAR.WM.openApp('autostart_settings');
    });

    if (typeof FAR.WMWallpaper !== 'undefined') {
        FAR.WM._addCtxSep(menu);
        FAR.WM._addCtxItem(menu, '🖼 Обои из URL…', function () {
            FAR.WMWallpaper.promptUrl();
        });
        FAR.WM._addCtxItem(menu, '🖼 Обои из БД…', function () {
            FAR.WMWallpaper.pickFromDb();
        });
        const st = FAR.WMWallpaper._load();
        if (st.source !== 'default') {
            FAR.WM._addCtxItem(menu, '🗑 Убрать обои', function () {
                FAR.WMWallpaper.reset();
            });
        }
    }

    FAR.WM._addCtxSep(menu);
    FAR.WM._addCtxItem(menu, '⚙ Сбросить расположение иконок', function () {
        FAR.WM._saveDesktopIcons(FAR.WM.DESKTOP_DEFAULT.slice());
        FAR.WM._renderDesktopIcons();
    });

    FAR.WM._positionContextMenu(menu, x, y);
};

FAR.WM._showIconContextMenu = function (x, y, appId) {
    const menu = document.getElementById('wmContextMenu');
    if (!menu) return;
    menu.innerHTML = '';

    const app = FAR.WM.getApp(appId);

    FAR.WM._addCtxItem(menu, '📂 Открыть', function () {
        if (app) FAR.WM._invokeApp(app);
    });

    if (app && window.FAR && FAR.Autostart) {
        FAR.WM._addCtxItem(menu, '🚀 Добавить в автозапуск', function () {
            if (app.androidPkg) {
                FAR.Autostart.addAndroidApp(app.androidPkg, app.androidActivity || '', app.title);
            } else {
                FAR.Autostart.addWmApp(app.id, app.title);
            }
        });
    }

    FAR.WM._positionContextMenu(menu, x, y);
};

FAR.WM._addCtxItem = function (menu, label, onClick) {
    const el = document.createElement('div');
    el.className = 'wm-ctx-item';
    el.textContent = label;
    el.addEventListener('click', function () {
        FAR.WM._hideContextMenu();
        try { onClick(); } catch (e) {
            console.error('[WM ctx]', e);
            FAR.toast('Ошибка: ' + e.message, 'error');
        }
    });
    menu.appendChild(el);
};

FAR.WM._addCtxSep = function (menu) {
    const s = document.createElement('div');
    s.className = 'wm-ctx-sep';
    menu.appendChild(s);
};

FAR.WM._positionContextMenu = function (menu, x, y) {
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    menu.classList.add('open');

    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x;
    let top = y;

    if (left + rect.width > vw - 4) left = vw - rect.width - 4;
    if (top + rect.height > vh - 4) top = vh - rect.height - 4;
    if (left < 4) left = 4;
    if (top < 4) top = 4;

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
};

FAR.WM._hideContextMenu = function () {
    const menu = document.getElementById('wmContextMenu');
    if (menu) menu.classList.remove('open');
};

// ============================================================
// Привязка событий рабочего стола
// ============================================================

FAR.WM._bindDesktopUI = function () {
    const desktop = document.getElementById('wmDesktop');
    if (!desktop || desktop._wmBound) return;
    desktop._wmBound = true;

    let startX = 0, startY = 0, longPressTimer = null;

    // Обработка долгого нажатия на ПУСТОМ месте рабочего стола
    desktop.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 && e.pointerType === 'mouse') return; // Игнорируем правую кнопку
        if (e.target.closest('.wm-window') || e.target.closest('.wm-desktop-icon')) return;

        startX = e.clientX;
        startY = e.clientY;

        longPressTimer = setTimeout(function () {
            longPressTimer = null;
            FAR.WM._showDesktopContextMenu(startX, startY);
            if (navigator.vibrate) { try { navigator.vibrate(30); } catch(err) {} }
        }, 500);
    });

    desktop.addEventListener('pointermove', function (e) {
        if (!longPressTimer) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });

    desktop.addEventListener('pointerup', function () {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });
};

FAR.WM._origEnter2 = FAR.WM.enter;
FAR.WM.enter = function () {
    FAR.WM._origEnter2.apply(this, arguments);
    FAR.WM._bindDesktopUI();
    FAR.WM._renderDesktopIcons();
};