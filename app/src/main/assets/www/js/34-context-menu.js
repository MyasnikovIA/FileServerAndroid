// ============================================================
// Контекстное меню файлового менеджера (ПКМ по элементу панели)
// ============================================================

FAR.ctxState = {
    visible: false,
    side: null,        // 'left' | 'right'
    index: null,       // индекс элемента в списке панели
    item: null,        // сам объект файла/папки
    menuEl: null,
    _bound: false
};

/**
 * Открывает контекстное меню в точке (x, y) для указанного элемента панели.
 */
FAR.openContextMenu = function (x, y, side, index, item) {
    FAR.ctxState.side = side;
    FAR.ctxState.index = index;
    FAR.ctxState.item = item;

    FAR._ctxEnsureElement();
    FAR._ctxRenderMenu();

    const menu = FAR.ctxState.menuEl;
    menu.classList.remove('hidden');

    // Позиционируем, не вылезая за границы окна
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x;
    let top = y;
    if (left + rect.width > vw - 4) left = vw - rect.width - 4;
    if (top + rect.height > vh - 4) top = vh - rect.height - 4;

    // Защита от выхода за верхний/левый край, если меню слишком большое
    if (left < 4) left = 4;
    if (top < 4) top = 4;

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    FAR.ctxState.visible = true;
};

/**
 * Закрывает контекстное меню.
 */
FAR.closeContextMenu = function () {
    if (!FAR.ctxState.menuEl) return;
    FAR.ctxState.menuEl.classList.add('hidden');
    FAR.ctxState.visible = false;
    FAR.ctxState.side = null;
    FAR.ctxState.index = null;
    FAR.ctxState.item = null;
};

/**
 * Создаёт DOM-элемент меню (один раз).
 */
FAR._ctxEnsureElement = function () {
    if (FAR.ctxState.menuEl) return;

    const menu = document.createElement('div');
    menu.className = 'ctx-menu hidden';
    menu.id = 'ctxMenu';
    document.body.appendChild(menu);
    FAR.ctxState.menuEl = menu;

    // Закрытие по клику вне меню / по скроллу / по потере фокуса
    if (!FAR.ctxState._bound) {
        FAR.ctxState._bound = true;

        document.addEventListener('mousedown', function (e) {
            if (!FAR.ctxState.visible) return;
            if (FAR.ctxState.menuEl && FAR.ctxState.menuEl.contains(e.target)) return;
            FAR.closeContextMenu();
        }, true);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && FAR.ctxState.visible) {
                FAR.closeContextMenu();
                e.stopPropagation();
            }
        }, true);

        window.addEventListener('blur', function () {
            FAR.closeContextMenu();
        });

        window.addEventListener('resize', function () {
            FAR.closeContextMenu();
        });

        // Скролл панели файлов — закрываем меню
        document.addEventListener('scroll', function (e) {
            if (!FAR.ctxState.visible) return;
            if (FAR.ctxState.menuEl && FAR.ctxState.menuEl.contains(e.target)) return;
            FAR.closeContextMenu();
        }, true);
    }
};

/**
 * Строит содержимое меню в зависимости от контекста (файл / папка / пусто).
 */
FAR._ctxRenderMenu = function () {
    const menu = FAR.ctxState.menuEl;
    menu.innerHTML = '';

    const side = FAR.ctxState.side;
    const index = FAR.ctxState.index;
    const item = FAR.ctxState.item;

    const hasDb = !!FAR.db;
    const isItem = index !== null && index >= 0 && !!item;
    const isFolder = isItem && item.isFolder;
    const isFile = isItem && !item.isFolder;

    const selSet = side === 'left' ? FAR.leftSelectedIdx : FAR.rightSelectedIdx;
    const selCount = selSet ? selSet.size : 0;
    const hasSelection = selCount > 0;

    // ==== Заголовок ====
    const titleText = isItem
        ? (isFolder ? '📁 ' + item.name : '📄 ' + item.name)
        : 'Панель: ' + (side === 'left' ? 'левая' : 'правая');

    const title = document.createElement('div');
    title.className = 'ctx-title';
    title.textContent = titleText;
    title.title = titleText;
    menu.appendChild(title);

    // ==== Пункты меню ====
    const entries = [];

    // Открыть — только для файла/папки, и только если есть БД
    entries.push({
        label: 'Открыть',
        icon: '📂',
        enabled: hasDb && isItem,
        action: function () {
            if (isFolder) {
                FAR.handleItemDblClick(side, index);
            } else {
                FAR.openFile(item, side, index);
            }
        }
    });

    // Открыть в новом окне — только для файла
    entries.push({
        label: 'Открыть в новом окне',
        icon: '🪟',
        enabled: hasDb && isFile,
        action: function () {
            FAR.openFileInNewWindow(item, side);
        }
    });

    // Открыть в браузере — для HTML-файлов
    entries.push({
        label: 'Открыть в браузере',
        icon: '🌐',
        enabled: hasDb && isFile && (typeof FAR.isHtmlFile === 'function') && FAR.isHtmlFile(item),
        action: function () {
            if (typeof FAR.openBrowserFromItem === 'function') {
                FAR.openBrowserFromItem(item, side);
            }
        }
    });

    // ============================================================
    // Установить приложение (только для .apk внутри Android WebView)
    // ============================================================
    if (isFile
        && typeof FAR.isApkFile === 'function'
        && FAR.isApkFile(item)
        && FAR.AndroidPrograms
        && FAR.AndroidPrograms.available) {
        entries.push({
            label: 'Установить приложение',
            icon: '📥',
            enabled: hasDb,
            action: function () {
                FAR.AndroidPrograms.installApk(item.path);
            }
        });
    }

    entries.push({ sep: true });

    // Загрузить — всегда доступно (загружаем в текущий путь панели)
    entries.push({
        label: 'Загрузить',
        icon: '📤',
        enabled: hasDb,
        action: function () { FAR.uploadFile(); }
    });

    // Создать папку — всегда доступно
    entries.push({
        label: 'Создать папку',
        icon: '📁',
        enabled: hasDb,
        action: function () { FAR.createFolder(); }
    });

    entries.push({ sep: true });

    // Копировать — активна, если есть выделение
    entries.push({
        label: 'Копировать',
        icon: '📋',
        enabled: hasDb && hasSelection,
        action: function () { FAR.copySelected(); }
    });

    // Перенести — активна, если есть выделение
    entries.push({
        label: 'Перенести',
        icon: '✂️',
        enabled: hasDb && hasSelection,
        action: function () { FAR.moveSelected(); }
    });

    // Скачать (без сжатия)
    entries.push({
        label: 'Скачать',
        icon: '📥',
        enabled: hasDb && hasSelection,
        action: function () { FAR.downloadSelectedUncompressed(); }
    });

    // Скачать ZIP
    entries.push({
        label: 'Скачать ZIP',
        icon: '🗜️',
        enabled: hasDb && hasSelection,
        action: function () { FAR.downloadSelectedAsZip(); }
    });

    entries.push({ sep: true });

    // Удалить
    entries.push({
        label: 'Удалить',
        icon: '🗑️',
        enabled: hasDb && hasSelection,
        danger: true,
        action: function () { FAR.deleteSelected(); }
    });

    // Обновить
    entries.push({
        label: 'Обновить',
        icon: '🔄',
        enabled: hasDb,
        action: function () { FAR.refreshFiles(); }
    });

    // ==== Рендер пунктов ====
    for (const e of entries) {
        if (e.sep) {
            const sep = document.createElement('div');
            sep.className = 'ctx-sep';
            menu.appendChild(sep);
            continue;
        }

        const row = document.createElement('div');
        row.className = 'ctx-item' +
            (e.enabled ? '' : ' disabled') +
            (e.danger ? ' danger' : '');

        const icon = document.createElement('span');
        icon.className = 'ctx-icon';
        icon.textContent = e.icon || '';

        const label = document.createElement('span');
        label.className = 'ctx-label';
        label.textContent = e.label;

        row.appendChild(icon);
        row.appendChild(label);

        if (e.enabled && typeof e.action === 'function') {
            row.addEventListener('click', function (ev) {
                ev.stopPropagation();
                ev.preventDefault();
                FAR.closeContextMenu();
                try {
                    e.action();
                } catch (err) {
                    console.error('ctx action failed:', err);
                    FAR.toast('Ошибка: ' + err.message, 'error');
                }
            });
        }

        menu.appendChild(row);
    }
};

/**
 * Открывает меню по событию contextmenu на элементе панели.
 * Внутренняя функция — вешается в setupPanelContextMenu.
 */
FAR._onPanelItemContextMenu = function (event, side) {
    if (event.ctrlKey || event.metaKey) return;

    event.preventDefault();
    event.stopPropagation();

    const itemEl = event.target.closest('.file-item');
    if (!itemEl) {
        FAR.setActivePanel(side);
        FAR.openContextMenu(event.clientX, event.clientY, side, null, null);
        return;
    }

    const idxAttr = itemEl.getAttribute('data-index');
    const index = idxAttr === null ? null : parseInt(idxAttr, 10);

    if (index === -1) {
        FAR.setActivePanel(side);
        FAR.openContextMenu(event.clientX, event.clientY, side, -1, {
            isFolder: true, name: '..', path: ''
        });
        return;
    }

    const items = side === 'left' ? FAR.leftFiles : FAR.rightFiles;
    if (index === null || index < 0 || index >= items.length) return;
    const item = items[index];

    FAR.setActivePanel(side);

    const selSet = side === 'left' ? FAR.leftSelectedIdx : FAR.rightSelectedIdx;
    if (!selSet.has(index)) {
        selSet.clear();
        selSet.add(index);
        if (side === 'left') {
            FAR.leftAnchor = index;
            FAR.leftCursor = index;
        } else {
            FAR.rightAnchor = index;
            FAR.rightCursor = index;
        }
        FAR.renderPanel(side);
    }

    FAR.openContextMenu(event.clientX, event.clientY, side, index, item);
};

/**
 * Вешается один раз при старте приложения. Прикрепляет обработчик
 * contextmenu к каждой панели.
 */
FAR.setupPanelContextMenu = function () {
    const panelLeft = document.getElementById('panelLeft');
    const panelRight = document.getElementById('panelRight');

    if (panelLeft && !panelLeft._farCtxBound) {
        panelLeft._farCtxBound = true;
        panelLeft.addEventListener('contextmenu', function (e) {
            FAR._onPanelItemContextMenu(e, 'left');
        });
    }
    if (panelRight && !panelRight._farCtxBound) {
        panelRight._farCtxBound = true;
        panelRight.addEventListener('contextmenu', function (e) {
            FAR._onPanelItemContextMenu(e, 'right');
        });
    }
};