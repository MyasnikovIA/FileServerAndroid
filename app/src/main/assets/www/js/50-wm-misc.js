// ============================================================
// 50-wm-misc.js — Утилиты, заглушки и перехват openFile
// ============================================================
//
// FIX 2026-10-30 v5:
//   • Подключение к удалённому рабочему столу использует нативный
//     loginRemoteAndSetCookie, который возвращает JSON с диагностикой.
//   • Пользователь видит, какие URL пробовали, какие ошибки получили.
//   • Добавлена кнопка «Открыть без авторизации» — на случай, если
//     сервер недоступен для нативного логина, но веб-клиент сам
//     покажет свою форму входа.
// ============================================================

FAR.WM._mountConnectionUI = function (win) {
    win.bodyEl.innerHTML =
        '<div style="padding:20px;background:#1e1e2e;color:#cdd6f4;height:100%;box-sizing:border-box;overflow:auto;">' +
        '<div style="display:flex;flex-direction:column;gap:12px;">' +
        '<div style="padding:10px;background:#313244;border-left:3px solid #89b4fa;border-radius:4px;font-size:13px;margin-bottom:8px;">' +
        'Подключение к удалённому рабочему столу FileServer.<br>' +
        '<small style="color:#a6adc8;">Введите адрес сервера (HTTP/HTTPS), логин и пароль.</small></div>' +
        '<label style="font-size:12px;color:#a6adc8;">Адрес FileServer' +
        '<input id="wm-rdUrl" type="text" placeholder="https://... или http://ip:8080" style="width:100%;margin-top:4px;padding:8px;background:#313244;border:1px solid #45475a;border-radius:5px;color:#cdd6f4;font-family:monospace;"></label>' +
        '<label style="font-size:12px;color:#a6adc8;">Имя пользователя' +
        '<input id="wm-rdUser" type="text" placeholder="admin" style="width:100%;margin-top:4px;padding:8px;background:#313244;border:1px solid #45475a;border-radius:5px;color:#cdd6f4;font-family:monospace;"></label>' +
        '<label style="font-size:12px;color:#a6adc8;">Пароль' +
        '<input id="wm-rdPass" type="password" placeholder="••••••••" style="width:100%;margin-top:4px;padding:8px;background:#313244;border:1px solid #45475a;border-radius:5px;color:#cdd6f4;font-family:monospace;"></label>' +
        '<div data-role="error" style="color:#f38ba8;font-size:12px;min-height:16px;white-space:pre-wrap;line-height:1.4;"></div>' +
        '<div data-role="extra-actions" style="display:flex;flex-direction:column;gap:8px;"></div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">' +
        '<button data-role="cancel" style="padding:8px 18px;background:#585b70;color:#cdd6f4;border:none;border-radius:5px;cursor:pointer;">Отмена</button>' +
        '<button data-role="connect" style="padding:8px 18px;background:#a6e3a1;color:#1e1e2e;border:none;border-radius:5px;cursor:pointer;font-weight:bold;">Подключиться</button>' +
        '</div></div></div>';

    const urlEl = win.bodyEl.querySelector('#wm-rdUrl');
    const userEl = win.bodyEl.querySelector('#wm-rdUser');
    const passEl = win.bodyEl.querySelector('#wm-rdPass');
    const errEl = win.bodyEl.querySelector('[data-role="error"]');
    const extraEl = win.bodyEl.querySelector('[data-role="extra-actions"]');
    const cancelBtn = win.bodyEl.querySelector('[data-role="cancel"]');
    const connectBtn = win.bodyEl.querySelector('[data-role="connect"]');

    // Загружаем последние значения
    let def = { url: '', user: '', pass: '' };
    try {
        const saved = localStorage.getItem('filebd_rd_conn');
        if (saved) def = JSON.parse(saved);
    } catch (e) {}

    urlEl.value = def.url || '';
    userEl.value = def.user || '';
    passEl.value = def.pass || '';

    cancelBtn.onclick = function () { FAR.WM.closeWindow(win.id); };

    function openBrowser(openUrl, titleUser) {
        FAR.WM.closeWindow(win.id, true);
        FAR.WM.openApp('browser', {
            title: '🖥️ ' + (titleUser ? titleUser + '@' : '') +
                   openUrl.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
            width: Math.min(window.innerWidth - 80, 1280),
            height: Math.min(window.innerHeight - 100, 800),
            props: { url: openUrl, trusted: true }
        });
    }

    function showSkipButton(originalUrl) {
        extraEl.innerHTML = '';
        const btn = document.createElement('button');
        btn.textContent = '🌐 Открыть без авторизации';
        btn.style.cssText = 'padding:8px 18px;background:#f9e2af;color:#1e1e2e;border:none;border-radius:5px;cursor:pointer;font-weight:bold;';
        btn.onclick = function () {
            let finalUrl = originalUrl.replace(/\/+$/, '');
            if (!/^https?:\/\//i.test(finalUrl)) finalUrl = 'http://' + finalUrl;
            openBrowser(finalUrl + '/', userEl.value.trim());
        };
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:11px;color:#a6adc8;line-height:1.4;';
        hint.textContent = 'Если сервер отвечает, но не принимает нативный логин, ' +
            'веб-клиент FileServer покажет свою форму входа.';
        extraEl.appendChild(btn);
        extraEl.appendChild(hint);
    }

    connectBtn.onclick = function () {
        let cfgUrl = urlEl.value.trim();
        const cfgUser = userEl.value.trim();
        const cfgPass = passEl.value;

        if (!cfgUrl) { errEl.textContent = 'Укажите URL FileServer'; return; }
        if (!/^https?:\/\//i.test(cfgUrl)) cfgUrl = 'http://' + cfgUrl;
        cfgUrl = cfgUrl.replace(/\/+$/, '');

        try {
            localStorage.setItem('filebd_rd_conn', JSON.stringify({
                url: cfgUrl, user: cfgUser, pass: cfgPass
            }));
        } catch (e) {}

        connectBtn.disabled = true;
        connectBtn.textContent = 'Подключение…';
        errEl.textContent = '';
        extraEl.innerHTML = '';

        let authOk = false;
        let finalUrl = cfgUrl;
        let diagnostics = '';

        // --- Попытка нативного логина ---
        if (window.AndroidBridge &&
            typeof window.AndroidBridge.loginRemoteAndSetCookie === 'function') {
            try {
                const raw = window.AndroidBridge.loginRemoteAndSetCookie(
                    cfgUrl, cfgUser, cfgPass);
                let res = null;
                try { res = JSON.parse(raw || '{}'); } catch (e) { res = null; }

                if (res && res.ok) {
                    authOk = true;
                    if (res.url) finalUrl = res.url;
                    console.log('[RemoteDesktop] native auth OK:', res.url,
                                'scheme=' + res.scheme, 'port=' + res.port);
                } else {
                    // Собираем диагностику
                    const tried = (res && res.tried) || [];
                    const lines = tried.map(function (t) {
                        const u = String(t.url || '').replace('/api/login', '');
                        const err = t.error || 'unknown';
                        const msg = t.message ? ' — ' + t.message : '';
                        return '• ' + u + '\n  ' + err + msg;
                    });
                    diagnostics = lines.length
                        ? lines.join('\n')
                        : ('Ошибка: ' + ((res && (res.error || res.message)) || 'unknown'));
                    console.warn('[RemoteDesktop] native auth failed:\n' + diagnostics);
                }
            } catch (e) {
                console.error('[RemoteDesktop] native auth exception:', e);
                diagnostics = 'Исключение: ' + (e.message || String(e));
            }
        } else {
            console.warn('[RemoteDesktop] AndroidBridge unavailable');
            diagnostics = 'AndroidBridge недоступен (запуск не в APK?)';
        }

        if (authOk) {
            openBrowser(finalUrl + '/', cfgUser);
            return;
        }

        // --- Провал: показываем ошибку + кнопку "Открыть без авторизации" ---
        errEl.textContent = '⚠️ Авторизация не удалась.\n\n' + diagnostics;
        connectBtn.disabled = false;
        connectBtn.textContent = 'Повторить';
        showSkipButton(cfgUrl);
    };
};

FAR.WM._mountGamepadSetupUI = function (win) { FAR.WM._mountNotice(win, '🎮', 'Настройка джойстика доступна в классическом режиме (кнопка 🎮 в тулбаре).'); };

FAR.WM._mountDebugUI = async function (win) {
    win.bodyEl.innerHTML = '<div style="padding:20px;background:#1e1e2e;color:#cdd6f4;height:100%;box-sizing:border-box;overflow:auto;"><pre data-role="out" style="white-space:pre-wrap;font-size:12px;">Загрузка…</pre></div>';
    const pre = win.bodyEl.querySelector('[data-role="out"]');
    if (!FAR.db) { pre.textContent = 'Нет подключения к БД.'; return; }
    try {
        const all = await FAR.db.allDocs({ include_docs: true, limit: 200 });
        let out = '=== ПЕРВЫЕ 200 ДОКУМЕНТОВ ===\n';
        all.rows.forEach(r => out += r.id + '\n');
        pre.textContent = out;
    } catch (e) { pre.textContent = 'Ошибка: ' + e.message; }
};

FAR.WM._mountLogUI = function (win) {
    const lines = FAR.progress.logLines || [];
    win.bodyEl.innerHTML = '<pre style="padding:14px;overflow:auto;height:100%;font-size:12px;color:#cdd6f4;box-sizing:border-box;">' +
        (lines.length ? lines.map(l => FAR.escapeHtml(l)).join('\n') : 'Журнал пуст') + '</pre>';
};

FAR.WM._mountFilePickerPrompt = function (win, message) {
    win.bodyEl.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText = 'padding:40px; text-align:center; color:#a6adc8;';
    box.innerHTML = '<div style="font-size:60px; margin-bottom:16px;">🗂️</div><div style="font-size:14px; margin-bottom:20px;">' + FAR.escapeHtml(message) + '</div>';
    const btn = document.createElement('button');
    btn.textContent = '📂 Выбрать файл из БД';
    btn.style.cssText = 'padding:10px 24px; background:#4aa3ff; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:13px;';
    btn.onclick = async function () {
        const picked = await FAR.WM.openFileDialog({ parentId: win.id, title: 'Выбор файла', side: FAR.activePanel });
        if (picked) {
            const appId = win.appId;
            FAR.WM._finalizeViewer(win);
            FAR.WM.closeWindow(win.id, true);
            FAR.WM.openApp(appId, { props: { file: picked, side: FAR.activePanel } });
        }
    };
    box.appendChild(btn); win.bodyEl.appendChild(box);
};

FAR.WM._mountNotice = function (win, icon, text) {
    win.bodyEl.innerHTML = '<div style="padding:40px; text-align:center; color:#a6adc8;">' +
        '<div style="font-size:60px; margin-bottom:16px;">' + icon + '</div>' +
        '<div style="font-size:14px;">' + FAR.escapeHtml(text) + '</div></div>';
};

FAR.WM._mountFileDialogAsApp = async function (win, props) {
    await FAR.WM._mountFileDialog(win, props.side || FAR.activePanel, {});
};

FAR.WM._installOpenFileWrapper = function () {
    if (FAR.WM._openFileWrapped) return;
    FAR.WM._openFileWrapped = true;

    FAR.WM._orig.openFile = FAR.openFile;

    FAR.openFile = async function (item, side, index) {
        if (!FAR.WM.state.active) return FAR.WM._orig.openFile.apply(this, arguments);

        side = side || FAR.activePanel;

        if (typeof FAR.isApkFile === 'function'
            && FAR.isApkFile(item)
            && window.FAR.AndroidPrograms
            && FAR.AndroidPrograms.available) {
            FAR.AndroidPrograms.installApk(item.path);
            return;
        }

        try {
            if (typeof FAR.WM.isFbmp3 === 'function' && FAR.WM.isFbmp3(item)) return FAR.WM.openApp('mp3', { props: { file: item, side: side, playlistPath: item.path } });
            if (typeof FAR.isJsdos === 'function' && FAR.isJsdos(item)) return FAR.WM.openApp('jsdos', { props: { file: item, side: side } });
            if (typeof FAR.isEmulatorFile === 'function' && FAR.isEmulatorFile(item)) return FAR.WM.openApp('emulator', { props: { file: item, side: side } });
            if (typeof FAR.isMp3 === 'function' && FAR.isMp3(item)) return FAR.WM.openApp('mp3', { props: { file: item, side: side } });
            if (typeof FAR.isVideo === 'function' && FAR.isVideo(item)) return FAR.WM.openApp('video', { props: { file: item, side: side } });
            if (typeof FAR.isPdf === 'function' && FAR.isPdf(item)) return FAR.WM.openApp('pdf', { props: { file: item, side: side } });
            if (typeof FAR.isLbrn2 === 'function' && FAR.isLbrn2(item)) return FAR.WM.openApp('lbrn2', { props: { file: item, side: side } });
            if (typeof FAR.isGcode === 'function' && FAR.isGcode(item)) return FAR.WM.openApp('gcode', { props: { file: item, side: side } });

            if (typeof FAR.isHtmlFile === 'function' && FAR.isHtmlFile(item)) {
                if (typeof FAR.openBrowserFromItem === 'function') { FAR.openBrowserFromItem(item, side); return; }
                console.warn('[WM openFile] FAR.openBrowserFromItem не загружен');
            }

            if (typeof FAR.isPanorama === 'function') {
                let isPano = false;
                try { isPano = await FAR.isPanorama(item, side); } catch (e) {}
                if (isPano) return FAR.WM.openApp('panorama', { props: { file: item, side: side } });
            }

            if (typeof FAR.isTextFile === 'function' && FAR.isTextFile(item)) return FAR.WM.openApp('texteditor', { props: { file: item, side: side } });
        } catch (e) { console.warn('[WM openFile] проверка типа:', e); }

        return FAR.WM.openApp('viewer', { props: { file: item, side: side } });
    };
};

FAR.WM._installOpenFileWrapper();