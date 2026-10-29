// ============================================================
// 48-wm-wallpaper.js — обои рабочего стола в оконном режиме
// ============================================================
//
// Возможности:
//   • Установить обои из файла в БД (по текущей активной панели).
//   • Установить обои по внешнему URL (http/https).
//   • Сбросить к дефолтному градиенту.
//
// Поведение:
//   • Состояние хранится в localStorage['filebd_wm_wallpaper'].
//   • При входе в WM применяется автоматически.
//   • Если обои были из БД, а пользователь переключил панель на
//     другую БД (fullUrl изменился) — обои сбрасываются к дефолту.
//     Как только пользователь возвращается на «свою» БД — обои
//     восстанавливаются автоматически.
//   • При смене сервера через applyConnectionToSide/applyConnectionToBoth
//     состояние перепроверяется на лету.
//
// Формат состояния в localStorage:
//   {
//     source:  'default' | 'db' | 'url',
//     side:    'left' | 'right' | null,   // только для source='db'
//     path:    'img/bg.jpg',              // только для source='db'
//     url:     'https://...',             // только для source='url'
//     fullUrl: 'http://host:5984/FileBD'  // только для source='db'
//   }

FAR.WMWallpaper = FAR.WMWallpaper || {};

FAR.WMWallpaper.LS_KEY = 'filebd_wm_wallpaper';

// Текущий blob URL для картинки, загруженной из БД.
// Храним глобально, чтобы корректно отзывать при переустановке.
FAR.WMWallpaper._currentBlobUrl = null;

// Текущее состояние (синхронизируется с LS)
FAR.WMWallpaper.state = {
    source: 'default',
    side: null,
    path: '',
    url: '',
    fullUrl: ''
};

// ============================================================
// Сохранение/загрузка состояния
// ============================================================

FAR.WMWallpaper._save = function () {
    try {
        const st = FAR.WMWallpaper.state;
        localStorage.setItem(FAR.WMWallpaper.LS_KEY, JSON.stringify({
            source: st.source || 'default',
            side: st.side || null,
            path: st.path || '',
            url: st.url || '',
            fullUrl: st.fullUrl || ''
        }));
    } catch (e) { /* ignore */ }
};

FAR.WMWallpaper._load = function () {
    try {
        const raw = localStorage.getItem(FAR.WMWallpaper.LS_KEY);
        if (!raw) {
            return { source: 'default', side: null, path: '', url: '', fullUrl: '' };
        }
        const obj = JSON.parse(raw);
        return {
            source: (obj && obj.source) || 'default',
            side: (obj && obj.side) || null,
            path: (obj && obj.path) || '',
            url: (obj && obj.url) || '',
            fullUrl: (obj && obj.fullUrl) || ''
        };
    } catch (e) {
        return { source: 'default', side: null, path: '', url: '', fullUrl: '' };
    }
};

// ============================================================
// Применение к DOM
// ============================================================

/**
 * Устанавливает фон #wmDesktop.
 * imageUrl === '' — сбросить к дефолтному градиенту (CSS-правило #wmDesktop).
 */
FAR.WMWallpaper._applyToDom = function (imageUrl) {
    const desktop = document.getElementById('wmDesktop');
    if (!desktop) return;

    if (imageUrl) {
        desktop.style.backgroundImage = 'url("' + imageUrl + '")';
        desktop.style.backgroundSize = 'cover';
        desktop.style.backgroundPosition = 'center center';
        desktop.style.backgroundRepeat = 'no-repeat';
    } else {
        // Убираем inline — вернётся градиент из CSS-правила #wmDesktop
        desktop.style.backgroundImage = '';
        desktop.style.backgroundSize = '';
        desktop.style.backgroundPosition = '';
        desktop.style.backgroundRepeat = '';
    }
};

FAR.WMWallpaper._applyDefault = function () {
    FAR.WMWallpaper._applyToDom(null);
};

// ============================================================
// Основная функция — применить текущее состояние
// ============================================================
//
// Порядок действий:
//   1. Прочитать состояние из LS.
//   2. Освободить предыдущий blob URL (если был).
//   3. Применить:
//      • source='url'   → сразу поставить URL;
//      • source='db'    → проверить совпадение fullUrl, найти файл,
//                         прочитать тело, создать blob URL, поставить;
//      • default / ошибки → дефолтный градиент.

FAR.WMWallpaper.apply = async function () {
    const st = FAR.WMWallpaper._load();
    FAR.WMWallpaper.state = st;

    // Освобождаем предыдущий blob URL
    if (FAR.WMWallpaper._currentBlobUrl) {
        try { URL.revokeObjectURL(FAR.WMWallpaper._currentBlobUrl); } catch (e) {}
        FAR.WMWallpaper._currentBlobUrl = null;
    }

    // --- URL ---
    if (st.source === 'url' && st.url) {
        FAR.WMWallpaper._applyToDom(st.url);
        return;
    }

    // --- Файл из БД ---
    if (st.source === 'db' && st.path && st.side) {
        const side = st.side;
        const ctx = FAR.side ? FAR.side[side] : null;

        // Панель не подключена — дефолт
        if (!ctx || !ctx.db) {
            FAR.WMWallpaper._applyDefault();
            return;
        }

        // fullUrl не совпадает с сохранённым — пользователь сменил сервер
        // (или переключился на другую БД на том же сервере) → дефолт.
        if (st.fullUrl && ctx.fullUrl && ctx.fullUrl !== st.fullUrl) {
            FAR.WMWallpaper._applyDefault();
            return;
        }

        // Пробуем прочитать файл
        try {
            const item = await FAR._readDocByPathFromSide(side, st.path);
            if (!item || item.isFolder) {
                FAR.WMWallpaper._applyDefault();
                return;
            }

            const r = await FAR.readFileBodyFromSide(side, item);
            const blob = new Blob([r.data], {
                type: r.contentType || 'image/jpeg'
            });
            const url = URL.createObjectURL(blob);
            FAR.WMWallpaper._currentBlobUrl = url;
            FAR.WMWallpaper._applyToDom(url);
        } catch (e) {
            console.warn('[WMWallpaper] ошибка загрузки обоев из БД:', e);
            FAR.WMWallpaper._applyDefault();
        }
        return;
    }

    // --- Дефолт ---
    FAR.WMWallpaper._applyDefault();
};

// ============================================================
// Публичные операции
// ============================================================

/**
 * Установить обои из файла в БД.
 * @param {string} side  — 'left' | 'right'
 * @param {string} path  — путь в БД (без ведущего слэша)
 */
FAR.WMWallpaper.setFromDb = function (side, path) {
    const ctx = FAR.side ? FAR.side[side] : null;
    if (!ctx || !ctx.db) {
        FAR.toast('Панель не подключена к БД', 'warning');
        return;
    }

    FAR.WMWallpaper.state = {
        source: 'db',
        side: side,
        path: FAR.normPath(path),
        url: '',
        fullUrl: ctx.fullUrl || ''
    };
    FAR.WMWallpaper._save();
    FAR.WMWallpaper.apply();

    FAR.toast('Обои установлены из БД', 'success');
};

/**
 * Установить обои по URL.
 * @param {string} url
 */
FAR.WMWallpaper.setFromUrl = function (url) {
    const trimmed = String(url || '').trim();
    if (!/^https?:\/\//i.test(trimmed)) {
        FAR.toast('URL должен начинаться с http:// или https://', 'warning');
        return;
    }

    FAR.WMWallpaper.state = {
        source: 'url',
        side: null,
        path: '',
        url: trimmed,
        fullUrl: ''
    };
    FAR.WMWallpaper._save();
    FAR.WMWallpaper.apply();

    FAR.toast('Обои установлены по URL', 'success');
};

/**
 * Сбросить обои к дефолту.
 */
FAR.WMWallpaper.reset = function () {
    FAR.WMWallpaper.state = {
        source: 'default',
        side: null,
        path: '',
        url: '',
        fullUrl: ''
    };
    FAR.WMWallpaper._save();
    FAR.WMWallpaper.apply();

    FAR.toast('Обои сброшены', 'info');
};

// ============================================================
// Диалоги выбора (для пунктов контекстного меню)
// ============================================================

/**
 * Запросить URL через prompt и применить.
 */
FAR.WMWallpaper.promptUrl = function () {
    const cur = FAR.WMWallpaper._load().url || '';
    const url = prompt('Введите URL картинки (http:// или https://):', cur);
    if (url === null) return;
    FAR.WMWallpaper.setFromUrl(url);
};

/**
 * Открыть стандартный диалог выбора файла из БД и применить
 * выбранное изображение как обои.
 */
FAR.WMWallpaper.pickFromDb = async function () {
    if (typeof FAR.WM === 'undefined' || typeof FAR.WM.openFileDialog !== 'function') {
        FAR.toast('Диалог выбора файла недоступен', 'error');
        return;
    }

    const side = FAR.activePanel;
    const ctx = FAR.side ? FAR.side[side] : null;
    if (!ctx || !ctx.db) {
        FAR.toast('Панель не подключена к БД', 'warning');
        return;
    }

    const picked = await FAR.WM.openFileDialog({
        title: 'Выбрать обои из БД',
        side: side
    });
    if (!picked) return;

    const ext = (picked.name.split('.').pop() || '').toLowerCase();
    const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'];
    if (imgExts.indexOf(ext) === -1) {
        FAR.toast('Выбранный файл не является изображением', 'warning');
        return;
    }

    FAR.WMWallpaper.setFromDb(side, picked.path);
};

// ============================================================
// Обёртки над WM: применяем обои при входе и при смене сервера
// ============================================================

(function installWallpaperHooks() {

    // --- Обёртка над FAR.WM.enter ---
    if (typeof FAR.WM === 'undefined' || typeof FAR.WM.enter !== 'function') {
        // WM ещё не загружен — ждём (не должно случаться при
        // правильном порядке подключения скриптов)
        setTimeout(installWallpaperHooks, 50);
        return;
    }
    if (FAR.WM._wallpaperWrapped) return;
    FAR.WM._wallpaperWrapped = true;

    const origEnter = FAR.WM.enter;
    FAR.WM.enter = function () {
        const r = origEnter.apply(this, arguments);

        // Применяем обои после того, как #wmDesktop показан.
        // Небольшая задержка — чтобы DOM успел отрисоваться.
        setTimeout(function () {
            try { FAR.WMWallpaper.apply(); } catch (e) {
                console.warn('[WMWallpaper] apply on enter failed:', e);
            }
        }, 30);

        return r;
    };

    // --- Обёртка над FAR.applyConnectionToSide ---
    // Перепроверяем обои после смены сервера на панели.
    if (typeof FAR.applyConnectionToSide === 'function') {
        const origApplySide = FAR.applyConnectionToSide;
        FAR.applyConnectionToSide = function () {
            const r = origApplySide.apply(this, arguments);
            if (FAR.WM.state && FAR.WM.state.active) {
                setTimeout(function () {
                    try { FAR.WMWallpaper.apply(); } catch (e) {
                        console.warn('[WMWallpaper] apply after conn change failed:', e);
                    }
                }, 0);
            }
            return r;
        };
    }

    // --- Обёртка над FAR.applyConnectionToBoth ---
    // applyConnectionToBoth внутри вызывает applyConnectionToSide
    // дважды, но с точки зрения обоев нам важно только то, что
    // fullUrl мог измениться. Дополнительно вызывать не нужно —
    // обёртки над applyConnectionToSide достаточно. Однако если
    // по какой-то причине applyConnectionToBoth меняет fullUrl
    // и не дёргает applyConnectionToSide — подстрахуемся.
    if (typeof FAR.applyConnectionToBoth === 'function') {
        const origApplyBoth = FAR.applyConnectionToBoth;
        FAR.applyConnectionToBoth = function () {
            const r = origApplyBoth.apply(this, arguments);
            if (FAR.WM.state && FAR.WM.state.active) {
                setTimeout(function () {
                    try { FAR.WMWallpaper.apply(); } catch (e) {}
                }, 0);
            }
            return r;
        };
    }
})();