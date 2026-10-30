// ============================================================
// 44-wm-apps.js — реестр приложений
// ============================================================

FAR.WM._apps = {};

FAR.WM.registerApp = function (def) {
    FAR.WM._apps[def.id] = def;
};

FAR.WM.getApps = function () {
    return Object.values(FAR.WM._apps);
};

FAR.WM.getApp = function (id) {
    return FAR.WM._apps[id] || null;
};

FAR.WM.openApp = async function (appId, opts) {
    opts = opts || {};
    const def = FAR.WM.getApp(appId);
    if (!def) {
        FAR.toast('Приложение не найдено: ' + appId, 'error');
        return null;
    }

    if (typeof def.directLaunch === 'function') {
        console.log('[WM openApp] directLaunch: ' + appId);
        try {
            def.directLaunch();
        } catch (e) {
            console.error('[WM openApp] directLaunch failed:', appId, e);
            FAR.toast('Ошибка запуска: ' + (e && e.message ? e.message : e), 'error');
        }
        return null;
    }

    if (def.singleton && !opts.forceNew && !opts._restoring) {
        const existing = FAR.WM.state.windows.find(function (w) {
            return w.appId === appId;
        });
        if (existing) {
            FAR.WM.restoreWindow(existing.id);
            FAR.WM.focusWindow(existing.id);

            if (typeof def.onReopen === 'function' && opts.props) {
                try { def.onReopen(existing, opts.props); }
                catch (e) { console.warn('[WM app onReopen]', appId, e); }
            }
            return existing;
        }
    }

    const title = opts.title || def.title;
    const icon  = def.icon || '📦';

    const win = FAR.WM.openWindow({
        title: title,
        icon: icon,
        width: opts.width || def.width || 900,
        height: opts.height || def.height || 600,
        x: opts.x, y: opts.y,
        appId: appId,
        content: null,
        props: Object.assign({}, def.defaultProps || {}, opts.props || {}),
        onClose: function (w) {
            if (typeof def.onClose === 'function') {
                try { def.onClose(w); } catch (e) { console.warn('[WM app onClose]', appId, e); }
            }
        }
    });

    if (typeof def.open !== 'function') {
        console.error('[WM app] у приложения нет open() и нет directLaunch: ' + appId);
        try { FAR.WM.closeWindow(win.id, true); } catch (e) {}
        FAR.toast('Приложение не может быть открыто', 'error');
        return null;
    }

    try {
        await def.open(win, win.props);
    } catch (e) {
        console.error('[WM app open]', appId, e);
        win.bodyEl.innerHTML =
            '<div style="padding: 24px; color: #f38ba8;">Ошибка открытия: ' +
            FAR.escapeHtml(e.message) + '</div>';
    }

    return win;
};

// ============================================================
// Приложение: Проводник FileBD
// ============================================================

FAR.WM.registerApp({
    id: 'explorer',
    title: 'Проводник FileBD',
    icon: '📁',
    keywords: 'проводник файлы папки explorer',
    singleton: false,
    width: 1100,
    height: 700,
    open: async function (win, props) {
        await FAR.WM._mountExplorerPanel(win, props);
    },
    onClose: function (win) {
        FAR.WM._cleanupExplorerPanel(win);
    }
});

// ============================================================
// Приложение: Текстовый редактор
// ============================================================

FAR.WM.registerApp({
    id: 'texteditor',
    title: 'Текстовый редактор',
    icon: '📝',
    keywords: 'текст редактор notepad код code',
    singleton: false,
    width: 900,
    height: 650,
    open: async function (win, props) {
        await FAR.WM._mountTextEditor(win, props);
    },
    onClose: function (win) {
        /* нет */
    }
});

// ============================================================
// Приложение: Браузер
// ============================================================

FAR.WM.registerApp({
    id: 'browser',
    title: 'Браузер',
    icon: '🌐',
    keywords: 'браузер browser web iframe html',
    singleton: false,
    width: 1100,
    height: 720,
    open: async function (win, props) {
        await FAR.WM._mountBrowserViewer(win, props);
    },
    onClose: function (win) {
        if (win.props && win.props._browserApi) {
            try { win.props._browserApi.destroy(); } catch (e) {}
            win.props._browserApi = null;
        }
    }
});

// ============================================================
// Приложение: Универсальный просмотрщик
// ============================================================

FAR.WM.registerApp({
    id: 'viewer',
    title: 'Просмотрщик',
    icon: '👁',
    keywords: 'просмотр файл изображение текст viewer',
    singleton: false,
    width: 900,
    height: 640,
    open: async function (win, props) {
        if (props && props.file) {
            await FAR.WM._mountFileViewer(win, props);
        } else {
            FAR.WM._mountFilePickerPrompt(win, 'Выберите файл для просмотра');
        }
    },
    onClose: function (win) { FAR.WM._finalizeViewer(win); }
});

// ============================================================
// Приложение: Панорама
// ============================================================

FAR.WM.registerApp({
    id: 'panorama',
    title: 'Панорама 360°',
    icon: '🌐',
    keywords: 'панорама 360 panorama',
    singleton: false,
    width: 1100,
    height: 720,
    open: async function (win, props) {
        if (props && props.file) {
            await FAR.WM._mountPanoramaViewer(win, props);
        } else {
            FAR.WM._mountFilePickerPrompt(win, 'Выберите панораму (jpg/png)');
        }
    },
    onClose: function (win) { FAR.WM._finalizeViewer(win); }
});

// ============================================================
// Приложение: Редактор панорам
// ============================================================

FAR.WM.registerApp({
    id: 'panoeditor',
    title: 'Редактор панорам',
    icon: '✏️',
    keywords: 'редактор панорама точки hotspots',
    singleton: true,
    width: 1300,
    height: 800,
    open: async function (win) {
        FAR.WM._mountNotice(win, '✏️',
            'Редактор точек перехода открывается из просмотрщика панорам ' +
            'кнопкой «✏️ Редактор точек» или двойным кликом по панораме.');
    }
});

// ============================================================
// Приложение: PDF
// ============================================================

FAR.WM.registerApp({
    id: 'pdf',
    title: 'PDF',
    icon: '📄',
    keywords: 'pdf документ',
    singleton: false,
    width: 1000,
    height: 720,
    open: async function (win, props) {
        if (props && props.file) {
            await FAR.WM._mountPdfViewer(win, props);
        } else {
            FAR.WM._mountFilePickerPrompt(win, 'Выберите PDF-файл');
        }
    },
    onClose: function (win) { FAR.WM._finalizeViewer(win); }
});

// ============================================================
// Приложение: MP3
// ============================================================

FAR.WM.registerApp({
    id: 'mp3',
    title: 'MP3-плеер',
    icon: '🎵',
    keywords: 'музыка mp3 audio плеер',
    singleton: true,
    width: 900,
    height: 620,
    open: async function (win, props) {
        if (props && props.file) {
            await FAR.WM._mountMp3Viewer(win, props);
        } else {
            FAR.WM._mountFilePickerPrompt(win, 'Выберите аудиофайл');
        }
    },
    onClose: function (win) { FAR.WM._finalizeViewer(win); }
});

// ============================================================
// Приложение: Видео
// ============================================================

FAR.WM.registerApp({
    id: 'video',
    title: 'Видео',
    icon: '🎬',
    keywords: 'видео фильм movie video',
    singleton: true,
    width: 1100,
    height: 700,
    open: async function (win, props) {
        if (props && props.file) {
            await FAR.WM._mountVideoViewer(win, props);
        } else {
            FAR.WM._mountFilePickerPrompt(win, 'Выберите видеофайл');
        }
    },
    onClose: function (win) { FAR.WM._finalizeViewer(win); }
});

// ============================================================
// Приложение: JSDOS
// ============================================================

FAR.WM.registerApp({
    id: 'jsdos',
    title: 'JSDOS',
    icon: '🕹️',
    keywords: 'jsdos dos игра game',
    singleton: false,
    width: 900,
    height: 700,
    open: async function (win, props) {
        if (props && props.file) {
            await FAR.WM._mountJsdosViewer(win, props);
        } else {
            FAR.WM._mountFilePickerPrompt(win, 'Выберите .jsdos-архив');
        }
    },
    onClose: function (win) { FAR.WM._finalizeViewer(win); }
});

// ============================================================
// Приложение: EmulatorJS
// ============================================================

FAR.WM.registerApp({
    id: 'emulator',
    title: 'EmulatorJS',
    icon: '🕹️',
    keywords: 'эмулятор snes n64 psx gba sega nes dendy',
    singleton: false,
    width: 1000,
    height: 720,
    open: async function (win, props) {
        if (props && props.file) {
            await FAR.WM._mountEmulatorViewer(win, props);
        } else {
            FAR.WM._mountFilePickerPrompt(win, 'Выберите ROM-файл');
        }
    },
    onClose: function (win) { FAR.WM._finalizeViewer(win); }
});

// ============================================================
// Приложение: Подключение к удалённому рабочему столу
// ============================================================

FAR.WM.registerApp({
    id: 'connect',
    title: 'Другой рабочий стол',
    icon: '🖥️',
    keywords: 'подключение другой рабочий стол remote desktop server',
    singleton: true,
    width: 460,
    height: 460,
    open: async function (win) {
        FAR.WM._mountConnectionUI(win);
    }
});

// ============================================================
// Приложение: Настройка джойстика
// ============================================================

FAR.WM.registerApp({
    id: 'gamepad',
    title: 'Настройка джойстика',
    icon: '🎮',
    keywords: 'джойстик gamepad геймпад',
    singleton: true,
    width: 860,
    height: 700,
    open: async function (win) {
        FAR.WM._mountGamepadSetupUI(win);
    }
});

// ============================================================
// Приложение: Debug
// ============================================================

FAR.WM.registerApp({
    id: 'debug',
    title: 'Debug',
    icon: '🔍',
    keywords: 'debug отладка db структура',
    singleton: true,
    width: 800,
    height: 600,
    open: async function (win) {
        FAR.WM._mountDebugUI(win);
    }
});

// ============================================================
// Приложение: Выбор файла из БД
// ============================================================

FAR.WM.registerApp({
    id: 'dbpick',
    title: 'Выбор файла из БД',
    icon: '🗂️',
    keywords: 'выбор файл db picker диалог',
    singleton: false,
    width: 1000,
    height: 620,
    open: async function (win, props) {
        await FAR.WM._mountFileDialogAsApp(win, props);
    }
});

// ============================================================
// Приложение: Лог операций
// ============================================================

FAR.WM.registerApp({
    id: 'log',
    title: 'Лог операций',
    icon: '📋',
    keywords: 'лог журнал операции log',
    singleton: true,
    width: 760,
    height: 500,
    open: async function (win) {
        FAR.WM._mountLogUI(win);
    }
});

// ============================================================
// Приложение: Настройки автозапуска
// ============================================================

FAR.WM.registerApp({
    id: 'autostart_settings',
    title: 'Настройки автозапуска',
    icon: '🚀',
    keywords: 'автозапуск autostart startup настройки',
    singleton: true,
    width: 700,
    height: 650,
    open: async function (win, props) {
        win.bodyEl.innerHTML = '';
        win.bodyEl.style.display = 'flex';
        win.bodyEl.style.flexDirection = 'column';
        win.bodyEl.style.background = '#1e1e2e';
        win.bodyEl.style.color = '#cdd6f4';
        win.bodyEl.style.padding = '16px';
        win.bodyEl.style.overflowY = 'auto';

        const render = function() {
            let data = { androidApps: [], jsScripts: [], wmApps: [] };
            if (window.FAR && FAR.Autostart) {
                data = FAR.Autostart._getLocal();
            }

            const availableWM = FAR.WM.getApps().filter(a => a.id !== 'autostart_settings' && a.id !== 'dbpick');
            const availableAndroid = (FAR.AndroidPrograms && FAR.AndroidPrograms.apps) ? FAR.AndroidPrograms.apps : [];

            let html = `
                <h3 style="margin-top:0; color:#89b4fa;">Настройки автозапуска (клиент)</h3>
                <p style="font-size:12px;color:#a6adc8;">Эти настройки применяются только к текущему устройству. Серверные настройки (config.json) применяются ко всем.</p>

                <div style="background:#181825; padding:12px; border-radius:6px; margin-bottom:16px;">
                    <h4 style="margin-top:0; color:#a6e3a1;">JS Скрипты</h4>
                    <div style="display:flex; gap:8px; margin-bottom:12px; align-items:center;">
                        <input type="text" id="astAddJsUrl" placeholder="js/custom.js" style="flex:1; padding:6px 10px; background:#313244; border:1px solid #45475a; border-radius:4px; color:#cdd6f4; font-size:12px;">
                        <button id="astBtnAddJs" style="padding:6px 12px; background:#a6e3a1; color:#1e1e2e; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">Добавить</button>
                    </div>
                    <div style="font-size:10px; color:#6c7086; margin-bottom:8px;">
                        Путь указывается относительно папки <b>www</b> (например: <code>js/custom.js</code>).
                    </div>
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        ${(data.jsScripts || []).map(s => `<div style="display:flex; justify-content:space-between; align-items:center; background:#313244; padding:6px 10px; border-radius:4px;">
                            <span style="font-family:monospace; font-size:12px;">${FAR.escapeHtml(s.name || s.url)}</span>
                            <button class="ast-del-js" data-url="${s.url}" style="background:#f38ba8; color:#1e1e2e; border:none; padding:2px 8px; border-radius:4px; cursor:pointer;">✕</button>
                        </div>`).join('') || '<div style="color:#6c7086;font-size:12px;">Нет скриптов</div>'}
                    </div>
                </div>

                <div style="background:#181825; padding:12px; border-radius:6px; margin-bottom:16px;">
                    <h4 style="margin-top:0; color:#a6e3a1;">Приложения FileServer</h4>
                    <div style="display:flex; gap:8px; margin-bottom:12px;">
                        <select id="astAddWmSelect" style="flex:1; padding:6px 10px; background:#313244; border:1px solid #45475a; border-radius:4px; color:#cdd6f4; font-size:12px;">
                            <option value="">-- Выберите приложение --</option>
                            ${availableWM.map(a => `<option value="${a.id}">${a.title}</option>`).join('')}
                        </select>
                        <button id="astBtnAddWm" style="padding:6px 12px; background:#a6e3a1; color:#1e1e2e; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">Добавить</button>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        ${(data.wmApps || []).map(w => `<div style="display:flex; justify-content:space-between; align-items:center; background:#313244; padding:6px 10px; border-radius:4px;">
                            <span style="font-size:12px;">${FAR.escapeHtml(w.title || w.id)}</span>
                            <button class="ast-del-wm" data-id="${w.id}" style="background:#f38ba8; color:#1e1e2e; border:none; padding:2px 8px; border-radius:4px; cursor:pointer;">✕</button>
                        </div>`).join('') || '<div style="color:#6c7086;font-size:12px;">Нет приложений</div>'}
                    </div>
                </div>

                <div style="background:#181825; padding:12px; border-radius:6px;">
                    <h4 style="margin-top:0; color:#a6e3a1;">Android Приложения</h4>
                    ${availableAndroid.length === 0 ? `
                        <div style="color:#f9e2af; font-size:12px; padding:8px; background:#313244; border-radius:4px; margin-bottom:8px;">
                            ⚠️ Нет доступных Android-приложений.<br>Список отображается только при работе внутри приложения на Android-устройстве.
                        </div>
                    ` : ''}

                    <div style="margin-bottom:12px;">
                        <button id="astBtnShowAndroidList" style="width:100%; padding:8px; background:#45475a; color:#cdd6f4; border:none; border-radius:4px; cursor:pointer; font-size:12px; font-weight:bold;">+ Добавить Android приложение</button>
                        <div id="astAndroidListContainer" style="display:none; margin-top:8px; max-height:250px; overflow-y:auto; background:#181825; border:1px solid #45475a; border-radius:4px;">
                            ${availableAndroid.map(a => `
                                <div class="ast-android-item" data-pkg="${a.pkg}" data-act="${a.activity || ''}" data-label="${FAR.escapeHtml(a.label)}" style="display:flex; align-items:center; gap:10px; padding:8px 12px; cursor:pointer; border-bottom:1px solid #313244; transition:background 0.1s;" onmouseover="this.style.background='#313244'" onmouseout="this.style.background='transparent'">
                                    ${a.icon ? `<img src="${a.icon}" style="width:28px; height:28px; object-fit:contain; border-radius:6px;">` : '<span style="font-size:24px;">📱</span>'}
                                    <span style="font-size:13px;">${FAR.escapeHtml(a.label)}</span>
                                </div>
                            `).join('') || '<div style="padding:12px; font-size:12px; color:#6c7086; text-align:center;">Нет приложений</div>'}
                        </div>
                    </div>

                    <div style="display:flex; flex-direction:column; gap:4px;">
                        ${(data.androidApps || []).map(a => `<div style="display:flex; justify-content:space-between; align-items:center; background:#313244; padding:6px 10px; border-radius:4px;">
                            <span style="font-size:12px;">${FAR.escapeHtml(a.label || a.pkg)}</span>
                            <button class="ast-del-android" data-pkg="${a.pkg}" data-act="${a.act || ''}" style="background:#f38ba8; color:#1e1e2e; border:none; padding:2px 8px; border-radius:4px; cursor:pointer;">✕</button>
                        </div>`).join('') || '<div style="color:#6c7086;font-size:12px;">Нет приложений</div>'}
                    </div>
                </div>
            `;

            win.bodyEl.innerHTML = html;

            // JS Handlers
            win.bodyEl.querySelector('#astBtnAddJs').onclick = () => {
                const url = win.bodyEl.querySelector('#astAddJsUrl').value.trim();
                if (url) {
                    FAR.Autostart.addJsScript(url, url);
                    render();
                }
            };
            win.bodyEl.querySelectorAll('.ast-del-js').forEach(btn => {
                btn.onclick = () => { FAR.Autostart.removeJsScript(btn.dataset.url); render(); };
            });

            // WM Handlers
            win.bodyEl.querySelector('#astBtnAddWm').onclick = () => {
                const sel = win.bodyEl.querySelector('#astAddWmSelect');
                const id = sel.value;
                if (id) {
                    const app = FAR.WM.getApp(id);
                    FAR.Autostart.addWmApp(id, app ? app.title : id);
                    render();
                }
            };
            win.bodyEl.querySelectorAll('.ast-del-wm').forEach(btn => {
                btn.onclick = () => { FAR.Autostart.removeWmApp(btn.dataset.id); render(); };
            });

            // Android Handlers
            win.bodyEl.querySelector('#astBtnShowAndroidList').onclick = function() {
                const container = win.bodyEl.querySelector('#astAndroidListContainer');
                container.style.display = container.style.display === 'none' ? 'block' : 'none';
            };

            win.bodyEl.querySelectorAll('.ast-android-item').forEach(item => {
                item.onclick = () => {
                    const pkg = item.dataset.pkg;
                    const act = item.dataset.act;
                    const label = item.dataset.label;
                    FAR.Autostart.addAndroidApp(pkg, act, label);
                    render();
                };
            });

            win.bodyEl.querySelectorAll('.ast-del-android').forEach(btn => {
                btn.onclick = () => { FAR.Autostart.removeAndroidApp(btn.dataset.pkg, btn.dataset.act); render(); };
            });
        };

        render();
    }
});