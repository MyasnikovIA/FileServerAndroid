// ============================================================
// 49-wm-dialogs.js — Диалоги выбора файлов
// ============================================================

FAR.WM.PICKER_LAST_DIR = 'filebd_wm_picker_last_dir';

FAR.WM.openFileDialog = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
        const side = opts.side || FAR.activePanel;
        let resolved = false;
        const done = function (val) { if (resolved) return; resolved = true; resolve(val); };

        const win = FAR.WM.openWindow({
            title: opts.title || 'Выбор файла из БД',
            icon: '🗂️', width: 1000, height: 620, appId: 'dbpick',
            modal: !!opts.parentId, parentId: opts.parentId || null,
            props: { side: side, filter: opts.filter || null },
            onClose: function () { done(null); }
        });

        FAR.WM._mountFileDialog(win, side, opts).then(function (picked) {
            done(picked || null);
            FAR.WM.closeWindow(win.id, true);
        });
    });
};

FAR.WM._mountFileDialog = async function (win, side, opts) {
    return new Promise(function (resolve) {
        let onKeyDown = null;
        const removeKeyListener = function () { if (!onKeyDown) return; try { document.removeEventListener('keydown', onKeyDown, true); } catch (e) {} onKeyDown = null; };
        const origOnClose = win.onClose;
        win.onClose = function (w) { removeKeyListener(); if (typeof origOnClose === 'function') try { origOnClose(w); } catch (e) {} };

        win.bodyEl.innerHTML = '';
        win.bodyEl.style.display = 'flex'; win.bodyEl.style.flexDirection = 'row';

        const state = { side: side, path: '/', items: [], cursor: -1, selected: null, previewUrl: null, filter: opts.filter || null };

        const colList = document.createElement('div');
        colList.className = 'wm-fd-col-list';
        colList.innerHTML =
            '<div class="wm-fd-pathbar" data-role="path">/</div>' +
            '<input type="text" data-role="filter" placeholder="🔍 Фильтр…" style="margin:6px; padding:6px 10px; background:#12121c; border:1px solid #2b2b3c; border-radius:4px; color:#e6e6e6; font-size:12px;">' +
            '<div class="wm-fd-list" data-role="list" tabindex="0"></div>';

        const colPreview = document.createElement('div');
        colPreview.className = 'wm-fd-col-preview';
        colPreview.innerHTML =
            '<div class="wm-fd-preview" data-role="preview"></div>' +
            '<div class="wm-fd-footer"><span class="wm-fd-info" data-role="info"></span>' +
            '<button class="wm-fd-cancel" data-role="cancel">Отмена</button>' +
            '<button class="wm-fd-ok" data-role="ok" disabled>Открыть</button></div>';

        win.bodyEl.appendChild(colList);
        win.bodyEl.appendChild(colPreview);

        const pathEl = colList.querySelector('[data-role="path"]');
        const listEl = colList.querySelector('[data-role="list"]');
        const filterEl = colList.querySelector('[data-role="filter"]');
        const previewEl = colPreview.querySelector('[data-role="preview"]');
        const infoEl = colPreview.querySelector('[data-role="info"]');
        const okBtn = colPreview.querySelector('[data-role="ok"]');
        const cancelBtn = colPreview.querySelector('[data-role="cancel"]');

        const saveLastDir = path => { try { localStorage.setItem(FAR.WM.PICKER_LAST_DIR, '/' + FAR.normPath(path)); } catch (e) {} };
        const loadLastDir = () => { try { return localStorage.getItem(FAR.WM.PICKER_LAST_DIR) || ''; } catch (e) { return ''; } };
        const clearLastDir = () => { try { localStorage.removeItem(FAR.WM.PICKER_LAST_DIR); } catch (e) {} };

        const getVisible = function () {
            let items = state.items.slice();
            if (state.filter) { const q = state.filter.toLowerCase(); items = items.filter(it => it.isFolder || it.name.toLowerCase().indexOf(q) !== -1); }
            return items;
        };

        const goUp = function () {
            const cur = FAR.normPath(state.path); if (!cur) return;
            const parts = cur.split('/').filter(Boolean); parts.pop();
            loadDir(parts.length ? '/' + parts.join('/') : '/');
        };

        const scrollCursorIntoView = function () {
            if (state.cursor < 0) return;
            const rows = listEl.querySelectorAll('.wm-fd-item');
            if (state.cursor < rows.length) try { rows[state.cursor].scrollIntoView({ block: 'nearest' }); } catch (e) {}
        };

        const render = function () {
            pathEl.textContent = state.path; listEl.innerHTML = '';
            const items = getVisible();
            if (items.length === 0) state.cursor = -1;
            else if (state.cursor < 0) state.cursor = 0;
            else if (state.cursor >= items.length) state.cursor = items.length - 1;

            items.forEach(function (it, idx) {
                const row = document.createElement('div');
                row.className = 'wm-fd-item' + (idx === state.cursor ? ' focused' : '') + (state.selected && state.selected.path === it.path ? ' selected' : '');
                let icon = '📄'; if (it._up || it.isFolder) icon = '📁'; else if (it.isImage) icon = '🖼️';
                row.innerHTML = '<span>' + icon + '</span><span class="wm-fd-name">' + FAR.escapeHtml(it.name) + '</span><span class="wm-fd-size">' + (it.isFolder ? '' : FAR.formatSize(it.size)) + '</span>';
                row.onclick = function () {
                    state.cursor = idx;
                    if (it._up) { state.selected = null; goUp(); }
                    else if (it.isFolder) { state.selected = null; loadDir(it.path); }
                    else { state.selected = it; loadPreview(it); }
                    render();
                };
                row.ondblclick = function () {
                    if (it._up) goUp();
                    else if (it.isFolder) loadDir(it.path);
                    else { state.selected = it; resolve(state.selected); }
                };
                listEl.appendChild(row);
            });
        };

        const loadDir = async function (path, opts2) {
            opts2 = opts2 || {};
            const norm = FAR.normPath(path);
            state.path = '/' + norm; state.cursor = -1; state.selected = null; okBtn.disabled = true; infoEl.textContent = ''; previewEl.innerHTML = '';
            listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#6c7086;">Загрузка…</div>';

            try {
                const children = await FAR.listDirFromSide(state.side, norm, { includeDocs: true });
                state.items = children.map(it => {
                    if (it.docType === 'folder' || it.isFolder) return Object.assign({}, it, { isFolder: true, size: 0 });
                    const ext = (it.name.split('.').pop() || '').toLowerCase();
                    return Object.assign({}, it, { isFolder: false, size: it.size || 0, isImage: ['jpg','jpeg','png','webp','gif','bmp','svg'].indexOf(ext) !== -1, _item: it });
                });
                if (norm !== '') state.items.unshift({ isFolder: true, name: '..', path: '..', size: 0, _up: true });
                state.cursor = getVisible().length > 0 ? 0 : -1;
                render();
                if (!opts2.fromFallback) saveLastDir(norm);
            } catch (e) {
                if (opts2.attemptedRestore && norm !== '') { clearLastDir(); return loadDir('/', { fromFallback: true }); }
                listEl.innerHTML = '<div style="padding:20px;color:#f38ba8;">Ошибка: ' + FAR.escapeHtml(e.message) + '</div>';
            }
        };

        const loadPreview = async function (item) {
            if (state.previewUrl) { try { URL.revokeObjectURL(state.previewUrl); } catch (e) {} state.previewUrl = null; }
            previewEl.innerHTML = ''; infoEl.textContent = item.path; okBtn.disabled = false;
            if (!item.isImage) { previewEl.innerHTML = '<div style="color:#6c7086;padding:20px;">Превью недоступно</div>'; return; }
            try {
                const r = await FAR.readFileBodyFromSide(state.side, item);
                const blob = new Blob([r.data], { type: r.contentType || 'image/jpeg' });
                state.previewUrl = URL.createObjectURL(blob);
                previewEl.innerHTML = '<img src="' + state.previewUrl + '">';
            } catch (e) { previewEl.innerHTML = '<div style="color:#f38ba8;padding:20px;">' + FAR.escapeHtml(e.message) + '</div>'; }
        };

        cancelBtn.onclick = () => resolve(null);
        okBtn.onclick = () => { if (state.selected) resolve(state.selected); };
        filterEl.addEventListener('input', () => { state.filter = filterEl.value; state.cursor = 0; render(); });

        onKeyDown = function (e) {
            if (FAR.WM.state.activeWindowId !== win.id) return;
            if (!FAR.WM.getWindow(win.id)) { removeKeyListener(); return; }
            const inFilter = (e.target === filterEl);
            const visible = getVisible();

            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); resolve(null); return; }
            if (inFilter) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (state.selected) resolve(state.selected); } return; }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault(); e.stopPropagation(); if (visible.length === 0) return;
                const dir = e.key === 'ArrowDown' ? 1 : -1;
                state.cursor = Math.max(0, Math.min(visible.length - 1, (state.cursor < 0 ? 0 : state.cursor + dir)));
                const it = visible[state.cursor];
                if (it && !it.isFolder) { state.selected = it; loadPreview(it); } else if (it) { state.selected = null; previewEl.innerHTML = ''; infoEl.textContent = ''; okBtn.disabled = true; }
                render(); scrollCursorIntoView(); return;
            }
            if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault(); e.stopPropagation(); if (visible.length === 0) return;
                state.cursor = e.key === 'Home' ? 0 : visible.length - 1;
                const it = visible[state.cursor];
                if (it && !it.isFolder) { state.selected = it; loadPreview(it); }
                render(); scrollCursorIntoView(); return;
            }
            if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation(); const it = visible[state.cursor]; if (!it) return;
                if (it._up) goUp(); else if (it.isFolder) loadDir(it.path); else { state.selected = it; resolve(it); }
                return;
            }
            if (e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); goUp(); return; }
        };
        document.addEventListener('keydown', onKeyDown, true);
        setTimeout(() => { try { listEl.focus(); } catch (e) {} }, 50);

        const lastDir = loadLastDir();
        if (lastDir && FAR.normPath(lastDir) !== '') loadDir(lastDir, { attemptedRestore: true }); else loadDir('/', { fromFallback: false });
    });
};

FAR.WM.openFileDialogMulti = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
        const side = opts.side || FAR.activePanel;
        let resolved = false;
        const done = val => { if (resolved) return; resolved = true; resolve(val); };
        const win = FAR.WM.openWindow({
            title: opts.title || 'Выбор файлов из БД', icon: '🗂️',
            width: 1000, height: 680, appId: 'dbpick-multi',
            modal: !!opts.parentId, parentId: opts.parentId || null,
            props: { side: side, filter: opts.filter || null }, onClose: () => done(null)
        });
        FAR.WM._mountFileDialogMulti(win, side, opts).then(picked => { done(picked || null); FAR.WM.closeWindow(win.id, true); });
    });
};

FAR.WM._mountFileDialogMulti = async function (win, side, opts) {
    return new Promise(function (resolve) {
        let onKeyDown = null;
        const removeKeyListener = () => { if (!onKeyDown) return; try { document.removeEventListener('keydown', onKeyDown, true); } catch (e) {} onKeyDown = null; };
        const origOnClose = win.onClose;
        win.onClose = w => { removeKeyListener(); if (typeof origOnClose === 'function') try { origOnClose(w); } catch (e) {} };

        win.bodyEl.innerHTML = '';
        win.bodyEl.style.display = 'flex'; win.bodyEl.style.flexDirection = 'row';

        const state = { side: side, path: '/', items: [], cursor: -1, ordered: [], anchorIdx: -1, previewUrl: null, filter: opts.filter || null };

        const colList = document.createElement('div');
        colList.className = 'wm-fd-col-list';
        colList.innerHTML = '<div class="wm-fd-pathbar" data-role="path">/</div>' +
            '<input type="text" data-role="filter" placeholder="🔍 Фильтр…" style="margin:6px; padding:6px 10px; background:#12121c; border:1px solid #2b2b3c; border-radius:4px; color:#e6e6e6; font-size:12px;">' +
            '<div class="wm-fd-list" data-role="list" tabindex="0"></div>';

        const colPreview = document.createElement('div');
        colPreview.className = 'wm-fd-col-preview';
        colPreview.innerHTML = '<div class="wm-fd-preview" data-role="preview"></div>' +
            '<div class="wm-fd-footer"><span class="wm-fd-info" data-role="info"></span>' +
            '<button class="wm-fd-cancel" data-role="cancel">Отмена</button>' +
            '<button class="wm-fd-ok" data-role="ok" disabled>✓ Выбрать</button></div>';

        win.bodyEl.appendChild(colList); win.bodyEl.appendChild(colPreview);

        const pathEl = colList.querySelector('[data-role="path"]');
        const listEl = colList.querySelector('[data-role="list"]');
        const filterEl = colList.querySelector('[data-role="filter"]');
        const previewEl = colPreview.querySelector('[data-role="preview"]');
        const infoEl = colPreview.querySelector('[data-role="info"]');
        const okBtn = colPreview.querySelector('[data-role="ok"]');
        const cancelBtn = colPreview.querySelector('[data-role="cancel"]');

        const saveLastDir = path => { try { localStorage.setItem(FAR.WM.PICKER_LAST_DIR, '/' + FAR.normPath(path)); } catch (e) {} };
        const loadLastDir = () => { try { return localStorage.getItem(FAR.WM.PICKER_LAST_DIR) || ''; } catch (e) { return ''; } };
        const clearLastDir = () => { try { localStorage.removeItem(FAR.WM.PICKER_LAST_DIR); } catch (e) {} };

        const getVisible = function () {
            let items = state.items.slice();
            if (state.filter) { const q = state.filter.toLowerCase(); items = items.filter(it => it.isFolder || it.name.toLowerCase().indexOf(q) !== -1); }
            return items;
        };

        const indexInOrdered = function (path) { const norm = FAR.normPath(path); for (let i = 0; i < state.ordered.length; i++) if (FAR.normPath(state.ordered[i].path) === norm) return i; return -1; };
        const addToOrdered = function (item) { if (!item || item.isFolder || indexInOrdered(item.path) >= 0) return false; state.ordered.push(item); return true; };
        const removeFromOrdered = function (path) { const idx = indexInOrdered(path); if (idx < 0) return false; state.ordered.splice(idx, 1); return true; };

        const goUp = function () {
            const cur = FAR.normPath(state.path); if (!cur) return;
            const parts = cur.split('/').filter(Boolean); parts.pop();
            loadDir(parts.length ? '/' + parts.join('/') : '/');
        };

        const scrollCursorIntoView = function () { if (state.cursor < 0) return; const rows = listEl.querySelectorAll('.wm-fd-item'); if (state.cursor < rows.length) try { rows[state.cursor].scrollIntoView({ block: 'nearest' }); } catch (e) {} };

        const updateFooter = function () {
            okBtn.disabled = state.ordered.length === 0;
            okBtn.textContent = state.ordered.length > 1 ? ('✓ Выбрать (' + state.ordered.length + ')') : '✓ Выбрать';
            const cur = getVisible()[state.cursor];
            if (cur && !cur.isFolder && !cur._up) infoEl.textContent = cur.path;
            else if (state.ordered.length > 0) infoEl.textContent = 'Выбрано файлов: ' + state.ordered.length;
            else infoEl.textContent = '';
        };

        const render = function () {
            pathEl.textContent = state.path; listEl.innerHTML = ''; const items = getVisible();
            if (items.length === 0) state.cursor = -1; else if (state.cursor < 0) state.cursor = 0; else if (state.cursor >= items.length) state.cursor = items.length - 1;

            items.forEach(function (it, idx) {
                const row = document.createElement('div');
                const isFolder = it._up || it.isFolder;
                const orderIdx = !isFolder ? indexInOrdered(it.path) : -1;
                row.className = 'wm-fd-item' + (idx === state.cursor ? ' focused' : '') + (orderIdx >= 0 ? ' selected' : '');

                let icon = '📄'; if (it._up || it.isFolder) icon = '📁'; else if (it.isImage) icon = '🖼️';
                const badge = orderIdx >= 0 ? '<span style="display:inline-block;min-width:22px;text-align:center;background:#4aa3ff;color:#1e1e2e;border-radius:3px;padding:0 4px;font-weight:bold;font-size:11px;margin-right:4px;">' + (orderIdx + 1) + '</span>' : '';

                row.innerHTML = '<span>' + icon + '</span><span class="wm-fd-name">' + badge + FAR.escapeHtml(it.name) + '</span><span class="wm-fd-size">' + (it.isFolder ? '' : FAR.formatSize(it.size)) + '</span>';

                row.onclick = function (e) {
                    state.cursor = idx;
                    if (it._up) { goUp(); return; }
                    if (it.isFolder) { loadDir(it.path); return; }
                    if (e.ctrlKey || e.metaKey) { if (orderIdx >= 0) removeFromOrdered(it.path); else addToOrdered(it); state.anchorIdx = idx; }
                    else if (e.shiftKey && state.anchorIdx >= 0) {
                        const a = Math.min(state.anchorIdx, idx), b = Math.max(state.anchorIdx, idx);
                        state.ordered = [];
                        for (let i = a; i <= b; i++) { const cand = items[i]; if (cand && !cand.isFolder && !cand._up) addToOrdered(cand); }
                    } else { state.ordered = [it]; state.anchorIdx = idx; }
                    loadPreview(it); render(); updateFooter();
                };

                row.ondblclick = function () {
                    if (it._up) goUp();
                    else if (it.isFolder) loadDir(it.path);
                    else { addToOrdered(it); resolve(state.ordered.slice()); }
                };
                listEl.appendChild(row);
            });
            updateFooter();
        };

        const loadDir = async function (path, opts2) {
            opts2 = opts2 || {};
            const norm = FAR.normPath(path);
            state.path = '/' + norm; state.cursor = -1; state.anchorIdx = -1; infoEl.textContent = ''; previewEl.innerHTML = '';
            listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#6c7086;">Загрузка…</div>';

            try {
                const children = await FAR.listDirFromSide(state.side, norm, { includeDocs: true });
                state.items = children.map(it => {
                    if (it.docType === 'folder' || it.isFolder) return Object.assign({}, it, { isFolder: true, size: 0 });
                    const ext = (it.name.split('.').pop() || '').toLowerCase();
                    return Object.assign({}, it, { isFolder: false, size: it.size || 0, isImage: ['jpg','jpeg','png','webp','gif','bmp','svg'].indexOf(ext) !== -1, _item: it });
                });
                if (norm !== '') state.items.unshift({ isFolder: true, name: '..', path: '..', size: 0, _up: true });
                state.cursor = getVisible().length > 0 ? 0 : -1;
                render();
                if (!opts2.fromFallback) saveLastDir(norm);
            } catch (e) {
                if (opts2.attemptedRestore && norm !== '') { clearLastDir(); return loadDir('/', { fromFallback: true }); }
                listEl.innerHTML = '<div style="padding:20px;color:#f38ba8;">Ошибка: ' + FAR.escapeHtml(e.message) + '</div>';
            }
        };

        const loadPreview = async function (item) {
            if (state.previewUrl) { try { URL.revokeObjectURL(state.previewUrl); } catch (e) {} state.previewUrl = null; }
            previewEl.innerHTML = ''; if (!item || item.isFolder) return;
            if (!item.isImage) { previewEl.innerHTML = '<div style="color:#6c7086;padding:20px;text-align:center;">Превью недоступно</div>'; return; }
            try {
                const r = await FAR.readFileBodyFromSide(state.side, item);
                const blob = new Blob([r.data], { type: r.contentType || 'image/jpeg' });
                state.previewUrl = URL.createObjectURL(blob);
                previewEl.innerHTML = '<img src="' + state.previewUrl + '">';
            } catch (e) { previewEl.innerHTML = '<div style="color:#f38ba8;padding:20px;">' + FAR.escapeHtml(e.message) + '</div>'; }
        };

        cancelBtn.onclick = () => resolve(null);
        okBtn.onclick = () => { if (state.ordered.length > 0) resolve(state.ordered.slice()); };
        filterEl.addEventListener('input', () => { state.filter = filterEl.value; state.cursor = 0; render(); });

        onKeyDown = function (e) {
            if (FAR.WM.state.activeWindowId !== win.id) return;
            if (!FAR.WM.getWindow(win.id)) { removeKeyListener(); return; }
            const inFilter = (e.target === filterEl);
            const visible = getVisible();

            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); resolve(null); return; }
            if (inFilter) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (state.ordered.length > 0) resolve(state.ordered.slice()); } return; }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault(); e.stopPropagation(); if (visible.length === 0) return;
                const dir = e.key === 'ArrowDown' ? 1 : -1;
                state.cursor = Math.max(0, Math.min(visible.length - 1, (state.cursor < 0 ? 0 : state.cursor + dir)));
                const it = visible[state.cursor]; if (it && !it.isFolder) loadPreview(it);
                render(); scrollCursorIntoView(); return;
            }
            if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault(); e.stopPropagation(); if (visible.length === 0) return;
                state.cursor = e.key === 'Home' ? 0 : visible.length - 1;
                const it = visible[state.cursor]; if (it && !it.isFolder) loadPreview(it);
                render(); scrollCursorIntoView(); return;
            }
            if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation(); const it = visible[state.cursor]; if (!it) return;
                if (it._up) { goUp(); return; }
                if (it.isFolder) { loadDir(it.path); return; }
                addToOrdered(it);
                if (e.shiftKey || state.ordered.length > 1) { render(); updateFooter(); }
                else { resolve(state.ordered.slice()); }
                return;
            }
            if (e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); goUp(); return; }
        };
        document.addEventListener('keydown', onKeyDown, true);
        setTimeout(() => { try { listEl.focus(); } catch (e) {} }, 50);

        const lastDir = loadLastDir();
        if (lastDir && FAR.normPath(lastDir) !== '') loadDir(lastDir, { attemptedRestore: true }); else loadDir('/', { fromFallback: false });
    });
};