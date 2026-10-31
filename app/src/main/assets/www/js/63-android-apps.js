// ============================================================
// 63-android-apps.js — Android программы + Settings + Launcher + APK
// ============================================================

(function () {
    'use strict';

    if (window.FAR && window.FAR.AndroidPrograms) return;
    window.FAR = window.FAR || {};

    FAR.AndroidPrograms = {
        available: false,
        apps: []
    };

    function isInAndroidApp() {
        try {
            if (typeof window.AndroidBridge === 'undefined' || !window.AndroidBridge) return false;
            if (typeof window.AndroidBridge.isAndroidApp !== 'function') return false;
            return !!window.AndroidBridge.isAndroidApp();
        } catch (e) { return false; }
    }

    function loadApps() {
        try {
            const raw = window.AndroidBridge.getApps();
            if (!raw) return [];
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            arr.sort(function (a, b) {
                return String(a.label || a.pkg || '')
                    .localeCompare(String(b.label || b.pkg || ''), 'ru');
            });
            return arr;
        } catch (e) {
            console.warn('[AndroidPrograms] getApps failed:', e);
            return [];
        }
    }

    // ============================================================
    // Запуск приложения
    // ============================================================

    function launchApp(pkg, activity) {
        console.log('[AndroidPrograms] launchApp JS: pkg=' + pkg + ' act=' + activity);

        if (!pkg) {
            console.warn('[AndroidPrograms] launchApp: empty pkg');
            if (window.FAR && typeof FAR.toast === 'function') {
                FAR.toast('Не указан пакет', 'error');
            }
            return false;
        }

        if (typeof window.AndroidBridge === 'undefined' || !window.AndroidBridge) {
            console.error('[AndroidPrograms] window.AndroidBridge === undefined');
            if (window.FAR && typeof FAR.toast === 'function') {
                FAR.toast('Мост AndroidBridge недоступен', 'error');
            }
            return false;
        }

        if (typeof window.AndroidBridge.launchApp !== 'function') {
            console.error('[AndroidPrograms] window.AndroidBridge.launchApp is not a function');
            if (window.FAR && typeof FAR.toast === 'function') {
                FAR.toast('Метод launchApp недоступен', 'error');
            }
            return false;
        }

        try {
            console.log('[AndroidPrograms] calling bridge.launchApp...');
            const ok = window.AndroidBridge.launchApp(pkg, activity || '');
            console.log('[AndroidPrograms] bridge.launchApp returned: ' + ok);
            if (!ok) {
                if (window.FAR && typeof FAR.toast === 'function') {
                    FAR.toast('Не удалось запустить: ' + pkg, 'error');
                }
                return false;
            }
            return true;
        } catch (e) {
            console.error('[AndroidPrograms] bridge.launchApp EXCEPTION:', e);
            if (window.FAR && typeof FAR.toast === 'function') {
                FAR.toast('Ошибка: ' + e.message, 'error');
            }
            return false;
        }
    }

    // ============================================================
    // Настройки Android
    // ============================================================

    function openSettings() {
        try {
            const ok = window.AndroidBridge.openSettings();
            if (!ok && window.FAR && typeof FAR.toast === 'function') {
                FAR.toast('Не удалось открыть настройки', 'error');
            }
            return ok;
        } catch (e) {
            if (window.FAR && typeof FAR.toast === 'function') {
                FAR.toast('Ошибка: ' + e.message, 'error');
            }
            return false;
        }
    }

    // ============================================================
    // Установка APK
    // ============================================================

    function installApk(virtualPath) {
        if (!virtualPath) {
            if (window.FAR && typeof FAR.toast === 'function') {
                FAR.toast('Не указан путь к APK', 'error');
            }
            return false;
        }
        try {
            const ok = window.AndroidBridge.installApk(virtualPath);
            if (!ok) {
                if (window.FAR && typeof FAR.toast === 'function') {
                    FAR.toast('Не удалось установить. Проверьте разрешение ' +
                        '«Установка неизвестных приложений».', 'error');
                }
                return false;
            }
            if (window.FAR && typeof FAR.toast === 'function') {
                FAR.toast('Открыт установщик APK', 'success');
            }
            return true;
        } catch (e) {
            console.error('[AndroidPrograms] installApk exception:', e);
            if (window.FAR && typeof FAR.toast === 'function') {
                FAR.toast('Ошибка установки: ' + e.message, 'error');
            }
            return false;
        }
    }

    // ============================================================
    // Регистрация WM-приложений
    // ============================================================

    const AVATAR_COLORS = [
        '#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8',
        '#cba6f7', '#94e2d5', '#fab387', '#b4befe'
    ];

    function colorFor(seed) {
        const s = String(seed || '');
        let hash = 0;
        for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
    }

    function firstLetterOf(label, pkg) {
        const s = String(label || pkg || '?').trim();
        return s ? s.charAt(0).toUpperCase() : '?';
    }

    function ensureCategory() {
        if (!Array.isArray(FAR.WM.APP_CATEGORIES)) return false;
        const hasCat = FAR.WM.APP_CATEGORIES.some(function (c) { return c && c.id === 'android'; });
        if (!hasCat) {
            FAR.WM.APP_CATEGORIES.unshift({ id: 'android', title: 'Android программы', icon: '🤖' });
        }
        return true;
    }

    function unregisterAndroidApps() {
        if (!FAR.WM || !FAR.WM._apps) return;
        Object.keys(FAR.WM._apps).forEach(function (id) {
            if (id === 'android:refresh') return;
            if (id.indexOf('android:') === 0) {
                delete FAR.WM._apps[id];
                if (FAR.WM.APP_CATEGORY_MAP) delete FAR.WM.APP_CATEGORY_MAP[id];
            }
        });
    }

    /**
     * Регистрирует каждое Android-приложение как WM-приложение.
     * ИСПРАВЛЕНИЕ: обработчик onContextMenu перенесён ВНУТРЬ forEach,
     * где appId определён. Раньше был дублирующий блок registerApp()
     * вне цикла, который падал с "appId is not defined".
     */
    function registerApps() {
        if (!window.FAR || !FAR.WM || typeof FAR.WM.registerApp !== 'function') {
            setTimeout(registerApps, 100); return;
        }
        if (!ensureCategory()) {
            setTimeout(registerApps, 100); return;
        }

        FAR.AndroidPrograms.apps.forEach(function (app) {
            const appId = 'android:' + app.pkg + '/' + (app.activity || 'main');
            FAR.WM.registerApp({
                id: appId,
                title: app.label || app.pkg,
                icon: '📱',
                keywords: (app.pkg || '') + ' ' + (app.label || ''),
                iconImg: app.icon || null,
                firstLetter: firstLetterOf(app.label, app.pkg),
                firstLetterColor: colorFor(app.pkg),
                androidPkg: app.pkg,
                androidActivity: app.activity || '',
                directLaunch: function () { launchApp(app.pkg, app.activity); },

                // ← Единственный обработчик ПКМ, теперь внутри forEach
                onContextMenu: function(e) {
                    e.preventDefault();
                    e.stopPropagation();

                    const menu = document.getElementById('wmContextMenu');
                    if (!menu) return;
                    menu.innerHTML = '';

                    FAR.WM._addCtxItem(menu, '🚀 Добавить в автозапуск', function() {
                        FAR.Autostart.addAndroidApp(app.pkg, app.activity || '', app.label);
                    });

                    FAR.WM._positionContextMenu(menu, e.clientX, e.clientY);
                }
            });
            if (FAR.WM.APP_CATEGORY_MAP) FAR.WM.APP_CATEGORY_MAP[appId] = 'android';
        });

        // Кнопка "Обновить список" — в конце категории
        FAR.WM.registerApp({
            id: 'android:refresh',
            title: '🔄 Обновить список',
            icon: '🔄',
            keywords: 'обновить refresh reload android приложения',
            directLaunch: function () {
                const n = FAR.AndroidPrograms.reloadApps();
                FAR.toast('Обновлено приложений: ' + n, 'success');
            }
        });
        if (FAR.WM.APP_CATEGORY_MAP) FAR.WM.APP_CATEGORY_MAP['android:refresh'] = 'android';

        console.log('[AndroidPrograms] зарегистрировано приложений: '
            + FAR.AndroidPrograms.apps.length);
    }

    function registerSettingsApp() {
        if (!window.FAR || !FAR.WM || typeof FAR.WM.registerApp !== 'function') {
            setTimeout(registerSettingsApp, 100); return;
        }
        if (FAR.WM.getApp && FAR.WM.getApp('settings')) return;
        FAR.WM.registerApp({
            id: 'settings',
            title: 'Настройки Android',
            icon: '⚙️',
            keywords: 'settings настройки system android',
            directLaunch: function () { openSettings(); }
        });
        if (FAR.WM.APP_CATEGORY_MAP) FAR.WM.APP_CATEGORY_MAP['settings'] = 'system';
    }

    function registerDefaultLauncherApp() {
        if (!window.FAR || !FAR.WM || typeof FAR.WM.registerApp !== 'function') {
            setTimeout(registerDefaultLauncherApp, 100); return;
        }
        if (FAR.WM.getApp && FAR.WM.getApp('default-launcher')) return;
        FAR.WM.registerApp({
            id: 'default-launcher',
            title: 'Лаунчер по умолчанию',
            icon: '🏠',
            keywords: 'launcher home default лаунчер главный экран',
            directLaunch: function () {
                try {
                    if (window.AndroidBridge.isDefaultLauncher()) {
                        if (window.FAR && typeof FAR.toast === 'function') {
                            FAR.toast('Это приложение уже является лаунчером', 'success');
                        }
                        return;
                    }
                } catch (e) { /* ignore */ }
                try {
                    const ok = window.AndroidBridge.openHomeSettings();
                    if (!ok && window.FAR && typeof FAR.toast === 'function') {
                        FAR.toast('Не удалось открыть настройки', 'error');
                    }
                } catch (e) {
                    if (window.FAR && typeof FAR.toast === 'function') {
                        FAR.toast('Ошибка: ' + e.message, 'error');
                    }
                }
            }
        });
        if (FAR.WM.APP_CATEGORY_MAP) FAR.WM.APP_CATEGORY_MAP['default-launcher'] = 'system';
    }

    // ============================================================
    // Перезагрузка списка
    // ============================================================

    function reloadApps() {
        try {
            unregisterAndroidApps();
            FAR.AndroidPrograms.apps = loadApps();
            if (FAR.AndroidPrograms.apps.length > 0) {
                registerApps();
            }
            if (FAR.WM && typeof FAR.WM._renderStartMenu === 'function') {
                const sm = document.getElementById('wmStartMenu');
                if (sm && sm.classList.contains('open')) {
                    FAR.WM._renderStartMenu('');
                }
            }
            return FAR.AndroidPrograms.apps.length;
        } catch (e) {
            console.warn('[AndroidPrograms] reloadApps:', e);
            return 0;
        }
    }

    // ============================================================
    // Определение .apk
    // ============================================================

    FAR.isApkFile = function (item) {
        if (!item || item.isFolder) return false;
        const n = String(item.name || item.path || '').toLowerCase();
        return n.endsWith('.apk');
    };

    // ============================================================
    // Init
    // ============================================================

    function init() {
        if (!isInAndroidApp()) {
            console.log('[AndroidPrograms] не в Android WebView — отключено');
            return;
        }
        FAR.AndroidPrograms.available = true;
        FAR.AndroidPrograms.apps = loadApps();
        console.log('[AndroidPrograms] найдено приложений: ' + FAR.AndroidPrograms.apps.length);

        registerSettingsApp();
        registerDefaultLauncherApp();

        if (FAR.AndroidPrograms.apps.length > 0) {
            registerApps();
        }
    }

    FAR.AndroidPrograms.launch = launchApp;
    FAR.AndroidPrograms.installApk = installApk;
    FAR.AndroidPrograms.openSettings = openSettings;
    FAR.AndroidPrograms.reloadApps = reloadApps;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();