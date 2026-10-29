// ============================================================
// Просмотр панорам 360° через Pannellum в модальном окне
// ============================================================

FAR._panoViewer = null;
FAR._panoCurrentItem = null;
FAR._panoCurrentUrl = null;
FAR._panoBlobUrls = [];
FAR._panoCurrentHotspots = [];

// Флаг: идёт переход на другую сцену. Защищает от двойного клика
// (Pannellum навешивает свой onclick, наш перехватчик — тоже свой).
FAR._panoNavigating = false;

FAR.PANO_ASPECT_MIN = 1.9;
FAR.PANO_ASPECT_MAX = 2.1;

/**
 * Проверяет, является ли файл панорамой 360°.
 * Критерий: соотношение сторон ≈ 2:1 (например, 7744×3872).
 */
FAR.isPanorama = async function(item, side) {
    side = side || FAR.activePanel;

    if (!item || item.isFolder) return false;

    if (typeof FAR._ensureItemName === 'function') {
        FAR._ensureItemName(item);
    }

    const ext = (item.name.split('.').pop() || '').toLowerCase();
    const imgExts = ['jpg', 'jpeg', 'png', 'webp'];
    if (!imgExts.includes(ext)) return false;

    if (item.width && item.height) {
        const ratio = item.width / item.height;
        return ratio >= FAR.PANO_ASPECT_MIN && ratio <= FAR.PANO_ASPECT_MAX;
    }

    try {
        const { data } = await FAR.readFileBodyFromSide(side, item);
        const blob = new Blob([data], { type: item.contentType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);

        const dims = await FAR._measureImage(url);
        URL.revokeObjectURL(url);

        if (!dims) return false;
        const ratio = dims.width / dims.height;
        return ratio >= FAR.PANO_ASPECT_MIN && ratio <= FAR.PANO_ASPECT_MAX;
    } catch (e) {
        console.warn('isPanorama: не удалось измерить', item.name, e);
        return false;
    }
};

FAR._measureImage = function(url) {
    return new Promise(function(resolve) {
        const img = new Image();
        img.onload = function() {
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = function() { resolve(null); };
        img.src = url;
    });
};

/**
 * Ищет JSON с хотспотами для панорамы.
 */
FAR._findPanoramaJson = async function(item, side) {
    side = side || FAR._panoCurrentSide || FAR.activePanel;

    if (!item) return null;
    if (typeof FAR._ensureItemName === 'function') {
        FAR._ensureItemName(item);
    }

    const baseName = item.name.replace(/\.[^/.]+$/, '');
    const dir = item.path && item.path.includes('/')
        ? item.path.substring(0, item.path.lastIndexOf('/'))
        : '';
    const jsonPath = dir ? dir + '/' + baseName + '.json' : baseName + '.json';

    let jsonItem = FAR.fileIndex.find(f =>
        f.docType === 'file' && FAR.normPath(f.path) === FAR.normPath(jsonPath)
    );

    if (jsonItem) {
        try {
            const { data } = await FAR.readFileBodyFromSide(side, jsonItem);
            const text = new TextDecoder('utf-8').decode(data);
            return JSON.parse(text);
        } catch (e) {
            console.warn('JSON найден, но не распарсен:', jsonPath, e);
        }
    }

    try {
        const url = FAR._panoCurrentUrl && FAR._panoCurrentUrl.startsWith('http')
            ? FAR._panoCurrentUrl.replace(/\.[^/.]+$/, '') + '.json'
            : null;
        if (url) {
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) return await res.json();
        }
    } catch (e) { /* ignore */ }

    return null;
};

/**
 * Преобразует JSON с хотспотами FileBD в формат Pannellum.
 *
 * ВАЖНО: Pannellum падает, если у хотспота type='scene', но нет
 * panorama_url (или он пустой). Поэтому «битые» хотспоты мы
 * отбрасываем здесь.
 */
FAR._jsonToPannellumHotspots = function(jsonData, basePath, fallbackImageUrl) {
    const result = [];
    if (!jsonData || !Array.isArray(jsonData.hotSpots)) return result;

    jsonData.hotSpots.forEach(function(hs) {
        if (!hs) return;

        const src = hs.source || (hs.dbPath ? 'db' : 'url');

        // Pannellum вызывает .startsWith на type.
        let type = hs.type;
        if (typeof type !== 'string' || !type) {
            type = 'scene';
        }

        let relUrl = hs.panorama_url || '';
        let fullUrl = relUrl;

        if (relUrl && !/^https?:\/\//i.test(relUrl)) {
            const cleanBase = (basePath || '').replace(/\/+$/, '');
            const cleanRel = relUrl.replace(/^\/+/, '');
            fullUrl = cleanBase ? cleanBase + '/' + cleanRel : cleanRel;
        }

        if (type === 'scene') {
            const hasUrl = !!(fullUrl && String(fullUrl).trim());
            const hasDb  = !!(src === 'db' && hs.dbPath && String(hs.dbPath).trim());
            if (!hasUrl && !hasDb) {
                console.warn('[_jsonToPannellumHotspots] отбрасываю scene без источника:',
                    hs.name || hs.text || hs.id);
                return;
            }
        }

        result.push({
            pitch: Number(hs.pitch) || 0,
            yaw: Number(hs.yaw) || 0,
            type: type,
            text: hs.text || hs.name || 'Переход',
            panorama_url: fullUrl,
            relativePath: relUrl,
            point_pitch: Number(hs.targetPitch) || 0,
            point_yaw: Number(hs.targetYaw) || 0,
            targetHfov: Number(hs.targetHfov) || 100,
            source: src,
            dbPath: hs.dbPath || '',
            id: hs.id
        });
    });

    return result;
};

/**
 * Хелпер: собрать config для Pannellum viewer.
 *
 * ВАЖНО:
 *   • НЕ передаём onClickHotSpot — Pannellum сам навесит обработчик,
 *     который вызовет наш _onPanoramaHotspotClick. Это приводит к
 *     двойному вызову и race condition. Перехват делаем только через
 *     FAR._panoAttachHotspotInterceptors.
 *   • crossOrigin не задаём — panorama это Blob URL.
 */
FAR._buildPannellumConfig = function(opts) {
    return {
        type: 'equirectangular',
        panorama: opts.panorama,
        autoLoad: true,
        autoRotate: false,
        showControls: true,
        showFullscreenCtrl: true,
        showZoomCtrl: true,
        mouseZoom: true,
        keyboardZoom: true,
        doubleClickZoom: false,
        compass: false,
        hfov: Number(opts.hfov) || 100,
        pitch: Number(opts.pitch) || 0,
        yaw: Number(opts.yaw) || 0,
        hotSpots: Array.isArray(opts.hotSpots) ? opts.hotSpots : []
        // onClickHotSpot НЕ передаём — см. комментарий выше
        // crossOrigin НЕ передаём — panorama это Blob URL
    };
};

/**
 * Открывает панораму в модалке.
 */
FAR.openPanoramaViewer = async function(item, side) {
    side = side || FAR.activePanel;

    if (!FAR.ensureDb()) return;
    if (typeof FAR._ensureItemName === 'function') {
        FAR._ensureItemName(item);
    }

    FAR.closeViewer();

    FAR._panoCurrentItem = item;
    FAR._panoCurrentSide = side;
    FAR._panoBlobUrls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    FAR._panoBlobUrls = [];
    FAR._panoCurrentHotspots = [];

    const modal = document.getElementById('panoramaViewerModal');
    const title = document.getElementById('panoramaViewerTitle');
    const info = document.getElementById('panoramaViewerInfo');
    const loading = document.getElementById('panoramaLoading');
    const loadingText = document.getElementById('panoramaLoadingText');

    title.textContent = '🌐 ' + item.name;
    info.textContent = '';
    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    loadingText.textContent = 'Загрузка панорамы…';

    if (FAR._panoViewer) {
        try { FAR._panoViewer.destroy(); } catch (e) {}
        FAR._panoViewer = null;
    }

    document.getElementById('panoramaCanvas').innerHTML = '';

    try {
        const { data, contentType } = await FAR.readFileBodyFromSide(side, item);
        const blob = new Blob([data], { type: contentType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        FAR._panoBlobUrls.push(url);
        FAR._panoCurrentUrl = url;

        const dims = await FAR._measureImage(url);
        if (dims) {
            info.textContent = `📐 ${dims.width}×${dims.height} (${FAR.formatSize(data.length)})`;
        } else {
            info.textContent = `📁 ${FAR.formatSize(data.length)}`;
        }

        const basePath = item.path.includes('/')
            ? item.path.substring(0, item.path.lastIndexOf('/'))
            : '';
        const jsonData = await FAR._findPanoramaJson(item, side);
        const hotspots = FAR._jsonToPannellumHotspots(jsonData, basePath, url);

        FAR._panoCurrentHotspots = jsonData && Array.isArray(jsonData.hotSpots)
            ? jsonData.hotSpots.slice()
            : [];

        const initialPitch = jsonData && jsonData.pitchCam !== undefined
            ? jsonData.pitchCam
            : 0;
        const initialYaw = jsonData && jsonData.yawCam !== undefined
            ? jsonData.yawCam
            : 0;

        const config = FAR._buildPannellumConfig({
            panorama: url,
            pitch: initialPitch,
            yaw: initialYaw,
            hotSpots: hotspots
        });

        FAR._panoViewer = window.pannellum.viewer('panoramaCanvas', config);

        FAR._panoViewer.on('load', function() {
            loading.classList.add('hidden');
            FAR.setStatus('🌐 Панорама загружена: ' + item.name);
            setTimeout(function() {
                FAR._panoAttachHotspotInterceptors();
                FAR._panoAttachDblClickHandler();
            }, 50);
        });

        FAR._panoViewer.on('error', function(msg) {
            loading.classList.add('hidden');
            FAR.toast('Ошибка панорамы: ' + msg, 'error');
        });

    } catch (e) {
        console.error('openPanoramaViewer:', e);
        loading.classList.add('hidden');
        FAR.toast('Не удалось открыть панораму: ' + e.message, 'error');
    }
};

/**
 * Клик по хотспоту — переход на новую сцену.
 *
 * ВАЖНО: единственная точка входа — наш перехватчик
 * FAR._panoAttachHotspotInterceptors. Pannellum своего
 * onClickHotSpot НЕ получает (мы его не передаём в config).
 */
FAR._onPanoramaHotspotClick = async function(hs) {
    if (!hs) return;

    // Защита от двойного клика
    if (FAR._panoNavigating) {
        console.log('[pano] переход уже выполняется, пропускаю повторный клик');
        return;
    }
    FAR._panoNavigating = true;

    const side = FAR._panoCurrentSide || FAR.activePanel;

    const loading = document.getElementById('panoramaLoading');
    const loadingText = document.getElementById('panoramaLoadingText');
    loading.classList.remove('hidden');

    try {
        // ============================================================
        // ВАРИАНТ 1: источник — PouchDB
        // ============================================================
        if (hs.source === 'db' && hs.dbPath) {
            loadingText.textContent = 'Загрузка из БД: ' + hs.dbPath;

            // ВАЖНО: await, иначе item = Promise!
            const item = await FAR._findDbImageByPath(hs.dbPath, side);
            if (!item) throw new Error('Файл не найден: ' + hs.dbPath);

            if (typeof FAR._ensureItemName === 'function') {
                FAR._ensureItemName(item);
            }

            FAR._panoCurrentItem = item;
            FAR._panoCurrentHotspots = [];

            const { data, contentType } = await FAR.readFileBodyFromSide(side, item);
            const blob = new Blob([data], { type: contentType || 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            FAR._panoBlobUrls.push(url);
            FAR._panoCurrentUrl = url;

            const jsonData = await FAR._findPanoramaJson(item, side);
            const hotspots = FAR._jsonToPannellumHotspots(jsonData, '', url);
            FAR._panoCurrentHotspots = jsonData && Array.isArray(jsonData.hotSpots)
                ? jsonData.hotSpots.slice()
                : [];

            document.getElementById('panoramaViewerTitle').textContent = '🌐 ' + item.name;

            const dims = await FAR._measureImage(url);
            const info = document.getElementById('panoramaViewerInfo');
            if (dims) info.textContent = `📐 ${dims.width}×${dims.height} (${FAR.formatSize(data.length)})`;

            if (FAR._panoViewer) {
                try { FAR._panoViewer.destroy(); } catch (e) {}
                FAR._panoViewer = null;
            }
            document.getElementById('panoramaCanvas').innerHTML = '';

            const config = FAR._buildPannellumConfig({
                panorama: url,
                pitch: hs.point_pitch !== undefined ? hs.point_pitch : 0,
                yaw: hs.point_yaw !== undefined ? hs.point_yaw : 0,
                hotSpots: hotspots
            });

            FAR._panoViewer = window.pannellum.viewer('panoramaCanvas', config);
            FAR._panoViewer.on('load', function() {
                loading.classList.add('hidden');
                FAR.setStatus('🌐 Панорама: ' + item.name);
                setTimeout(function() {
                    FAR._panoAttachHotspotInterceptors();
                    FAR._panoAttachDblClickHandler();
                }, 50);
            });
            FAR._panoViewer.on('error', function(msg) {
                loading.classList.add('hidden');
                FAR.toast('Ошибка панорамы: ' + msg, 'error');
            });

            if (typeof FAR._selectFileInPanel === 'function') {
                FAR._selectFileInPanel(item, side);
            }

            return;
        }

        // ============================================================
        // ВАРИАНТ 2: URL (поиск файла в БД по panorama_url)
        // ============================================================
        if (!hs.panorama_url) {
            loading.classList.add('hidden');
            FAR.toast('У хотспота не задан panorama_url', 'warning');
            return;
        }

        loadingText.textContent = 'Переход: ' + hs.panorama_url;

        const normTarget = FAR.normPath(hs.panorama_url);

        // Ищем в текущем fileIndex
        let targetItem = FAR.fileIndex.find(f =>
            f.docType === 'file' && FAR.normPath(f.path) === normTarget
        );

        // Если не нашли — читаем напрямую из БД стороны
        if (!targetItem) {
            targetItem = await FAR._findDbImageByPath(normTarget, side);
        }

        if (!targetItem && FAR._panoCurrentItem) {
            const curPath = FAR.normPath(FAR._panoCurrentItem.path);
            const curDir = curPath.includes('/')
                ? curPath.substring(0, curPath.lastIndexOf('/'))
                : '';
            const altPath = FAR.normPath((curDir ? curDir + '/' : '') +
                hs.panorama_url.replace(/^.*?([^/]+\/[^/]+)$/, '$1'));
            targetItem = FAR.fileIndex.find(f =>
                f.docType === 'file' && FAR.normPath(f.path) === altPath
            );
            if (!targetItem) {
                targetItem = await FAR._findDbImageByPath(altPath, side);
            }
        }

        if (!targetItem) {
            throw new Error('Файл панорамы не найден в БД: ' + hs.panorama_url);
        }
        if (typeof FAR._ensureItemName === 'function') {
            FAR._ensureItemName(targetItem);
        }

        FAR._panoCurrentItem = targetItem;
        FAR._panoCurrentHotspots = [];

        const { data, contentType } = await FAR.readFileBodyFromSide(side, targetItem);
        const blob = new Blob([data], { type: contentType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        FAR._panoBlobUrls.push(url);
        FAR._panoCurrentUrl = url;

        const jsonData = await FAR._findPanoramaJson(targetItem, side);
        const hotspots = FAR._jsonToPannellumHotspots(jsonData, '', url);
        FAR._panoCurrentHotspots = jsonData && Array.isArray(jsonData.hotSpots)
            ? jsonData.hotSpots.slice()
            : [];

        document.getElementById('panoramaViewerTitle').textContent = '🌐 ' + targetItem.name;

        const dims = await FAR._measureImage(url);
        const info = document.getElementById('panoramaViewerInfo');
        if (dims) info.textContent = `📐 ${dims.width}×${dims.height} (${FAR.formatSize(data.length)})`;

        if (FAR._panoViewer) {
            try { FAR._panoViewer.destroy(); } catch (e) {}
            FAR._panoViewer = null;
        }
        document.getElementById('panoramaCanvas').innerHTML = '';

        const config = FAR._buildPannellumConfig({
            panorama: url,
            pitch: hs.point_pitch !== undefined ? hs.point_pitch : 0,
            yaw: hs.point_yaw !== undefined ? hs.point_yaw : 0,
            hotSpots: hotspots
        });

        FAR._panoViewer = window.pannellum.viewer('panoramaCanvas', config);
        FAR._panoViewer.on('load', function() {
            loading.classList.add('hidden');
            FAR.setStatus('🌐 Панорама: ' + targetItem.name);
            setTimeout(function() {
                FAR._panoAttachHotspotInterceptors();
                FAR._panoAttachDblClickHandler();
            }, 50);
        });
        FAR._panoViewer.on('error', function(msg) {
            loading.classList.add('hidden');
            FAR.toast('Ошибка панорамы: ' + msg, 'error');
        });

        if (typeof FAR._selectFileInPanel === 'function') {
            FAR._selectFileInPanel(targetItem, side);
        }

    } catch (e) {
        console.error('hotspot click:', e);
        loading.classList.add('hidden');
        FAR.toast('Переход не выполнен: ' + e.message, 'error');
    } finally {
        // Снимаем защиту от двойного клика
        FAR._panoNavigating = false;
    }
};


FAR.closePanoramaViewer = function() {
    const modal = document.getElementById('panoramaViewerModal');
    if (modal) modal.classList.add('hidden');

    const container = document.getElementById('panoramaCanvas');
    if (container && container._farDblClickHandler) {
        try {
            container.removeEventListener('dblclick', container._farDblClickHandler, true);
        } catch (e) {}
        container._farDblClickHandler = null;
    }

    if (FAR._panoViewer) {
        try { FAR._panoViewer.destroy(); } catch (e) {}
        FAR._panoViewer = null;
    }

    FAR._panoBlobUrls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    FAR._panoBlobUrls = [];

    document.getElementById('panoramaCanvas').innerHTML = '';
    FAR._panoCurrentItem = null;
    FAR._panoCurrentUrl = null;
    FAR._panoCurrentHotspots = [];
    FAR._panoCurrentSide = null;
    FAR._panoNavigating = false;
};

FAR.closePanoramaViewerOutside = function(e) {
    if (e.target === e.currentTarget) FAR.closePanoramaViewer();
};

FAR.downloadCurrentPanorama = async function() {
    if (!FAR._panoCurrentItem) {
        FAR.toast('Нет активной панорамы', 'warning');
        return;
    }
    const side = FAR._panoCurrentSide || FAR.activePanel;
    try {
        const { data, contentType } = await FAR.readFileBodyFromSide(side, FAR._panoCurrentItem);
        const blob = new Blob([data], { type: contentType || 'image/jpeg' });
        FAR.saveBlobAs(blob, FAR.sanitizeFileName(FAR._panoCurrentItem.name));
        FAR.toast('Панорама сохранена', 'success');
    } catch (e) {
        FAR.toast('Ошибка скачивания: ' + e.message, 'error');
    }
};

FAR._panoUpdateFooter = function() {
    const footer = document.querySelector('#panoramaViewerModal .modal-footer');
    if (!footer) return;

    const old = footer.querySelector('.pano-modal-footer-btn');
    if (old) old.remove();

    const btn = document.createElement('button');
    btn.className = 'pano-modal-footer-btn';
    btn.textContent = '✏️ Редактор точек';
    btn.onclick = function() {
        FAR.openPanoramaEditor();
    };

    const downloadBtn = footer.querySelector('button:last-child');
    if (downloadBtn && downloadBtn !== btn) {
        footer.insertBefore(btn, downloadBtn);
    } else {
        footer.appendChild(btn);
    }
};

// ============================================================
// Перехват кликов по хотспотам.
// Это ЕДИНСТВЕННЫЙ источник вызовов _onPanoramaHotspotClick.
// ============================================================

FAR._panoAttachHotspotInterceptors = function() {
    const container = document.getElementById('panoramaCanvas');
    if (!container) return;

    let hotspots = [];
    try {
        const cfg = FAR._panoViewer && FAR._panoViewer.getConfig();
        if (cfg && Array.isArray(cfg.hotSpots)) {
            hotspots = cfg.hotSpots;
        }
    } catch (e) { /* ignore */ }

    const divs = container.querySelectorAll('.pnlm-hotspot-base');

    divs.forEach(function(div) {
        if (div._farIntercepted) return;
        div._farIntercepted = true;

        let matchedHs = null;
        for (let i = 0; i < hotspots.length; i++) {
            if (hotspots[i].div === div) {
                matchedHs = hotspots[i];
                break;
            }
        }

        if (!matchedHs) {
            const idx = Array.prototype.indexOf.call(divs, div);
            if (idx >= 0 && idx < hotspots.length) {
                matchedHs = hotspots[idx];
            }
        }

        if (!matchedHs) {
            console.warn('Не удалось сопоставить хотспот с DOM-элементом');
            return;
        }

        // Захватываем событие в capture-фазе — ДО встроенного onclick
        // Pannellum. Это единственный вызов _onPanoramaHotspotClick.
        div.addEventListener('click', function(e) {
            e.stopImmediatePropagation();
            e.preventDefault();
            FAR._onPanoramaHotspotClick(matchedHs);
        }, true);

        div.addEventListener('touchend', function(e) {
            e.stopImmediatePropagation();
            e.preventDefault();
            FAR._onPanoramaHotspotClick(matchedHs);
        }, true);
    });
};

// ============================================================
// Двойной клик по панораме → открыть редактор с координатами
// ============================================================

FAR._panoHandleDblClick = function(coords) {
    if (!coords) return;
    if (!FAR._panoCurrentItem) return;

    const pitch = parseFloat(coords.pitch) || 0;
    const yaw = parseFloat(coords.yaw) || 0;

    console.log('DblClick по панораме:', { pitch, yaw });

    FAR.openPanoramaEditor({ pitch: pitch, yaw: yaw });

    FAR.toast('Координаты точки: Yaw=' + yaw.toFixed(2) +
              ', Pitch=' + pitch.toFixed(2), 'success');
};

FAR._panoAttachDblClickHandler = function() {
    const container = document.getElementById('panoramaCanvas');
    if (!container) return;

    if (container._farDblClickHandler) {
        try {
            container.removeEventListener('dblclick', container._farDblClickHandler, true);
        } catch (e) {}
        container._farDblClickHandler = null;
    }

    const handler = function(e) {
        if (e.target && e.target.closest && e.target.closest('.pnlm-hotspot-base')) {
            return;
        }

        if (e.target && e.target.closest && (
            e.target.closest('.pnlm-controls-container') ||
            e.target.closest('.pnlm-control') ||
            e.target.closest('.pnlm-zoom-controls') ||
            e.target.closest('.pnlm-fullscreen-toggle-button') ||
            e.target.closest('.pnlm-compass')
        )) {
            return;
        }

        let coords = null;
        try {
            if (FAR._panoViewer && typeof FAR._panoViewer.mouseEventToCoords === 'function') {
                const arr = FAR._panoViewer.mouseEventToCoords(e);
                if (Array.isArray(arr) && arr.length >= 2) {
                    coords = { pitch: arr[0], yaw: arr[1] };
                }
            }
        } catch (err) {
            console.warn('mouseEventToCoords error:', err);
        }

        if (!coords) {
            try {
                if (FAR._panoViewer) {
                    const canvas = container.querySelector('canvas');
                    if (canvas) {
                        const rect = canvas.getBoundingClientRect();
                        const cx = e.clientX - rect.left;
                        const cy = e.clientY - rect.top;
                        const nx = (cx / rect.width) * 2 - 1;
                        const ny = 1 - (cy / rect.height) * 2;
                        const hfov = FAR._panoViewer.getHfov() || 100;
                        const pitch0 = FAR._panoViewer.getPitch() || 0;
                        const yaw0 = FAR._panoViewer.getYaw() || 0;
                        coords = {
                            pitch: pitch0 - ny * (hfov / 2) * 0.9,
                            yaw:   yaw0   + nx * (hfov / 2)
                        };
                    }
                }
            } catch (err) {
                console.warn('Fallback dblclick coords error:', err);
            }
        }

        if (!coords) {
            FAR.toast('Не удалось определить координаты клика', 'warning');
            return;
        }

        e.stopPropagation();
        e.preventDefault();

        FAR._panoHandleDblClick(coords);
    };

    container._farDblClickHandler = handler;
    container.addEventListener('dblclick', handler, true);
};

// ============================================================
// Синхронизация активной панели файлового менеджера
// ============================================================

FAR._selectFileInPanel = function(item, side) {
    if (!item || !item.path) return;
    if (typeof FAR._ensureItemName === 'function') {
        FAR._ensureItemName(item);
    }

    side = side || FAR.activePanel;
    const ctx = FAR.side[side];
    if (!ctx) return;

    const targetPath = FAR.normPath(item.path);
    if (!targetPath) return;

    const dir = targetPath.includes('/')
        ? targetPath.substring(0, targetPath.lastIndexOf('/'))
        : '';

    const trySelect = function(s) {
        const c = FAR.side[s];
        if (!c) return false;

        const currentDir = FAR.normPath(c.path);
        if (currentDir !== dir) return false;

        const files = c.files || [];
        const idx = files.findIndex(function(f) {
            return FAR.normPath(f.path) === targetPath;
        });
        if (idx < 0) return false;

        c.selectedIdx.clear();
        c.selectedIdx.add(idx);
        c.cursor = idx;
        c.anchor = idx;

        FAR.renderPanel(s);
        if (typeof FAR.scrollCursorIntoView === 'function') {
            FAR.scrollCursorIntoView(s);
        }
        FAR.saveUiState();
        return true;
    };

    if (trySelect(side)) return;

    const newPath = dir ? '/' + dir : '/';
    ctx.path = newPath;
    ctx.selectedIdx.clear();
    ctx.anchor = -1;
    ctx.cursor = -1;

    FAR.renderPanel(side);

    const files = ctx.files || [];
    const idx = files.findIndex(function(f) {
        return FAR.normPath(f.path) === targetPath;
    });
    if (idx >= 0) {
        ctx.selectedIdx.clear();
        ctx.selectedIdx.add(idx);
        ctx.cursor = idx;
        ctx.anchor = idx;
        FAR.renderPanel(side);
        if (typeof FAR.scrollCursorIntoView === 'function') {
            FAR.scrollCursorIntoView(side);
        }
        FAR.saveUiState();
    }
};