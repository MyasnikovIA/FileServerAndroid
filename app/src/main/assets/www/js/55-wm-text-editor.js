// ============================================================
// 55-wm-text-editor.js — Текстовый редактор (Notepad++ style) для WM
// ============================================================

FAR.isTextFile = function(item) {
    if (!item || item.isFolder) return false;
    const ext = (item.name.split('.').pop() || '').toLowerCase();
    const textExts = ['txt', 'md', 'json', 'xml', 'csv', 'log', 'html', 'htm',
        'css', 'js', 'py', 'java', 'c', 'cpp', 'h', 'ini', 'cfg', 'yaml', 'yml'];
    if (textExts.includes(ext)) return true;
    const ct = (item.contentType || '').toLowerCase();
    return ct.startsWith('text/') || ct.includes('json') || ct.includes('xml') || ct.includes('javascript');
};

FAR.WM._mountTextEditor = async function(win, props) {
    const item = props.file;
    const side = props.side || FAR.activePanel;

    if (!item) {
        FAR.WM._mountFilePickerPrompt(win, 'Выберите текстовый файл для редактирования');
        return;
    }

    // ============================================================
    // FIX (важно): строим _id из path, а не доверяем item._id.
    // ------------------------------------------------------------
    // Причина бага: при повторном открытии файла из другой папки
    // (и при переключении каталогов) в объекте item мог оставаться
    // _id, указывающий на ДРУГОЙ файл, если объект был взят из
    // устаревшего снимка файлового списка. При этом item.path
    // оставался верным. Поскольку серверный getAttachment строит
    // URL именно из _id (декодирует _id → path), получалось, что
    // вместо file1 грузился file2.
    //
    // Решение: жёстко привязываемся к path. И _id, и фактическое
    // содержимое файла теперь однозначно определяются path.
    // ============================================================
    const itemPath = FAR.normPath(item.path || '');
    if (!itemPath) {
        FAR.toast('У файла не задан path — открыть нельзя', 'error');
        return;
    }
    const itemName = item.name || itemPath.split('/').pop() || 'file.txt';
    const itemId   = 'f:' + encodeURIComponent(itemPath);

    win.props._openedPath = itemPath;
    win.props._openedId   = itemId;
    win.props._openedName = itemName;

    // Diagnostic log: помогает отследить, если item._id != вычисленного
    try {
        if (item._id && item._id !== itemId) {
            console.warn('[WM TextEditor] item._id != derived id:', {
                passedId: item._id,
                derivedId: itemId,
                path: itemPath
            });
        }
    } catch (e) {}

    win.el.querySelector('.wm-title-text').textContent = '📝 ' + itemName;
    win.bodyEl.style.display = 'flex';
    win.bodyEl.style.flexDirection = 'column';
    win.bodyEl.style.background = '#1e1e2e';
    win.bodyEl.style.overflow = 'hidden';

    win.bodyEl.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;padding:4px 10px;background:#181825;border-bottom:1px solid #313244;flex-shrink:0;">' +
        '  <button id="te-save" style="padding:4px 12px;background:#a6e3a1;color:#1e1e2e;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;">💾 Сохранить</button>' +
        '  <span id="te-status" style="font-size:11px;color:#a6adc8;margin-left:10px;">Загрузка...</span>' +
        '  <span id="te-coords" style="font-size:11px;color:#6c7086;margin-left:auto;font-family:monospace;">Стр: 1, Кол: 1</span>' +
        '</div>' +
        '<div style="display:flex;flex:1;min-height:0;position:relative;overflow:hidden;">' +
        '  <div id="te-lines" style="width:50px;background:#11111b;color:#585b70;text-align:right;padding:10px 8px;font-family:\'Courier New\',monospace;font-size:14px;line-height:1.5;overflow:hidden;user-select:none;border-right:1px solid #313244;">1</div>' +
        '  <textarea id="te-textarea" spellcheck="false" style="flex:1;background:#1e1e2e;color:#cdd6f4;border:none;outline:none;resize:none;padding:10px;font-family:\'Courier New\',monospace;font-size:14px;line-height:1.5;white-space:pre;overflow:auto;"></textarea>' +
        '</div>';

    const btnSave = win.bodyEl.querySelector('#te-save');
    const statusEl = win.bodyEl.querySelector('#te-status');
    const coordsEl = win.bodyEl.querySelector('#te-coords');
    const linesEl = win.bodyEl.querySelector('#te-lines');
    const ta = win.bodyEl.querySelector('#te-textarea');

    let currentContent = '';

    // Загрузка файла: используем ТОЛЬКО id, построенный из path,
    // чтобы гарантированно читать содержимое именно этого файла.
    try {
        const freshItem = {
            _id: itemId,
            path: itemPath,
            name: itemName,
            contentType: item.contentType || 'text/plain'
        };

        const res = await FAR.readFileBodyFromSide(side, freshItem);
        const text = new TextDecoder('utf-8').decode(res.data);

        currentContent = text;
        ta.value = text;
        statusEl.textContent = 'Готово';
        statusEl.style.color = '#a6e3a1';
        updateLines();
    } catch (e) {
        statusEl.textContent = 'Ошибка загрузки: ' + e.message;
        statusEl.style.color = '#f38ba8';
        return;
    }

    // Обновление нумерации строк
    function updateLines() {
        const linesCount = ta.value.split('\n').length;
        let html = '';
        for (let i = 1; i <= linesCount; i++) {
            html += i + '<br>';
        }
        linesEl.innerHTML = html;
        syncScroll();
    }

    // Синхронизация прокрутки
    function syncScroll() {
        linesEl.scrollTop = ta.scrollTop;
    }

    ta.addEventListener('scroll', syncScroll);
    ta.addEventListener('input', updateLines);

    // Обновление координат курсора
    ta.addEventListener('click', updateCoords);
    ta.addEventListener('keyup', updateCoords);
    function updateCoords() {
        const text = ta.value.substring(0, ta.selectionStart);
        const lines = text.split('\n');
        const row = lines.length;
        const col = lines[lines.length - 1].length + 1;
        coordsEl.textContent = `Стр: ${row}, Кол: ${col}`;
    }

    // Обработка Tab
    ta.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = this.selectionStart;
            const end = this.selectionEnd;
            this.value = this.value.substring(0, start) + '\t' + this.value.substring(end);
            this.selectionStart = this.selectionEnd = start + 1;
            updateLines();
        }
    });

    // Сохранение: используем зафиксированный win.props._openedId,
    // а не item._id. Это исключает сохранение «не в тот файл».
    btnSave.onclick = async function() {
        const text = ta.value;
        if (text === currentContent) {
            FAR.toast('Нет изменений для сохранения', 'info');
            return;
        }

        btnSave.disabled = true;
        btnSave.textContent = '⏳ Сохранение...';
        statusEl.textContent = 'Сохранение...';
        statusEl.style.color = '#f9e2af';

        try {
            const s = FAR.side[side];
            if (!s || !s.db) throw new Error('Нет подключения к БД');

            const contentType = item.contentType || 'text/plain';
            const blob = new Blob([text], { type: contentType });

            let rev = null;
            try {
                const doc = await s.db.get(win.props._openedId);
                rev = doc._rev;
            } catch (e) {
                if (e.status !== 404) throw e;
            }

            await s.db.putAttachment(win.props._openedId, 'b', rev, blob, contentType);

            // Обновляем локальный кэш
            const idx = s.fileIndex.find(f => f._id === win.props._openedId);
            if (idx) {
                idx.size = blob.size;
                idx.mtime = Date.now();
            }

            currentContent = text;
            statusEl.textContent = 'Сохранено ✓';
            statusEl.style.color = '#a6e3a1';
            FAR.toast('Файл сохранён', 'success');

            // Обновляем панель, чтобы размер файла в списке обновился
            FAR.reloadPanel(side);
        } catch (e) {
            statusEl.textContent = 'Ошибка: ' + e.message;
            statusEl.style.color = '#f38ba8';
            FAR.toast('Ошибка сохранения: ' + e.message, 'error');
        } finally {
            btnSave.disabled = false;
            btnSave.textContent = '💾 Сохранить';
        }
    };

    // Фокус в текстовое поле
    setTimeout(() => ta.focus(), 100);
};