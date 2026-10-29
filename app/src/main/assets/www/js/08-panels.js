// ============================================================
// Рендер панелей, выделение, навигация курсором.
// В мульти-БД режиме каждая панель читает свой контекст
// из FAR.side[side]. Старые имена FAR.leftPath / FAR.leftFiles
// работают как алиасы к этим контекстам.
//
// ЛЕНИВАЯ ЗАГРУЗКА + ВИРТУАЛИЗАЦИЯ:
//   • renderPanel теперь асинхронно подгружает директорию,
//     если она ещё не загружена (FAR.ensureDirLoaded).
//   • DOM-рендер виртуализирован: в контейнер .file-list
//     добавляется spacer высотой total*ROW_H, а реально
//     создаются только строки видимого окна.
// ============================================================

// Высота одной строки списка (должна совпадать с CSS .file-item)
FAR.ROW_H = 22;

// Сколько строк рисуем за пределами видимой области (буфер)
FAR.ROW_OVERSCAN = 8;

// ============================================================
// Публичный асинхронный renderPanel — сначала грузит директорию,
// потом рисует.
// ============================================================

FAR.renderPanel = function (side, opts) {
    opts = opts || {};
    const ctx = FAR.side[side];
    if (!ctx) return Promise.resolve();

    const pathEl = document.getElementById(side === 'left' ? 'pathLeft' : 'pathRight');
    const safePath = '/' + FAR.normPath(ctx.path);
    ctx.path = safePath;
    if (pathEl) pathEl.textContent = safePath;

    // Если директория ещё не загружена — грузим и потом рисуем.
    if (!opts.skipLoad && ctx._loadedDir !== FAR.normPath(safePath)) {
        const self = FAR;
        return FAR.ensureDirLoaded(side, safePath, { silent: true }).then(function () {
            self._renderPanelDOM(side);
        });
    }
    FAR._renderPanelDOM(side);
    return Promise.resolve();
};

// ============================================================
// Синхронный рендер DOM — вызывается, когда директория уже
// загружена в ctx.fileIndex. Использует виртуализацию.
// ============================================================

FAR._renderPanelDOM = function (side) {
    const ctx = FAR.side[side];
    if (!ctx) return;

    const listEl   = document.getElementById(side === 'left' ? 'listLeft'   : 'listRight');
    const pathEl   = document.getElementById(side === 'left' ? 'pathLeft'   : 'pathRight');
    const statusEl = document.getElementById(side === 'left' ? 'statusLeft' : 'statusRight');

    const safePath = '/' + FAR.normPath(ctx.path);
    ctx.path = safePath;
    if (pathEl) pathEl.textContent = safePath;

    // Подсказка с текущей БД
    if (pathEl) {
        const dbLabel = ctx.conn ? FAR.connLabel(ctx.conn) : '— нет подключения —';
        pathEl.title = 'Источник: ' + dbLabel + '\nКлик — сменить сервер для этой панели';
    }

    // items для этой панели берём прямо из ctx.fileIndex
    // (ленивая загрузка уже наполнила его детьми текущей папки).
    const items = ctx.fileIndex.filter(function (it) {
        const parent = (function () {
            const p = FAR.normPath(it.path);
            const ls = p.lastIndexOf('/');
            return ls === -1 ? '' : p.substring(0, ls);
        })();
        const curNorm = FAR.normPath(safePath);
        return parent === curNorm;
    });
    ctx.files = items;

    const hasParent = (safePath !== '/');
    const minCursor = hasParent ? -1 : 0;
    const maxCursor = items.length - 1;

    // --- Корректировка курсора ---
    let cursor = ctx.cursor;
    if (items.length === 0) {
        cursor = -1;
    } else if (cursor < minCursor) {
        cursor = minCursor;
    } else if (cursor > maxCursor) {
        cursor = maxCursor;
    }
    ctx.cursor = cursor;

    const selSet = ctx.selectedIdx;
    for (const idx of Array.from(selSet)) {
        if (idx < 0 || idx >= items.length) selSet.delete(idx);
    }

    // === Стилизация активной панели ===
    const panelEl = document.getElementById(side === 'left' ? 'panelLeft' : 'panelRight');
    if (panelEl) panelEl.classList.toggle('active', side === FAR.activePanel);

    // === Виртуализированный рендер ===
    FAR._virtualRender(side, listEl, hasParent, items, cursor, selSet);

    if (statusEl) {
        statusEl.textContent = `${side === 'left' ? 'Левая' : 'Правая'}: ${items.length}`;
    }
    FAR.updateSelectionInfo();
    FAR.updateButtons();
    FAR.updateTotalSize();
};

// ============================================================
// Виртуализация списка.
// ============================================================

FAR._virtualRender = function (side, listEl, hasParent, items, cursor, selSet) {
    if (!listEl) return;

    const totalRows = items.length + (hasParent ? 1 : 0);
    const totalH = totalRows * FAR.ROW_H;

    // Гарантируем наличие spacer и viewport
    let spacer = listEl.querySelector('.file-list-spacer');
    if (!spacer) {
        listEl.innerHTML = '';
        spacer = document.createElement('div');
        spacer.className = 'file-list-spacer';
        spacer.style.position = 'relative';
        listEl.appendChild(spacer);
    }
    spacer.style.height = totalH + 'px';

    // Скролл-позиция → какое окно строк рисовать
    const scrollTop = listEl.scrollTop;
    const viewportH = listEl.clientHeight || 400;
    const firstVisible = Math.max(0, Math.floor(scrollTop / FAR.ROW_H) - FAR.ROW_OVERSCAN);
    const lastVisible  = Math.min(totalRows - 1,
        Math.ceil((scrollTop + viewportH) / FAR.ROW_H) + FAR.ROW_OVERSCAN);

    // Пересобираем DOM только для видимого окна
    // (быстро: innerHTML блока размером ~30–60 строк).
    let html = '';
    for (let vi = firstVisible; vi <= lastVisible; vi++) {
        const top = vi * FAR.ROW_H;

        if (hasParent && vi === 0) {
            const isFocused = (side === FAR.activePanel) && (cursor === -1);
            const extraClass = isFocused ? 'focused' : '';
            html += `<div class="file-item parent-dir ${extraClass}"
                data-index="-1" data-side="${side}"
                style="position:absolute;top:${top}px;left:0;right:0;height:${FAR.ROW_H}px;"
                onclick="FAR.handleItemClick(event, '${side}', -1)"
                ondblclick="FAR.goToParent('${side}')"
                title="Перейти в родительский каталог">
                <span class="name">📁 ..</span><span class="meta"></span>
            </div>`;
            continue;
        }

        const idx = hasParent ? vi - 1 : vi;
        const item = items[idx];
        if (!item) continue;

        const icon = item.isFolder ? '📁' : '📄';
        const cls = item.isFolder ? 'folder' : 'file';
        const sizeStr = item.size ? FAR.formatSize(item.size) : '';
        const isSelected = selSet.has(idx);
        const isFocused = (side === FAR.activePanel) && (cursor === idx);
        const extraClass = isFocused ? 'focused' : (isSelected ? 'selected' : '');
        html += `<div class="file-item ${extraClass}"
            data-index="${idx}" data-side="${side}"
            style="position:absolute;top:${top}px;left:0;right:0;height:${FAR.ROW_H}px;"
            onclick="FAR.handleItemClick(event, '${side}', ${idx})"
            ondblclick="FAR.handleItemDblClick('${side}', ${idx})">
            <span class="name ${cls}">${icon} ${FAR.escapeHtml(item.name)}</span>
            <span class="meta">${sizeStr}</span>
        </div>`;
    }

    if (!html) {
        html = '<div style="padding:10px;color:#a6adc8;text-align:center;">Папка пуста</div>';
    }

    spacer.innerHTML = html;

    // Один раз вешаем scroll-обработчик
    if (!listEl._farVirtualBound) {
        listEl._farVirtualBound = true;
        listEl.addEventListener('scroll', function () {
            FAR._renderPanelDOM(side);
        });
    }
};

// ============================================================
// setActivePanel / goToParent / navigatePanel
// ============================================================

FAR.setActivePanel = function (side) {
    if (FAR.activePanel === side) return;
    FAR.activePanel = side;
    document.getElementById('panelLeft').classList.toggle('active', side === 'left');
    document.getElementById('panelRight').classList.toggle('active', side === 'right');
    FAR.renderPanel('left');
    FAR.renderPanel('right');
    FAR.updateSelectionInfo();
    FAR.updateButtons();
    FAR.saveUiState();
};

FAR.goToParent = function (side) {
    const ctx = FAR.side[side];
    if (!ctx) return;
    const cur = FAR.normPath(ctx.path);
    if (!cur) return;
    const parts = cur.split('/').filter(Boolean);
    parts.pop();
    const newPath = parts.length ? '/' + parts.join('/') : '/';
    ctx.path = newPath;
    ctx.selectedIdx.clear();
    ctx.anchor = -1;
    ctx.cursor = -1;
    ctx._loadedDir = null;
    FAR.renderPanel(side);
    FAR.saveUiState();
};

FAR.navigatePanel = function (side, action) {
    const ctx = FAR.side[side];
    if (!ctx) return;
    let path = ctx.path;
    if (action === '..') {
        const cur = FAR.normPath(path);
        if (!cur) return;
        const parts = cur.split('/').filter(Boolean);
        parts.pop();
        path = parts.length ? '/' + parts.join('/') : '/';
    } else if (action === '/') {
        path = '/';
    }
    ctx.path = path;
    ctx.selectedIdx.clear();
    ctx.anchor = -1;
    ctx.cursor = -1;
    ctx._loadedDir = null;
    FAR.renderPanel(side);
    FAR.saveUiState();
};

// ============================================================
// Обработчики кликов
// ============================================================

FAR.handleItemClick = function (event, side, index) {
    event.stopPropagation();
    FAR.setActivePanel(side);

    const ctx = FAR.side[side];
    if (!ctx) return;

    if (index === -1) {
        ctx.cursor = -1;
        ctx.selectedIdx.clear();
        ctx.anchor = -1;
        FAR.renderPanel(side, { skipLoad: true });
        FAR.saveUiState();
        return;
    }

    const selSet = ctx.selectedIdx;
    const anchor = ctx.anchor;
    const ctrl   = event.ctrlKey || event.metaKey;
    const shift  = event.shiftKey;

    if (!shift) {
        ctx.cursor = index;
    }

    if (ctrl) {
        if (selSet.has(index)) selSet.delete(index);
        else selSet.add(index);
        ctx.anchor = index;
    } else if (shift && anchor !== -1) {
        selSet.clear();
        const from = Math.min(anchor, index);
        const to   = Math.max(anchor, index);
        for (let i = from; i <= to; i++) selSet.add(i);
    } else {
        selSet.clear();
        selSet.add(index);
        ctx.anchor = index;
    }
    FAR.renderPanel(side, { skipLoad: true });
    FAR.saveUiState();
};

FAR.handleItemDblClick = async function (side, index) {
    if (index === -1) {
        FAR.goToParent(side);
        return;
    }
    const ctx = FAR.side[side];
    if (!ctx) return;
    const items = ctx.files;
    if (index < 0 || index >= items.length) return;
    const item = items[index];

    if (item.isFolder) {
        const newPath = '/' + FAR.normPath(item.path);
        ctx.path = newPath;
        ctx.selectedIdx.clear();
        ctx.anchor = -1;
        ctx.cursor = -1;
        ctx._loadedDir = null;
        await FAR.renderPanel(side);
        FAR.saveUiState();
    } else {
        await FAR.openFile(item, side, index);
    }
};

FAR.updateSelectionInfo = function () {
    const el = document.getElementById('selInfo');
    if (!el) return;
    const leftSel  = FAR.side.left  ? FAR.side.left.selectedIdx.size  : 0;
    const rightSel = FAR.side.right ? FAR.side.right.selectedIdx.size : 0;
    const total = leftSel + rightSel;
    if (total === 0) { el.textContent = ''; return; }
    const parts = [];
    if (leftSel > 0)  parts.push(`Л: ${leftSel}`);
    if (rightSel > 0) parts.push(`П: ${rightSel}`);
    el.textContent = `Выделено — ${parts.join(', ')}`;
};

FAR.getSelectedItemsFromActivePanel = function () {
    const ctx = FAR.side[FAR.activePanel];
    if (!ctx) return [];
    const items = ctx.files;
    const selSet = ctx.selectedIdx;
    const result = [];
    for (const i of Array.from(selSet).sort((a, b) => a - b)) {
        if (i >= 0 && i < items.length) result.push({ item: items[i], index: i });
    }
    return result;
};

FAR.updateButtons = function () {
    const hasDb = !!FAR.db;
    const ctx = FAR.side[FAR.activePanel];
    const selCount = ctx ? ctx.selectedIdx.size : 0;
    document.getElementById('btnCopy').disabled     = !hasDb || selCount === 0;
    document.getElementById('btnMove').disabled     = !hasDb || selCount === 0;
    document.getElementById('btnDelete').disabled   = !hasDb || selCount === 0;
    document.getElementById('btnDownload').disabled = !hasDb || selCount === 0;
    document.getElementById('btnZip').disabled      = !hasDb || selCount === 0;
};

// ============================================================
// Навигация курсором
// ============================================================

FAR.getPageSize = function (side) {
    const listEl = document.getElementById(side === 'left' ? 'listLeft' : 'listRight');
    if (!listEl) return 15;
    const h = listEl.clientHeight;
    return Math.max(1, Math.floor(h / FAR.ROW_H) - 1);
};

FAR.scrollCursorIntoView = function (side) {
    const listEl = document.getElementById(side === 'left' ? 'listLeft' : 'listRight');
    if (!listEl) return;
    const ctx = FAR.side[side];
    if (!ctx) return;
    const cursor = ctx.cursor;
    if (cursor < -1) return;

    const hasParent = (FAR.normPath(ctx.path) !== '');
    const vi = hasParent ? (cursor + 1) : cursor;
    if (vi < 0) return;

    const top = vi * FAR.ROW_H;
    const bot = top + FAR.ROW_H;
    const viewTop = listEl.scrollTop;
    const viewBot = viewTop + listEl.clientHeight;

    if (top < viewTop) {
        listEl.scrollTop = top;
    } else if (bot > viewBot) {
        listEl.scrollTop = bot - listEl.clientHeight;
    }
};

FAR.moveCursor = function (side, delta, options) {
    options = options || {};
    const isPage = !!options.page;
    const toEdge = options.toEdge;

    const ctx = FAR.side[side];
    if (!ctx) return;

    const hasParent = (FAR.normPath(ctx.path) !== '');
    const items = ctx.files;

    const minCursor = hasParent ? -1 : 0;
    const maxCursor = items.length - 1;

    if (maxCursor < minCursor) return;

    const selSet = ctx.selectedIdx;
    const anchor = ctx.anchor;
    let cursor = ctx.cursor;

    if (cursor < minCursor) cursor = minCursor;
    if (cursor > maxCursor) cursor = maxCursor;
    if (cursor < 0 && !hasParent) cursor = 0;

    let newCursor = cursor;

    if (toEdge === 'home') {
        newCursor = minCursor;
    } else if (toEdge === 'end') {
        newCursor = maxCursor;
    } else if (isPage) {
        const pageSize = FAR.getPageSize(side);
        newCursor = cursor + delta * pageSize;
    } else {
        newCursor = cursor + delta;
    }

    if (newCursor < minCursor) newCursor = minCursor;
    if (newCursor > maxCursor) newCursor = maxCursor;

    if (newCursor === cursor && !options.force) {
        FAR.scrollCursorIntoView(side);
        return;
    }

    const shift = !!options.shift;

    if (shift) {
        if (newCursor === -1) {
            selSet.clear();
        } else if (anchor === -1 || anchor === undefined) {
            selSet.clear();
            selSet.add(newCursor);
            ctx.anchor = newCursor;
        } else {
            selSet.clear();
            const from = Math.min(anchor, newCursor);
            const to   = Math.max(anchor, newCursor);
            for (let i = from; i <= to; i++) selSet.add(i);
        }
    } else {
        if (newCursor === -1) {
            selSet.clear();
            ctx.anchor = -1;
        } else {
            selSet.clear();
            selSet.add(newCursor);
            ctx.anchor = newCursor;
        }
    }

    ctx.cursor = newCursor;

    FAR.renderPanel(side, { skipLoad: true });
    FAR.scrollCursorIntoView(side);
    FAR.saveUiState();
};