// ============================================================
// 47-wm-viewers.js — Универсальные просмотрщики для WM-режима.
// ============================================================
//
// Этот файл определяет общие функции, которые используются
// приложениями WM-режима (explorer, viewer, panorama, pdf, video,
// browser, jsdos, nes, emulator, mp3, lbrn2, gcode и т.д.):
//
//   • _trackBlobUrl(win, url)         — учёт blob URL для очистки
//   • _finalizeViewer(win)            — освобождение всех ресурсов
//   • _installViewerNavButtons(...)   — кнопки ◀/▶ в заголовке окна
//   • _mountFileViewer(win, props)    — универсальный просмотрщик
//   • _mountPanoramaViewer(win, props)— 360° панорама (Pannellum)
//   • _mountPdfViewer(win, props)     — PDF (PDFObject)
//   • _mountVideoViewer(win, props)   — видео
//   • _mountBrowserViewer(win, props) — встроенный браузер
// ============================================================

// ------------------------------------------------------------
// Учёт и освобождение blob URL
// ------------------------------------------------------------


FAR.WM._trackBlobUrl = function (win, url) {
    if (!win || !win.props || !url) return;
    if (!Array.isArray(win.props._blobUrls)) win.props._blobUrls = [];
    win.props._blobUrls.push(url);
};

/**
 * Освобождает все ресурсы окна-просмотрщика:
 *  • отзывает все blob URL;
 *  • останавливает JSDOS / NES / EmulatorJS (включая AudioContext);
 *  • уничтожает Pannellum-вьюер;
 *  • уничтожает API встроенного браузера.
 *  • удаляет виртуальный джойстик.
 */
FAR.WM._finalizeViewer = function (win) {
    if (!win || !win.props) return;

    // Уничтожаем виртуальный джойстик, если он есть
    if (typeof FAR.VirtualGamepad !== 'undefined') {
        if (win.bodyEl) {
            const rootNodes = win.bodyEl.querySelectorAll('[data-role="root"]');
            rootNodes.forEach(node => FAR.VirtualGamepad.unmount(node));
            FAR.VirtualGamepad.unmount(win.bodyEl);
        }
    }

    // JSDOS
    if (win.props._jsdosInstance) {
        try { win.props._jsdosInstance.stop(); } catch (e) { /* ignore */ }
        win.props._jsdosInstance = null;
    }

    // NES
    if (win.props._nesBrowser) {
        try { win.props._nesBrowser.destroy(); } catch (e) { /* ignore */ }
        win.props._nesBrowser = null;
    }

    // EmulatorJS (жесткая остановка аудио и WASM)
    if (win.props._emulatorInstance) {
        const emu = win.props._emulatorInstance;
        try {
            // 1. Обязательно закрываем AudioContext, иначе звук продолжит играть
            if (emu.Module && emu.Module.AL && emu.Module.AL.currentCtx &&
                emu.Module.AL.currentCtx.audioCtx) {
                try { emu.Module.AL.currentCtx.audioCtx.close(); } catch (e) {}
            }
            // 2. Останавливаем игровой цикл
            if (emu.gameManager && typeof emu.gameManager.toggleMainLoop === 'function') {
                try { emu.gameManager.toggleMainLoop(0); } catch (e) {}
            }
            if (emu.Module && typeof emu.Module.pauseMainLoop === 'function') {
                try { emu.Module.pauseMainLoop(); } catch (e) {}
            }
            // 3. Вызываем встроенные методы
            if (typeof emu.pause === 'function') { try { emu.pause(true); } catch (e) {} }
            if (typeof emu.destroy === 'function') { try { emu.destroy(); } catch (e) {} }
            // 4. Прерываем WebAssembly
            if (emu.Module && typeof emu.Module.abort === 'function') {
                try { emu.Module.abort(); } catch (e) {}
            }
        } catch (e) { /* ignore */ }

        // Очищаем глобальную ссылку только если это тот же инстанс
        if (window.EJS_emulator === emu) {
            window.EJS_emulator = null;
        }
        win.props._emulatorInstance = null;
    }

    // Pannellum
    if (win.props._pannellumViewer) {
        try { win.props._pannellumViewer.destroy(); } catch (e) { /* ignore */ }
        win.props._pannellumViewer = null;
    }

    // Встроенный браузер
    if (win.props._browserApi) {
        try { win.props._browserApi.destroy(); } catch (e) { /* ignore */ }
        win.props._browserApi = null;
    }

    // Blob URL
    if (Array.isArray(win.props._blobUrls)) {
        for (const u of win.props._blobUrls) {
            try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ }
        }
        win.props._blobUrls = [];
    }
};


// ------------------------------------------------------------
// Кнопки ◀ / ▶ в заголовке окна
// ------------------------------------------------------------

FAR.WM._installViewerNavButtons = function (win, item, side) {
    if (!win || !win.el) return;
    const titlebar = win.el.querySelector('.wm-titlebar');
    if (!titlebar) return;
    const actions = titlebar.querySelector('.wm-title-actions');
    if (!actions) return;

    // Удаляем старые кнопки (если были)
    actions.querySelectorAll('.wm-nav-btn').forEach(function (b) { b.remove(); });

    const sideCtx = FAR.side[side || FAR.activePanel];
    if (!sideCtx || !Array.isArray(sideCtx.files) || !item) return;

    const files = sideCtx.files;
    const curIdx = files.findIndex(function (f) {
        return f && f._id === item._id;
    });
    if (curIdx < 0) return;

    const findFileIdx = function (fromIdx, dir) {
        let i = fromIdx + dir;
        while (i >= 0 && i < files.length) {
            const it = files[i];
            if (it && !it.isFolder) return i;
            i += dir;
        }
        return -1;
    };

    const prevIdx = findFileIdx(curIdx, -1);
    const nextIdx = findFileIdx(curIdx, +1);

    const createNavBtn = function (label, targetIdx, title) {
        const btn = document.createElement('button');
        btn.className = 'wm-title-btn wm-nav-btn';
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener('click', async function (e) {
            e.stopPropagation();
            const f = files[targetIdx];
            if (!f) return;
            FAR.WM.closeWindow(win.id, true);
            try {
                await FAR.openFile(f, side, targetIdx);
            } catch (err) {
                console.error('[WM nav] openFile failed:', err);
            }
        });
        return btn;
    };

    const firstAction = actions.firstChild;
    if (prevIdx >= 0) {
        actions.insertBefore(createNavBtn('◀', prevIdx, 'Предыдущий файл'), firstAction);
    }
    if (nextIdx >= 0) {
        actions.insertBefore(createNavBtn('▶', nextIdx, 'Следующий файл'), firstAction);
    }
};


// ------------------------------------------------------------
// Универсальный просмотрщик файлов
// ------------------------------------------------------------

FAR.WM._mountFileViewer = async function (win, props) {
    const item = props.file;
    const side = props.side || FAR.activePanel;

    if (!item) {
        FAR.WM._mountFilePickerPrompt(win, 'Выберите файл для просмотра');
        return;
    }

    const sideCtx = FAR.side[side];
    if (!sideCtx || !sideCtx.db) {
        FAR.WM._mountNotice(win, '⚠️', 'Панель не подключена к БД.');
        return;
    }

    win.el.querySelector('.wm-title-text').textContent = '📄 ' + item.name;

    win.bodyEl.innerHTML =
        '<div style="height:100%;display:flex;flex-direction:column;background:#1e1e2e;min-height:0;">' +
        '  <div data-role="loading" style="flex:1;display:flex;align-items:center;justify-content:center;color:#a6adc8;font-size:13px;">Загрузка…</div>' +
        '  <div data-role="content" style="flex:1;display:none;overflow:auto;"></div>' +
        '</div>';

    const loadingEl = win.bodyEl.querySelector('[data-role="loading"]');
    const contentEl = win.bodyEl.querySelector('[data-role="content"]');

    try {
        const res = await FAR.readFileBodyFromSide(side, item);
        const data = res.data;
        const contentType = res.contentType || item.contentType || 'application/octet-stream';

        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';

        const ext = (item.name.split('.').pop() || '').toLowerCase();
        const imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp','ico'];
        const txtExts = ['txt','md','json','xml','csv','log','html','css','js','py','java','c','cpp','h','ini','cfg','yaml','yml'];

        if (imgExts.indexOf(ext) !== -1) {
            const blob = new Blob([data], {
                type: contentType.indexOf('image/') === 0
                    ? contentType
                    : 'image/' + (ext === 'jpg' ? 'jpeg' : ext)
            });
            const url = URL.createObjectURL(blob);
            FAR.WM._trackBlobUrl(win, url);
            contentEl.innerHTML =
                '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#0b0b12;padding:10px;box-sizing:border-box;">' +
                '  <img src="' + url + '" alt="" style="max-width:100%;max-height:100%;object-fit:contain;display:block;">' +
                '</div>';
        } else if (txtExts.indexOf(ext) !== -1 || !item.binary) {
            let text;
            try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(data);
            } catch (e) {
                text = FAR.hexPreview(data);
            }
            contentEl.innerHTML =
                '<pre style="margin:0;padding:14px;font-family:Consolas,\'Courier New\',monospace;' +
                'font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-all;color:#cdd6f4;">' +
                FAR.escapeHtml(text) + '</pre>';
        } else {
            contentEl.innerHTML =
                '<div style="padding:14px;color:#f9e2af;font-size:12px;">' +
                'Бинарный файл (' + FAR.formatSize(data.length) + ')</div>' +
                '<pre style="margin:0;padding:14px;font-family:monospace;font-size:11px;color:#a6adc8;white-space:pre-wrap;">' +
                FAR.hexPreview(data) + '</pre>';
        }

        FAR.WM._installViewerNavButtons(win, item, side);

    } catch (e) {
        console.error('[WM file viewer]', e);
        loadingEl.innerHTML = '<div style="padding:20px;color:#f38ba8;">Ошибка: ' + FAR.escapeHtml(e.message) + '</div>';
    }
};

// ------------------------------------------------------------
// Панорама 360° (Pannellum)
// ------------------------------------------------------------

FAR.WM._panoNavigateHotspot = async function (win, hs, side) {
    if (!hs) return;
    if (win._panoNavigating) return;
    win._panoNavigating = true;

    try {
        let targetItem = null;
        if (hs.source === 'db' && hs.dbPath) {
            targetItem = await FAR._findDbImageByPath(hs.dbPath, side);
        } else if (hs.panorama_url) {
            if (/^https?:\/\//i.test(hs.panorama_url)) {
                FAR.toast('Переход на внешний URL в WM не поддерживается', 'warning');
                return;
            }
            targetItem = await FAR._findDbImageByPath(hs.panorama_url, side);
        }

        if (!targetItem) {
            FAR.toast('Целевая панорама не найдена', 'warning');
            return;
        }

        if (Array.isArray(win.props._blobUrls)) {
            for (const u of win.props._blobUrls) {
                try { URL.revokeObjectURL(u); } catch (e) {}
            }
            win.props._blobUrls = [];
        }
        if (win.props._pannellumViewer) {
            try { win.props._pannellumViewer.destroy(); } catch (e) {}
            win.props._pannellumViewer = null;
        }

        win.props.file = targetItem;
        win.props._initialPitch = Number(hs.point_pitch) || 0;
        win.props._initialYaw   = Number(hs.point_yaw)   || 0;
        win.props._initialHfov  = 100;
        win.props._hotspotsOverride = null;

        await FAR.WM._mountPanoramaViewer(win, win.props);

    } catch (e) {
        FAR.toast('Ошибка перехода: ' + e.message, 'error');
    } finally {
        win._panoNavigating = false;
    }
};

FAR.WM._mountPanoramaViewer = async function (win, props) {
    const item = props.file;
    const side = props.side || FAR.activePanel;

    if (!item) {
        FAR.WM._mountFilePickerPrompt(win, 'Выберите панораму (jpg/png/webp)');
        return;
    }

    win.el.querySelector('.wm-title-text').textContent = '🌐 ' + item.name;

    win.bodyEl.innerHTML =
        '<div style="height:100%;position:relative;background:#000;min-height:0;">' +
        '  <div data-role="canvas" style="width:100%;height:100%;"></div>' +
        '  <div data-role="loading" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#a6adc8;background:rgba(0,0,0,0.9);z-index:10;">' +
        '    <div style="width:50px;height:50px;border:4px solid #313244;border-top-color:#89b4fa;border-radius:50%;animation:spin 1s linear infinite;"></div>' +
        '    <div>Загрузка панорамы…</div>' +
        '  </div>' +
        '</div>';

    const canvasEl  = win.bodyEl.querySelector('[data-role="canvas"]');
    const loadingEl = win.bodyEl.querySelector('[data-role="loading"]');

    const uniqueId = 'wm-pano-' + win.id + '-' + Date.now();
    canvasEl.id = uniqueId;

    if (win.props._pannellumViewer) {
        try { win.props._pannellumViewer.destroy(); } catch (e) {}
        win.props._pannellumViewer = null;
    }

    try {
        if (typeof FAR._ensureItemName === 'function') FAR._ensureItemName(item);

        const res = await FAR.readFileBodyFromSide(side, item);
        const blob = new Blob([res.data], { type: res.contentType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        FAR.WM._trackBlobUrl(win, url);

        let hotspots = [];
        if (Array.isArray(props._hotspotsOverride)) {
            hotspots = props._hotspotsOverride.map(function (hs) {
                let type = hs.type;
                if (typeof type !== 'string' || !type) type = 'scene';
                return {
                    pitch: Number(hs.pitch) || 0,
                    yaw: Number(hs.yaw) || 0,
                    type: type,
                    text: hs.text || hs.name || 'Переход',
                    source: hs.source || 'url',
                    dbPath: hs.dbPath || '',
                    panorama_url: hs.panorama_url || '',
                    point_pitch: Number(hs.targetPitch) || 0,
                    point_yaw: Number(hs.targetYaw) || 0,
                    id: hs.id
                };
            }).filter(function (hs) {
                if (hs.type === 'scene' &&
                    (!hs.panorama_url || !String(hs.panorama_url).trim()) &&
                    !(hs.source === 'db' && hs.dbPath)) {
                    return false;
                }
                return true;
            });
        } else {
            try {
                const jsonData = await FAR._findPanoramaJson(item, side);
                const basePath = item.path.includes('/')
                    ? item.path.substring(0, item.path.lastIndexOf('/'))
                    : '';
                hotspots = FAR._jsonToPannellumHotspots(jsonData, basePath, url);
            } catch (e) {
                console.warn('[WM pano] hotspots:', e);
            }
        }

        const oldSide = FAR._panoCurrentSide;
        FAR._panoCurrentSide = side;

        if (typeof window.pannellum === 'undefined') {
            throw new Error('Pannellum не загружен');
        }

        const viewer = window.pannellum.viewer(uniqueId, {
            type: 'equirectangular',
            panorama: url,
            autoLoad: true,
            autoRotate: false,
            showControls: true,
            showFullscreenCtrl: true,
            showZoomCtrl: true,
            mouseZoom: true,
            keyboardZoom: true,
            doubleClickZoom: false,
            compass: false,
            hfov:  Number(props._initialHfov)  || 100,
            pitch: Number(props._initialPitch) || 0,
            yaw:   Number(props._initialYaw)   || 0,
            hotSpots: hotspots
        });

        win.props._pannellumViewer = viewer;
        FAR._panoCurrentSide = oldSide;

        viewer.on('load', function () {
            loadingEl.style.display = 'none';
            setTimeout(function () {
                const divs = canvasEl.querySelectorAll('.pnlm-hotspot-base');
                const divsArr = Array.from(divs);

                let hotspotsCfg = [];
                try {
                    const cfg = viewer.getConfig && viewer.getConfig();
                    if (cfg && Array.isArray(cfg.hotSpots)) hotspotsCfg = cfg.hotSpots;
                } catch (e) { /* ignore */ }

                divsArr.forEach(function (div, idx) {
                    if (div._farWmIntercepted) return;
                    div._farWmIntercepted = true;

                    let matchedHs = null;
                    for (let i = 0; i < hotspotsCfg.length; i++) {
                        if (hotspotsCfg[i].div === div) {
                            matchedHs = hotspotsCfg[i];
                            break;
                        }
                    }
                    if (!matchedHs && idx < hotspotsCfg.length) {
                        matchedHs = hotspotsCfg[idx];
                    }
                    if (!matchedHs) return;

                    div.addEventListener('click', function (e) {
                        e.stopImmediatePropagation();
                        e.preventDefault();
                        FAR.WM._panoNavigateHotspot(win, matchedHs, side);
                    }, true);
                });

                if (typeof FAR.WM._attachPanoEditorDblClick === 'function') {
                    FAR.WM._attachPanoEditorDblClick(win, uniqueId, item, side);
                }
            }, 50);
        });

        viewer.on('error', function (msg) {
            console.warn('[WM pano] error:', msg);
            loadingEl.style.display = 'none';
            FAR.toast('Ошибка панорамы: ' + msg, 'error');
        });

        FAR.WM._installViewerNavButtons(win, item, side);

    } catch (e) {
        console.error('[WM pano]', e);
        loadingEl.innerHTML =
            '<div style="padding:20px;color:#f38ba8;text-align:center;">' +
            '  Ошибка: ' + FAR.escapeHtml(e.message) + '</div>';
    }
};

// ------------------------------------------------------------
// PDF (PDFObject)
// ------------------------------------------------------------

FAR.WM._mountPdfViewer = async function (win, props) {
    const item = props.file;
    const side = props.side || FAR.activePanel;

    if (!item) {
        FAR.WM._mountFilePickerPrompt(win, 'Выберите PDF-файл');
        return;
    }

    win.el.querySelector('.wm-title-text').textContent = '📄 ' + item.name;

    win.bodyEl.innerHTML =
        '<div style="height:100%;display:flex;flex-direction:column;background:#181825;min-height:0;">' +
        '  <div data-role="loading" style="flex:1;display:flex;align-items:center;justify-content:center;color:#a6adc8;font-size:13px;">Загрузка PDF…</div>' +
        '  <div data-role="root" style="flex:1;min-height:0;display:none;"></div>' +
        '</div>';

    const loadingEl = win.bodyEl.querySelector('[data-role="loading"]');
    const rootEl    = win.bodyEl.querySelector('[data-role="root"]');
    const uniqueId  = 'wm-pdf-' + win.id + '-' + Date.now();
    rootEl.id = uniqueId;

    try {
        if (typeof PDFObject === 'undefined' || typeof PDFObject.embed !== 'function') {
            throw new Error('PDFObject не загружен (lib/PDFObject/pdfobject.min.js)');
        }

        const res = await FAR.readFileBodyFromSide(side, item);
        const blob = new Blob([res.data], { type: res.contentType || 'application/pdf' });
        const url = URL.createObjectURL(blob);
        FAR.WM._trackBlobUrl(win, url);

        loadingEl.style.display = 'none';
        rootEl.style.display = 'block';

        if (PDFObject.supportsPDFs) {
            PDFObject.embed(url, '#' + uniqueId, {
                title: item.name || 'PDF'
            });
        } else {
            rootEl.innerHTML =
                '<div style="padding:30px;text-align:center;color:#a6adc8;">' +
                '  <div style="font-size:60px;margin-bottom:16px;">📄</div>' +
                '  <div>Браузер не может встроить PDF inline.<br>' +
                '  Скачайте файл и откройте во внешней программе.</div>' +
                '</div>';
        }

        FAR.WM._installViewerNavButtons(win, item, side);

    } catch (e) {
        console.error('[WM pdf]', e);
        loadingEl.innerHTML =
            '<div style="padding:20px;color:#f38ba8;text-align:center;">' +
            '  Ошибка: ' + FAR.escapeHtml(e.message) + '</div>';
    }
};

// ------------------------------------------------------------
// Видео
// ------------------------------------------------------------

FAR.WM._mountVideoViewer = async function (win, props) {
    const item = props.file;
    const side = props.side || FAR.activePanel;

    if (!item) {
        FAR.WM._mountFilePickerPrompt(win, 'Выберите видеофайл');
        return;
    }

    win.el.querySelector('.wm-title-text').textContent = '🎬 ' + item.name;

    win.bodyEl.innerHTML =
        '<div style="height:100%;display:flex;flex-direction:column;background:#000;min-height:0;">' +
        '  <div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;">' +
        '    <video data-role="video" controls playsinline ' +
        '           style="max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;background:#000;"></video>' +
        '  </div>' +
        '  <div data-role="info" style="padding:6px 12px;background:#181825;color:#a6adc8;font-size:11px;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>' +
        '</div>';

    const video  = win.bodyEl.querySelector('[data-role="video"]');
    const infoEl = win.bodyEl.querySelector('[data-role="info"]');

    const directUrl = FAR.buildDirectFileUrl(item, side);

    if (directUrl) {
        video.src = directUrl;
        if (item.size) {
            infoEl.textContent = FAR.formatSize(item.size) + ' • ' + (item.contentType || 'video/*');
        }

        video.addEventListener('error', async function onErr() {
            video.removeEventListener('error', onErr);
            try {
                infoEl.textContent = 'Прямой URL не сработал, загрузка целиком…';
                const res = await FAR.readFileBodyFromSide(side, item);
                const blob = new Blob([res.data], { type: res.contentType || 'video/mp4' });
                const url = URL.createObjectURL(blob);
                FAR.WM._trackBlobUrl(win, url);
                video.src = url;
                infoEl.textContent = FAR.formatSize(res.data.length) + ' (blob)';
            } catch (e) {
                infoEl.textContent = 'Ошибка: ' + e.message;
                infoEl.style.color = '#f38ba8';
            }
        });
    } else {
        try {
            const res = await FAR.readFileBodyFromSide(side, item);
            const blob = new Blob([res.data], { type: res.contentType || 'video/mp4' });
            const url = URL.createObjectURL(blob);
            FAR.WM._trackBlobUrl(win, url);
            video.src = url;
            infoEl.textContent = FAR.formatSize(res.data.length);
        } catch (e) {
            infoEl.textContent = 'Ошибка: ' + e.message;
            infoEl.style.color = '#f38ba8';
        }
    }

    FAR.WM._installViewerNavButtons(win, item, side);
};


// ------------------------------------------------------------
// Встроенный браузер
// ------------------------------------------------------------

FAR.WM._mountBrowserViewer = async function (win, props) {
    win.el.querySelector('.wm-title-text').textContent = props.title || '🌐 Браузер';

    win.bodyEl.innerHTML = '';
    win.bodyEl.style.display = 'flex';
    win.bodyEl.style.flexDirection = 'column';
    win.bodyEl.style.minHeight = '0';

    if (win.props._browserApi) {
        try { win.props._browserApi.destroy(); } catch (e) {}
        win.props._browserApi = null;
    }

    if (typeof FAR._createBrowser !== 'function') {
        FAR.WM._mountNotice(win, '🌐', 'Модуль браузера не загружен (38-browser-viewer.js).');
        return;
    }

    const api = FAR._createBrowser(win.bodyEl, {
        url: props.url || '',
        homeUrl: props.homeUrl || props.url || '',
        trusted: !!props.trusted,
        onChangeTitle: function (title) {
            const titleEl = win.el.querySelector('.wm-title-text');
            if (titleEl) titleEl.textContent = title;
        }
    });

    win.props._browserApi = api;
};