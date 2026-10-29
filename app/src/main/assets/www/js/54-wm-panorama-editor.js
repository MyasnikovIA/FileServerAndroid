// ============================================================
// 54-wm-panorama-editor.js — Редактор точек перехода для WM-режима
// ============================================================

FAR.WM.PanoEditorState = {
    item: null,
    side: null,
    hotspots: [],
    editingIndex: -1,
    coords: null,
    previewViewer: null,
    previewBlobUrl: null,
    previewItem: null,
    _watchRaf: null
};

/**
 * Открывает редактор точек для указанной панорамы.
 * Если редактор уже открыт — обновляет его данные.
 */
FAR.WM.openPanoEditor = async function (opts) {
    opts = opts || {};
    const side = opts.side || FAR.activePanel;
    const item = opts.item || null;
    const coords = opts.coords || null;

    // Сохраняем в общем состоянии
    FAR.WM.PanoEditorState.side = side;
    FAR.WM.PanoEditorState.item = item;
    FAR.WM.PanoEditorState.coords = coords;
    FAR.WM.PanoEditorState.editingIndex = -1;

    // Загружаем текущие хотспоты из JSON, если есть панорама
    FAR.WM.PanoEditorState.hotspots = [];
    if (item) {
        if (typeof FAR._ensureItemName === 'function') FAR._ensureItemName(item);
        try {
            const jsonData = await FAR._findPanoramaJson(item, side);
            const raw = jsonData && Array.isArray(jsonData.hotSpots) ? jsonData.hotSpots : [];
            FAR.WM.PanoEditorState.hotspots = raw.map(function(h) {
                return {
                    id: h.id || Date.now() + Math.random(),
                    name: h.name || h.text || 'Без имени',
                    type: h.type || 'scene',
                    text: h.text || 'Точка перехода',
                    pitch: parseFloat(h.pitch) || 0,
                    yaw: parseFloat(h.yaw) || 0,
                    targetPitch: parseFloat(h.targetPitch !== undefined ? h.targetPitch : h.point_pitch) || 0,
                    targetYaw: parseFloat(h.targetYaw !== undefined ? h.targetYaw : h.point_yaw) || 0,
                    source: h.source || (h.dbPath ? 'db' : 'url'),
                    dbPath: h.dbPath || '',
                    panorama_url: h.panorama_url || '',
                    path: h.path || '',
                    createdAt: h.createdAt || new Date().toISOString()
                };
            });
        } catch (e) {
            console.warn('[WM pano editor] load hotspots failed:', e);
        }
    }

    // Открываем (или фокусируем) окно редактора
    const existing = FAR.WM.state.windows.find(function(w) { return w.appId === 'panoeditor'; });
    if (existing) {
        FAR.WM.focusWindow(existing.id);
        await FAR.WM._mountPanoramaEditor(existing, existing.props);
        return existing;
    }

    return FAR.WM.openApp('panoeditor', { props: { side: side, item: item, coords: coords } });
};

FAR.WM._mountPanoramaEditor = async function (win, props) {
    const item = FAR.WM.PanoEditorState.item || (props && props.item);
    const side = FAR.WM.PanoEditorState.side || (props && props.side) || FAR.activePanel;
    const coords = FAR.WM.PanoEditorState.coords || (props && props.coords);

    if (!item) {
        FAR.WM._mountFilePickerPrompt(win, 'Выберите панораму для редактирования');
        return;
    }

    win.el.querySelector('.wm-title-text').textContent = '✏️ Редактор точек: ' + item.name;

    win.bodyEl.innerHTML = '';
    win.bodyEl.style.display = 'flex';
    win.bodyEl.style.flexDirection = 'row';
    win.bodyEl.style.background = '#1e1e2e';
    win.bodyEl.style.color = '#cdd6f4';
    win.bodyEl.style.overflow = 'hidden';

    // ===== ЛЕВАЯ КОЛОНКА: форма =====
    const leftCol = document.createElement('div');
    leftCol.style.cssText =
        'flex:0 0 420px;padding:16px;overflow-y:auto;border-right:1px solid #45475a;' +
        'display:flex;flex-direction:column;gap:12px;';

    leftCol.innerHTML =
        '<h4 style="margin:0 0 6px;color:#89b4fa;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Точка перехода</h4>' +
        '<label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#a6adc8;">Название' +
        '<input type="text" id="wmPeName" placeholder="Например: Кухня" maxlength="100" style="padding:6px 10px;background:#313244;border:1px solid #45475a;border-radius:4px;color:#cdd6f4;font-size:12px;"></label>' +
        '<label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#a6adc8;">Тип' +
        '<select id="wmPeType" style="padding:6px 10px;background:#313244;border:1px solid #45475a;border-radius:4px;color:#cdd6f4;font-size:12px;">' +
        '<option value="scene">Сцена (переход)</option>' +
        '<option value="info">Информация</option>' +
        '</select></label>' +
        '<label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#a6adc8;">Текст подсказки' +
        '<input type="text" id="wmPeText" placeholder="Перейти в ..." maxlength="200" style="padding:6px 10px;background:#313244;border:1px solid #45475a;border-radius:4px;color:#cdd6f4;font-size:12px;"></label>' +

        '<h4 style="margin:6px 0 6px;color:#89b4fa;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Координаты хотспота</h4>' +
        '<div style="display:flex;gap:8px;">' +
        '<label style="flex:1;display:flex;flex-direction:column;gap:4px;font-size:12px;color:#a6adc8;">Yaw' +
        '<input type="number" id="wmPeYaw" step="0.01" value="0" style="padding:6px 10px;background:#313244;border:1px solid #45475a;border-radius:4px;color:#cdd6f4;font-size:12px;"></label>' +
        '<label style="flex:1;display:flex;flex-direction:column;gap:4px;font-size:12px;color:#a6adc8;">Pitch' +
        '<input type="number" id="wmPePitch" step="0.01" value="0" style="padding:6px 10px;background:#313244;border:1px solid #45475a;border-radius:4px;color:#cdd6f4;font-size:12px;"></label>' +
        '</div>' +

        '<h4 style="margin:6px 0 6px;color:#89b4fa;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Целевая сцена</h4>' +
        '<label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#a6adc8;">Путь к файлу в БД' +
        '<div style="display:flex;gap:6px;">' +
        '<input type="text" id="wmPeDbPath" placeholder="/img/path" readonly style="flex:1;padding:6px 10px;background:#313244;border:1px solid #45475a;border-radius:4px;color:#cdd6f4;font-size:12px;">' +
        '<button id="wmPeBrowse" style="padding:6px 12px;background:#585b70;color:#cdd6f4;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;">📁 Обзор</button>' +
        '</div></label>' +
        '<label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#a6adc8;">Или URL (для внешних)' +
        '<input type="text" id="wmPeUrl" placeholder="https://..." style="padding:6px 10px;background:#313244;border:1px solid #45475a;border-radius:4px;color:#cdd6f4;font-size:12px;"></label>' +

        '<h4 style="margin:6px 0 6px;color:#89b4fa;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Направление взгляда после перехода</h4>' +
        '<div style="display:flex;gap:8px;">' +
        '<label style="flex:1;display:flex;flex-direction:column;gap:4px;font-size:12px;color:#a6adc8;">Target Yaw' +
        '<input type="number" id="wmPeTargetYaw" step="0.01" value="0" style="padding:6px 10px;background:#313244;border:1px solid #45475a;border-radius:4px;color:#cdd6f4;font-size:12px;"></label>' +
        '<label style="flex:1;display:flex;flex-direction:column;gap:4px;font-size:12px;color:#a6adc8;">Target Pitch' +
        '<input type="number" id="wmPeTargetPitch" step="0.01" value="0" style="padding:6px 10px;background:#313244;border:1px solid #45475a;border-radius:4px;color:#cdd6f4;font-size:12px;"></label>' +
        '</div>' +

        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">' +
        '<button id="wmPeCaptureDir" style="flex:1;padding:6px 10px;background:#89b4fa;color:#1e1e2e;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;">🎯 Зафиксировать</button>' +
        '<button id="wmPeResetDir" style="flex:1;padding:6px 10px;background:#585b70;color:#cdd6f4;border:none;border-radius:4px;cursor:pointer;font-size:11px;">↺ Сбросить</button>' +
        '</div>' +

        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;">' +
        '<button id="wmPeSave" style="flex:1;padding:8px 14px;background:#a6e3a1;color:#1e1e2e;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:bold;">💾 Сохранить точку</button>' +
        '<button id="wmPeResetForm" style="flex:1;padding:8px 14px;background:#585b70;color:#cdd6f4;border:none;border-radius:4px;cursor:pointer;font-size:13px;">↺ Новая точка</button>' +
        '<button id="wmPeCancel" style="flex:1;padding:8px 14px;background:#585b70;color:#cdd6f4;border:none;border-radius:4px;cursor:pointer;font-size:13px;">Закрыть</button>' +
        '</div>' +
        '<button id="wmPeExport" style="width:100%;padding:8px 14px;background:#cba6f7;color:#1e1e2e;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:bold;margin-top:4px;">📤 Сохранить JSON в БД</button>' +

        '<div id="wmPeFooterInfo" style="font-size:11px;color:#6c7086;margin-top:8px;line-height:1.4;"></div>';

    // ===== ПРАВАЯ КОЛОНКА: превью + список =====
    const rightCol = document.createElement('div');
    rightCol.style.cssText =
        'flex:1;padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:12px;min-width:0;';

    rightCol.innerHTML =
        '<h4 style="margin:0;color:#89b4fa;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Предпросмотр целевой сцены</h4>' +
        '<div id="wmPePreviewWrapper" style="position:relative;height:300px;background:#181825;border:1px solid #45475a;border-radius:6px;overflow:hidden;">' +
        '<div id="wmPePreviewCanvas" style="width:100%;height:100%;"></div>' +
        '<div id="wmPePreviewPlaceholder" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6c7086;font-size:13px;text-align:center;padding:20px;pointer-events:none;">Укажите путь и нажмите «👁 Загрузить предпросмотр»</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
        '<button id="wmPeLoadPreview" style="padding:6px 14px;background:#585b70;color:#cdd6f4;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;">👁 Загрузить предпросмотр</button>' +
        '<span id="wmPePreviewInfo" style="font-size:11px;color:#a6adc8;font-family:monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>' +
        '</div>' +
        '<div id="wmPeViewIndicator" style="background:#181825;border:1px solid #45475a;border-radius:6px;padding:8px 12px;font-family:monospace;font-size:12px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;">' +
        '<span style="color:#a6adc8;font-weight:bold;">Текущее направление:</span>' +
        '<span id="wmPeViewPitch" style="color:#a6e3a1;background:#313244;padding:2px 8px;border-radius:4px;border:1px solid #45475a;min-width:90px;text-align:center;">Pitch: 0.00°</span>' +
        '<span id="wmPeViewYaw" style="color:#a6e3a1;background:#313244;padding:2px 8px;border-radius:4px;border:1px solid #45475a;min-width:90px;text-align:center;">Yaw: 0.00°</span>' +
        '<span id="wmPeViewHfov" style="color:#a6e3a1;background:#313244;padding:2px 8px;border-radius:4px;border:1px solid #45475a;min-width:90px;text-align:center;">Hfov: 100°</span>' +
        '</div>' +
        '<div style="font-size:11px;color:#6c7086;font-style:italic;line-height:1.5;">Поверните мини-панораму в нужную сторону и нажмите «🎯 Зафиксировать направление» (или сделайте двойной клик по предпросмотру, чтобы сразу сохранить точку).</div>' +
        '<h4 style="margin:6px 0 6px;color:#89b4fa;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Точки перехода на текущей панораме</h4>' +
        '<div id="wmPeHotspotsList" style="flex:1;overflow-y:auto;background:#181825;border-radius:6px;padding:8px;min-height:100px;"></div>';

    win.bodyEl.appendChild(leftCol);
    win.bodyEl.appendChild(rightCol);

    // ===== Находим элементы =====
    const $ = function(id) { return win.bodyEl.querySelector('#' + id); };
    const els = {
        nameEl: $('wmPeName'),
        typeEl: $('wmPeType'),
        textEl: $('wmPeText'),
        yawEl: $('wmPeYaw'),
        pitchEl: $('wmPePitch'),
        dbPathEl: $('wmPeDbPath'),
        urlEl: $('wmPeUrl'),
        targetYawEl: $('wmPeTargetYaw'),
        targetPitchEl: $('wmPeTargetPitch'),
        footerInfo: $('wmPeFooterInfo'),
        hotspotsList: $('wmPeHotspotsList'),
        previewCanvas: $('wmPePreviewCanvas'),
        previewWrapper: $('wmPePreviewWrapper'),
        previewInfo: $('wmPePreviewInfo'),
        viewPitchEl: $('wmPeViewPitch'),
        viewYawEl: $('wmPeViewYaw'),
        viewHfovEl: $('wmPeViewHfov')
    };

    // Заполняем форму координатами
    if (coords) {
        els.yawEl.value = (parseFloat(coords.yaw) || 0).toFixed(2);
        els.pitchEl.value = (parseFloat(coords.pitch) || 0).toFixed(2);
    }

    els.footerInfo.textContent = 'Файл: ' + item.path;

    // Обработчики
    $('wmPeSave').onclick = function() {
        FAR.WM._peSaveHotspot(win, els, false);
    };

    $('wmPeResetForm').onclick = function() {
        FAR.WM.PanoEditorState.editingIndex = -1;
        els.nameEl.value = '';
        els.textEl.value = '';
        els.dbPathEl.value = '';
        els.urlEl.value = '';
        els.targetYawEl.value = '0';
        els.targetPitchEl.value = '0';
        els.yawEl.value = '0';
        els.pitchEl.value = '0';
        FAR.WM._peRenderHotspotsList(win, els);
        FAR.toast('Форма сброшена для создания новой точки', 'info');
    };

    $('wmPeCancel').onclick = function() {
        FAR.WM._peClearPreview(win);
        FAR.WM.closeWindow(win.id);
    };

    $('wmPeExport').onclick = async function() {
        try {
            const savedPath = await FAR.WM._peSaveJsonToDb();
            FAR.toast('JSON сохранён в БД: ' + savedPath, 'success');
            FAR.setStatus('✅ JSON сохранён: ' + savedPath);
        } catch (e) {
            FAR.toast('Ошибка сохранения JSON: ' + e.message, 'error');
        }
    };

    $('wmPeBrowse').onclick = async function() {
        const picked = await FAR.WM.openFileDialog({
            parentId: win.id,
            title: 'Выберите панораму',
            side: side
        });
        if (picked) {
            els.dbPathEl.value = '/' + FAR.normPath(picked.path);
            els.urlEl.value = '';
            FAR.WM._peLoadPreview(win, els);
        }
    };

    $('wmPeLoadPreview').onclick = function() {
        FAR.WM._peLoadPreview(win, els);
    };

    $('wmPeCaptureDir').onclick = function() {
        FAR.WM._peCaptureDirection(win, els);
    };

    $('wmPeResetDir').onclick = function() {
        els.targetYawEl.value = '0';
        els.targetPitchEl.value = '0';
        FAR.toast('Направление сброшено', 'info');
    };

    // Обработчик двойного клика на предпросмотре
    els.previewWrapper.addEventListener('dblclick', function(e) {
        if (e.target && e.target.closest) {
            if (e.target.closest('.pnlm-controls-container') ||
                e.target.closest('.pnlm-control') ||
                e.target.closest('.pnlm-zoom-controls') ||
                e.target.closest('.pnlm-fullscreen-toggle-button') ||
                e.target.closest('.pnlm-compass')) {
                return;
            }
        }

        e.preventDefault();
        e.stopPropagation();

        const state = FAR.WM.PanoEditorState;
        if (!state.previewViewer) return;

        try {
            const pitch = state.previewViewer.getPitch();
            const yaw = state.previewViewer.getYaw();
            els.targetPitchEl.value = pitch.toFixed(2);
            els.targetYawEl.value = yaw.toFixed(2);

            FAR.toast('Направление зафиксировано: Pitch=' + pitch.toFixed(1) + ', Yaw=' + yaw.toFixed(1), 'success');

            // Сохраняем точку, не сбрасывая форму
            FAR.WM._peSaveHotspot(win, els, true).then(() => {
                FAR.WM._peSaveJsonToDb().then(savedPath => {
                    FAR.toast('JSON сохранён: ' + savedPath, 'success');
                }).catch(err => {
                    FAR.toast('Ошибка сохранения JSON: ' + err.message, 'error');
                });
            });
        } catch (err) {
            FAR.toast('Не удалось прочитать направление', 'error');
        }
    });

    // Рендер списка хотспотов
    FAR.WM._peRenderHotspotsList(win, els);
};

// --- Сохранение хотспота (только в память + обновление сцены) ---
FAR.WM._peSaveHotspot = async function(win, els, keepEditing) {
    const item = FAR.WM.PanoEditorState.item;
    if (!item) { FAR.toast('Нет активной панорамы', 'warning'); return; }

    const name = (els.nameEl.value || '').trim() || 'Без имени';
    const type = els.typeEl.value;
    const text = (els.textEl.value || '').trim() || 'Точка перехода';
    const yaw = parseFloat(els.yawEl.value) || 0;
    const pitch = parseFloat(els.pitchEl.value) || 0;
    const dbPath = (els.dbPathEl.value || '').trim();
    const url = (els.urlEl.value || '').trim();
    const targetYaw = parseFloat(els.targetYawEl.value) || 0;
    const targetPitch = parseFloat(els.targetPitchEl.value) || 0;

    if (!dbPath && !url) {
        FAR.toast('Укажите путь в БД или URL', 'warning');
        return;
    }

    let panoramaUrl = '';
    let source = 'url';
    let finalDbPath = '';

    if (dbPath) {
        source = 'db';
        finalDbPath = dbPath.startsWith('/') ? dbPath : '/' + dbPath;
        panoramaUrl = finalDbPath.replace(/^\/+/, '');
    } else {
        source = 'url';
        panoramaUrl = url;
    }

    const hs = {
        id: Date.now(),
        name: name,
        type: type,
        text: text,
        pitch: pitch,
        yaw: yaw,
        targetPitch: targetPitch,
        targetYaw: targetYaw,
        source: source,
        dbPath: finalDbPath,
        panorama_url: panoramaUrl,
        path: '',
        createdAt: new Date().toISOString()
    };

    const state = FAR.WM.PanoEditorState;
    if (state.editingIndex >= 0) {
        hs.id = state.hotspots[state.editingIndex].id || hs.id;
        state.hotspots[state.editingIndex] = hs;
        FAR.toast('Точка обновлена', 'success');
    } else {
        state.hotspots.push(hs);
        if (keepEditing) {
            state.editingIndex = state.hotspots.length - 1;
        }
        FAR.toast('Точка добавлена', 'success');
    }

    if (!keepEditing) {
        state.editingIndex = -1;
        els.nameEl.value = '';
        els.textEl.value = '';
        els.dbPathEl.value = '';
        els.urlEl.value = '';
        els.targetYawEl.value = '0';
        els.targetPitchEl.value = '0';
        els.yawEl.value = '0';
        els.pitchEl.value = '0';
    }

    await FAR.WM._peApplyHotspotsToScene();
    FAR.WM._peRenderHotspotsList(win, els);
};

// --- Применение хотспотов к текущей панораме ---
FAR.WM._peApplyHotspotsToScene = async function() {
    const state = FAR.WM.PanoEditorState;
    if (!state.item) return;

    const panoWin = FAR.WM.state.windows.find(function(w) {
        return w.appId === 'panorama' && w.props && w.props.file && w.props.file._id === state.item._id;
    });

    if (panoWin) {
        let savedPitch = 0, savedYaw = 0, savedHfov = 100;
        try {
            if (panoWin.props._pannellumViewer) {
                savedPitch = panoWin.props._pannellumViewer.getPitch();
                savedYaw = panoWin.props._pannellumViewer.getYaw();
                savedHfov = panoWin.props._pannellumViewer.getHfov();
            }
        } catch (e) {}

        panoWin.props._initialPitch = savedPitch;
        panoWin.props._initialYaw = savedYaw;

        // Передаем текущие точки из редактора напрямую в окно панорамы
        panoWin.props._hotspotsOverride = state.hotspots;
        await FAR.WM._mountPanoramaViewer(panoWin, panoWin.props);
        // Сбрасываем, чтобы при следующем открытии читалось из файла
        panoWin.props._hotspotsOverride = null;
    }
};

// --- Сохранение JSON в БД ---
FAR.WM._peSaveJsonToDb = async function() {
    const state = FAR.WM.PanoEditorState;
    if (!state.item) throw new Error('Нет активной панорамы');

    const item = state.item;
    const side = state.side;

    if (typeof FAR._ensureItemName === 'function') FAR._ensureItemName(item);
    const currentPath = FAR.normPath(item.path);
    const currentBase = currentPath.replace(/\.[^/.]+$/, '');
    const jsonPath = currentBase + '.json';

    const jsonData = {
        pitchCam: 0,
        yawCam: 0,
        hotSpots: state.hotspots.map(function(h) {
            return {
                id: h.id,
                name: h.name,
                type: h.type,
                text: h.text,
                pitch: parseFloat((h.pitch || 0).toFixed(12)),
                yaw: parseFloat((h.yaw || 0).toFixed(12)),
                targetPitch: parseFloat((h.targetPitch || 0).toFixed(12)),
                targetYaw: parseFloat((h.targetYaw || 0).toFixed(12)),
                source: h.source || 'url',
                dbPath: h.dbPath || '',
                panorama_url: h.panorama_url || '',
                path: h.path || '',
                createdAt: h.createdAt
            };
        })
    };

    const jsonString = JSON.stringify(jsonData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });

    const s = FAR.side[side];
    if (!s || !s.db) throw new Error('Нет подключения к БД');

    const docId = 'f:' + encodeURIComponent(jsonPath);

    // 1. Удаляем старый файл, чтобы избежать ошибки 500 (ATOMIC_MOVE на Windows)
    try {
        await s.db.remove(docId);
    } catch (e) {
        // Игнорируем, если файла не было
    }

    // 2. Записываем новый файл
    await s.db.putAttachment(docId, 'b', null, blob, 'application/json');

    // 3. Обновляем локальный кэш (fileIndex)
    const existingIdx = s.fileIndex.find(function(f) { return f._id === docId; });
    if (existingIdx) {
        existingIdx.size = blob.size;
        existingIdx.mtime = Date.now();
        existingIdx.contentType = 'application/json';
    } else {
        s.fileIndex.push({
            _id: docId,
            path: jsonPath,
            name: jsonPath.split('/').pop(),
            isFolder: false,
            size: blob.size,
            mtime: Date.now(),
            binary: false,
            contentType: 'application/json',
            docType: 'file',
            children: []
        });
    }

    // 4. Перезагружаем панель, чтобы обновить список файлов в UI
    await FAR.reloadPanel(side);
    FAR.renderPanel(side);

    return jsonPath;
};

// --- Рендер списка хотспотов ---
FAR.WM._peRenderHotspotsList = function(win, els) {
    const state = FAR.WM.PanoEditorState;
    const listEl = els.hotspotsList;
    if (!listEl) return;
    listEl.innerHTML = '';

    if (state.hotspots.length === 0) {
        listEl.innerHTML = '<div style="color:#6c7086;font-style:italic;text-align:center;padding:20px;font-size:12px;">Нет созданных точек</div>';
        return;
    }

    state.hotspots.forEach(function(hs, idx) {
        const item = document.createElement('div');
        item.style.cssText =
            'display:flex;justify-content:space-between;align-items:flex-start;' +
            'padding:8px 10px;background:#313244;border:1px solid #45475a;' +
            'border-radius:5px;margin-bottom:6px;font-size:12px;';

        const targetLabel = hs.source === 'db'
            ? 'DB: ' + FAR.escapeHtml(hs.dbPath || hs.panorama_url || '')
            : 'URL: ' + FAR.escapeHtml(hs.panorama_url || '');

        item.innerHTML =
            '<div style="flex:1;min-width:0;">' +
            '<div style="color:#cdd6f4;font-weight:bold;margin-bottom:3px;">' + FAR.escapeHtml(hs.name || 'Без имени') + '</div>' +
            '<div style="color:#a6adc8;font-size:11px;font-family:monospace;word-break:break-all;">' +
            'Yaw: ' + (parseFloat(hs.yaw) || 0).toFixed(2) +
            ' Pitch: ' + (parseFloat(hs.pitch) || 0).toFixed(2) + '<br>' +
            '→ Yaw: ' + (parseFloat(hs.targetYaw) || 0).toFixed(2) +
            ' Pitch: ' + (parseFloat(hs.targetPitch) || 0).toFixed(2) + '<br>' +
            targetLabel +
            '</div></div>' +
            '<div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px;">' +
            '<button class="edit" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px 6px;border-radius:3px;color:#f9e2af;" title="Редактировать">✏️</button>' +
            '<button class="delete" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px 6px;border-radius:3px;color:#f38ba8;" title="Удалить">🗑️</button>' +
            '</div>';

        item.querySelector('.edit').onclick = function() {
            FAR.WM._peEditHotspot(win, els, idx);
        };
        item.querySelector('.delete').onclick = function() {
            FAR.WM._peDeleteHotspot(win, els, idx);
        };

        listEl.appendChild(item);
    });
};

FAR.WM._peEditHotspot = function(win, els, idx) {
    const state = FAR.WM.PanoEditorState;
    const hs = state.hotspots[idx];
    if (!hs) return;

    state.editingIndex = idx;

    els.nameEl.value = hs.name || '';
    els.typeEl.value = hs.type || 'scene';
    els.textEl.value = hs.text || '';
    els.yawEl.value = (parseFloat(hs.yaw) || 0).toFixed(2);
    els.pitchEl.value = (parseFloat(hs.pitch) || 0).toFixed(2);
    els.dbPathEl.value = hs.dbPath || '';
    els.urlEl.value = hs.source === 'url' ? (hs.panorama_url || '') : '';
    els.targetYawEl.value = (parseFloat(hs.targetYaw) || 0).toFixed(2);
    els.targetPitchEl.value = (parseFloat(hs.targetPitch) || 0).toFixed(2);

    FAR.WM._peRenderHotspotsList(win, els);
    FAR.toast('Редактирование: ' + hs.name, 'info');

    // Автозагрузка превью, если есть путь
    if (hs.dbPath || hs.panorama_url) {
        FAR.WM._peLoadPreview(win, els);
    }
};

FAR.WM._peDeleteHotspot = function(win, els, idx) {
    if (!confirm('Удалить точку "' + FAR.WM.PanoEditorState.hotspots[idx].name + '"?')) return;

    FAR.WM.PanoEditorState.hotspots.splice(idx, 1);

    const state = FAR.WM.PanoEditorState;
    if (state.editingIndex === idx) {
        state.editingIndex = -1;
        els.nameEl.value = '';
        els.textEl.value = '';
        els.dbPathEl.value = '';
        els.urlEl.value = '';
        els.targetYawEl.value = '0';
        els.targetPitchEl.value = '0';
        els.yawEl.value = '0';
        els.pitchEl.value = '0';
    } else if (state.editingIndex > idx) {
        state.editingIndex--;
    }

    FAR.WM._peRenderHotspotsList(win, els);
    FAR.WM._peApplyHotspotsToScene();
};

FAR.WM._peClearPreview = function(win) {
    const state = FAR.WM.PanoEditorState;
    FAR.WM._peStopDirectionWatch();

    if (state.previewViewer) {
        try { state.previewViewer.destroy(); } catch (e) {}
        state.previewViewer = null;
    }
    if (state.previewBlobUrl) {
        try { URL.revokeObjectURL(state.previewBlobUrl); } catch (e) {}
        state.previewBlobUrl = null;
    }
    state.previewItem = null;

    const canvas = win.bodyEl.querySelector('#wmPePreviewCanvas');
    if (canvas) canvas.innerHTML = '';
    const wrapper = win.bodyEl.querySelector('#wmPePreviewWrapper');
    if (wrapper) wrapper.classList.remove('loaded');
    const placeholder = win.bodyEl.querySelector('#wmPePreviewPlaceholder');
    if (placeholder) placeholder.style.display = 'flex';
};

FAR.WM._peLoadPreview = async function(win, els) {
    if (!FAR.ensureDb()) return;

    const dbPath = (els.dbPathEl.value || '').trim();
    const url = (els.urlEl.value || '').trim();

    if (!dbPath && !url) {
        FAR.toast('Укажите путь в БД или URL', 'warning');
        return;
    }

    FAR.WM._peClearPreview(win);

    const state = FAR.WM.PanoEditorState;
    const side = state.side || FAR.activePanel;

    try {
        let imageUrl = '';
        let itemForTarget = null;

        if (dbPath) {
            const norm = FAR.normPath(dbPath);
            itemForTarget = await FAR._findDbImageByPath(norm, side);
            if (!itemForTarget) {
                throw new Error('Файл не найден в БД: ' + dbPath);
            }

            const r = await FAR.readFileBodyFromSide(side, itemForTarget);
            const blob = new Blob([r.data], { type: r.contentType || 'image/jpeg' });
            imageUrl = URL.createObjectURL(blob);
            state.previewBlobUrl = imageUrl;
            state.previewItem = itemForTarget;
            els.previewInfo.textContent = itemForTarget.path;
        } else {
            imageUrl = url;
            els.previewInfo.textContent = url;
        }

        // Ждём размеров контейнера
        await new Promise(function(resolve) {
            requestAnimationFrame(function() {
                requestAnimationFrame(resolve);
            });
        });

        if (typeof window.pannellum === 'undefined') {
            throw new Error('Pannellum не загружен');
        }

        const uniqueId = 'wm-pe-preview-' + Date.now();
        els.previewCanvas.id = uniqueId;

        // Временно ставим правильный side для резолвера Pannellum
        const oldSide = FAR._panoCurrentSide;
        FAR._panoCurrentSide = side;

        const config = {
            type: 'equirectangular',
            panorama: imageUrl,
            autoLoad: true,
            autoRotate: false,
            showControls: true,
            showFullscreenCtrl: false,
            showZoomCtrl: true,
            mouseZoom: true,
            keyboardZoom: false,
            doubleClickZoom: false,
            compass: false,
            hfov: 100,
            pitch: 0,
            yaw: 0,
            hotSpots: []
        };

        state.previewViewer = window.pannellum.viewer(uniqueId, config);

        FAR._panoCurrentSide = oldSide;

        // Ждём load
        await new Promise(function(resolve) {
            let done = false;
            const onLoad = function() {
                if (done) return;
                done = true;
                resolve();
            };
            try {
                state.previewViewer.on('load', onLoad);
            } catch (e) {}
            setTimeout(onLoad, 3000);
        });

        // Применяем начальные target-координаты
        const initPitch = parseFloat(els.targetPitchEl.value) || 0;
        const initYaw = parseFloat(els.targetYawEl.value) || 0;
        try {
            state.previewViewer.lookAt(initPitch, initYaw, 100, 0);
        } catch (e) {}

        els.previewWrapper.classList.add('loaded');
        const placeholder = win.bodyEl.querySelector('#wmPePreviewPlaceholder');
        if (placeholder) placeholder.style.display = 'none';

        // Ресайзы
        setTimeout(function() {
            try { state.previewViewer.resize(); } catch (e) {}
        }, 100);

        FAR.WM._peUpdateDirectionIndicator(win, els);
        FAR.WM._peStartDirectionWatch(win, els);

    } catch (e) {
        console.error('[WM peLoadPreview]', e);
        FAR.toast('Не удалось загрузить предпросмотр: ' + e.message, 'error');
    }
};

FAR.WM._peUpdateDirectionIndicator = function(win, els) {
    const state = FAR.WM.PanoEditorState;
    if (!state.previewViewer) return;
    try {
        const pitch = state.previewViewer.getPitch();
        const yaw = state.previewViewer.getYaw();
        const hfov = state.previewViewer.getHfov();
        if (els.viewPitchEl) els.viewPitchEl.textContent = 'Pitch: ' + pitch.toFixed(2) + '°';
        if (els.viewYawEl) els.viewYawEl.textContent = 'Yaw: ' + yaw.toFixed(2) + '°';
        if (els.viewHfovEl) els.viewHfovEl.textContent = 'Hfov: ' + hfov.toFixed(0) + '°';
    } catch (e) {}
};

FAR.WM._peStartDirectionWatch = function(win, els) {
    FAR.WM._peStopDirectionWatch();
    const state = FAR.WM.PanoEditorState;
    let lastPitch = null, lastYaw = null, lastHfov = null;

    const loop = function() {
        if (!state.previewViewer) {
            state._watchRaf = null;
            return;
        }
        try {
            const v = state.previewViewer;
            const pitch = v.getPitch();
            const yaw = v.getYaw();
            const hfov = v.getHfov();
            if (pitch !== lastPitch || yaw !== lastYaw || hfov !== lastHfov) {
                lastPitch = pitch;
                lastYaw = yaw;
                lastHfov = hfov;
                FAR.WM._peUpdateDirectionIndicator(win, els);
            }
        } catch (e) {}
        state._watchRaf = requestAnimationFrame(loop);
    };
    state._watchRaf = requestAnimationFrame(loop);
};

FAR.WM._peStopDirectionWatch = function() {
    const state = FAR.WM.PanoEditorState;
    if (state._watchRaf) {
        cancelAnimationFrame(state._watchRaf);
        state._watchRaf = null;
    }
};

FAR.WM._peCaptureDirection = function(win, els) {
    const state = FAR.WM.PanoEditorState;
    if (!state.previewViewer) {
        FAR.toast('Сначала загрузите предпросмотр', 'warning');
        return;
    }
    try {
        const pitch = state.previewViewer.getPitch();
        const yaw = state.previewViewer.getYaw();
        els.targetPitchEl.value = pitch.toFixed(2);
        els.targetYawEl.value = yaw.toFixed(2);
        FAR.toast('Направление зафиксировано: Pitch=' + pitch.toFixed(1) + ', Yaw=' + yaw.toFixed(1), 'success');
    } catch (e) {
        FAR.toast('Не удалось прочитать направление', 'error');
    }
};

/**
 * Перехват двойного клика по панораме в WM-режиме.
 */
FAR.WM._attachPanoEditorDblClick = function(win, containerId, item, side) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (container._wmPanoDblClickHandler) {
        container.removeEventListener('dblclick', container._wmPanoDblClickHandler, true);
    }

    const handler = function(e) {
        if (e.target && e.target.closest) {
            if (e.target.closest('.pnlm-controls-container')) return;
            if (e.target.closest('.pnlm-control')) return;
            if (e.target.closest('.pnlm-zoom-controls')) return;
            if (e.target.closest('.pnlm-fullscreen-toggle-button')) return;
            if (e.target.closest('.pnlm-compass')) return;
            if (e.target.closest('.pnlm-hotspot-base')) return;
        }

        let coords = null;
        try {
            const viewer = win.props._pannellumViewer;
            if (viewer && typeof viewer.mouseEventToCoords === 'function') {
                const arr = viewer.mouseEventToCoords(e);
                if (Array.isArray(arr) && arr.length >= 2) {
                    coords = { pitch: arr[0], yaw: arr[1] };
                }
            }
        } catch (err) {
            console.warn('[WM pano] mouseEventToCoords error:', err);
        }

        if (!coords) {
            try {
                const viewer = win.props._pannellumViewer;
                if (viewer) {
                    const canvas = container.querySelector('canvas');
                    if (canvas) {
                        const rect = canvas.getBoundingClientRect();
                        const cx = e.clientX - rect.left;
                        const cy = e.clientY - rect.top;
                        const nx = (cx / rect.width) * 2 - 1;
                        const ny = 1 - (cy / rect.height) * 2;
                        const hfov = viewer.getHfov() || 100;
                        const pitch0 = viewer.getPitch() || 0;
                        const yaw0 = viewer.getYaw() || 0;
                        coords = {
                            pitch: pitch0 - ny * (hfov / 2) * 0.9,
                            yaw:   yaw0   + nx * (hfov / 2)
                        };
                    }
                }
            } catch (err) {
                console.warn('[WM pano] fallback coords error:', err);
            }
        }

        if (!coords) {
            FAR.toast('Не удалось определить координаты клика', 'warning');
            return;
        }

        e.stopPropagation();
        e.preventDefault();

        FAR.WM.openPanoEditor({
            item: item,
            side: side,
            coords: coords
        });
    };

    container._wmPanoDblClickHandler = handler;
    container.addEventListener('dblclick', handler, true);
};

// ============================================================
// Регистрация приложения (переопределяет пустышку из 44-wm-apps.js)
// ============================================================

FAR.WM.registerApp({
    id: 'panoeditor',
    title: 'Редактор панорам',
    icon: '✏️',
    keywords: 'редактор панорама точки hotspots',
    singleton: true,
    width: 1300,
    height: 800,
    open: async function (win, props) {
        await FAR.WM._mountPanoramaEditor(win, props || {});
    },
    onClose: function (win) {
        FAR.WM._peClearPreview(win);
        FAR.WM._peStopDirectionWatch();

        // Обновляем сцену при закрытии окна, чтобы точки точно отобразились
        try {
            FAR.WM._peApplyHotspotsToScene();
        } catch (e) {
            console.warn('Ошибка обновления сцены при закрытии:', e);
        }

        FAR.WM.PanoEditorState = {
            item: null, side: null, hotspots: [], editingIndex: -1,
            coords: null, previewViewer: null, previewBlobUrl: null,
            previewItem: null, _watchRaf: null
        };
    }
});