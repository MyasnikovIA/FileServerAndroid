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

    if (def.singleton && !opts.forceNew && !opts._restoring) {
        const existing = FAR.WM.state.windows.find(function (w) {
            return w.appId === appId;
        });
        if (existing) {
            FAR.WM.restoreWindow(existing.id);
            FAR.WM.focusWindow(existing.id);

            if (typeof def.onReopen === 'function' && opts.props) {
                try {
                    def.onReopen(existing, opts.props);
                } catch (e) {
                    console.warn('[WM app onReopen]', appId, e);
                }
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
                try { def.onClose(w); } catch (e) { console.warn('[WM app onClose]', e); }
            }
        }
    });

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
// Приложение: Текстовый редактор (Notepad++)
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
        // Очистка при необходимости
    }
});

// ============================================================
// Приложение: Браузер (внутри WM-окна)
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

// ПРИЛОЖЕНИЕ NES УДАЛЕНО

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
// Приложение: Подключение
// ============================================================

FAR.WM.registerApp({
    id: 'connect',
    title: 'Подключение к БД',
    icon: '🔐',
    keywords: 'подключение база login conn',
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
// Приложение: Выбор файла из БД (диалог)
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