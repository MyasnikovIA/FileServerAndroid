// ============================================================
// Обёртка над Pannellum + резолвер путей в БД (lazy-friendly).
// ============================================================
//
// ВАЖНО (ленивая загрузка):
//   Раньше _findDbImageByPath искал только в FAR.fileIndex —
//   кэше текущей директории. В ленивом режиме файл из другой
//   папки там отсутствует. Теперь функции работают так:
//     1) если файл есть в fileIndex — берём оттуда (быстро);
//     2) иначе — читаем doc по _id = 'f:' + encodeURIComponent(path)
//        напрямую из БД нужной панели;
//     3) если это папка — рекурсивно ищем первое изображение
//        через FAR.listDirFromSide.
//
//   Все функции теперь async и принимают side.
// ============================================================

FAR._pannellumBlobUrls = FAR._pannellumBlobUrls || [];

/**
 * Достраивает поле name у элемента fileIndex, если его нет.
 * Экспортируется как FAR._ensureItemName, используется в других модулях.
 */
FAR._ensureItemName = function(item) {
    if (!item) return item;
    if (!item.name && item.path) {
        const p = FAR.normPath(item.path);
        item.name = p.includes('/') ? p.substring(p.lastIndexOf('/') + 1) : p;
    }
    return item;
};

// ============================================================
// Проверка расширения
// ============================================================

FAR._IMG_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];

FAR._isImageName = function(name) {
    const ext = (String(name || '').split('.').pop() || '').toLowerCase();
    return FAR._IMG_EXTS.indexOf(ext) !== -1;
};

// ============================================================
// Чтение одного документа из БД по пути
// ============================================================

/**
 * Загружает doc из БД стороны по пути. Ищет и как файл ('f:'),
 * и как папку ('d:'). Возвращает fileIndex-подобный объект или null.
 *
 * @param {string} side
 * @param {string} path   — normPath без ведущего слэша
 * @returns {Promise<Object|null>}
 */
FAR._readDocByPathFromSide = async function(side, path) {
    const s = FAR.side[side];
    if (!s || !s.db) return null;

    const norm = FAR.normPath(path);
    if (!norm) return null;

    // Пробуем как файл, потом как папку
    const candidates = [
        { id: 'f:' + encodeURIComponent(norm), kind: 'file' },
        { id: 'd:' + encodeURIComponent(norm), kind: 'folder' }
    ];

    for (const c of candidates) {
        try {
            const doc = await s.db.get(c.id);
            if (!doc) continue;
            const name = norm.split('/').pop();
            if (c.kind === 'folder') {
                return {
                    _id: doc._id,
                    path: norm,
                    name: name,
                    isFolder: true,
                    size: 0,
                    mtime: doc.mtime || 0,
                    docType: 'folder',
                    children: []
                };
            }
            return {
                _id: doc._id,
                path: norm,
                name: name,
                isFolder: false,
                size: doc.size || 0,
                mtime: doc.mtime || 0,
                binary: doc.binary || false,
                contentType: doc.contentType || '',
                children: doc.children || [],
                docType: 'file'
            };
        } catch (e) {
            if (e.status !== 404) {
                // Сеть/401 — не молчим
                console.warn('_readDocByPathFromSide:', c.id, e);
            }
        }
    }
    return null;
};

// ============================================================
// Резолвер: путь → fileIndex-элемент (или первое изображение в папке)
// ============================================================

/**
 * Возвращает элемент файла-изображения по пути.
 * Алгоритм:
 *   1) если в fileIndex панели есть точное совпадение — быстро отдаём;
 *   2) иначе читаем doc напрямую из БД стороны;
 *   3) если это папка — берём первое изображение из неё (listDirFromSide).
 *
 * @param {string} dbPath
 * @param {string} [side]  — по умолчанию активная панель
 * @returns {Promise<Object|null>}
 */
FAR._findDbImageByPath = async function(dbPath, side) {
    side = side || FAR.activePanel;
    const s = FAR.side[side];
    if (!s || !s.db) return null;

    const norm = FAR.normPath(dbPath);
    if (!norm) return null;

    // 1. Быстрый путь — есть в кэше текущей директории
    const ctx = FAR.side[side];
    if (ctx && Array.isArray(ctx.fileIndex)) {
        const hit = ctx.fileIndex.find(f =>
            f.docType === 'file' && FAR.normPath(f.path) === norm
        );
        if (hit) {
            FAR._ensureItemName(hit);
            return hit;
        }
    }

    // 2. Читаем doc напрямую из БД стороны
    const doc = await FAR._readDocByPathFromSide(side, norm);
    if (!doc) return null;

    // 3. Если это файл — отдаём
    if (!doc.isFolder) {
        // Проверим, что это изображение (панорама должна быть картинкой)
        if (!FAR._isImageName(doc.name)) {
            // Не картинка — вернём как есть, выше решат, что делать
            return doc;
        }
        return doc;
    }

    // 4. Это папка — ищем первое изображение внутри
    try {
        const children = await FAR.listDirFromSide(side, norm, { includeDocs: true });
        const img = children.find(c =>
            (c.docType === 'file' || !c.isFolder) && FAR._isImageName(c.name)
        );
        if (img) {
            FAR._ensureItemName(img);
            return img;
        }
    } catch (e) {
        console.warn('_findDbImageByPath: listDirFromSide failed', norm, e);
    }

    return null;
};

// ============================================================
// Загрузка изображения из БД как Blob URL
// ============================================================

/**
 * Загружает файл из БД стороны и возвращает Blob URL.
 * @param {string} dbPath
 * @param {string} [side]
 */
FAR._loadDbImageAsBlobUrl = async function(dbPath, side) {
    side = side || FAR.activePanel;

    const item = await FAR._findDbImageByPath(dbPath, side);
    if (!item) {
        throw new Error('Файл не найден в БД: ' + dbPath);
    }

    const { data, contentType } = await FAR.readFileBodyFromSide(side, item);
    const blob = new Blob([data], { type: contentType || 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    FAR._pannellumBlobUrls.push(url);
    return url;
};

/**
 * Освобождает все Blob URL, созданные для Pannellum.
 */
FAR._revokePannellumBlobUrls = function() {
    FAR._pannellumBlobUrls.forEach(function(u) {
        try { URL.revokeObjectURL(u); } catch (e) {}
    });
    FAR._pannellumBlobUrls = [];
};

// ============================================================
// Обёртка над window.pannellum.viewer
// ============================================================
//
// Поддерживает:
//  - scene.source === 'db' + scene.dbPath
//  - scene.panorama, начинающийся с 'db:'
//  - hotSpots[] с source === 'db' (загружает картинки заранее)
//
// ВАЖНО: side берётся из FAR._panoCurrentSide, чтобы читать
// тело из той же БД, из которой открыта панорама.

FAR._installPannellumDbWrapper = function() {
    if (!window.pannellum || window.pannellum._dbWrapped) {
        console.log('[pannellum-wrapper] уже установлена или pannellum нет');
        return;
    }
    const originalViewer = window.pannellum.viewer;
    console.log('[pannellum-wrapper] УСТАНОВКА. originalViewer =', typeof originalViewer);

    window.pannellum.viewer = function(container, config) {
        console.log('[pannellum-wrapper] viewer() вызван. container =', container,
                    'config.type =', config && config.type,
                    'config.panorama =', config && config.panorama,
                    'config.crossOrigin =', config && config.crossOrigin);

        const prep = async function() {
            const cfg = JSON.parse(JSON.stringify(config));
            const side = FAR._panoCurrentSide || FAR.activePanel;

            // ============================================================
            // САНИТИЗАЦИЯ ХОТСПОТОВ
            // ============================================================
            const sanitizeHotspot = function(hs) {
                if (!hs) return null;
                let type = hs.type;
                if (typeof type !== 'string' || !type) type = 'scene';
                hs.type = type;
                hs.pitch = Number(hs.pitch) || 0;
                hs.yaw = Number(hs.yaw) || 0;
                hs.point_pitch = Number(hs.point_pitch) || 0;
                hs.point_yaw = Number(hs.point_yaw) || 0;
                if (typeof hs.panorama_url !== 'string') {
                    hs.panorama_url = '';
                }
                return hs;
            };

            // ============================================================
            // КРИТИЧНО: убираем crossOrigin для Blob URL
            // ============================================================
            // Если panorama — Blob URL, crossOrigin='anonymous' ломает
            // WebGL-текстуру в libpannellum.js.
            const sanitizeCrossOrigin = function(obj) {
                if (!obj) return;

                const pano = obj.panorama;
                const isBlobUrl = typeof pano === 'string' && pano.indexOf('blob:') === 0;

                if (isBlobUrl) {
                    console.log('[pannellum-wrapper] Убираю crossOrigin для Blob URL');
                    delete obj.crossOrigin;
                }
            };

            // ============================================================
            // Сцены
            // ============================================================
            if (cfg.scenes) {
                for (const sceneId of Object.keys(cfg.scenes)) {
                    const sc = cfg.scenes[sceneId];
                    if (!sc) continue;

                    const wantsDb = sc.source === 'db'
                        || (typeof sc.panorama === 'string' && sc.panorama.startsWith('db:'));

                    if (wantsDb) {
                        const dbPath = sc.dbPath || (sc.panorama || '').replace(/^db:/, '');
                        try {
                            sc.panorama = await FAR._loadDbImageAsBlobUrl(dbPath, side);
                            delete sc.crossOrigin;
                            delete sc.source;
                            delete sc.dbPath;
                        } catch (e) {
                            console.error('Не удалось загрузить панораму из БД:', dbPath, e);
                        }
                    } else {
                        sanitizeCrossOrigin(sc);
                    }

                    if (Array.isArray(sc.hotSpots)) {
                        const cleaned = [];
                        for (const raw of sc.hotSpots) {
                            const hs = sanitizeHotspot(raw);
                            if (!hs) continue;

                            if (hs.source === 'db' && hs.dbPath) {
                                try {
                                    hs.panorama_url = await FAR._loadDbImageAsBlobUrl(hs.dbPath, side);
                                    hs._origDbPath = hs.dbPath;
                                } catch (e) {
                                    console.error('Не удалось загрузить хотспот из БД:', hs.dbPath, e);
                                    continue;
                                }
                            }

                            if (hs.type === 'scene' &&
                                (!hs.panorama_url || !String(hs.panorama_url).trim())) {
                                console.warn('[pannellum-wrapper] отбрасываю scene без panorama_url:', hs);
                                continue;
                            }

                            cleaned.push(hs);
                        }
                        sc.hotSpots = cleaned;
                    }
                }
            }

            // ============================================================
            // Одиночная сцена
            // ============================================================
            if (!cfg.scenes && cfg.panorama) {
                const wantsDb = cfg.source === 'db'
                    || (typeof cfg.panorama === 'string' && cfg.panorama.startsWith('db:'));
                if (wantsDb) {
                    const dbPath = cfg.dbPath || cfg.panorama.replace(/^db:/, '');
                    try {
                        cfg.panorama = await FAR._loadDbImageAsBlobUrl(dbPath, side);
                        delete cfg.crossOrigin;
                        delete cfg.source;
                        delete cfg.dbPath;
                    } catch (e) {
                        console.error('Не удалось загрузить панораму из БД:', dbPath, e);
                    }
                } else {
                    sanitizeCrossOrigin(cfg);
                }

                if (Array.isArray(cfg.hotSpots)) {
                    const cleaned = [];
                    for (const raw of cfg.hotSpots) {
                        const hs = sanitizeHotspot(raw);
                        if (!hs) continue;

                        if (hs.source === 'db' && hs.dbPath) {
                            try {
                                hs.panorama_url = await FAR._loadDbImageAsBlobUrl(hs.dbPath, side);
                                hs._origDbPath = hs.dbPath;
                            } catch (e) {
                                console.error('Не удалось загрузить хотспот из БД:', hs.dbPath, e);
                                continue;
                            }
                        }

                        if (hs.type === 'scene' &&
                            (!hs.panorama_url || !String(hs.panorama_url).trim())) {
                            console.warn('[pannellum-wrapper] отбрасываю scene без panorama_url:', hs);
                            continue;
                        }

                        cleaned.push(hs);
                    }
                    cfg.hotSpots = cleaned;
                }
            }

            // Финальная санитизация перед передачей в Pannellum
            sanitizeCrossOrigin(cfg);

            console.log('[pannellum-wrapper] cfg перед originalViewer:',
                        JSON.stringify({
                            type: cfg.type,
                            panorama: cfg.panorama && cfg.panorama.substring(0, 60),
                            crossOrigin: cfg.crossOrigin,   // должно быть undefined
                            hotSpotsCount: cfg.hotSpots && cfg.hotSpots.length
                        }));

            try {
                return originalViewer(container, cfg);
            } catch (e) {
                console.error('[pannellum-wrapper] originalViewer упал:', e);
                throw e;
            }
        };

        const queue = [];
        const proxy = { _isProxy: true, _ready: false, _real: null };

        ['on','off','loadScene','getScene','addScene','removeScene',
         'addHotSpot','removeHotSpot','lookAt','getPitch','setPitch',
         'getYaw','setYaw','getHfov','setHfov','getConfig','getContainer',
         'resize','destroy','toggleFullscreen','startAutoRotate',
         'stopAutoRotate','stopMovement','renderHotSpots','viewScene',
         'isLoaded','getNorthOffset','setNorthOffset','startOrientation',
         'stopOrientation','isOrientationActive','isOrientationSupported',
         'getPitchBounds','setPitchBounds','getYawBounds','setYawBounds',
         'getHfovBounds','setHfovBounds','zoomOut','getRenderer','setUpdate',
         'mouseEventToCoords','getLastClick','getLastSceneId'
        ].forEach(function(method) {
            proxy[method] = function() {
                if (proxy._real) {
                    return proxy._real[method].apply(proxy._real, arguments);
                }
                queue.push({ method: method, args: Array.from(arguments) });
                return proxy;
            };
        });

        prep().then(function(real) {
            proxy._real = real;
            proxy._ready = true;
            queue.forEach(function(call) {
                try { real[call.method].apply(real, call.args); }
                catch (e) { console.warn('Отложенный вызов упал:', call.method, e); }
            });
            queue.length = 0;
        }).catch(function(e) {
            console.error('[pannellum-wrapper] prep() упал:', e);
        });

        return proxy;
    };

    window.pannellum._dbWrapped = true;
    window.pannellum._originalViewer = originalViewer;
    console.log('[pannellum-wrapper] УСТАНОВЛЕНА');
};