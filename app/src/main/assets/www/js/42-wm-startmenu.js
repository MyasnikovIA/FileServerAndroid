// ============================================================
// 42-wm-startmenu.js — меню Пуск с категориями и подменю
// ============================================================

console.log('[StartMenu] VERSION 2026-10-30 v8 — touch fix');

FAR.WM.toggleStartMenu = function () {
    const sm = document.getElementById('wmStartMenu');
    if (!sm) return;
    if (sm.classList.contains('open')) FAR.WM.closeStartMenu();
    else FAR.WM.openStartMenu();
};

FAR.WM.openStartMenu = function () {
    const sm = document.getElementById('wmStartMenu');
    const btn = document.getElementById('wmStartBtn');
    if (!sm) return;
    sm.classList.add('open');
    if (btn) btn.classList.add('open');
    FAR.WM._hideStartSubmenu();
    FAR.WM._renderStartMenu('');
    const search = document.getElementById('wmStartSearch');
    if (search) search.value = '';
};

FAR.WM.closeStartMenu = function () {
    const sm = document.getElementById('wmStartMenu');
    const btn = document.getElementById('wmStartBtn');
    if (sm) sm.classList.remove('open');
    if (btn) btn.classList.remove('open');
    FAR.WM._hideStartSubmenu();
    const search = document.getElementById('wmStartSearch');
    if (search && document.activeElement === search) {
        try { search.blur(); } catch (e) {}
    }
};

FAR.WM.APP_CATEGORIES = [
    { id: 'files',  title: 'Файлы и документы',      icon: '📁' },
    { id: 'media',  title: 'Медиа',                   icon: '🖼' },
    { id: 'games',  title: 'Игры',                    icon: '🎮' },
    { id: 'ai',     title: 'Искусственный интеллект', icon: '🦙' },
    { id: 'stream', title: 'Трансляции',              icon: '📡' },
    { id: 'system', title: 'Система',                 icon: '⚙️' },
    { id: 'other',  title: 'Прочее',                  icon: '📦' }
];

FAR.WM.APP_CATEGORY_MAP = {
    explorer: 'files', viewer: 'files', texteditor: 'files',
    pdf: 'files', browser: 'files',
    panorama: 'media', panoeditor: 'media', mp3: 'media', video: 'media',
    jsdos: 'games', nes: 'games', emulator: 'games',
    ollama: 'ai',
    videochat: 'stream', broadcaster: 'stream',
    connect: 'system', gamepad: 'system',
    debug: 'system', log: 'system', console: 'system',
    settings: 'system', 'default-launcher': 'system', 'autostart_settings': 'system'
};

FAR.WM._renderAppIcon = function (app, size) {
    size = size || 24;
    if (!app) return '📦';
    if (app.iconImg) {
        return '<img src="' + FAR.escapeHtml(app.iconImg) + '" ' +
            'style="width:' + size + 'px;height:' + size + 'px;' +
            'border-radius:' + Math.round(size / 5) + 'px;' +
            'vertical-align:middle;object-fit:contain;" alt="">';
    }
    if (app.firstLetter) {
        const color = app.firstLetterColor || '#89b4fa';
        return '<span style="display:inline-flex;align-items:center;justify-content:center;' +
            'width:' + size + 'px;height:' + size + 'px;' +
            'border-radius:' + Math.round(size / 5) + 'px;' +
            'background:' + color + ';color:#1e1e2e;' +
            'font-size:' + Math.round(size * 0.55) + 'px;font-weight:bold;' +
            'vertical-align:middle;">' +
            FAR.escapeHtml(app.firstLetter) + '</span>';
    }
    return FAR.escapeHtml(app.icon || '📦');
};

FAR.WM._invokeApp = function (app) {
    if (!app) return;
    if (typeof app.directLaunch === 'function') {
        try { app.directLaunch(); return; }
        catch (err) { console.error('[StartMenu] directLaunch:', err); }
    }
    if (app.androidPkg && window.FAR && FAR.AndroidPrograms &&
        typeof FAR.AndroidPrograms.launch === 'function') {
        FAR.AndroidPrograms.launch(app.androidPkg, app.androidActivity);
        return;
    }
    FAR.WM.openApp(app.id);
};

// ============================================================
// Всплывающее подменю
// ============================================================

FAR.WM._startSubmenuEl       = null;
FAR.WM._startSubmenuTimer    = null;
FAR.WM._startSubmenuCategory = null;

FAR.WM._ensureStartSubmenu = function () {
    if (FAR.WM._startSubmenuEl) return FAR.WM._startSubmenuEl;

    const el = document.createElement('div');
    el.className = 'wm-start-submenu';
    el.style.position = 'fixed';
    el.style.zIndex   = '9999';
    el.style.display  = 'none';

    el.addEventListener('mouseenter', function () {
        if (FAR.WM._startSubmenuTimer) {
            clearTimeout(FAR.WM._startSubmenuTimer);
            FAR.WM._startSubmenuTimer = null;
        }
    });
    el.addEventListener('mouseleave', function () {
        FAR.WM._scheduleHideStartSubmenu();
    });
    el.addEventListener('mousedown', function (e) { e.stopPropagation(); });

    const root = document.getElementById('wmRoot') || document.body;
    root.appendChild(el);

    FAR.WM._startSubmenuEl = el;
    return el;
};

FAR.WM._scheduleHideStartSubmenu = function () {
    if (FAR.WM._startSubmenuTimer) return;
    FAR.WM._startSubmenuTimer = setTimeout(function () {
        FAR.WM._startSubmenuTimer = null;
        FAR.WM._hideStartSubmenu();
    }, 220);
};

FAR.WM._hideStartSubmenu = function () {
    if (FAR.WM._startSubmenuTimer) {
        clearTimeout(FAR.WM._startSubmenuTimer);
        FAR.WM._startSubmenuTimer = null;
    }
    if (FAR.WM._startSubmenuEl) {
        const el = FAR.WM._startSubmenuEl;
        el.style.display = 'none';
        if (el._farClearTimer) clearTimeout(el._farClearTimer);
        el._farClearTimer = setTimeout(function () {
            el._farClearTimer = null;
            if (el.style.display === 'none') el.innerHTML = '';
        }, 0);
    }
    FAR.WM._startSubmenuCategory = null;
    document.querySelectorAll('.wm-start-cat-row.active').forEach(function (r) {
        r.classList.remove('active');
    });
};

FAR.WM._showStartSubmenu = function (rowEl, categoryId, categoryIcon,
                                     categoryTitle, apps) {
    const el = FAR.WM._ensureStartSubmenu();

    if (el._farClearTimer) { clearTimeout(el._farClearTimer); el._farClearTimer = null; }
    if (FAR.WM._startSubmenuTimer) {
        clearTimeout(FAR.WM._startSubmenuTimer);
        FAR.WM._startSubmenuTimer = null;
    }

    el.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'wm-start-submenu-title';
    title.textContent = categoryIcon + ' ' + categoryTitle;
    el.appendChild(title);

    apps.forEach(function (app) {
        const item = document.createElement('div');
        item.className = 'wm-start-item';
        item.setAttribute('data-app-id', app.id);

        if (app.androidPkg) {
            item.setAttribute('data-launch-pkg', app.androidPkg);
            item.setAttribute('data-launch-activity', app.androidActivity || '');
        }

        item.innerHTML =
            '<span class="wm-si-emoji">' + FAR.WM._renderAppIcon(app, 32) + '</span>' +
            '<span class="wm-si-label">' + FAR.escapeHtml(app.title) + '</span>';
        item.title = app.title;

        item.addEventListener('pointerup', function (e) {
            e.preventDefault();
            e.stopPropagation();

            try {
                if (app.androidPkg) {
                    try {
                        console.log('__LAUNCH_APP__|' + app.androidPkg + '|' +
                            (app.androidActivity || ''));
                    } catch (err) {}
                }
                FAR.WM._invokeApp(app);
            } catch (err) {
                console.error('[StartMenu] invokeApp:', err);
            }

            FAR.WM._hideStartSubmenu();
            FAR.WM.closeStartMenu();
        });

        el.appendChild(item);
    });

    el.style.display    = 'block';
    el.style.visibility = 'hidden';
    el.style.left       = '0px';
    el.style.top        = '0px';

    const rect    = rowEl.getBoundingClientRect();
    const subRect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 6;

    let left = rect.right + margin;
    let top  = rect.top;
    if (left + subRect.width > vw - margin) {
        left = rect.left - subRect.width - margin;
        if (left < margin) left = Math.max(margin, vw - subRect.width - margin);
    }
    if (top + subRect.height > vh - margin) {
        top = vh - subRect.height - margin;
        if (top < margin) top = margin;
    }

    el.style.left       = left + 'px';
    el.style.top        = top  + 'px';
    el.style.visibility = 'visible';

    FAR.WM._startSubmenuCategory = categoryId;

    document.querySelectorAll('.wm-start-cat-row.active').forEach(function (r) {
        r.classList.remove('active');
    });
    rowEl.classList.add('active');
};

FAR.WM._renderStartMenu = function (query) {
    const list = document.getElementById('wmStartList');
    if (!list) return;

    const HIDDEN_IN_START = { 'dbpick': true, 'autostart_settings': true };
    const apps = FAR.WM.getApps ? FAR.WM.getApps() : [];
    const q = (query || '').toLowerCase().trim();

    const filtered = apps.filter(function (a) {
        if (!a || !a.id) return false;
        if (HIDDEN_IN_START[a.id]) return false;
        if (!q) return true;
        return (a.title || '').toLowerCase().includes(q)
            || (a.keywords || '').toLowerCase().includes(q);
    });

    list.innerHTML = '';

    if (q) {
        FAR.WM._hideStartSubmenu();
        if (filtered.length === 0) {
            list.innerHTML = '<div style="text-align:center;color:#6c7086;' +
                'padding:20px;font-size:12px;">Ничего не найдено</div>';
            return;
        }
        filtered.forEach(function (app) {
            const item = document.createElement('div');
            item.className = 'wm-start-item';
            item.setAttribute('data-app-id', app.id);
            if (app.androidPkg) {
                item.setAttribute('data-launch-pkg', app.androidPkg);
                item.setAttribute('data-launch-activity', app.androidActivity || '');
            }
            item.innerHTML =
                '<span class="wm-si-emoji">' + FAR.WM._renderAppIcon(app, 32) + '</span>' +
                '<span class="wm-si-label">' + FAR.escapeHtml(app.title) + '</span>';
            item.title = app.title;
            item.addEventListener('pointerup', function (e) {
                e.preventDefault();
                e.stopPropagation();
                try {
                    if (app.androidPkg) {
                        console.log('__LAUNCH_APP__|' + app.androidPkg + '|' +
                            (app.androidActivity || ''));
                    }
                    FAR.WM.closeStartMenu();
                    FAR.WM._invokeApp(app);
                } catch (err) {
                    console.error('[StartMenu] search invokeApp:', err);
                }
            });
            list.appendChild(item);
        });
        return;
    }

    const buckets = {};
    FAR.WM.APP_CATEGORIES.forEach(function (cat) { buckets[cat.id] = []; });
    filtered.forEach(function (a) {
        const catId = FAR.WM.APP_CATEGORY_MAP[a.id] || 'other';
        if (!buckets[catId]) buckets[catId] = [];
        buckets[catId].push(a);
    });

    let anyShown = false;
    FAR.WM.APP_CATEGORIES.forEach(function (cat) {
        const items = buckets[cat.id];
        if (!items || items.length === 0) return;
        anyShown = true;

        const row = document.createElement('div');
        row.className = 'wm-start-cat-row';
        row.setAttribute('data-category', cat.id);
        row.innerHTML =
            '<span class="wm-start-cat-icon">' + cat.icon + '</span>' +
            '<span class="wm-start-cat-label">' + FAR.escapeHtml(cat.title) + '</span>' +
            '<span class="wm-start-cat-count">' + items.length + '</span>' +
            '<span class="wm-start-cat-arrow">›</span>';

        row.addEventListener('mouseenter', function () {
            FAR.WM._showStartSubmenu(row, cat.id, cat.icon, cat.title, items);
        });
        row.addEventListener('mouseleave', function () {
            FAR.WM._scheduleHideStartSubmenu();
        });
        row.addEventListener('pointerup', function (e) {
            e.stopPropagation();
            if (FAR.WM._startSubmenuCategory !== cat.id) {
                FAR.WM._showStartSubmenu(row, cat.id, cat.icon, cat.title, items);
            }
        });
        list.appendChild(row);
    });

    // Добавляем кнопку "Настройки автозапуска" в самый низ
    const astBtn = document.createElement('div');
    astBtn.className = 'wm-start-item';
    astBtn.style.marginTop = '10px';
    astBtn.style.borderTop = '1px solid #313244';
    astBtn.style.flexShrink = '0';
    astBtn.innerHTML = '<span class="wm-si-emoji">🚀</span><span class="wm-si-label">Настройки автозапуска</span>';
    astBtn.title = 'Управление автозапуском';

    // Используем pointerup для поддержки тачскрина
    astBtn.addEventListener('pointerup', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[StartMenu] Clicked Autostart Settings');
        FAR.WM.closeStartMenu();
        FAR.WM.openApp('autostart_settings');
    });

    list.appendChild(astBtn);

    if (!anyShown) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.cssText = 'text-align:center;color:#6c7086;padding:20px;font-size:12px;';
        emptyMsg.textContent = 'Нет приложений';
        list.insertBefore(emptyMsg, astBtn);
    }

    if (!list._wmSubmenuScrollBound) {
        list._wmSubmenuScrollBound = true;
        list.addEventListener('scroll', function () {
            FAR.WM._hideStartSubmenu();
        }, { passive: true });
    }
};

FAR.WM._bindStartMenuUI = function () {
    const btn = document.getElementById('wmStartBtn');
    if (btn && !btn._wmBound) {
        btn._wmBound = true;
        btn.addEventListener('pointerup', function (e) {
            e.stopPropagation();
            FAR.WM.toggleStartMenu();
        });
    }
    const search = document.getElementById('wmStartSearch');
    if (search && !search._wmBound) {
        search._wmBound = true;
        search.addEventListener('input', function () {
            FAR.WM._renderStartMenu(search.value);
        });
        search.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') FAR.WM.closeStartMenu();
            else if (e.key === 'Enter') {
                const first = document.querySelector('#wmStartList .wm-start-item');
                if (first) first.dispatchEvent(new PointerEvent('pointerup'));
            }
        });
    }
};

FAR.WM._origEnter = FAR.WM.enter;
FAR.WM.enter = function () {
    FAR.WM._origEnter.apply(this, arguments);
    FAR.WM._bindStartMenuUI();
};

FAR.WM._origExit = FAR.WM.exit;
FAR.WM.exit = function () {
    FAR.WM._hideStartSubmenu();
    return FAR.WM._origExit.apply(this, arguments);
};

FAR.WM.logout = function () {
    FAR.WM.closeStartMenu();
    if (typeof FAR.onAuthButton === 'function') {
        FAR.WM.exit();
        FAR.onAuthButton();
    }
};

// ============================================================
// ГЛОБАЛЬНЫЙ TOUCH LAUNCHER
// ============================================================

(function installStartMenuTouchLauncher() {
    if (window._farStartMenuTouchInstalled) return;
    window._farStartMenuTouchInstalled = true;

    document.addEventListener('touchstart', function (e) {
        window._farTouchStart = null;
        if (!e.touches || e.touches.length !== 1) return;
        const t = e.touches[0];
        const el = document.elementFromPoint(t.clientX, t.clientY);
        if (!el || !el.closest) return;
        const item = el.closest('.wm-start-item');
        if (!item) return;

        window._farTouchStart = {
            x: t.clientX,
            y: t.clientY,
            time: Date.now(),
            pkg:   item.getAttribute('data-launch-pkg')   || '',
            act:   item.getAttribute('data-launch-activity') || '',
            appId: item.getAttribute('data-app-id')       || ''
        };
    }, { capture: true, passive: true });

    document.addEventListener('touchend', function (e) {
        const s = window._farTouchStart;
        if (!s) return;
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;

        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        const dt = Date.now() - s.time;

        if (Math.abs(dx) > 25 || Math.abs(dy) > 25 || dt > 700 || dt < 15) {
            window._farTouchStart = null;
            return;
        }

        // Если есть pkg или appId — это приложение
        if (s.pkg && window.AndroidBridge &&
            typeof window.AndroidBridge.launchApp === 'function') {
            try { window.AndroidBridge.launchApp(s.pkg, s.act); }
            catch (err) { console.error('[StartMenu] bridge launch:', err); }
        } else if (s.appId && window.FAR && FAR.WM) {
            try {
                const app = FAR.WM.getApp && FAR.WM.getApp(s.appId);
                if (app) FAR.WM._invokeApp(app);
            } catch (err) { console.error('[StartMenu] invokeApp:', err); }
        }

        try {
            if (window.FAR && FAR.WM) {
                FAR.WM._hideStartSubmenu();
                FAR.WM.closeStartMenu();
            }
        } catch (err) {}
    }, { capture: true, passive: true });
})();