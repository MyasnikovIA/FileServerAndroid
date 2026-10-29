// ============================================================
// 49-wm-wallpaper-360.js — 360°-обои рабочего стола (WM)
// ============================================================
//
// Расширяет 48-wm-wallpaper.js:
//   • если картинка-обои имеет соотношение сторон ≈ 2:1 —
//     вместо background-image монтируется Pannellum-вьюер;
//   • вьюер живёт в контейнере #wmWallpaper360 (z-index: 0),
//     иконки рабочего стола — над ним (z-index: 1);
//   • хотспоты из соседнего .json кликаются и меняют «локацию»
//     (новую панораму), как в обычном просмотрщике;
//   • текущая локация + положение камеры (yaw/pitch/hfov)
//     сохраняются в localStorage; на F5 восстанавливаются;
//   • при смене сервера БД: если файла нет — дефолтный градиент,
//     если появился — обои восстанавливаются.
//
// Ключ localStorage: filebd_wm_wallpaper_360
//   {
//     active:  true,
//     source:  'db' | 'url',
//     side:    'left' | 'right' | null,
//     path:    'img/room.jpg',        // для source='db'
//     url:     'https://...',         // для source='url'
//     fullUrl: 'http://host/FileBD',  // для source='db'
//     view:    { yaw, pitch, hfov }
//   }

FAR.WMWallpaper360 = FAR.WMWallpaper360 || {};

FAR.WMWallpaper360.LS_KEY     = 'filebd_wm_wallpaper_360';
FAR.WMWallpaper360.ASPECT_MIN = 1.9;
FAR.WMWallpaper360.ASPECT_MAX = 2.1;

// ---- Внутреннее состояние ----
FAR.WMWallpaper360._viewer           = null;   // прокси Pannellum
FAR.WMWallpaper360._currentItem      = null;
FAR.WMWallpaper360._currentSide      = null;
FAR.WMWallpaper360._currentHotspots  = [];
FAR.WMWallpaper360._navigating       = false;
FAR.WMWallpaper360._saveTimer        = null;
FAR.WMWallpaper360._viewWatcherRaf   = null;
FAR.WMWallpaper360._viewWatcherLast  = null;
FAR.WMWallpaper360._resizeHandler    = null;

// ============================================================
// localStorage: state
// ============================================================

FAR.WMWallpaper360._saveState = function (state) {
    try {
        localStorage.setItem(FAR.WMWallpaper360.LS_KEY, JSON.stringify(state));
    } catch (e) { /* ignore */ }
};

FAR.WMWallpaper360._loadState = function () {
    const empty = { active: false, view: { yaw: 0, pitch: 0, hfov: 100 } };
    try {
        const raw = localStorage.getItem(FAR.WMWallpaper360.LS_KEY);
        if (!raw) return empty;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object') return empty;
        if (!obj.view) obj.view = { yaw: 0, pitch: 0, hfov: 100 };
        return obj;
    } catch (e) {
        return empty;
    }
};

FAR.WMWallpaper360._resetState = function () {
    try { localStorage.removeItem(FAR.WMWallpaper360.LS_KEY); } catch (e) {}
};

// ============================================================
// localStorage: view (yaw/pitch/hfov)
// ============================================================

FAR.WMWallpaper360._saveView = function (view) {
    const st = FAR.WMWallpaper360._loadState();
    st.view = view || { yaw: 0, pitch: 0, hfov: 100 };
    FAR.WMWallpaper360._saveState(st);
};

FAR.WMWallpaper360._loadView = function () {
    const st = FAR.WMWallpaper360._loadState();
    return st.view || { yaw: 0, pitch: 0, hfov: 100 };
};

FAR.WMWallpaper360._scheduleSaveView = function (yaw, pitch, hfov) {
    if (FAR.WMWallpaper360._saveTimer) return;
    FAR.WMWallpaper360._saveTimer = setTimeout(function () {
        FAR.WMWallpaper360._saveTimer = null;
        FAR.WMWallpaper360._saveView({ yaw: yaw, pitch: pitch, hfov: hfov });
    }, 400);
};

FAR.WMWallpaper360._saveViewNow = function () {
    if (FAR.WMWallpaper360._saveTimer) {
        clearTimeout(FAR.WMWallpaper360._saveTimer);
        FAR.WMWallpaper360._saveTimer = null;
    }
    const v = FAR.WMWallpaper360._viewer;
    if (!v || !v._ready) return;
    try {
        FAR.WMWallpaper360._saveView({
            yaw:   v.getYaw(),
            pitch: v.getPitch(),
            hfov:  v.getHfov()
        });
    } catch (e) { /* ignore */ }
};

// ============================================================
// RAF-цикл: следим за камерой и сохраняем положение
// ============================================================
//
// Pannellum не предоставляет события «камера повернулась»,
// поэтому опрашиваем её значения через requestAnimationFrame
// и сохраняем debounced.

FAR.WMWallpaper360._startViewWatch = function () {
    FAR.WMWallpaper360._stopViewWatch();
    FAR.WMWallpaper360._viewWatcherLast = { yaw: null, pitch: null, hfov: null };

    const loop = function () {
        const v = FAR.WMWallpaper360._viewer;
        if (!v) {
            FAR.WMWallpaper360._viewWatcherRaf = null;
            return;
        }
        if (v._ready) {
            try {
                const yaw   = v.getYaw();
                const pitch = v.getPitch();
                const hfov  = v.getHfov();
                const last  = FAR.WMWallpaper360._viewWatcherLast;
                if (yaw !== last.yaw || pitch !== last.pitch || hfov !== last.hfov) {
                    last.yaw   = yaw;
                    last.pitch = pitch;
                    last.hfov  = hfov;
                    FAR.WMWallpaper360._scheduleSaveView(yaw, pitch, hfov);
                }
            } catch (e) { /* ignore */ }
        }
        FAR.WMWallpaper360._viewWatcherRaf = requestAnimationFrame(loop);
    };
    FAR.WMWallpaper360._viewWatcherRaf = requestAnimationFrame(loop);
};

FAR.WMWallpaper360._stopViewWatch = function () {
    if (FAR.WMWallpaper360._viewWatcherRaf) {
        cancelAnimationFrame(FAR.WMWallpaper360._viewWatcherRaf);
        FAR.WMWallpaper360._viewWatcherRaf = null;
    }
};

// ============================================================
// Измерение картинки
// ============================================================

FAR.WMWallpaper360._measureImage = function (url) {
    return new Promise(function (resolve) {
        const img = new Image();
        img.onload = function () {
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = function () { resolve(null); };
        img.src = url;
    });
};

// ============================================================
// Чтение JSON с хотспотами для текущей панорамы из БД
// ============================================================
//
// 24-panorama-viewer.js#_findPanoramaJson умеет искать JSON
// только в fileIndex текущей директории панели. Для обоев
// картинка может лежать в любой папке — читаем напрямую.

FAR.WMWallpaper360._findPanoJson = async function (item, side) {
    if (!item || !item.path) return null;
    FAR._ensureItemName(item);

    const baseName = item.name.replace(/\.[^/.]+$/, '');
    const dir = item.path.includes('/')
        ? item.path.substring(0, item.path.lastIndexOf('/'))
        : '';
    const jsonPath = dir ? dir + '/' + baseName + '.json' : baseName + '.json';

    try {
        const jsonItem = await FAR._readDocByPathFromSide(side, jsonPath);
        if (!jsonItem || jsonItem.isFolder) return null;
        const r = await FAR.readFileBodyFromSide(side, jsonItem);
        const text = new TextDecoder('utf-8').decode(r.data);
        return JSON.parse(text);
    } catch (e) {
        // 404 / parse error / нет БД — просто нет JSON
        return null;
    }
};

// ============================================================
// Контейнер обоев в DOM
// ============================================================

FAR.WMWallpaper360._ensureContainer = function () {
    const desktop = document.getElementById('wmDesktop');
    if (!desktop) return null;

    let container = document.getElementById('wmWallpaper360');
    if (!container) {
        container = document.createElement('div');
        container.id = 'wmWallpaper360';
        // Вставляем первым ребёнком, чтобы иконки (следующие
        // в DOM) оказались выше. Плюс явный z-index в CSS.
        desktop.insertBefore(container, desktop.firstChild);
    }
    return container;
};

// ============================================================
// Монтаж Pannellum-вьюера
// ============================================================
//
// opts = {
//   source: 'db' | 'url',
//   side:   'left' | 'right'  (для db),
//   path:   'img/room.jpg'    (для db),
//   url:    'https://...'     (для url),
//   fullUrl:'http://host/FileBD' (для db),
//   blobUrl:'blob:...'        (для db — уже прочитанный blob),
//   item:   { _id, path, ... } (для db)
// }

FAR.WMWallpaper360._mount = async function (opts) {
    const container = FAR.WMWallpaper360._ensureContainer();
    if (!container) return false;

    if (typeof window.pannellum === 'undefined') {
        console.warn('[WMWallpaper360] Pannellum не загружен');
        return false;
    }

    // --- Готовим URL панорамы и хотспоты ---
    let panoUrl = '';
    let hotspots = [];

    if (opts.source === 'db') {
        panoUrl = opts.blobUrl || '';
        if (!panoUrl) {
            console.warn('[WMWallpaper360] db source без blobUrl');
            return false;
        }

        try {
            const jsonData = await FAR.WMWallpaper360._findPanoJson(opts.item, opts.side);
            const basePath = opts.item.path.includes('/')
                ? opts.item.path.substring(0, opts.item.path.lastIndexOf('/'))
                : '';
            hotspots = FAR._jsonToPannellumHotspots(jsonData, basePath, panoUrl);
            FAR.WMWallpaper360._currentHotspots = jsonData && Array.isArray(jsonData.hotSpots)
                ? jsonData.hotSpots.slice()
                : [];
        } catch (e) {
            console.warn('[WMWallpaper360] JSON load failed:', e);
            FAR.WMWallpaper360._currentHotspots = [];
        }
    } else if (opts.source === 'url') {
        panoUrl = opts.url;
        FAR.WMWallpaper360._currentHotspots = [];
    } else {
        return false;
    }

    // --- Позиция камеры из LS ---
    const view = FAR.WMWallpaper360._loadView();

    // --- Обёртка над Pannellum читает FAR._panoCurrentSide,
    //     чтобы резолвить db-хотспоты. Выставляем заранее. ---
    FAR._panoCurrentSide = opts.side || FAR.activePanel;

    // --- Уничтожаем предыдущий viewer, если есть ---
    if (FAR.WMWallpaper360._viewer) {
        try { FAR.WMWallpaper360._viewer.destroy(); } catch (e) {}
        FAR.WMWallpaper360._viewer = null;
    }
    container.innerHTML = '';

    // --- Конфиг ---
    const cfg = {
        type: 'equirectangular',
        panorama: panoUrl,
        autoLoad: true,
        autoRotate: false,
        showControls: false,
        showFullscreenCtrl: false,
        showZoomCtrl: false,
        mouseZoom: true,
        keyboardZoom: false,
        doubleClickZoom: false,
        compass: false,
        hfov:  Number(view.hfov)  || 100,
        pitch: Number(view.pitch) || 0,
        yaw:   Number(view.yaw)   || 0,
        hotSpots: hotspots
    };

    // Внешний URL грузим с crossOrigin — иначе WebGL-текстура
    // не примет чужой домен.
    if (opts.source === 'url' && /^https?:\/\//i.test(panoUrl)) {
        cfg.crossOrigin = 'anonymous';
    }

    try {
        FAR.WMWallpaper360._viewer = window.pannellum.viewer('wmWallpaper360', cfg);
    } catch (e) {
        console.warn('[WMWallpaper360] viewer() failed:', e);
        return false;
    }

    // --- Запоминаем текущую локацию в LS ---
    const curState = FAR.WMWallpaper360._loadState();
    FAR.WMWallpaper360._saveState({
        active:  true,
        source:  opts.source,
        side:    opts.side || null,
        path:    opts.path || '',
        url:     opts.url  || '',
        fullUrl: opts.fullUrl || '',
        view:    curState.view || { yaw: 0, pitch: 0, hfov: 100 }
    });

    FAR.WMWallpaper360._currentItem = opts.item || null;
    FAR.WMWallpaper360._currentSide = opts.side || null;

    // --- События ---
    FAR.WMWallpaper360._viewer.on('load', function () {
        setTimeout(function () {
            FAR.WMWallpaper360._attachHotspotInterceptors();
        }, 50);
    });
    FAR.WMWallpaper360._viewer.on('error', function (msg) {
        console.warn('[WMWallpaper360] viewer error:', msg);
    });

    // --- Слежение за камерой ---
    FAR.WMWallpaper360._startViewWatch();

    // --- Реакция на resize окна ---
    if (!FAR.WMWallpaper360._resizeHandler) {
        FAR.WMWallpaper360._resizeHandler = function () {
            const v = FAR.WMWallpaper360._viewer;
            if (!v || !v._ready) return;
            try { v.resize(); } catch (e) {}
        };
        window.addEventListener('resize', FAR.WMWallpaper360._resizeHandler);
    }

    return true;
};

// ============================================================
// Перехват кликов по хотспотам
// ============================================================

FAR.WMWallpaper360._attachHotspotInterceptors = function () {
    const container = document.getElementById('wmWallpaper360');
    const viewer    = FAR.WMWallpaper360._viewer;
    if (!container || !viewer) return;

    let hotspots = [];
    try {
        const cfg = viewer.getConfig();
        if (cfg && Array.isArray(cfg.hotSpots)) hotspots = cfg.hotSpots;
    } catch (e) { /* ignore */ }

    const divs = container.querySelectorAll('.pnlm-hotspot-base');
    const divsArr = Array.from(divs);

    divsArr.forEach(function (div) {
        if (div._wmWallpaperIntercepted) return;
        div._wmWallpaperIntercepted = true;

        let matchedHs = null;
        for (let i = 0; i < hotspots.length; i++) {
            if (hotspots[i].div === div) { matchedHs = hotspots[i]; break; }
        }
        if (!matchedHs) {
            const idx = divsArr.indexOf(div);
            if (idx >= 0 && idx < hotspots.length) matchedHs = hotspots[idx];
        }
        if (!matchedHs) return;

        // Гасим встроенный onclick Pannellum
        try { div.onclick = null; }    catch (e) {}
        try { div.ontouchend = null; } catch (e) {}

        const handler = function (e) {
            e.stopImmediatePropagation();
            e.preventDefault();
            FAR.WMWallpaper360._onHotspotClick(matchedHs);
        };
        div.addEventListener('click',    handler, true);
        div.addEventListener('touchend', handler, true);
    });
};

// ============================================================
// Клик по хотспоту — переход на новую локацию
// ============================================================

FAR.WMWallpaper360._onHotspotClick = async function (hs) {
    if (!hs) return;
    if (FAR.WMWallpaper360._navigating) return;
    FAR.WMWallpaper360._navigating = true;

    try {
        const side = FAR.WMWallpaper360._currentSide || FAR.activePanel;

        let source = '';
        let sideFinal = side;
        let path = '';
        let url = '';
        let fullUrl = '';
        let item = null;

        if (hs.source === 'db' && hs.dbPath) {
            source = 'db';
            path = FAR.normPath(hs.dbPath);
            const ctx = FAR.side[side];
            fullUrl = ctx ? (ctx.fullUrl || '') : '';
            item = await FAR._findDbImageByPath(path, side);
            if (!item) throw new Error('Файл не найден в БД: ' + path);
        } else if (hs.panorama_url) {
            if (/^https?:\/\//i.test(hs.panorama_url)) {
                source = 'url';
                url = hs.panorama_url;
            } else {
                // локальный путь в БД
                source = 'db';
                path = FAR.normPath(hs.panorama_url);
                const ctx = FAR.side[side];
                fullUrl = ctx ? (ctx.fullUrl || '') : '';
                item = await FAR._findDbImageByPath(path, side);
                if (!item) throw new Error('Файл не найден в БД: ' + path);
            }
        } else {
            throw new Error('Не удалось определить цель перехода');
        }

        // ---- Сохраняем ЦЕЛЕВУЮ позицию камеры ДО монтирования ----
        // (следующая локация открывается с targetPitch/targetYaw)
        FAR.WMWallpaper360._saveView({
            yaw:   Number(hs.targetPitch !== undefined ? hs.targetYaw   : (hs.point_yaw   || 0)) || 0,
            pitch: Number(hs.targetPitch !== undefined ? hs.targetPitch : (hs.point_pitch || 0)) || 0,
            hfov:  100
        });

        // ---- Готовим blobUrl для DB-источника ----
        let blobUrl = '';
        if (source === 'db') {
            const r = await FAR.readFileBodyFromSide(sideFinal, item);
            const blob = new Blob([r.data], { type: r.contentType || 'image/jpeg' });
            blobUrl = URL.createObjectURL(blob);

            if (FAR.WMWallpaper._currentBlobUrl &&
                FAR.WMWallpaper._currentBlobUrl !== blobUrl) {
                try { URL.revokeObjectURL(FAR.WMWallpaper._currentBlobUrl); }
                catch (e) {}
            }
            FAR.WMWallpaper._currentBlobUrl = blobUrl;
        }

        // ---- Уничтожаем старый вьюер и монтируем новый ----
        if (FAR.WMWallpaper360._viewer) {
            try { FAR.WMWallpaper360._viewer.destroy(); } catch (e) {}
            FAR.WMWallpaper360._viewer = null;
        }

        const ok = await FAR.WMWallpaper360._mount({
            source: source,
            side:   source === 'db' ? sideFinal : null,
            path:   source === 'db' ? path : '',
            url:    source === 'url' ? url : '',
            fullUrl: source === 'db' ? fullUrl : '',
            blobUrl: source === 'db' ? blobUrl : '',
            item:   source === 'db' ? item : null
        });

        if (!ok) throw new Error('Не удалось открыть целевую панораму');

        FAR.toast('Переход: ' + (path || url), 'success');
    } catch (e) {
        console.error('[WMWallpaper360] hotspot click:', e);
        FAR.toast('Переход не выполнен: ' + e.message, 'error');
    } finally {
        FAR.WMWallpaper360._navigating = false;
    }
};

// ============================================================
// Восстановление из LS при apply (F5 или смена wallpaper)
// ============================================================

FAR.WMWallpaper360._restoreFromState = async function (st) {
    if (!st || !st.active) return false;

    try {
        if (st.source === 'db') {
            const side = st.side;
            const ctx = FAR.side ? FAR.side[side] : null;
            if (!ctx || !ctx.db) {
                FAR.WMWallpaper360._resetState();
                return false;
            }

            const item = await FAR._readDocByPathFromSide(side, st.path);
            if (!item || item.isFolder) {
                FAR.WMWallpaper360._resetState();
                return false;
            }

            const r = await FAR.readFileBodyFromSide(side, item);
            const blob = new Blob([r.data], { type: r.contentType || 'image/jpeg' });
            const blobUrl = URL.createObjectURL(blob);

            if (FAR.WMWallpaper._currentBlobUrl) {
                try { URL.revokeObjectURL(FAR.WMWallpaper._currentBlobUrl); }
                catch (e) {}
            }
            FAR.WMWallpaper._currentBlobUrl = blobUrl;

            const ok = await FAR.WMWallpaper360._mount({
                source:  'db',
                side:    side,
                path:    st.path,
                fullUrl: st.fullUrl || '',
                blobUrl: blobUrl,
                item:    item
            });
            if (!ok) FAR.WMWallpaper360._resetState();
            return ok;
        }

        if (st.source === 'url' && st.url) {
            const ok = await FAR.WMWallpaper360._mount({
                source: 'url',
                url:    st.url
            });
            if (!ok) FAR.WMWallpaper360._resetState();
            return ok;
        }
    } catch (e) {
        console.warn('[WMWallpaper360] restore failed:', e);
    }

    FAR.WMWallpaper360._resetState();
    return false;
};

// ============================================================
// Уничтожение
// ============================================================

FAR.WMWallpaper360._destroy = function () {
    FAR.WMWallpaper360._stopViewWatch();

    if (FAR.WMWallpaper360._saveTimer) {
        clearTimeout(FAR.WMWallpaper360._saveTimer);
        FAR.WMWallpaper360._saveTimer = null;
    }

    if (FAR.WMWallpaper360._viewer) {
        FAR.WMWallpaper360._saveViewNow();
        try { FAR.WMWallpaper360._viewer.destroy(); } catch (e) {}
        FAR.WMWallpaper360._viewer = null;
    }

    const container = document.getElementById('wmWallpaper360');
    if (container) container.innerHTML = '';

    FAR.WMWallpaper360._currentItem     = null;
    FAR.WMWallpaper360._currentSide     = null;
    FAR.WMWallpaper360._currentHotspots = [];
    FAR.WMWallpaper360._navigating      = false;
};

// ============================================================
// Обёртка над FAR.WMWallpaper.apply
// ============================================================
//
// Заменяем оригинальный apply на расширенный:
//   1) Уничтожаем предыдущий 360-вьюер.
//   2) Если есть активная запись в 49-LS (локация после
//      хотспот-навигации) — пытаемся её восстановить.
//   3) Иначе — читаем 48-LS, определяем 360/обычное фото и
//      либо монтируем Pannellum, либо отдаём оригинальному
//      apply (background-image).

(function wrapWallpaperApply() {
    if (typeof FAR.WMWallpaper === 'undefined' ||
        typeof FAR.WMWallpaper.apply !== 'function') {
        setTimeout(wrapWallpaperApply, 50);
        return;
    }
    if (FAR.WMWallpaper._w360Wrapped) return;
    FAR.WMWallpaper._w360Wrapped = true;

    const origApply      = FAR.WMWallpaper.apply;
    const origSetFromDb  = FAR.WMWallpaper.setFromDb;
    const origSetFromUrl = FAR.WMWallpaper.setFromUrl;
    const origReset      = FAR.WMWallpaper.reset;

    // ---- apply ----
    FAR.WMWallpaper.apply = async function () {
        // 1. Уничтожаем предыдущий 360-вьюер
        FAR.WMWallpaper360._destroy();

        // 2. Пробуем восстановить из 49-LS (последняя 360-локация)
        const s49 = FAR.WMWallpaper360._loadState();
        if (s49 && s49.active) {
            const ok = await FAR.WMWallpaper360._restoreFromState(s49);
            if (ok) {
                FAR.WMWallpaper._applyToDom(null);
                return;
            }
            // не удалось — падаем в стандартную логику
        }

        // 3. Стандартный путь: читаем 48-LS
        const st = FAR.WMWallpaper._load();
        FAR.WMWallpaper.state = st;

        if (FAR.WMWallpaper._currentBlobUrl) {
            try { URL.revokeObjectURL(FAR.WMWallpaper._currentBlobUrl); }
            catch (e) {}
            FAR.WMWallpaper._currentBlobUrl = null;
        }

        // 3a. Определяем источник картинки
        let imgUrl = '';
        let source = '';
        let side   = '';
        let path   = '';
        let item   = null;
        let tempBlobUrl = null;
        let usable = false;

        if (st.source === 'db' && st.path && st.side) {
            const ctx = FAR.side ? FAR.side[st.side] : null;
            if (ctx && ctx.db) {
                const fullUrlOk = !st.fullUrl || !ctx.fullUrl || st.fullUrl === ctx.fullUrl;
                if (fullUrlOk) {
                    try {
                        const it = await FAR._readDocByPathFromSide(st.side, st.path);
                        if (it && !it.isFolder) {
                            const r = await FAR.readFileBodyFromSide(st.side, it);
                            const blob = new Blob([r.data], { type: r.contentType || 'image/jpeg' });
                            tempBlobUrl = URL.createObjectURL(blob);
                            imgUrl  = tempBlobUrl;
                            source  = 'db';
                            side    = st.side;
                            path    = st.path;
                            item    = it;
                            usable  = true;
                        }
                    } catch (e) {
                        console.warn('[WMWallpaper360] db read failed:', e);
                    }
                }
            }
        } else if (st.source === 'url' && st.url) {
            imgUrl = st.url;
            source = 'url';
            usable = true;
        }

        // 3b. Нет источника — дефолт
        if (!usable) {
            FAR.WMWallpaper._applyToDom(null);
            return;
        }

        // 3c. Определяем, панорама ли это
        let is360 = false;
        try {
            const dims = await FAR.WMWallpaper360._measureImage(imgUrl);
            if (dims) {
                const ratio = dims.width / dims.height;
                is360 = ratio >= FAR.WMWallpaper360.ASPECT_MIN &&
                    ratio <= FAR.WMWallpaper360.ASPECT_MAX;
            }
        } catch (e) {
            console.warn('[WMWallpaper360] measure failed:', e);
        }

        // 3d. 360° → монтируем Pannellum
        if (is360) {
            if (source === 'db') {
                FAR.WMWallpaper._currentBlobUrl = tempBlobUrl;
                tempBlobUrl = null;
            }
            const ok = await FAR.WMWallpaper360._mount({
                source:  source,
                side:    side,
                path:    path,
                url:     source === 'url' ? imgUrl : '',
                fullUrl: st.fullUrl || '',
                blobUrl: source === 'db' ? FAR.WMWallpaper._currentBlobUrl : '',
                item:    item
            });
            if (ok) {
                FAR.WMWallpaper._applyToDom(null);
            } else {
                // Монтаж провалился — обычный фон
                FAR.WMWallpaper._applyToDom(imgUrl);
                if (source === 'db') {
                    FAR.WMWallpaper._currentBlobUrl = tempBlobUrl;
                    tempBlobUrl = null;
                }
            }
        } else {
            // 3e. Обычная картинка — background-image
            FAR.WMWallpaper._applyToDom(imgUrl);
            if (source === 'db') {
                FAR.WMWallpaper._currentBlobUrl = tempBlobUrl;
                tempBlobUrl = null;
            }
        }

        if (tempBlobUrl) {
            try { URL.revokeObjectURL(tempBlobUrl); } catch (e) {}
        }
    };

    // ---- setFromDb / setFromUrl / reset ----
    // Пользователь явно ставит новые обои — сбрасываем
    // 360-состояние (локацию после хотспот-навигации),
    // чтобы оно не перебило новый выбор.
    FAR.WMWallpaper.setFromDb = function () {
        FAR.WMWallpaper360._resetState();
        FAR.WMWallpaper360._destroy();
        return origSetFromDb.apply(this, arguments);
    };
    FAR.WMWallpaper.setFromUrl = function () {
        FAR.WMWallpaper360._resetState();
        FAR.WMWallpaper360._destroy();
        return origSetFromUrl.apply(this, arguments);
    };
    FAR.WMWallpaper.reset = function () {
        FAR.WMWallpaper360._resetState();
        FAR.WMWallpaper360._destroy();
        return origReset.apply(this, arguments);
    };
})();

// ============================================================
// Обёртка над FAR.WM.exit — при выходе из WM гасим вьюер
// ============================================================

(function wrapWMExit() {
    if (typeof FAR.WM === 'undefined' || typeof FAR.WM.exit !== 'function') {
        setTimeout(wrapWMExit, 50);
        return;
    }
    if (FAR.WM._wallpaper360ExitWrapped) return;
    FAR.WM._wallpaper360ExitWrapped = true;

    const origExit = FAR.WM.exit;
    FAR.WM.exit = function () {
        FAR.WMWallpaper360._destroy();
        return origExit.apply(this, arguments);
    };
})();

// ============================================================
// Синхронное сохранение при выгрузке страницы (F5)
// ============================================================

window.addEventListener('beforeunload', function () {
    if (FAR.WMWallpaper360._viewer) {
        FAR.WMWallpaper360._saveViewNow();
    }
});