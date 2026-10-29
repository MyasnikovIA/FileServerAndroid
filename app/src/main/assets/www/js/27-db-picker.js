// ============================================================
// Модалка выбора изображения из FileBD с превью.
// ============================================================
//
// ЛЕНИВАЯ ЗАГРУЗКА:
//   Раньше список строился из FAR.fileIndex — глобального
//   индекса, который содержал всю БД. Теперь fileIndex
//   содержит только текущую директорию панели, поэтому
//   dbPicker сам грузит содержимое каждой папки через
//   FAR.listDirFromSide(side, path).
//
//   Состояние:
//     currentPath  — текущая папка внутри dbPicker
//     items        — загруженные дети текущей папки
//     loading      — флаг, что идёт загрузка
//
//   Навигация:
//     • клик по папке — загрузка её содержимого
//     • клик по файлу — превью + активация кнопки «Выбрать»
//     • Enter        — войти в папку или выбрать файл
//     • Backspace    — вверх
//     • стрелки/PageUp/PageDown/Home/End — курсор
//     • Esc          — закрыть
// ============================================================

FAR.dbPickerState = {
    side: 'left',          // панель, из которой берём файл
    currentPath: '/',      // текущая папка (внутри БД)
    cursorIdx: -1,         // индекс курсора в items
    anchorIdx: -1,         // якорь Shift-выделения
    selectedFile: null,    // выбранный файл
    items: [],             // видимые элементы (папки + файлы)
    filter: '',            // текст фильтра
    previewBlobUrl: null,  // Blob URL текущего превью
    onConfirm: null,       // callback при подтверждении
    loading: false,        // идёт загрузка директории
    _bound: false,
    _reqToken: 0           // защита от гонок при быстрой навигации
};

FAR.DBPICKER_LS_KEY = 'filebd_picker_state';

// ============================================================
// Сохранение/загрузка состояния
// ============================================================

FAR._dbPickerLoadState = function() {
    try {
        const raw = localStorage.getItem(FAR.DBPICKER_LS_KEY);
        if (!raw) return { path: '/', file: '' };
        const obj = JSON.parse(raw);
        return {
            path: obj.path || '/',
            file: obj.file || ''
        };
    } catch (e) {
        return { path: '/', file: '' };
    }
};

FAR._dbPickerSaveState = function() {
    try {
        const st = FAR.dbPickerState;
        const filePath = st.selectedFile ? st.selectedFile.path : '';
        localStorage.setItem(FAR.DBPICKER_LS_KEY, JSON.stringify({
            path: st.currentPath,
            file: filePath
        }));
    } catch (e) { /* ignore */ }
};

// ============================================================
// Открытие/закрытие
// ============================================================

/**
 * Открывает модалку выбора файла.
 * @param {Function} [onConfirm] — callback(path), вызывается при выборе
 * @param {string}   [side]      — панель, из БД которой брать файлы
 */
FAR.openDbPicker = function(onConfirm, side) {
    if (!FAR.ensureDb()) return;

    FAR.dbPickerState.side = side || FAR.activePanel;
    FAR.dbPickerState.onConfirm = onConfirm || null;
    FAR.dbPickerState.filter = '';
    FAR.dbPickerState.selectedFile = null;
    FAR.dbPickerState._bound || FAR._dbPickerBindOnce();

    const saved = FAR._dbPickerLoadState();
    FAR.dbPickerState.currentPath = saved.path || '/';
    FAR.dbPickerState.cursorIdx = 0;
    FAR.dbPickerState.anchorIdx = 0;

    const modal = document.getElementById('dbPickerModal');
    modal.classList.remove('hidden');

    const filterEl = document.getElementById('dbPickerFilter');
    if (filterEl) filterEl.value = '';

    FAR._dbPickerClearPreview();

    FAR._dbPickerLoadDir(FAR.dbPickerState.currentPath).then(function () {
        FAR._dbPickerRestoreCursor(saved.file);
    });

    setTimeout(function() {
        if (filterEl) {
            filterEl.focus();
        }
    }, 50);
};

FAR.closeDbPicker = function() {
    const modal = document.getElementById('dbPickerModal');
    if (modal) modal.classList.add('hidden');

    FAR._dbPickerClearPreview();
};

FAR.closeDbPickerOutside = function(e) {
    if (e.target === e.currentTarget) FAR.closeDbPicker();
};

// ============================================================
// Загрузка директории (ленивая)
// ============================================================

FAR._dbPickerLoadDir = async function(path) {
    const st = FAR.dbPickerState;
    const side = st.side;

    const norm = FAR.normPath(path);
    st.currentPath = norm ? '/' + norm : '/';
    st.loading = true;

    // Токен против гонок
    const myToken = ++st._reqToken;

    // Показать индикатор
    FAR._dbPickerRenderLoading();

    try {
        const items = await FAR.listDirFromSide(side, norm, { includeDocs: true });
        if (myToken !== st._reqToken) return; // устарело

        st.items = items.map(function(it) {
            // Для папок вычисляем isFolder, для файлов — isImage
            if (it.docType === 'folder' || it.isFolder) {
                return {
                    isFolder: true,
                    name: it.name,
                    path: it.path,
                    size: 0,
                    mtime: it.mtime || 0,
                    _id: it._id
                };
            }
            const ext = (it.name.split('.').pop() || '').toLowerCase();
            const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(ext);
            return {
                isFolder: false,
                name: it.name,
                path: it.path,
                size: it.size || 0,
                mtime: it.mtime || 0,
                isImage: isImage,
                ext: ext,
                _id: it._id
            };
        });

        st.loading = false;

        // Сброс курсора
        st.cursorIdx = st.items.length > 0 ? 0 : -1;
        st.anchorIdx = st.cursorIdx;

        FAR._dbPickerRenderList();
        FAR._dbPickerScrollToCursor();
    } catch (e) {
        if (myToken !== st._reqToken) return;
        st.loading = false;
        console.error('_dbPickerLoadDir:', e);
        FAR.toast('Ошибка загрузки ' + path + ': ' + e.message, 'error');
        st.items = [];
        FAR._dbPickerRenderList();
    }
};

// ============================================================
// Рендер списка
// ============================================================

FAR._dbPickerRenderLoading = function() {
    const listEl = document.getElementById('dbPickerList');
    if (!listEl) return;
    listEl.innerHTML = '<div class="db-picker-empty">Загрузка…</div>';
};

FAR._dbPickerRenderList = function() {
    const pathEl = document.getElementById('dbPickerCurrentPath');
    const listEl = document.getElementById('dbPickerList');
    if (!pathEl || !listEl) return;

    pathEl.textContent = FAR.dbPickerState.currentPath || '/';

    // Применяем фильтр
    const filter = (FAR.dbPickerState.filter || '').toLowerCase().trim();
    let items = FAR.dbPickerState.items;
    if (filter) {
        items = items.filter(function(it) {
            if (it.isFolder) return true;   // папки не фильтруем
            return it.name.toLowerCase().includes(filter);
        });
    }

    // Корректируем курсор под отфильтрованный список
    let cursor = FAR.dbPickerState.cursorIdx;
    if (items.length === 0) cursor = -1;
    else if (cursor < 0) cursor = 0;
    else if (cursor >= items.length) cursor = items.length - 1;
    FAR.dbPickerState.cursorIdx = cursor;

    // Запоминаем отфильтрованный список отдельно — для навигации
    FAR.dbPickerState.visibleItems = items;

    let html = '';

    // Кнопка «..» если не в корне
    if (FAR.normPath(FAR.dbPickerState.currentPath) !== '') {
        html += `<div class="db-picker-item parent-dir" data-idx="-1"
            onclick="FAR.dbPickerGoUp()">
            <span class="db-picker-icon">📁</span>
            <span class="db-picker-name">..</span>
            <span class="db-picker-meta"></span>
        </div>`;
    }

    if (items.length === 0) {
        html += '<div class="db-picker-empty">Папка пуста</div>';
    } else {
        items.forEach(function(it, i) {
            const icon = it.isFolder ? '📁' : (it.isImage ? '🖼️' : '📄');
            const cls = it.isFolder ? 'folder' : 'file';
            const isFocused = (i === cursor);
            const isSelected = FAR.dbPickerState.selectedFile
                && FAR.dbPickerState.selectedFile.path === it.path;
            const extra = isFocused ? 'focused' : (isSelected ? 'selected' : '');
            const sizeStr = it.isFolder ? '' : FAR.formatSize(it.size);
            html += `<div class="db-picker-item ${cls} ${extra}" data-idx="${i}"
                onclick="FAR._dbPickerOnItemClick(event, ${i})"
                ondblclick="FAR._dbPickerOnItemDblClick(${i})">
                <span class="db-picker-icon">${icon}</span>
                <span class="db-picker-name">${FAR.escapeHtml(it.name)}</span>
                <span class="db-picker-meta">${sizeStr}</span>
            </div>`;
        });
    }

    listEl.innerHTML = html;
};

// ============================================================
// Клики по элементам
// ============================================================

FAR._dbPickerOnItemClick = function(event, idx) {
    event.stopPropagation();
    const visible = FAR.dbPickerState.visibleItems || [];
    const it = visible[idx];
    if (!it) return;

    FAR.dbPickerState.cursorIdx = idx;
    FAR.dbPickerState.anchorIdx = idx;

    if (it.isFolder) {
        FAR.dbPickerState.selectedFile = null;
        FAR._dbPickerClearPreview();
    } else {
        FAR.dbPickerSelectFile(it);
    }

    FAR._dbPickerRenderList();
};

FAR._dbPickerOnItemDblClick = function(idx) {
    const visible = FAR.dbPickerState.visibleItems || [];
    const it = visible[idx];
    if (!it) return;

    if (it.isFolder) {
        FAR._dbPickerEnterFolder(it.path);
    } else {
        FAR.dbPickerSelectFile(it);
        FAR.dbPickerConfirm();
    }
};

FAR._dbPickerMoveCursor = function(delta, shift) {
    const visible = FAR.dbPickerState.visibleItems || [];
    if (visible.length === 0) return;

    let cursor = FAR.dbPickerState.cursorIdx;
    if (cursor < 0) cursor = 0;

    let newCursor = cursor + delta;
    if (newCursor < 0) newCursor = 0;
    if (newCursor > visible.length - 1) newCursor = visible.length - 1;
    if (newCursor === cursor) return;

    FAR.dbPickerState.cursorIdx = newCursor;
    if (!shift) FAR.dbPickerState.anchorIdx = newCursor;

    // Автовыбор файла при перемещении
    const it = visible[newCursor];
    if (it && !it.isFolder) {
        FAR.dbPickerSelectFile(it);
    } else if (it && it.isFolder) {
        FAR.dbPickerState.selectedFile = null;
        FAR._dbPickerClearPreview();
    }

    FAR._dbPickerRenderList();
    FAR._dbPickerScrollToCursor();
};

FAR._dbPickerScrollToCursor = function() {
    const listEl = document.getElementById('dbPickerList');
    if (!listEl) return;
    const cursor = FAR.dbPickerState.cursorIdx;
    if (cursor < 0) return;
    const el = listEl.querySelector('.db-picker-item[data-idx="' + cursor + '"]');
    if (el && el.scrollIntoView) {
        el.scrollIntoView({ block: 'nearest' });
    }
};

// ============================================================
// Навигация по папкам
// ============================================================

FAR._dbPickerEnterFolder = function(path) {
    FAR.dbPickerState.selectedFile = null;
    FAR._dbPickerClearPreview();
    FAR._dbPickerLoadDir(path);
};

FAR.dbPickerGoUp = function() {
    const cur = FAR.normPath(FAR.dbPickerState.currentPath);
    if (!cur) return;
    const parts = cur.split('/').filter(Boolean);
    parts.pop();
    const parent = parts.length ? '/' + parts.join('/') : '/';
    FAR.dbPickerState.selectedFile = null;
    FAR._dbPickerClearPreview();
    FAR._dbPickerLoadDir(parent);
};

FAR.dbPickerGoRoot = function() {
    FAR.dbPickerState.selectedFile = null;
    FAR._dbPickerClearPreview();
    FAR._dbPickerLoadDir('/');
};

FAR.dbPickerApplyFilter = function() {
    const el = document.getElementById('dbPickerFilter');
    FAR.dbPickerState.filter = el ? el.value : '';
    FAR.dbPickerState.cursorIdx = 0;
    FAR._dbPickerRenderList();
};

// ============================================================
// Восстановление курсора на последнем выбранном файле
// ============================================================

FAR._dbPickerRestoreCursor = function(filePath) {
    if (!filePath) return;

    const norm = FAR.normPath(filePath);
    const fileDir = norm.includes('/')
        ? norm.substring(0, norm.lastIndexOf('/'))
        : '';
    const curDir = FAR.normPath(FAR.dbPickerState.currentPath);

    // Если сохранённый файл лежит в другой папке — переходим туда
    if (fileDir !== curDir) {
        FAR._dbPickerLoadDir(fileDir || '/').then(function() {
            FAR._dbPickerRestoreCursorInCurrentDir(norm);
        });
    } else {
        FAR._dbPickerRestoreCursorInCurrentDir(norm);
    }
};

FAR._dbPickerRestoreCursorInCurrentDir = function(norm) {
    const visible = FAR.dbPickerState.visibleItems || [];
    const idx = visible.findIndex(function(it) {
        return FAR.normPath(it.path) === norm;
    });

    if (idx >= 0) {
        FAR.dbPickerState.cursorIdx = idx;
        FAR.dbPickerState.anchorIdx = idx;
        const it = visible[idx];
        if (it && !it.isFolder) {
            FAR.dbPickerSelectFile(it);
        }
        FAR._dbPickerRenderList();
        FAR._dbPickerScrollToCursor();
    }
};

// ============================================================
// Превью
// ============================================================

FAR.dbPickerSelectFile = async function(item) {
    FAR.dbPickerState.selectedFile = item;

    const btn = document.getElementById('dbPickerSelectBtn');
    if (btn) btn.disabled = false;

    FAR._dbPickerClearPreview();

    if (!item.isImage) {
        const info = document.getElementById('dbPickerInfo');
        if (info) info.textContent = item.path + ' — не изображение';
        const canvas = document.getElementById('dbPickerPreviewCanvas');
        if (canvas) {
            canvas.innerHTML = '<pre>Файл не является изображением.\nПревью недоступно.</pre>';
        }
        document.getElementById('dbPickerPreviewWrapper').classList.add('loaded');
        return;
    }

    const canvas = document.getElementById('dbPickerPreviewCanvas');
    const info = document.getElementById('dbPickerInfo');
    const wrapper = document.getElementById('dbPickerPreviewWrapper');

    if (canvas) canvas.innerHTML = '<div style="color:#6c7086;">Загрузка…</div>';

    try {
        const side = FAR.dbPickerState.side;
        const { data, contentType } = await FAR.readFileBodyFromSide(side, item);
        const blob = new Blob([data], { type: contentType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        FAR.dbPickerState.previewBlobUrl = url;

        if (canvas) {
            canvas.innerHTML = '<img src="' + url + '" alt="">';
        }
        if (info) {
            info.textContent = item.path + ' (' + FAR.formatSize(item.size) + ')';
        }
        if (wrapper) wrapper.classList.add('loaded');
    } catch (e) {
        console.error('dbPickerSelectFile:', e);
        if (canvas) {
            canvas.innerHTML = '<div style="color:#f38ba8;">Ошибка: ' + FAR.escapeHtml(e.message) + '</div>';
        }
        if (wrapper) wrapper.classList.add('loaded');
    }
};

FAR._dbPickerClearPreview = function() {
    const canvas = document.getElementById('dbPickerPreviewCanvas');
    const info = document.getElementById('dbPickerInfo');
    const wrapper = document.getElementById('dbPickerPreviewWrapper');
    const btn = document.getElementById('dbPickerSelectBtn');

    if (canvas) canvas.innerHTML = '';
    if (info) info.textContent = '';
    if (wrapper) wrapper.classList.remove('loaded');
    if (btn) btn.disabled = true;

    if (FAR.dbPickerState.previewBlobUrl) {
        try { URL.revokeObjectURL(FAR.dbPickerState.previewBlobUrl); } catch (e) {}
        FAR.dbPickerState.previewBlobUrl = null;
    }
};

// ============================================================
// Подтверждение выбора
// ============================================================

FAR.dbPickerConfirm = function() {
    const st = FAR.dbPickerState;
    if (!st.selectedFile) {
        FAR.toast('Выберите файл', 'warning');
        return;
    }

    FAR._dbPickerSaveState();

    // Заполняем поле в редакторе
    const input = document.getElementById('peDbPath');
    if (input) {
        input.value = '/' + st.selectedFile.path;
    }

    // Чистим поле URL
    const urlInput = document.getElementById('peUrl');
    if (urlInput) urlInput.value = '';

    if (typeof st.onConfirm === 'function') {
        try { st.onConfirm('/' + st.selectedFile.path); } catch (e) {}
    }

    FAR.toast('Выбран файл: ' + st.selectedFile.name, 'success');
    FAR.closeDbPicker();
    setTimeout(function() {
        FAR.peLoadPreview();
    }, 500);
};

// ============================================================
// Клавиатура
// ============================================================

FAR._dbPickerBindOnce = function() {
    if (FAR.dbPickerState._bound) return;
    FAR.dbPickerState._bound = true;

    document.addEventListener('keydown', function(e) {
        const modal = document.getElementById('dbPickerModal');
        if (!modal || modal.classList.contains('hidden')) return;

        const inFilter = (e.target && e.target.id === 'dbPickerFilter');

        if (e.key === 'Escape') {
            e.preventDefault();
            FAR.closeDbPicker();
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            const st = FAR.dbPickerState;
            if (st.selectedFile) {
                FAR.dbPickerConfirm();
                return;
            }
            const visible = st.visibleItems || [];
            const it = visible[st.cursorIdx];
            if (it) {
                if (it.isFolder) {
                    FAR._dbPickerEnterFolder(it.path);
                } else {
                    FAR.dbPickerSelectFile(it);
                    FAR.dbPickerConfirm();
                }
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            FAR._dbPickerMoveCursor(+1, e.shiftKey);
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            FAR._dbPickerMoveCursor(-1, e.shiftKey);
            return;
        }
        if (e.key === 'PageDown') {
            e.preventDefault();
            FAR._dbPickerMoveCursor(+10, e.shiftKey);
            return;
        }
        if (e.key === 'PageUp') {
            e.preventDefault();
            FAR._dbPickerMoveCursor(-10, e.shiftKey);
            return;
        }
        if (e.key === 'Home' && !inFilter) {
            e.preventDefault();
            FAR.dbPickerState.cursorIdx = 0;
            FAR.dbPickerState.anchorIdx = 0;
            FAR._dbPickerRenderList();
            FAR._dbPickerScrollToCursor();
            return;
        }
        if (e.key === 'End' && !inFilter) {
            e.preventDefault();
            const visible = FAR.dbPickerState.visibleItems || [];
            const last = visible.length - 1;
            FAR.dbPickerState.cursorIdx = last;
            FAR.dbPickerState.anchorIdx = last;
            FAR._dbPickerRenderList();
            FAR._dbPickerScrollToCursor();
            return;
        }
        if (e.key === 'Backspace' && !inFilter) {
            e.preventDefault();
            FAR.dbPickerGoUp();
            return;
        }
    }, true);
};