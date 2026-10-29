// ============================================================
// 58-lbrn2-viewer.js — Просмотрщик LightBurn (.lbrn2)
// ============================================================

FAR.LBRN2_EXTS = ['lbrn2', 'lbrn'];

FAR.isLbrn2 = function (item) {
    if (!item || item.isFolder) return false;
    const ext = (item.name.split('.').pop() || '').toLowerCase();
    return FAR.LBRN2_EXTS.indexOf(ext) !== -1;
};

FAR.Lbrn2 = FAR.Lbrn2 || {};

FAR.Lbrn2._modalApi = null;
FAR.Lbrn2._currentItem = null;
FAR.Lbrn2._currentSide = null;

// ============================================================
// Публичное API (панельный режим)
// ============================================================

FAR.openLbrn2Viewer = async function (item, side) {
    side = side || FAR.activePanel;
    if (!FAR.ensureDb()) return;

    if (typeof FAR._ensureItemName === 'function') FAR._ensureItemName(item);

    try { FAR.closeViewer(); } catch (e) {}
    try { FAR.closePanoramaViewer(); } catch (e) {}

    FAR.Lbrn2._currentItem = item;
    FAR.Lbrn2._currentSide = side;

    const modal = document.getElementById('lbrn2ViewerModal');
    const host = document.getElementById('lbrn2Root');
    const title = document.getElementById('lbrn2ViewerTitle');
    const loading = document.getElementById('lbrn2Loading');

    if (!modal || !host) {
        console.error('[LBRN2] Modal not found');
        return;
    }

    title.textContent = '🔦 ' + item.name;
    modal.classList.remove('hidden');
    if (loading) loading.classList.remove('hidden');

    if (FAR.Lbrn2._modalApi) {
        try { FAR.Lbrn2._modalApi.destroy(); } catch (e) {}
        FAR.Lbrn2._modalApi = null;
    }

    FAR.Lbrn2._modalApi = FAR._createLbrn2Viewer(host, item, side);
};

FAR.closeLbrn2Viewer = function () {
    const modal = document.getElementById('lbrn2ViewerModal');
    if (modal) modal.classList.add('hidden');

    if (FAR.Lbrn2._modalApi) {
        try { FAR.Lbrn2._modalApi.destroy(); } catch (e) {}
        FAR.Lbrn2._modalApi = null;
    }
};

FAR.closeLbrn2ViewerOutside = function (e) {
    if (e.target === e.currentTarget) FAR.closeLbrn2Viewer();
};

FAR.downloadCurrentLbrn2 = function () {
    if (FAR.Lbrn2._modalApi) {
        FAR.Lbrn2._modalApi.downloadSvg();
    }
};

// ============================================================
// ЯДРО: FAR._createLbrn2Viewer
// ============================================================

FAR._createLbrn2Viewer = function (hostEl, item, side) {
    if (!hostEl) throw new Error('_createLbrn2Viewer: hostEl required');

    // --- Математика и парсинг ---
    const DEFAULT_COLOR       = "#000000";
    const DEFAULT_STROKE_MM   = 0.05;
    const GRID_STEP_MM        = 10;
    const SAFE_MARGIN_MM      = 10;
    const GRID_FONT_MM        = 5;
    const GRID_PAD_MM         = 15;

    const r6 = v => isFinite(v) ? Number(v.toFixed(6)).toString() : "0";

    function parseXForm(s){
        if(!s) return {a:1,b:0,c:0,d:1,e:0,f:0};
        const p = String(s).trim().split(/\s+/).map(Number);
        if(p.length !== 6 || p.some(isNaN)) return {a:1,b:0,c:0,d:1,e:0,f:0};
        return {a:p[0],b:p[1],c:p[2],d:p[3],e:p[4],f:p[5]};
    }

    function getXFormValue(el){
        const a = el.getAttribute("XForm");
        if(a !== null && a.trim() !== "") return a;
        const child = Array.from(el.children).find(c => c.tagName === "XForm");
        if(child){
            const t = child.textContent;
            if(t && t.trim() !== "") return t;
        }
        return null;
    }

    function mulXForm(m1, m2){
        return {
            a: m1.a*m2.a + m1.c*m2.b,
            b: m1.b*m2.a + m1.d*m2.b,
            c: m1.a*m2.c + m1.c*m2.d,
            d: m1.b*m2.c + m1.d*m2.d,
            e: m1.a*m2.e + m1.c*m2.f + m1.e,
            f: m1.b*m2.e + m1.d*m2.f + m1.f
        };
    }

    function applyPoint(t, x, y){
        return { x: t.a*x + t.c*y + t.e, y: -(t.b*x + t.d*y + t.f) };
    }

    function svgMatrix(t){
        return `matrix(${r6(t.a)} ${r6(-t.b)} ${r6(t.c)} ${r6(-t.d)} ${r6(t.e)} ${r6(-t.f)})`;
    }

    function readNumber(s, pos){
        while(pos < s.length && /\s/.test(s[pos])) pos++;
        let out = "";
        while(pos < s.length){
            const ch = s[pos];
            if(ch==="-"||ch==="+"||(ch>="0"&&ch<="9")||ch==="."||ch==="e"||ch==="E"){
                out += ch; pos++;
            } else break;
        }
        return { num: parseFloat(out), pos };
    }

    function parseControlPoints(str){
        const out = {};
        if(!str) return out;
        const tokens = ["c0x","c0y","c1x","c1y"];
        let i = 0;
        while(i < str.length){
            let found = -1, tok = null;
            for(const t of tokens){
                const idx = str.indexOf(t, i);
                if(idx !== -1 && (found === -1 || idx < found)){ found = idx; tok = t; }
            }
            if(found === -1) break;
            i = found + tok.length;
            const r = readNumber(str, i);
            if(!isNaN(r.num)){ out[tok] = r.num; i = r.pos; }
        }
        return out;
    }

    function parseVertList(str){
        const verts = [];
        if(!str) return verts;
        let pos = 0;
        while(pos < str.length){
            while(pos < str.length && str[pos] !== "V") pos++;
            if(pos >= str.length) break;
            pos++;
            const rx = readNumber(str, pos); pos = rx.pos;
            const ry = readNumber(str, pos); pos = ry.pos;
            let cp = "";
            while(pos < str.length && str[pos] !== "V"){ cp += str[pos]; pos++; }
            if(!isNaN(rx.num) && !isNaN(ry.num)){
                verts.push({ x: rx.num, y: ry.num, ...parseControlPoints(cp) });
            }
        }
        return verts;
    }

    function parsePrimList(str){
        const prims = [];
        if(!str) return prims;
        let pos = 0;
        while(pos < str.length){
            while(pos < str.length && /\s/.test(str[pos])) pos++;
            if(pos >= str.length) break;
            const ch = str[pos];
            if(!/[A-Za-z]/.test(ch)){ pos++; continue; }
            pos++;
            const nums = [];
            for(let k = 0; k < 4; k++){
                const r = readNumber(str, pos);
                if(r.pos === pos) break;
                if(!isNaN(r.num)){ nums.push(r.num); pos = r.pos; } else break;
            }
            if(ch === "L" && nums.length >= 2)
                prims.push({ type: "Line", startIdx: nums[0], endIdx: nums[1] });
            else if(ch === "B" && nums.length >= 2)
                prims.push({ type: "Bezier", startIdx: nums[0], endIdx: nums[1] });
        }
        return prims;
    }

    function attr(el, name, fb){ if(!el) return fb; const v = el.getAttribute(name); return v !== null ? v : fb; }
    function num(el, name, fb = 0){ const v = parseFloat(attr(el, name, fb)); return isNaN(v) ? fb : v; }
    function children(el, tag){ if(!el) return []; return Array.from(el.children).filter(c => c.tagName === tag); }

    function parseLbrn2(xmlText){
        const doc = new DOMParser().parseFromString(xmlText, "application/xml");
        const perr = doc.querySelector("parsererror");
        if(perr) throw new Error("XML error: " + perr.textContent.slice(0, 150));

        const root = doc.documentElement;
        if(!root || root.tagName !== "LightBurnProject")
            throw new Error("Не .lbrn2 файл (нет <LightBurnProject>)");

        const cutSettings = children(root, "CutSetting").map(el => {
            const childEl = name => Array.from(el.children).find(c => c.tagName === name);
            const n = (name, fb = 0) => {
                const c = childEl(name); if(!c) return fb;
                const v = parseFloat(c.getAttribute("Value"));
                return isNaN(v) ? fb : v;
            };
            const s = (name, fb = null) => {
                const c = childEl(name); return c ? c.getAttribute("Value") : fb;
            };
            return {
                index:       n("index"),
                name:        s("name", ""),
                maxPower:    n("maxPower"),
                speed:       n("speed"),
                numPasses:   n("numPasses", 1),
                color:       s("color"),
                strokeWidth: s("strokeWidth")
            };
        });

        const vertCache = new Map();
        const primCache = new Map();

        function parseShape(el){
            const type = attr(el, "Type", "");
            if(!type) return null;

            const s = {
                type,
                cutIndex: num(el, "CutIndex", 0),
                xform: parseXForm(getXFormValue(el))
            };

            if(type === "Rect"){
                s.w  = num(el, "W", 0);
                s.h  = num(el, "H", 0);
                s.cr = num(el, "Cr", 0);
            }
            else if(type === "Ellipse"){
                s.rx = num(el, "Rx", 0);
                s.ry = num(el, "Ry", 0);
            }
            else if(type === "Path"){
                const vId = attr(el, "VertID", null);
                const pId = attr(el, "PrimID", null);
                const vEl = el.querySelector("VertList");
                const pEl = el.querySelector("PrimList");

                let vStr = vEl ? vEl.textContent : null;
                let pStr = pEl ? pEl.textContent : null;

                if(vStr === null && vId !== null && vertCache.has(vId)) vStr = vertCache.get(vId);
                if(pStr === null && pId !== null && primCache.has(pId)) pStr = primCache.get(pId);

                if(vStr !== null && vId !== null) vertCache.set(vId, vStr);
                if(pStr !== null && pId !== null) primCache.set(pId, pStr);

                s.vertStr = vStr || "";
                s.primStr = pStr || "";
                s.verts   = parseVertList(s.vertStr);
                s.prims   = parsePrimList(s.primStr);
            }
            else if(type === "Group"){
                const wrapper = Array.from(el.children).find(c => c.tagName === "Children");
                const parent  = wrapper || el;
                const childEls = Array.from(parent.children).filter(c => c.tagName === "Shape");
                s.children = childEls.map(parseShape).filter(Boolean);
            }
            else if(type === "Bitmap"){
                const d = el.querySelector("Data");
                s.data = d ? d.textContent : "";
                s.w    = num(el, "W", 0);
                s.h    = num(el, "H", 0);
            }
            return s;
        }

        const shapes = children(root, "Shape").map(parseShape).filter(Boolean);

        return {
            shapes,
            cutSettings,
            appVersion:    attr(root, "AppVersion", ""),
            formatVersion: attr(root, "FormatVersion", "")
        };
    }

    function flattenShapes(shapes, parent = null){
        const out = [];
        for(const s of shapes){
            const world = parent ? mulXForm(parent, s.xform) : s.xform;
            if(s.type === "Group"){
                out.push(...flattenShapes(s.children || [], world));
            } else {
                out.push({ ...s, world });
            }
        }
        return out;
    }

    function shapeLocalPoints(s){
        const pts = [];
        if(s.type === "Rect" || s.type === "Bitmap"){
            const w = s.w/2, h = s.h/2;
            pts.push({x:-w,y:-h},{x:w,y:-h},{x:w,y:h},{x:-w,y:h});
        }
        else if(s.type === "Ellipse"){
            const n = 32;
            for(let i = 0; i < n; i++){
                const a = (i/n)*Math.PI*2;
                pts.push({x: s.rx*Math.cos(a), y: s.ry*Math.sin(a)});
            }
        }
        else if(s.type === "Path"){
            for(const v of s.verts){
                pts.push({x:v.x, y:v.y});
                if(v.c0x !== undefined && v.c0y !== undefined) pts.push({x:v.c0x, y:v.c0y});
                if(v.c1x !== undefined && v.c1y !== undefined) pts.push({x:v.c1x, y:v.c1y});
            }
        }
        return pts;
    }

    function computeBounds(flat){
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for(const s of flat){
            for(const p of shapeLocalPoints(s)){
                const w = applyPoint(s.world, p.x, p.y);
                if(w.x < minX) minX = w.x;
                if(w.y < minY) minY = w.y;
                if(w.x > maxX) maxX = w.x;
                if(w.y > maxY) maxY = w.y;
            }
        }
        if(!isFinite(minX)) return null;
        return {minX, minY, maxX, maxY};
    }

    function cutStyle(s, cutSettings){
        const cut = cutSettings.find(c => c.index === s.cutIndex);
        let color = DEFAULT_COLOR;
        let sw    = DEFAULT_STROKE_MM;

        if(cut){
            if(cut.color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(cut.color.trim()))
                color = cut.color.trim();
            if(cut.strokeWidth){
                const v = parseFloat(cut.strokeWidth);
                if(!isNaN(v) && v > 0) sw = v;
            }
        }
        return `stroke:${color};stroke-width:${r6(sw)}mm;fill:none;stroke-linecap:round;stroke-linejoin:round`;
    }

    function pathToD(s){
        const verts = s.verts, prims = s.prims;
        if(!verts || verts.length === 0) return null;

        if(prims.length === 0){
            if(s.primStr.trim() !== "LineClosed") return null;
            let d = `M${r6(verts[0].x)},${r6(verts[0].y)}`;
            for(let i = 1; i < verts.length; i++){
                d += ` L${r6(verts[i].x)},${r6(verts[i].y)}`;
            }
            return d + "Z";
        }

        let d = "", lastIdx = -1;
        const startIdx = prims[0].startIdx;
        for(const p of prims){
            const a = verts[p.startIdx], b = verts[p.endIdx];
            if(!a || !b) continue;
            if(d === "" || lastIdx !== p.startIdx)
                d += (d ? " " : "") + `M${r6(a.x)},${r6(a.y)}`;
            if(p.type === "Line"){
                d += ` L${r6(b.x)},${r6(b.y)}`;
            } else {
                const c0x = a.c0x !== undefined ? a.c0x : a.x;
                const c0y = a.c0y !== undefined ? a.c0y : a.y;
                const c1x = b.c1x !== undefined ? b.c1x : b.x;
                const c1y = b.c1y !== undefined ? b.c1y : b.y;
                d += ` C${r6(c0x)},${r6(c0y)} ${r6(c1x)},${r6(c1y)} ${r6(b.x)},${r6(b.y)}`;
            }
            lastIdx = p.endIdx;
        }
        if(lastIdx === startIdx && d) d += "Z";
        return d;
    }

    function renderShape(s, cutSettings){
        const tr = `transform="${svgMatrix(s.world)}"`;
        const st = cutStyle(s, cutSettings);
        let html = "";

        if(s.type === "Rect"){
            const w = s.w, h = s.h, cr = s.cr;
            let a = `x="${r6(-w/2)}" y="${r6(-h/2)}" width="${r6(w)}" height="${r6(h)}"`;
            if(cr > 0) a += ` rx="${r6(cr)}" ry="${r6(cr)}"`;
            html = `<rect ${a} style="${st}" ${tr}/>`;
        }
        else if(s.type === "Ellipse"){
            if(Math.abs(s.rx - s.ry) < 1e-6)
                html = `<circle cx="0" cy="0" r="${r6(s.rx)}" style="${st}" ${tr}/>`;
            else
                html = `<ellipse cx="0" cy="0" rx="${r6(s.rx)}" ry="${r6(s.ry)}" style="${st}" ${tr}/>`;
        }
        else if(s.type === "Path"){
            const d = pathToD(s);
            if(d) html = `<path d="${d}" style="${st}" ${tr}/>`;
        }
        else if(s.type === "Bitmap" && s.data){
            html = `<image x="${r6(-s.w/2)}" y="${r6(-s.h/2)}" width="${r6(s.w)}" height="${r6(s.h)}" xlink:href="data:image/png;base64,${s.data}" ${tr}/>`;
        }

        if(html && s.cutIndex !== undefined){
            html = html.replace(/^<(\w+)/, `<$1 data-cut="${s.cutIndex}"`);
        }
        return html;
    }

    function drawGrid(gridMaxX, gridMaxY, fontSize){
        const parts = [];
        const MINOR = "#dcdcdc";
        const AXIS  = "#444444";
        const TEXT  = "#222222";
        const minorW = 0.06;
        const axisW  = 0.18;
        const tickW  = 0.10;

        for(let x = GRID_STEP_MM; x <= gridMaxX; x += GRID_STEP_MM){
            parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${-gridMaxY}" stroke="${MINOR}" stroke-width="${minorW}"/>`);
        }
        for(let y = GRID_STEP_MM; y <= gridMaxY; y += GRID_STEP_MM){
            parts.push(`<line x1="0" y1="${-y}" x2="${gridMaxX}" y2="${-y}" stroke="${MINOR}" stroke-width="${minorW}"/>`);
        }

        parts.push(`<line x1="0" y1="0" x2="${gridMaxX}" y2="0" stroke="${AXIS}" stroke-width="${axisW}"/>`);
        parts.push(`<line x1="0" y1="0" x2="0" y2="${-gridMaxY}" stroke="${AXIS}" stroke-width="${axisW}"/>`);

        const arrow = fontSize * 0.55;
        parts.push(`<polygon points="${gridMaxX},0 ${gridMaxX-arrow},${-arrow*0.45} ${gridMaxX-arrow},${arrow*0.45}" fill="${AXIS}"/>`);
        parts.push(`<polygon points="0,${-gridMaxY} ${-arrow*0.45},${-gridMaxY+arrow} ${arrow*0.45},${-gridMaxY+arrow}" fill="${AXIS}"/>`);

        const tickLen = fontSize * 0.9;
        const labelOffset = fontSize * 1.4;

        // Нижняя ось X
        for(let x = 0; x <= gridMaxX; x += GRID_STEP_MM){
            parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${tickLen}" stroke="${AXIS}" stroke-width="${tickW}"/>`);
            parts.push(`<text x="${x}" y="${tickLen + labelOffset}" font-size="${fontSize}" text-anchor="middle" fill="${TEXT}" font-family="sans-serif">${x}</text>`);
        }

        // Левая ось Y
        for(let y = GRID_STEP_MM; y <= gridMaxY; y += GRID_STEP_MM){
            parts.push(`<line x1="0" y1="${-y}" x2="${-tickLen}" y2="${-y}" stroke="${AXIS}" stroke-width="${tickW}"/>`);
            parts.push(`<text x="${-tickLen - fontSize * 0.4}" y="${-y + fontSize * 0.35}" font-size="${fontSize}" text-anchor="end" fill="${TEXT}" font-family="sans-serif">${y}</text>`);
        }

        // Верхняя ось X
        for(let x = 0; x <= gridMaxX; x += GRID_STEP_MM){
            parts.push(`<line x1="${x}" y1="${-gridMaxY}" x2="${x}" y2="${-gridMaxY - tickLen}" stroke="${AXIS}" stroke-width="${tickW}"/>`);
            parts.push(`<text x="${x}" y="${-gridMaxY - tickLen - fontSize * 0.4}" font-size="${fontSize}" text-anchor="middle" fill="${TEXT}" font-family="sans-serif">${x}</text>`);
        }

        // Правая ось Y
        for(let y = GRID_STEP_MM; y <= gridMaxY; y += GRID_STEP_MM){
            parts.push(`<line x1="${gridMaxX}" y1="${-y}" x2="${gridMaxX + tickLen}" y2="${-y}" stroke="${AXIS}" stroke-width="${tickW}"/>`);
            parts.push(`<text x="${gridMaxX + tickLen + fontSize * 0.4}" y="${-y + fontSize * 0.35}" font-size="${fontSize}" text-anchor="start" fill="${TEXT}" font-family="sans-serif">${y}</text>`);
        }

        parts.push(`<text x="${gridMaxX + fontSize * 0.5}" y="${-fontSize * 0.35}" font-size="${fontSize}" text-anchor="start" fill="${TEXT}" font-family="sans-serif" font-weight="bold">X, mm</text>`);
        parts.push(`<text x="${-fontSize * 0.4}" y="${-gridMaxY - fontSize * 0.4}" font-size="${fontSize}" text-anchor="start" fill="${TEXT}" font-family="sans-serif" font-weight="bold">Y, mm</text>`);

        return parts.join("\n");
    }

    // --- DOM ---
    hostEl.innerHTML =
        '<div class="lbrn2-sidebar" data-role="sidebar">' +
        '  <div class="section">' +
        '    <h3>Проект</h3>' +
        '    <div data-role="meta" style="font-size:12px;color:#8a8a8a;line-height:1.6">Загрузка...</div>' +
        '  </div>' +
        '  <div class="section" style="flex:1">' +
        '    <h3>Слои (CutSetting)</h3>' +
        '    <div data-role="layers" style="font-size:13px;color:#8a8a8a">—</div>' +
        '  </div>' +
        '</div>' +
        '<div class="lbrn2-viewport" data-role="viewport">' +
        '  <div class="lbrn2-zoom-controls">' +
        '    <button data-role="btn-grid" class="lbrn2-grid-toggle-btn active" title="Сетка">📏</button>' +
        '    <button data-role="btn-out" title="Уменьшить">−</button>' +
        '    <div class="lbrn2-zoom-label" data-role="zoom-label">100%</div>' +
        '    <button data-role="btn-in" title="Увеличить">+</button>' +
        '    <button data-role="btn-fit" title="Вписать">⛶</button>' +
        '  </div>' +
        '  <div class="lbrn2-statusbar" data-role="statusbar" style="display:none"></div>' +
        '</div>';

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flex = '1';
    wrapper.style.minHeight = '0';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    while (hostEl.firstChild) wrapper.appendChild(hostEl.firstChild);
    hostEl.appendChild(wrapper);

    const el = {
        sidebar:  hostEl.querySelector('[data-role="sidebar"]'),
        meta:     hostEl.querySelector('[data-role="meta"]'),
        layers:   hostEl.querySelector('[data-role="layers"]'),
        viewport: hostEl.querySelector('[data-role="viewport"]'),
        statusbar:hostEl.querySelector('[data-role="statusbar"]'),
        zoomLabel:hostEl.querySelector('[data-role="zoom-label"]'),
        btnIn:    hostEl.querySelector('[data-role="btn-in"]'),
        btnOut:   hostEl.querySelector('[data-role="btn-out"]'),
        btnFit:   hostEl.querySelector('[data-role="btn-fit"]'),
        btnGrid:  hostEl.querySelector('[data-role="btn-grid"]')
    };

    let svgEl = null, baseViewBox = null, currentViewBox = null;
    let displayVB = null, exportVB = null;
    let currentSvgText = null;
    let fileName = item.name || "output.svg";

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

    let showGridState = true;
    el.btnGrid.onclick = () => {
        showGridState = !showGridState;
        el.btnGrid.classList.toggle('active', showGridState);
        if (!svgEl || !displayVB || !exportVB) return;
        const grid = svgEl.querySelector("#grid-layer");
        if (grid) grid.style.display = showGridState ? "" : "none";
        baseViewBox = showGridState ? displayVB : exportVB;
        fitView();
    };

    function renderLayerPanel(project){
        if(!project.cutSettings.length){
            el.layers.innerHTML = '<span style="color:#8a8a8a">Нет CutSetting</span>';
            return;
        }
        el.layers.innerHTML = project.cutSettings.map(c => {
            const color = (c.color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c.color.trim()))
                ? c.color.trim()
                : DEFAULT_COLOR;
            return `<label class="lbrn2-layer-item">
                <input type="checkbox" checked data-layer="${c.index}">
                <span class="lbrn2-layer-swatch" style="background:${color}"></span>
                <span>${c.name || "C" + String(c.index).padStart(2, "0")}</span>
                <span class="lbrn2-layer-meta">${c.speed || "?"} / ${c.maxPower || "?"}%</span>
            </label>`;
        }).join("");

        el.layers.querySelectorAll("input[type=checkbox]").forEach(cb => {
            cb.addEventListener("change", () => {
                const idx = cb.dataset.layer;
                const vis = cb.checked;
                if(!svgEl) return;
                svgEl.querySelectorAll(`[data-cut="${idx}"]`).forEach(el => {
                    el.style.display = vis ? "" : "none";
                });
            });
        });
    }

    // --- Инициализация (загрузка файла) ---
    (async function init() {
        try {
            const res = await FAR.readFileBodyFromSide(side, item);
            const text = new TextDecoder('utf-8').decode(res.data);

            const project = parseLbrn2(text);
            if(project.shapes.length === 0) throw new Error("В файле нет <Shape> верхнего уровня");

            const flat = flattenShapes(project.shapes);
            if(flat.length === 0) throw new Error("После разворота групп не осталось фигур");

            const b0 = computeBounds(flat);
            if(!b0) throw new Error("Не удалось вычислить границы фигур");

            const offsetX_svg = Math.max(0, SAFE_MARGIN_MM - b0.minX);
            const offsetY_svg = Math.max(0, SAFE_MARGIN_MM - b0.minY);
            const offsetMatrix = { a:1, b:0, c:0, d:1, e:offsetX_svg, f:-offsetY_svg };

            const shifted = flat.map(s => ({ ...s, world: mulXForm(offsetMatrix, s.world) }));
            const b = computeBounds(shifted);
            if(!b) throw new Error("Не удалось вычислить границы после сдвига");

            const gridMaxX = Math.max(GRID_STEP_MM, Math.ceil((b.maxX + SAFE_MARGIN_MM) / GRID_STEP_MM) * GRID_STEP_MM);
            const gridMaxY = Math.max(GRID_STEP_MM, Math.ceil((b.maxY + SAFE_MARGIN_MM) / GRID_STEP_MM) * GRID_STEP_MM);

            const fontSize = GRID_FONT_MM;

            displayVB = {
                x: -GRID_PAD_MM,
                y: -(gridMaxY + GRID_PAD_MM),
                w: gridMaxX + GRID_PAD_MM * 2,
                h: gridMaxY + GRID_PAD_MM * 2
            };

            const pad = 5;
            exportVB = {
                x: b.minX - pad,
                y: b.minY - pad,
                w: Math.max(b.maxX - b.minX + pad * 2, 1),
                h: Math.max(b.maxY - b.minY + pad * 2, 1)
            };

            const body = shifted.map(s => {
                try { return renderShape(s, project.cutSettings); }
                catch(e){ return ""; }
            }).join("\n");

            const grid = drawGrid(gridMaxX, gridMaxY, fontSize);

            const displaySvgText = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${r6(displayVB.x)} ${r6(displayVB.y)} ${r6(displayVB.w)} ${r6(displayVB.h)}" preserveAspectRatio="xMidYMid meet">
                <rect x="${r6(displayVB.x)}" y="${r6(displayVB.y)}" width="${r6(displayVB.w)}" height="${r6(displayVB.h)}" fill="#ffffff"/>
                <g id="grid-layer">${grid}</g>
                ${body}
            </svg>`;

            currentSvgText = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${r6(exportVB.x)} ${r6(exportVB.y)} ${r6(exportVB.w)} ${r6(exportVB.h)}" preserveAspectRatio="xMidYMid meet">
                <rect x="${r6(exportVB.x)}" y="${r6(exportVB.y)}" width="${r6(exportVB.w)}" height="${r6(exportVB.h)}" fill="#ffffff"/>
                ${body}
            </svg>`;

            fileName = item.name.replace(/\.lbrn2?$/i, "") + ".svg";

            const wrap = document.createElement("div");
            wrap.innerHTML = displaySvgText;
            svgEl = wrap.firstElementChild;
            el.viewport.appendChild(svgEl);

            baseViewBox = displayVB;
            setViewBox(baseViewBox);

            renderLayerPanel(project);

            el.meta.innerHTML = `
                <div style="word-break:break-all;margin-bottom:4px;">📄 <strong>${item.name}</strong></div>
                <div>Фигур (после flatten): <strong>${flat.length}</strong></div>
                <div>Слоёв: <strong>${project.cutSettings.length}</strong></div>
                ${project.appVersion ? `<div>LightBurn v${project.appVersion}</div>` : ""}
            `;

            el.statusbar.style.display = "block";
            el.statusbar.textContent = `${flat.length} фигур · X: 0–${gridMaxX} мм · Y: 0–${gridMaxY} мм`;

            const loading = document.getElementById('lbrn2Loading');
            if (loading) loading.classList.add('hidden');

        } catch (err) {
            console.error('[LBRN2] Parse error:', err);
            el.meta.textContent = "Ошибка: " + err.message;
            const loading = document.getElementById('lbrn2Loading');
            if (loading) loading.classList.add('hidden');
            FAR.toast('Ошибка LBRN2: ' + err.message, 'error');
        }
    })();

    return {
        downloadSvg: function () {
            if (!currentSvgText) return;
            const blob = new Blob([currentSvgText], { type: "image/svg+xml" });
            FAR.saveBlobAs(blob, fileName);
            FAR.toast("💾 SVG сохранён (без сетки)", "success");
        },
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

FAR._registerLbrn2WmApp = function () {
    if (typeof FAR.WM === 'undefined' || typeof FAR.WM.registerApp !== 'function') return;
    if (FAR.WM.getApp && FAR.WM.getApp('lbrn2')) return;

    FAR.WM.registerApp({
        id: 'lbrn2',
        title: 'LightBurn (.lbrn2)',
        icon: '🔦',
        keywords: 'lightburn lbrn2 laser лазер гравировка',
        singleton: false,
        width: 1000,
        height: 700,
        open: async function (win, props) {
            const item = props.file;
            const side = props.side || FAR.activePanel;

            win.el.querySelector('.wm-title-text').textContent = '🔦 ' + item.name;
            win.bodyEl.innerHTML = '';
            win.bodyEl.style.display = 'flex';
            win.bodyEl.style.flexDirection = 'column';
            win.bodyEl.style.minHeight = '0';
            win.bodyEl.style.background = '#1e1e2e';

            if (win.props._lbrn2Api) {
                try { win.props._lbrn2Api.destroy(); } catch (e) {}
                win.props._lbrn2Api = null;
            }

            const api = FAR._createLbrn2Viewer(win.bodyEl, item, side);

            const titlebar = win.el.querySelector('.wm-titlebar');
            const actions = titlebar.querySelector('.wm-title-actions');
            if (actions && !actions.querySelector('.wm-nav-download')) {
                const dlBtn = document.createElement('button');
                dlBtn.className = 'wm-title-btn wm-nav-download';
                dlBtn.textContent = '💾';
                dlBtn.title = 'Скачать SVG';
                dlBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    api.downloadSvg();
                });
                actions.insertBefore(dlBtn, actions.firstChild);
            }

            win.props._lbrn2Api = api;
        },
        onClose: function (win) {
            if (win.props && win.props._lbrn2Api) {
                try { win.props._lbrn2Api.destroy(); } catch (e) {}
                win.props._lbrn2Api = null;
            }
        }
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', FAR._registerLbrn2WmApp);
} else {
    FAR._registerLbrn2WmApp();
}

// Закрытие по Esc в модалке
document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('lbrn2ViewerModal');
    if (!modal || modal.classList.contains('hidden')) return;
    const t = e.target;
    const tag = (t && t.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    FAR.closeLbrn2Viewer();
}, true);