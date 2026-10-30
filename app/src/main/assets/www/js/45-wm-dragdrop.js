// ============================================================
// 45-wm-dragdrop.js — Drag & drop между окнами
// ============================================================

FAR.WM._orig = FAR.WM._orig || {};

FAR.WM._dragPayload = null;
FAR.WM._dragGhostEl = null;

FAR.WM._beginDragFromExplorer = function (win, side, startX, startY) {
    const ctx = FAR.side[side];
    if (!ctx) return;

    const selSet = ctx.selectedIdx;
    const files = ctx.files || [];
    let items = [];

    if (selSet && selSet.size > 0) {
        for (const idx of Array.from(selSet).sort((a, b) => a - b)) {
            if (idx >= 0 && idx < files.length) {
                const f = files[idx];
                if (f) items.push({ _id: f._id, name: f.name, path: f.path, isFolder: f.isFolder, contentType: f.contentType });
            }
        }
    }
    if (items.length === 0) return;

    FAR.WM._dragPayload = {
        sourceWinId: win.id,
        sourceCtx: ctx,
        sourcePath: ctx.path,
        items: items,
        mode: 'copy'
    };

    const ghost = document.createElement('div');
    ghost.className = 'wm-drag-ghost';
    ghost.textContent = items.length === 1
        ? '📦 ' + items[0].name
        : '📦 ' + items.length + ' элементов';
    ghost.style.cssText =
        'position:fixed;pointer-events:none;z-index:99999;' +
        'background:rgba(74,163,255,0.92);color:#fff;' +
        'padding:6px 12px;border-radius:5px;font-size:12px;' +
        'box-shadow:0 4px 12px rgba(0,0,0,0.5);' +
        'transform:translate(12px,12px);';
    ghost.style.left = startX + 'px';
    ghost.style.top = startY + 'px';
    document.body.appendChild(ghost);
    FAR.WM._dragGhostEl = ghost;

    FAR.WM.state.windows.forEach(function (w) {
        if (w.appId === 'explorer') {
            w.el.classList.add('wm-drop-target-candidate');
        }
    });

    FAR.setStatus('Перетаскивание: ' + items.length +
        ' элемент(ов). Отпустите в окне Проводника.');
};

FAR.WM._updateDragGhost = function (x, y) {
    if (FAR.WM._dragGhostEl) {
        FAR.WM._dragGhostEl.style.left = x + 'px';
        FAR.WM._dragGhostEl.style.top  = y + 'px';
    }
};

FAR.WM._endDrag = function () {
    const payload = FAR.WM._dragPayload;
    FAR.WM._dragPayload = null;

    if (FAR.WM._dragGhostEl) {
        try { FAR.WM._dragGhostEl.remove(); } catch (e) {}
        FAR.WM._dragGhostEl = null;
    }

    if (typeof FAR._setExternalHover === 'function') {
        FAR._setExternalHover(null);
    }

    FAR.WM.state.windows.forEach(function (w) {
        w.el.classList.remove('wm-drop-target-candidate', 'wm-drop-target-hover');
    });

    return payload;
};

FAR.WM._performDrop = async function (targetWin, targetSide) {
    const payload = FAR.WM._endDrag();
    if (!payload) return;

    if (targetWin.id === payload.sourceWinId) {
        FAR.toast('Перетащите в другое окно', 'info');
        return;
    }

    const sSrc = payload.sourceCtx;
    const sDst = FAR.side[targetSide];

    if (!sSrc || !sSrc.db) { FAR.toast('Источник не подключён', 'warning'); return; }
    if (!sDst || !sDst.db) { FAR.toast('Цель не подключена', 'warning'); return; }

    const mode = payload.mode || 'copy';

    try {
        await FAR.transferBetweenContexts(sSrc, sDst, payload.items, sDst.path, mode);
    } catch (e) {
        console.error('[WM drop] transfer failed:', e);
        FAR.toast('Ошибка переноса: ' + e.message, 'error');
    }

    await FAR.reloadPanel('left');
    await FAR.reloadPanel('right');
    FAR.renderPanel('left');
    FAR.renderPanel('right');

    FAR.toast(
        (mode === 'move' ? 'Перенесено' : 'Скопировано') +
        ': ' + payload.items.length + ' элемент(ов)',
        'success'
    );
};

FAR.WM._updateDropTargetUnderCursor = function (x, y, sourceWinId) {
    const ext = (typeof FAR._findExternalDropTarget === 'function')
        ? FAR._findExternalDropTarget(x, y)
        : null;
    if (typeof FAR._setExternalHover === 'function') {
        FAR._setExternalHover(ext);
    }

    FAR.WM.state.windows.forEach(function (w) {
        if (w.appId !== 'explorer') return;
        if (w.id === sourceWinId) return;

        const rect = w.el.getBoundingClientRect();
        const isInside = x >= rect.left && x <= rect.right &&
            y >= rect.top  && y <= rect.bottom;

        if (isInside && FAR.WM._dragPayload && !ext) {
            w.el.classList.add('wm-drop-target-hover');
        } else {
            w.el.classList.remove('wm-drop-target-hover');
        }
    });
};