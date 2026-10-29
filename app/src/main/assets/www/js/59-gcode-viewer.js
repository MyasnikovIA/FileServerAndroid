// ============================================================
// 59-gcode-viewer.js — Просмотрщик G-code (.gcode, .nc, .cnc)
// ============================================================

FAR.GCODE_EXTS = ['gcode', 'nc', 'cnc', 'tap'];

FAR.isGcode = function (item) {
    if (!item || item.isFolder) return false;
    const ext = (item.name.split('.').pop() || '').toLowerCase();
    return FAR.GCODE_EXTS.indexOf(ext) !== -1;
};

FAR.Gcode = FAR.Gcode || {};
FAR.Gcode._modalApi = null;
FAR.Gcode._currentItem = null;
FAR.Gcode._currentSide = null;

// ============================================================
// Публичное API (панельный режим)
// ============================================================

FAR.openGcodeViewer = async function (item, side) {
    side = side || FAR.activePanel;
    if (!FAR.ensureDb()) return;

    if (typeof FAR._ensureItemName === 'function') FAR._ensureItemName(item);
    try { FAR.closeViewer(); } catch (e) {}
    try { FAR.closePanoramaViewer(); } catch (e) {}
    try { FAR.closePdfViewer(); } catch (e) {}

    FAR.Gcode._currentItem = item;
    FAR.Gcode._currentSide = side;

    const modal = document.getElementById('gcodeViewerModal');
    const host = document.getElementById('gcodeRoot');
    const title = document.getElementById('gcodeViewerTitle');
    const loading = document.getElementById('gcodeLoading');

    if (!modal || !host) {
        console.error('[GCODE] Modal not found');
        return;
    }

    title.textContent = '⚙️ ' + item.name;
    modal.classList.remove('hidden');
    if (loading) loading.classList.remove('hidden');

    if (FAR.Gcode._modalApi) {
        try { FAR.Gcode._modalApi.destroy(); } catch (e) {}
        FAR.Gcode._modalApi = null;
    }

    FAR.Gcode._modalApi = FAR._createGcodeViewer(host, item, side);
};

FAR.closeGcodeViewer = function () {
    const modal = document.getElementById('gcodeViewerModal');
    if (modal) modal.classList.add('hidden');

    if (FAR.Gcode._modalApi) {
        try { FAR.Gcode._modalApi.destroy(); } catch (e) {}
        FAR.Gcode._modalApi = null;
    }
};

FAR.closeGcodeViewerOutside = function (e) {
    if (e.target === e.currentTarget) FAR.closeGcodeViewer();
};

// ============================================================
// ЯДРО: FAR._createGcodeViewer
// ============================================================

FAR._createGcodeViewer = function (hostEl, item, side) {
    if (!hostEl) throw new Error('_createGcodeViewer: hostEl required');

    const r6 = v => isFinite(v) ? Number(v.toFixed(6)).toString() : "0";

    // --- DOM ---
    hostEl.innerHTML =
        '<div class="gcode-sidebar" data-role="sidebar">' +
        '  <div class="section">' +
        '    <h3>Статистика</h3>' +
        '    <div data-role="stats" style="font-size:12px;color:#8a8a8a;line-height:1.6">Загрузка...</div>' +
        '  </div>' +
        '  <div class="section" style="flex:1">' +
        '    <h3>Легенда</h3>' +
        '    <div style="font-size:12px;color:#e0e0e0;line-height:1.6;">' +
        '      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
        '        <span style="width:12px;height:2px;background:#888;display:inline-block;"></span> G0 (Холостой ход)' +
        '      </div>' +
        '      <div style="display:flex;align-items:center;gap:6px;">' +
        '        <span style="width:12px;height:2px;background:#4a8cff;display:inline-block;"></span> G1 (Рабочий ход)' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '</div>' +
        '<div class="gcode-viewport" data-role="viewport">' +
        '  <div class="gcode-zoom-controls">' +
        '    <button data-role="btn-out" title="Уменьшить">−</button>' +
        '    <div class="gcode-zoom-label" data-role="zoom-label">100%</div>' +
        '    <button data-role="btn-in" title="Увеличить">+</button>' +
        '    <button data-role="btn-fit" title="Вписать">⛶</button>' +
        '  </div>' +
        '</div>';

    const el = {
        stats:    hostEl.querySelector('[data-role="stats"]'),
        viewport: hostEl.querySelector('[data-role="viewport"]'),
        zoomLabel:hostEl.querySelector('[data-role="zoom-label"]'),
        btnIn:    hostEl.querySelector('[data-role="btn-in"]'),
        btnOut:   hostEl.querySelector('[data-role="btn-out"]'),
        btnFit:   hostEl.querySelector('[data-role="btn-fit"]')
    };

    let svgEl = null, baseViewBox = null, currentViewBox = null;

    function setViewBox(vb){
        currentViewBox = { ...vb };
        if(svgEl){
            svgEl.setAttribute("viewBox", `${r6(vb.x)} ${r6(vb.y)} ${r6(vb.w)} ${r6(vb.h)}`);
        }
        const zoom = baseViewBox ? (baseViewBox.w / vb.w) * 100 : 100;
        el.zoomLabel.textContent = Math.round(zoom) + "%";
    }

    function fitView(){ if(baseViewBox) setViewBox(baseViewBox); }

    function zoomAt(factor, cx, cy){
        if(!currentViewBox) return;
        const vb = currentViewBox;
        const nw = vb.w / factor, nh = vb.h / factor;
        const sx = vb.x + cx * vb.w, sy = vb.y + cy * vb.h;
        setViewBox({
            x: sx - (sx - vb.x) * (nw / vb.w),
            y: sy - (sy - vb.y) * (nh / vb.h),
            w: nw, h: nh
        });
    }

    // Pan & Zoom
    el.viewport.addEventListener("wheel", e => {
        if(!currentViewBox) return;
        e.preventDefault();
        const rect = el.viewport.getBoundingClientRect();
        const cx = (e.clientX - rect.left) / rect.width;
        const cy = (e.clientY - rect.top) / rect.height;
        zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, cx, cy);
    }, { passive: false });

    let panState = null;
    el.viewport.addEventListener("pointerdown", e => {
        if(!currentViewBox || e.button !== 0) return;
        panState = { sx: e.clientX, sy: e.clientY, vb: { ...currentViewBox } };
        el.viewport.classList.add("dragging");
        el.viewport.setPointerCapture(e.pointerId);
    });
    el.viewport.addEventListener("pointermove", e => {
        if(!panState) return;
        const r = el.viewport.getBoundingClientRect();
        const dx = (e.clientX - panState.sx) / r.width  * panState.vb.w;
        const dy = (e.clientY - panState.sy) / r.height * panState.vb.h;
        setViewBox({ x: panState.vb.x - dx, y: panState.vb.y - dy, w: panState.vb.w, h: panState.vb.h });
    });
    el.viewport.addEventListener("pointerup", e => {
        if(!panState) return;
        panState = null; el.viewport.classList.remove("dragging");
        try { el.viewport.releasePointerCapture(e.pointerId); } catch(_){}
    });
    el.viewport.addEventListener("dblclick", fitView);

    el.btnIn.onclick  = () => zoomAt(1.3, .5, .5);
    el.btnOut.onclick = () => zoomAt(1/1.3, .5, .5);
    el.btnFit.onclick = fitView;

    // --- Инициализация (загрузка и парсинг файла) ---
    (async function init() {
        try {
            const res = await FAR.readFileBodyFromSide(side, item);
            const text = new TextDecoder('utf-8').decode(res.data);

            let currX = 0, currY = 0, currZ = 0;
            let isAbs = true;
            let travelPath = "";
            let cutPath = "";
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            let linesCount = 0, travelCount = 0, cutCount = 0;
            let minZ = Infinity, maxZ = -Infinity;

            // Разбиваем на строки и парсим
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].replace(/;.*$/, '').trim(); // Убираем комментарии
                if (!line) continue;
                linesCount++;

                // Проверка на абсолютные/относительные координаты
                if (/G90\b/.test(line)) isAbs = true;
                if (/G91\b/.test(line)) isAbs = false;

                // Ищем команды G0, G1
                const matchG = line.match(/G0?([01])\b/);
                if (matchG) {
                    const isRapid = matchG[1] === '0';

                    const xm = line.match(/X(-?\d*\.?\d+)/);
                    const ym = line.match(/Y(-?\d*\.?\d+)/);
                    const zm = line.match(/Z(-?\d*\.?\d+)/);

                    let nx = xm ? parseFloat(xm[1]) : currX;
                    let ny = ym ? parseFloat(ym[1]) : currY;
                    let nz = zm ? parseFloat(zm[1]) : currZ;

                    if (!isAbs) {
                        nx += currX;
                        ny += currY;
                        nz += currZ;
                    }

                    // Инвертируем Y для SVG
                    const svgY1 = -currY;
                    const svgY2 = -ny;

                    // Обновляем границы
                    if (nx < minX) minX = nx;
                    if (nx > maxX) maxX = nx;
                    if (ny < minY) minY = ny;
                    if (ny > maxY) maxY = ny;
                    if (nz < minZ) minZ = nz;
                    if (nz > maxZ) maxZ = nz;

                    if (isRapid) {
                        travelPath += `M${r6(currX)},${r6(svgY1)} L${r6(nx)},${r6(svgY2)} `;
                        travelCount++;
                    } else {
                        cutPath += `M${r6(currX)},${r6(svgY1)} L${r6(nx)},${r6(svgY2)} `;
                        cutCount++;
                    }

                    currX = nx;
                    currY = ny;
                    currZ = nz;
                }
            }

            if (minX === Infinity) throw new Error("В файле не найдено команд движения (G0/G1)");

            // ИСПРАВЛЕНИЕ: Сдвигаем только если есть отрицательные координаты
            const offsetX = minX < 0 ? -minX : 0;
            const offsetY = minY < 0 ? -minY : 0;

            // Координаты после сдвига
            const finalMaxX = maxX + offsetX;
            const finalMaxY = maxY + offsetY;

            // Границы сетки (кратны 10, плюс отступ от края)
            const GRID_STEP = 10;
            const GRID_PAD = 10;
            const gridMaxX = Math.max(GRID_STEP, Math.ceil((finalMaxX + GRID_PAD) / GRID_STEP) * GRID_STEP);
            const gridMaxY = Math.max(GRID_STEP, Math.ceil((finalMaxY + GRID_PAD) / GRID_STEP) * GRID_STEP);

            const FONT_SIZE = 5;
            const PAD = 15;

            baseViewBox = {
                x: -PAD,
                y: -(gridMaxY + PAD),
                w: gridMaxX + PAD * 2,
                h: gridMaxY + PAD * 2
            };

            // Генерация сетки
            const MINOR = "#dcdcdc";
            const AXIS = "#444444";
            const TEXT = "#222222";
            const gridParts = [];

            for (let x = GRID_STEP; x <= gridMaxX; x += GRID_STEP) {
                gridParts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${-gridMaxY}" stroke="${MINOR}" stroke-width="0.06"/>`);
            }
            for (let y = GRID_STEP; y <= gridMaxY; y += GRID_STEP) {
                gridParts.push(`<line x1="0" y1="${-y}" x2="${gridMaxX}" y2="${-y}" stroke="${MINOR}" stroke-width="0.06"/>`);
            }

            gridParts.push(`<line x1="0" y1="0" x2="${gridMaxX}" y2="0" stroke="${AXIS}" stroke-width="0.18"/>`);
            gridParts.push(`<line x1="0" y1="0" x2="0" y2="${-gridMaxY}" stroke="${AXIS}" stroke-width="0.18"/>`);

            // Стрелки
            const arrow = FONT_SIZE * 0.55;
            gridParts.push(`<polygon points="${gridMaxX},0 ${gridMaxX - arrow},${-arrow * 0.45} ${gridMaxX - arrow},${arrow * 0.45}" fill="${AXIS}"/>`);
            gridParts.push(`<polygon points="0,${-gridMaxY} ${-arrow * 0.45},${-gridMaxY + arrow} ${arrow * 0.45},${-gridMaxY + arrow}" fill="${AXIS}"/>`);

            // Тики и подписи
            const tickLen = FONT_SIZE * 0.9;
            const labelOffset = FONT_SIZE * 1.4;

            // Нижняя ось X
            for (let x = 0; x <= gridMaxX; x += GRID_STEP) {
                gridParts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${tickLen}" stroke="${AXIS}" stroke-width="0.1"/>`);
                gridParts.push(`<text x="${x}" y="${tickLen + labelOffset}" font-size="${FONT_SIZE}" text-anchor="middle" fill="${TEXT}" font-family="sans-serif">${x}</text>`);
            }
            // Левая ось Y
            for (let y = GRID_STEP; y <= gridMaxY; y += GRID_STEP) {
                gridParts.push(`<line x1="0" y1="${-y}" x2="${-tickLen}" y2="${-y}" stroke="${AXIS}" stroke-width="0.1"/>`);
                gridParts.push(`<text x="${-tickLen - FONT_SIZE * 0.4}" y="${-y + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}" text-anchor="end" fill="${TEXT}" font-family="sans-serif">${y}</text>`);
            }

            // Верхняя ось X
            for (let x = 0; x <= gridMaxX; x += GRID_STEP) {
                gridParts.push(`<line x1="${x}" y1="${-gridMaxY}" x2="${x}" y2="${-gridMaxY - tickLen}" stroke="${AXIS}" stroke-width="0.1"/>`);
                gridParts.push(`<text x="${x}" y="${-gridMaxY - tickLen - FONT_SIZE * 0.4}" font-size="${FONT_SIZE}" text-anchor="middle" fill="${TEXT}" font-family="sans-serif">${x}</text>`);
            }

            // Правая ось Y
            for (let y = GRID_STEP; y <= gridMaxY; y += GRID_STEP) {
                gridParts.push(`<line x1="${gridMaxX}" y1="${-y}" x2="${gridMaxX + tickLen}" y2="${-y}" stroke="${AXIS}" stroke-width="0.1"/>`);
                gridParts.push(`<text x="${gridMaxX + tickLen + FONT_SIZE * 0.4}" y="${-y + FONT_SIZE * 0.35}" font-size="${FONT_SIZE}" text-anchor="start" fill="${TEXT}" font-family="sans-serif">${y}</text>`);
            }

            gridParts.push(`<text x="${gridMaxX + FONT_SIZE * 0.5}" y="${-FONT_SIZE * 0.35}" font-size="${FONT_SIZE}" text-anchor="start" fill="${TEXT}" font-family="sans-serif" font-weight="bold">X, mm</text>`);
            gridParts.push(`<text x="${-FONT_SIZE * 0.4}" y="${-gridMaxY - FONT_SIZE * 0.4}" font-size="${FONT_SIZE}" text-anchor="start" fill="${TEXT}" font-family="sans-serif" font-weight="bold">Y, mm</text>`);

            const gridSvg = gridParts.join('');

            const displaySvgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r6(baseViewBox.x)} ${r6(baseViewBox.y)} ${r6(baseViewBox.w)} ${r6(baseViewBox.h)}" preserveAspectRatio="xMidYMid meet">
                <rect x="${r6(baseViewBox.x)}" y="${r6(baseViewBox.y)}" width="${r6(baseViewBox.w)}" height="${r6(baseViewBox.h)}" fill="#ffffff"/>
                <g id="grid-layer">${gridSvg}</g>
                <g transform="translate(${r6(offsetX)}, ${r6(-offsetY)})" fill="none">
                    <path d="${travelPath}" stroke="#888888" stroke-width="0.1" stroke-dasharray="2 2" />
                    <path d="${cutPath}" stroke="#4a8cff" stroke-width="0.15" stroke-linecap="round" stroke-linejoin="round" />
                </g>
            </svg>`;

            const wrap = document.createElement("div");
            wrap.innerHTML = displaySvgText;
            svgEl = wrap.firstElementChild;
            el.viewport.appendChild(svgEl);

            setViewBox(baseViewBox);

            // Обновляем статистику
            el.stats.innerHTML = `
                <div class="gcode-stat-row"><span class="gcode-stat-label">Строк:</span> <span>${linesCount}</span></div>
                <div class="gcode-stat-row"><span class="gcode-stat-label">Холостых (G0):</span> <span>${travelCount}</span></div>
                <div class="gcode-stat-row"><span class="gcode-stat-label">Рабочих (G1):</span> <span>${cutCount}</span></div>
                <div class="gcode-stat-row"><span class="gcode-stat-label">Диапазон Z:</span> <span>${(minZ===Infinity?0:minZ).toFixed(2)} – ${(maxZ===-Infinity?0:maxZ).toFixed(2)}</span></div>
            `;

            const loading = document.getElementById('gcodeLoading');
            if (loading) loading.classList.add('hidden');

        } catch (err) {
            console.error('[GCODE] Parse error:', err);
            el.stats.textContent = "Ошибка: " + err.message;
            const loading = document.getElementById('gcodeLoading');
            if (loading) loading.classList.add('hidden');
            FAR.toast('Ошибка G-code: ' + err.message, 'error');
        }
    })();

    return {
        destroy: function () {
            if (svgEl) {
                try { svgEl.remove(); } catch (e) {}
                svgEl = null;
            }
            hostEl.innerHTML = '';
        }
    };
};

// ============================================================
// WM-приложение (Оконный режим)
// ============================================================

FAR._registerGcodeWmApp = function () {
    if (typeof FAR.WM === 'undefined' || typeof FAR.WM.registerApp !== 'function') return;
    if (FAR.WM.getApp && FAR.WM.getApp('gcode')) return;

    FAR.WM.registerApp({
        id: 'gcode',
        title: 'G-code',
        icon: '⚙️',
        keywords: 'gcode g-code чпу 3d принтер cnc',
        singleton: false,
        width: 1000,
        height: 700,
        open: async function (win, props) {
            const item = props.file;
            const side = props.side || FAR.activePanel;

            win.el.querySelector('.wm-title-text').textContent = '⚙️ ' + item.name;
            win.bodyEl.innerHTML = '';
            win.bodyEl.style.display = 'flex';
            win.bodyEl.style.flexDirection = 'column';
            win.bodyEl.style.minHeight = '0';
            win.bodyEl.style.background = '#1e1e2e';

            if (win.props._gcodeApi) {
                try { win.props._gcodeApi.destroy(); } catch (e) {}
                win.props._gcodeApi = null;
            }

            const api = FAR._createGcodeViewer(win.bodyEl, item, side);
            win.props._gcodeApi = api;
        },
        onClose: function (win) {
            if (win.props && win.props._gcodeApi) {
                try { win.props._gcodeApi.destroy(); } catch (e) {}
                win.props._gcodeApi = null;
            }
        }
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', FAR._registerGcodeWmApp);
} else {
    FAR._registerGcodeWmApp();
}

// Закрытие по Esc в модалке
document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('gcodeViewerModal');
    if (!modal || modal.classList.contains('hidden')) return;
    const t = e.target;
    const tag = (t && t.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    FAR.closeGcodeViewer();
}, true);