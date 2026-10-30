// ============================================================
// 50-wm-misc.js — Утилиты, заглушки и перехват openFile
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
        '<div data-role="error" style="color:#f38ba8;font-size:12px;min-height:16px;"></div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">' +
        '<button data-role="cancel" style="padding:8px 18px;background:#585b70;color:#cdd6f4;border:none;border-radius:5px;cursor:pointer;">Отмена</button>' +
        '<button data-role="connect" style="padding:8px 18px;background:#a6e3a1;color:#1e1e2e;border:none;border-radius:5px;cursor:pointer;font-weight:bold;">Подключиться</button>' +
        '</div></div></div>';

    const urlEl = win.bodyEl.querySelector('#wm-rdUrl');
    const userEl = win.bodyEl.querySelector('#wm-rdUser');
    const passEl = win.bodyEl.querySelector('#wm-rdPass');
    const errEl = win.bodyEl.querySelector('[data-role="error"]');
    const cancelBtn = win.bodyEl.querySelector('[data-role="cancel"]');
    const connectBtn = win.bodyEl.querySelector('[data-role="connect"]');

    // Предзаполняем поля из последних сохранённых настроек
    const def = FAR.getConnDefaultsForSide ? FAR.getConnDefaultsForSide(null) : FAR.getDefaultConn();
    urlEl.value = def.url || '';
    userEl.value = def.user || '';
    // passEl.value = def.pass || '';

    cancelBtn.onclick = function () { FAR.WM.closeWindow(win.id); };

    connectBtn.onclick = async function () {
        const cfg = { url: urlEl.value.trim(), user: userEl.value.trim(), pass: passEl.value };
        if (!cfg.url) { errEl.textContent = 'Укажите URL FileServer'; return; }

        connectBtn.disabled = true;
        connectBtn.textContent = 'Подключение…';
        errEl.textContent = '';

        try {
            // 1. Авторизация (проверка логина/пароля и получение токена)
            const res = await FAR.connectToDb(cfg);

            // 2. Закрываем окно подключения
            FAR.WM.closeWindow(win.id, true);

            // 3. Открываем удалённый рабочий стол
            const targetUrl = cfg.url; // Нормализованный URL
            let fullUrl = targetUrl;

            // Добавляем токен в URL, чтобы удалённый веб-клиент авторизовался автоматически
            if (res.token) {
                fullUrl += (fullUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(res.token);
            }

            FAR.WM.openApp('browser', {
                title: '🖥️ ' + (cfg.user ? cfg.user + '@' : '') + targetUrl.replace(/^https?:\/\//, ''),
                width: Math.min(window.innerWidth - 80, 1280),
                height: Math.min(window.innerHeight - 100, 800),
                props: {
                    url: fullUrl,
                    trusted: true // Разрешаем скрипты, так как это доверенный FileServer
                }
            });

        } catch (e) {
            errEl.textContent = '❌ ' + (e.message || String(e));
            connectBtn.disabled = false;
            connectBtn.textContent = 'Подключиться';
        }
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