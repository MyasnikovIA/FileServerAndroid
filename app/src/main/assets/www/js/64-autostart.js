// ============================================================
// 64-autostart.js — Автозапуск приложений и скриптов
// ============================================================

console.log('[Autostart] Module loaded');

FAR.Autostart = {
    LS_KEY: 'filebd_autostart_data',

    _getLocal: function() {
        try {
            return JSON.parse(localStorage.getItem(this.LS_KEY) || '{"androidApps":[],"jsScripts":[],"wmApps":[]}');
        } catch(e) {
            return { androidApps: [], jsScripts: [], wmApps: [] };
        }
    },

    _saveLocal: function(data) {
        try { localStorage.setItem(this.LS_KEY, JSON.stringify(data)); } catch(e) {}
    },

    getConfig: async function() {
        let serverCfg = { androidApps: [], jsScripts: [], wmApps: [] };
        try {
            const res = await fetch('/api/autostart');
            if (res.ok) {
                serverCfg = await res.json();
            }
        } catch(e) {
            console.warn('[Autostart] Failed to fetch server config:', e);
        }

        const localCfg = this._getLocal();

        return {
            androidApps: (serverCfg.androidApps || []).concat(localCfg.androidApps || []),
            jsScripts: (serverCfg.jsScripts || []).concat(localCfg.jsScripts || []),
            wmApps: (serverCfg.wmApps || []).concat(localCfg.wmApps || [])
        };
    },

    run: async function() {
        console.log('[Autostart] Starting boot sequence...');
        const cfg = await this.getConfig();
        console.log('[Autostart] Config loaded:', cfg);

        // 1. Выполнение JS-скриптов
        for (const script of cfg.jsScripts) {
            if (script.url) {
                try {
                    await FAR.loadScriptOnce(script.url);
                    console.log('[Autostart] Loaded script:', script.url);
                } catch(e) { console.error('[Autostart] Script error:', script.url, e); }
            } else if (script.code) {
                try {
                    new Function(script.code)();
                    console.log('[Autostart] Executed inline script:', script.name || 'unnamed');
                } catch(e) { console.error('[Autostart] Inline script error:', e); }
            }
        }

        // 2. Запуск Android-приложений
        if (window.AndroidBridge && typeof window.AndroidBridge.launchApp === 'function') {
            for (const app of cfg.androidApps) {
                try {
                    window.AndroidBridge.launchApp(app.pkg, app.act || '');
                    console.log('[Autostart] Launched Android app:', app.pkg);
                } catch(e) { console.warn('[Autostart] Failed to launch app:', app.pkg, e); }
            }
        }

        // 3. Открытие окон WM
        if (typeof FAR.WM !== 'undefined') {
            for (const w of cfg.wmApps) {
                try {
                    FAR.WM.openApp(w.id, { props: w.props || {} });
                    console.log('[Autostart] Opened WM app:', w.id);
                } catch(e) { console.warn('[Autostart] Failed to open WM app:', w.id, e); }
            }
        }
        console.log('[Autostart] Boot sequence complete.');
    },

    // --- Методы добавления ---

    addAndroidApp: function(pkg, act, label) {
        const data = this._getLocal();
        if (!data.androidApps) data.androidApps = [];

        if (data.androidApps.some(a => a.pkg === pkg && a.act === act)) {
            FAR.toast('Приложение уже в автозапуске', 'info');
            return;
        }

        data.androidApps.push({ pkg: pkg, act: act, label: label });
        this._saveLocal(data);
        FAR.toast('Добавлено в автозапуск: ' + label, 'success');
    },

    addWmApp: function(id, title) {
        const data = this._getLocal();
        if (!data.wmApps) data.wmApps = [];

        if (data.wmApps.some(a => a.id === id)) {
            FAR.toast('Приложение уже в автозапуске', 'info');
            return;
        }

        data.wmApps.push({ id: id, title: title });
        this._saveLocal(data);
        FAR.toast('Добавлено в автозапуск: ' + title, 'success');
    },

    addJsScript: function(url, name) {
        const data = this._getLocal();
        if (!data.jsScripts) data.jsScripts = [];

        if (data.jsScripts.some(s => s.url === url)) {
            FAR.toast('Скрипт уже в автозапуске', 'info');
            return;
        }

        data.jsScripts.push({ url: url, name: name || url });
        this._saveLocal(data);
        FAR.toast('Скрипт добавлен в автозапуск', 'success');
    },

    // --- Методы удаления ---

    removeAndroidApp: function(pkg, act) {
        const data = this._getLocal();
        if (!data.androidApps) return;
        data.androidApps = data.androidApps.filter(a => !(a.pkg === pkg && a.act === act));
        this._saveLocal(data);
        FAR.toast('Удалено из автозапуска', 'info');
    },

    removeWmApp: function(id) {
        const data = this._getLocal();
        if (!data.wmApps) return;
        data.wmApps = data.wmApps.filter(w => w.id !== id);
        this._saveLocal(data);
        FAR.toast('Удалено из автозапуска', 'info');
    },

    removeJsScript: function(url) {
        const data = this._getLocal();
        if (!data.jsScripts) return;
        data.jsScripts = data.jsScripts.filter(s => s.url !== url);
        this._saveLocal(data);
        FAR.toast('Скрипт удален из автозапуска', 'info');
    }
};