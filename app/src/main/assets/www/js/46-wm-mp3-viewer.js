// ============================================================
// 46-wm-mp3-viewer.js — MP3-плеер для оконного режима (WM)
// ============================================================
//
// Полноценный Winamp-подобный плеер, независимый от
// классического 36-mp3-viewer.js.
//
// Дополнительный функционал относительно классического:
//   • добавление одного файла в плейлист
//   • добавление всех .mp3 из каталога (рекурсивно)
//   • drag&drop для изменения порядка треков
//   • множественное выделение (Shift/Ctrl) + перетаскивание
//   • сохранение плейлиста в БД (.fbmp3)
//   • загрузка плейлиста двойным кликом по .fbmp3 в Проводнике
//
// Формат файла плейлиста (.fbmp3) — JSON:
//   { "type":"fbmp3", "version":1, "tracks":["/path/a.mp3", ...] }

FAR.WM.MP3_PLAYLIST_EXT = 'fbmp3';

// ------------------------------------------------------------
// Вспомогательные
// ------------------------------------------------------------

FAR.WM.isFbmp3 = function (item) {
    if (!item || item.isFolder) return false;
    const name = item.name || item.path || '';
    const ext = (name.split('.').pop() || '').toLowerCase();
    return ext === FAR.WM.MP3_PLAYLIST_EXT;
};

FAR.WM._mp3ReadFileBody = async function (side, pathOrItem) {
    const sideCtx = FAR.side[side];
    if (!sideCtx || !sideCtx.db) throw new Error('Панель не подключена к БД');

    let item = pathOrItem;
    if (typeof pathOrItem === 'string') {
        item = await FAR._readDocByPathFromSide(side, pathOrItem);
    }
    if (!item) throw new Error('Файл не найден: ' + pathOrItem);
    if (!item._id) throw new Error('Не удалось определить ID файла');

    return FAR.readFileBodyFromSide(side, item);
};

// Рекурсивный обход каталога: возвращает [{ path, name }, ...]
FAR.WM._mp3ScanDir = async function (side, dirPath) {
    const norm = FAR.normPath(dirPath);
    const files = [];

    async function walk(path) {
        let children;
        try {
            children = await FAR.listDirFromSide(side, path, { includeDocs: true });
        } catch (e) {
            console.warn('[WM mp3 scan] listDir failed:', path, e);
            return;
        }
        for (const it of children) {
            if (it.isFolder || it.docType === 'folder') {
                await walk(it.path);
            } else if (FAR.isMp3(it)) {
                files.push({ path: FAR.normPath(it.path), name: it.name });
            }
        }
    }

    await walk(norm);
    return files;
};

// ------------------------------------------------------------
// Диалог выбора каталога
// ------------------------------------------------------------

FAR.WM.pickFolder = function (side) {
    return new Promise(function (resolve) {
        const win = FAR.WM.openWindow({
            title: 'Выбор каталога',
            icon: '📁',
            width: 800, height: 560,
            appId: 'folderpick',
            props: { side: side }
        });

        const state = { side: side, path: '/' };

        win.bodyEl.innerHTML = '';
        win.bodyEl.style.display = 'flex';
        win.bodyEl.style.flexDirection = 'column';

        const pathBar = document.createElement('div');
        pathBar.className = 'wm-fd-pathbar';
        pathBar.textContent = '/';
        win.bodyEl.appendChild(pathBar);

        const listEl = document.createElement('div');
        listEl.className = 'wm-fd-list';
        listEl.style.flex = '1';
        win.bodyEl.appendChild(listEl);

        const footer = document.createElement('div');
        footer.className = 'wm-fd-footer';
        footer.innerHTML =
            '<span class="wm-fd-info" data-role="info"></span>' +
            '<button class="wm-fd-cancel" data-role="cancel">Отмена</button>' +
            '<button class="wm-fd-ok" data-role="ok">✓ Выбрать эту папку</button>';
        win.bodyEl.appendChild(footer);

        const cancelBtn = footer.querySelector('[data-role="cancel"]');
        const okBtn = footer.querySelector('[data-role="ok"]');

        cancelBtn.onclick = function () { resolve(null); FAR.WM.closeWindow(win.id, true); };
        okBtn.onclick = function () { resolve(state.path); FAR.WM.closeWindow(win.id, true); };

        const render = function () {
            pathBar.textContent = state.path;
            listEl.innerHTML = '';

            if (FAR.normPath(state.path) !== '') {
                const up = document.createElement('div');
                up.className = 'wm-fd-item';
                up.innerHTML = '<span>⬆</span><span class="wm-fd-name">..</span><span class="wm-fd-size"></span>';
                up.onclick = function () {
                    const cur = FAR.normPath(state.path);
                    const parts = cur.split('/').filter(Boolean);
                    parts.pop();
                    state.path = parts.length ? '/' + parts.join('/') : '/';
                    loadDir();
                };
                listEl.appendChild(up);
            }

            (state.items || []).forEach(function (it) {
                if (!it.isFolder && it.docType !== 'folder') return;
                const row = document.createElement('div');
                row.className = 'wm-fd-item';
                row.innerHTML =
                    '<span>📁</span>' +
                    '<span class="wm-fd-name">' + FAR.escapeHtml(it.name) + '</span>' +
                    '<span class="wm-fd-size"></span>';
                row.onclick = function () {
                    state.path = '/' + FAR.normPath(it.path);
                    loadDir();
                };
                listEl.appendChild(row);
            });
        };

        const loadDir = async function () {
            listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#6c7086;">Загрузка…</div>';
            try {
                state.items = await FAR.listDirFromSide(state.side, FAR.normPath(state.path), { includeDocs: true });
                render();
            } catch (e) {
                listEl.innerHTML = '<div style="padding:20px;color:#f38ba8;">Ошибка: ' + FAR.escapeHtml(e.message) + '</div>';
            }
        };

        const onKeyDown = function (e) {
            if (FAR.WM.state.activeWindowId !== win.id) return;
            if (e.key === 'Escape') {
                e.preventDefault(); e.stopPropagation();
                resolve(null); FAR.WM.closeWindow(win.id, true);
            } else if (e.key === 'Backspace') {
                e.preventDefault(); e.stopPropagation();
                const cur = FAR.normPath(state.path);
                if (!cur) return;
                const parts = cur.split('/').filter(Boolean);
                parts.pop();
                state.path = parts.length ? '/' + parts.join('/') : '/';
                loadDir();
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        win.onClose = function () {
            document.removeEventListener('keydown', onKeyDown, true);
        };

        loadDir();
    });
};

// ------------------------------------------------------------
// Диалог сохранения плейлиста
// ------------------------------------------------------------

FAR.WM.savePlaylistDialog = function (side, defaultName) {
    return new Promise(function (resolve) {
        const win = FAR.WM.openWindow({
            title: 'Сохранить плейлист',
            icon: '💾',
            width: 680, height: 480,
            appId: 'playlistsave',
            props: { side: side }
        });

        const state = { side: side, path: '/' };

        win.bodyEl.innerHTML =
            '<div style="padding:14px;display:flex;flex-direction:column;gap:10px;height:100%;box-sizing:border-box;background:#1e1e2e;color:#cdd6f4;">' +
            '<label style="font-size:12px;color:#a6adc8;">Имя файла (расширение .fbmp3 добавится автоматически)<input id="plSaveName" type="text" style="width:100%;margin-top:4px;padding:8px;background:#313244;border:1px solid #45475a;border-radius:5px;color:#cdd6f4;font-family:monospace;"></label>' +
            '<div style="font-size:12px;color:#a6adc8;">Каталог сохранения:</div>' +
            '<div class="wm-fd-pathbar" id="plSavePath" style="padding:6px 10px;background:#232333;border:1px solid #45475a;border-radius:4px;font-family:monospace;font-size:12px;color:#a6e3a1;"></div>' +
            '<div class="wm-fd-list" id="plSaveList" style="flex:1;min-height:0;overflow-y:auto;background:#12121c;border:1px solid #2b2b3c;border-radius:4px;padding:4px;font-family:monospace;font-size:12px;"></div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
            '<button id="plSaveCancel" style="padding:8px 18px;background:#585b70;color:#cdd6f4;border:none;border-radius:5px;cursor:pointer;">Отмена</button>' +
            '<button id="plSaveOk" style="padding:8px 18px;background:#a6e3a1;color:#1e1e2e;border:none;border-radius:5px;cursor:pointer;font-weight:bold;">💾 Сохранить</button>' +
            '</div>' +
            '</div>';

        const nameEl = win.bodyEl.querySelector('#plSaveName');
        const pathEl = win.bodyEl.querySelector('#plSavePath');
        const listEl = win.bodyEl.querySelector('#plSaveList');
        const cancelBtn = win.bodyEl.querySelector('#plSaveCancel');
        const okBtn = win.bodyEl.querySelector('#plSaveOk');

        nameEl.value = (defaultName || 'Playlist').replace(/\.fbmp3$/i, '');
        nameEl.focus();
        nameEl.select();

        const render = function () {
            pathEl.textContent = state.path;
            listEl.innerHTML = '';
            if (FAR.normPath(state.path) !== '') {
                const up = document.createElement('div');
                up.className = 'wm-fd-item';
                up.innerHTML = '<span>⬆</span><span class="wm-fd-name">..</span><span class="wm-fd-size"></span>';
                up.onclick = function () {
                    const cur = FAR.normPath(state.path);
                    const parts = cur.split('/').filter(Boolean);
                    parts.pop();
                    state.path = parts.length ? '/' + parts.join('/') : '/';
                    loadDir();
                };
                listEl.appendChild(up);
            }
            (state.items || []).forEach(function (it) {
                if (!it.isFolder && it.docType !== 'folder') return;
                const row = document.createElement('div');
                row.className = 'wm-fd-item';
                row.innerHTML = '<span>📁</span><span class="wm-fd-name">' + FAR.escapeHtml(it.name) + '</span><span class="wm-fd-size"></span>';
                row.onclick = function () {
                    state.path = '/' + FAR.normPath(it.path);
                    loadDir();
                };
                listEl.appendChild(row);
            });
        };

        const loadDir = async function () {
            listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#6c7086;">Загрузка…</div>';
            try {
                state.items = await FAR.listDirFromSide(state.side, FAR.normPath(state.path), { includeDocs: true });
                render();
            } catch (e) {
                listEl.innerHTML = '<div style="padding:20px;color:#f38ba8;">Ошибка: ' + FAR.escapeHtml(e.message) + '</div>';
            }
        };

        cancelBtn.onclick = function () { resolve(null); FAR.WM.closeWindow(win.id, true); };

        okBtn.onclick = function () {
            const name = (nameEl.value || '').trim();
            if (!name) { FAR.toast('Введите имя', 'warning'); return; }
            const fullName = /\.fbmp3$/i.test(name) ? name : name + '.fbmp3';
            const norm = FAR.normPath(state.path);
            const fullPath = FAR.normPath(norm ? norm + '/' + fullName : fullName);
            resolve(fullPath);
            FAR.WM.closeWindow(win.id, true);
        };

        const onKeyDown = function (e) {
            if (FAR.WM.state.activeWindowId !== win.id) return;
            if (e.key === 'Escape') {
                e.preventDefault(); e.stopPropagation();
                resolve(null); FAR.WM.closeWindow(win.id, true);
            } else if (e.key === 'Enter' && e.target === nameEl) {
                e.preventDefault(); e.stopPropagation();
                okBtn.click();
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        win.onClose = function () {
            document.removeEventListener('keydown', onKeyDown, true);
        };

        loadDir();
    });
};

// ------------------------------------------------------------
// Финализация плеера
// ------------------------------------------------------------

FAR.WM._finalizeMp3Player = function (win) {
    if (!win || !win.props) return;
    const S = win.props._mp3State;
    if (S) {
        if (S.audio) {
            try {
                S.audio.pause();
                S.audio.removeAttribute('src');
                S.audio.load();
            } catch (e) {}
            S.audio = null;
        }
        if (S.rafId) {
            try { cancelAnimationFrame(S.rafId); } catch (e) {}
            S.rafId = null;
        }
        if (S.visCtx) {
            try { S.visCtx.close(); } catch (e) {}
            S.visCtx = null;
            S.visAnalyser = null;
            S.visSource = null;
        }
        win.props._mp3State = null;
    }
    FAR.WM._finalizeViewer(win);
};

// ------------------------------------------------------------
// Основная функция монтирования плеера
// ------------------------------------------------------------

// ------------------------------------------------------------
// Основная функция монтирования плеера
// ------------------------------------------------------------

FAR.WM._mountMp3Player = async function (win, props) {
    const side = props.side || FAR.activePanel;

    const S = {
        playlist: [],
        currentIdx: -1,
        repeat: true,
        shuffle: false,
        audio: null,
        rafId: null,
        visCtx: null,
        visAnalyser: null,
        visSource: null,
        visBars: [],
        blobUrl: null,
        loadToken: 0,
        selectedIdxs: new Set(),
        anchorIdx: -1
    };

    win.props._audio = null;
    win.props._blobUrls = win.props._blobUrls || [];
    win.props._mp3State = S;

    // ---- Разметка ----
    win.bodyEl.innerHTML =
        '<div style="display:flex;flex-direction:column;height:100%;background:#0a0a0a;color:#cdd6f4;overflow:hidden;">' +
        // Тулбар сверху
        '<div style="display:flex;gap:4px;padding:6px 8px;background:#1a1a2a;border-bottom:1px solid #000;flex-shrink:0;">' +
        '<button data-cmd="add-file" title="Добавить файл в плейлист" style="padding:4px 10px;background:#4a4a5a;color:#cdd6f4;border:1px solid #000;border-radius:3px;cursor:pointer;font-size:11px;">➕ Файл</button>' +
        '<button data-cmd="add-dir" title="Добавить все mp3 из каталога (рекурсивно)" style="padding:4px 10px;background:#4a4a5a;color:#cdd6f4;border:1px solid #000;border-radius:3px;cursor:pointer;font-size:11px;">📁 Каталог</button>' +
        '<span style="flex:1;"></span>' +
        '<button data-cmd="save-pl" title="Сохранить плейлист как .fbmp3 в БД" style="padding:4px 10px;background:#4a8a4a;color:#cdd6f4;border:1px solid #000;border-radius:3px;cursor:pointer;font-size:11px;">💾 Сохранить</button>' +
        '<button data-cmd="load-pl" title="Загрузить .fbmp3 или добавить .mp3" style="padding:4px 10px;background:#4a6a8a;color:#cdd6f4;border:1px solid #000;border-radius:3px;cursor:pointer;font-size:11px;">📂 Загрузить / ➕ mp3</button>' +
        '<button data-cmd="remove-sel" title="Убрать выделенные из списка (Delete)" style="padding:4px 10px;background:#7a5a2a;color:#cdd6f4;border:1px solid #000;border-radius:3px;cursor:pointer;font-size:11px;">🗑️ Из списка</button>' +
        '<button data-cmd="clear-pl" title="Очистить плейлист" style="padding:4px 10px;background:#6a3a3a;color:#cdd6f4;border:1px solid #000;border-radius:3px;cursor:pointer;font-size:11px;">✕ Очистить</button>' +
        '</div>' +
        '<div style="flex:1;min-height:0;display:flex;flex-direction:column;gap:6px;padding:8px;">' +
        // Дисплей
        '<div style="background:#000;border:1px solid #333;border-radius:3px;padding:6px;display:flex;flex-direction:column;gap:4px;flex-shrink:0;">' +
        '<div style="display:flex;gap:8px;align-items:center;font-family:\'Courier New\',monospace;font-weight:bold;font-size:15px;">' +
        '<span id="wmp3Time" style="color:#00ff00;text-shadow:0 0 4px #00ff00;min-width:56px;">00:00</span>' +
        '<span style="flex:1;color:#00aa00;font-size:11px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" id="wmp3Marquee">Плейлист пуст. Используйте кнопки сверху.</span>' +
        '</div>' +
        '<div id="wmp3Vis" style="height:34px;background:#000;border:1px solid #222;display:flex;align-items:flex-end;gap:1px;padding:2px;overflow:hidden;"></div>' +
        '</div>' +
        // Сикбар
        '<div id="wmp3Seek" style="position:relative;height:10px;background:#000;border:1px solid #333;cursor:pointer;flex-shrink:0;">' +
        '<div id="wmp3SeekFill" style="position:absolute;left:0;top:0;bottom:0;width:0%;background:linear-gradient(180deg,#00ff00 0%,#00aa00 100%);"></div>' +
        '<div id="wmp3SeekThumb" style="position:absolute;top:-2px;width:8px;height:12px;background:linear-gradient(180deg,#d0d0d0 0%,#707070 100%);border:1px solid #000;left:0%;transform:translateX(-4px);"></div>' +
        '</div>' +
        // Кнопки
        '<div style="display:flex;gap:3px;flex-shrink:0;">' +
        '<button data-cmd="prev" style="flex:1;height:26px;background:linear-gradient(180deg,#4a4a5a,#2a2a3a);color:#d0d0d0;border:1px solid #000;cursor:pointer;font-size:12px;">⏮</button>' +
        '<button data-cmd="rew" style="flex:1;height:26px;background:linear-gradient(180deg,#4a4a5a,#2a2a3a);color:#d0d0d0;border:1px solid #000;cursor:pointer;font-size:12px;">◀◀</button>' +
        '<button data-cmd="play" id="wmp3BtnPlay" style="flex:1;height:26px;background:linear-gradient(180deg,#3a6a3a,#1a4a1a);color:#80ff80;border:1px solid #000;cursor:pointer;font-size:14px;">▶</button>' +
        '<button data-cmd="stop" style="flex:1;height:26px;background:linear-gradient(180deg,#4a4a5a,#2a2a3a);color:#d0d0d0;border:1px solid #000;cursor:pointer;font-size:12px;">■</button>' +
        '<button data-cmd="fwd" style="flex:1;height:26px;background:linear-gradient(180deg,#4a4a5a,#2a2a3a);color:#d0d0d0;border:1px solid #000;cursor:pointer;font-size:12px;">▶▶</button>' +
        '<button data-cmd="next" style="flex:1;height:26px;background:linear-gradient(180deg,#4a4a5a,#2a2a3a);color:#d0d0d0;border:1px solid #000;cursor:pointer;font-size:12px;">⏭</button>' +
        '</div>' +
        // Режимы + громкость
        '<div style="display:flex;gap:6px;flex-shrink:0;align-items:center;">' +
        '<button data-cmd="repeat" id="wmp3BtnRepeat" style="padding:3px 8px;background:linear-gradient(180deg,#3a3a4a,#1a1a2a);color:#6a6a8a;border:1px solid #000;font-size:10px;font-weight:bold;cursor:pointer;">🔁 REPEAT</button>' +
        '<button data-cmd="shuffle" id="wmp3BtnShuffle" style="padding:3px 8px;background:linear-gradient(180deg,#3a3a4a,#1a1a2a);color:#6a6a8a;border:1px solid #000;font-size:10px;font-weight:bold;cursor:pointer;">🔀 SHUFFLE</button>' +
        '<span style="flex:1;"></span>' +
        '<label style="font-size:10px;color:#80a0c0;font-weight:bold;">VOL</label>' +
        '<input type="range" min="0" max="100" value="80" id="wmp3Vol" style="width:100px;">' +
        '</div>' +
        // Плейлист
        '<div style="flex:1;min-height:100px;display:flex;flex-direction:column;background:#1a1a1a;border:1px solid #000;border-radius:3px;overflow:hidden;">' +
        '<div style="background:linear-gradient(180deg,#3a3a5a,#1a1a3a);padding:3px 8px;font-size:10px;font-weight:bold;color:#a0a0d0;letter-spacing:2px;border-bottom:1px solid #000;">PLAYLIST</div>' +
        '<div id="wmp3Playlist" style="flex:1;overflow-y:auto;background:#000;font-family:\'Courier New\',monospace;font-size:12px;color:#00cc00;padding:2px 0;"></div>' +
        '<div id="wmp3PlInfo" style="background:#1a1a1a;border-top:1px solid #333;padding:3px 8px;font-size:10px;color:#8080a0;font-family:\'Courier New\',monospace;">0 треков</div>' +
        '</div>' +
        '</div>' +
        '</div>';

    const timeEl = win.bodyEl.querySelector('#wmp3Time');
    const marqueeEl = win.bodyEl.querySelector('#wmp3Marquee');
    const visEl = win.bodyEl.querySelector('#wmp3Vis');
    const seekEl = win.bodyEl.querySelector('#wmp3Seek');
    const seekFillEl = win.bodyEl.querySelector('#wmp3SeekFill');
    const seekThumbEl = win.bodyEl.querySelector('#wmp3SeekThumb');
    const btnPlayEl = win.bodyEl.querySelector('#wmp3BtnPlay');
    const btnRepeatEl = win.bodyEl.querySelector('#wmp3BtnRepeat');
    const btnShuffleEl = win.bodyEl.querySelector('#wmp3BtnShuffle');
    const volEl = win.bodyEl.querySelector('#wmp3Vol');
    const plEl = win.bodyEl.querySelector('#wmp3Playlist');
    const plInfoEl = win.bodyEl.querySelector('#wmp3PlInfo');

    const N = 40;
    for (let i = 0; i < N; i++) {
        const b = document.createElement('div');
        b.style.cssText = 'flex:1;background:linear-gradient(180deg,#00ff00 0%,#00aa00 50%,#ff0000 100%);height:0%;min-width:2px;transition:height 0.05s linear;';
        visEl.appendChild(b);
        S.visBars.push(b);
    }

    // ---- Утилиты ----
    const formatTime = function (sec) {
        if (!isFinite(sec) || sec < 0) sec = 0;
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    };

    const updatePlayBtn = function () {
        if (!S.audio) return;
        btnPlayEl.textContent = S.audio.paused ? '▶' : '⏸';
    };

    const updateModeButtons = function () {
        btnRepeatEl.style.color = S.repeat ? '#a0ffa0' : '#6a6a8a';
        btnRepeatEl.style.background = S.repeat
            ? 'linear-gradient(180deg,#4a8a4a,#1a5a1a)'
            : 'linear-gradient(180deg,#3a3a4a,#1a1a2a)';
        btnShuffleEl.style.color = S.shuffle ? '#a0ffa0' : '#6a6a8a';
        btnShuffleEl.style.background = S.shuffle
            ? 'linear-gradient(180deg,#4a8a4a,#1a5a1a)'
            : 'linear-gradient(180deg,#3a3a4a,#1a1a2a)';
    };

    // ---- Аудио ----
    const ensureAudio = function () {
        if (S.audio) return S.audio;
        const a = new Audio();
        a.preload = 'auto';
        a.setAttribute('playsinline', '');
        a.addEventListener('timeupdate', onTimeUpdate);
        a.addEventListener('loadedmetadata', onLoadedMetadata);
        a.addEventListener('ended', onEnded);
        a.addEventListener('play', updatePlayBtn);
        a.addEventListener('pause', updatePlayBtn);
        S.audio = a;
        win.props._audio = a;
        return a;
    };

    const loadTrack = async function (idx) {
        if (idx < 0 || idx >= S.playlist.length) return;
        S.currentIdx = idx;
        const entry = S.playlist[idx];
        if (!entry) return;

        const myToken = ++S.loadToken;

        const a = ensureAudio();
        try { a.pause(); } catch (e) {}
        try { a.removeAttribute('src'); a.load(); } catch (e) {}
        if (S.blobUrl) {
            try { URL.revokeObjectURL(S.blobUrl); } catch (e) {}
            S.blobUrl = null;
        }

        marqueeEl.textContent = 'Загрузка: ' + entry.name;

        try {
            const r = await FAR.WM._mp3ReadFileBody(side, entry.path);
            if (myToken !== S.loadToken) return;
            const blob = new Blob([r.data], { type: r.contentType || 'audio/mpeg' });
            const url = URL.createObjectURL(blob);
            S.blobUrl = url;
            win.props._blobUrls.push(url);

            a.src = url;
            try { a.load(); } catch (e) {}

            marqueeEl.textContent = entry.name + '  •  ' + FAR.formatSize(r.data.length);
            renderPlaylist();

            try {
                await a.play();
                if (myToken !== S.loadToken) return;
                updatePlayBtn();
                startVisualizer();
            } catch (e) {
                if (e && e.name === 'AbortError') return;
                updatePlayBtn();
            }
        } catch (e) {
            console.error('[WM mp3] loadTrack:', e);
            marqueeEl.textContent = 'Ошибка: ' + e.message;
            FAR.toast('Не удалось загрузить: ' + e.message, 'error');
        }
    };

    const onTimeUpdate = function () {
        if (!S.audio) return;
        const cur = S.audio.currentTime || 0;
        const dur = S.audio.duration || 0;
        const pct = dur > 0 ? (cur / dur) * 100 : 0;
        timeEl.textContent = formatTime(cur);
        seekFillEl.style.width = pct + '%';
        seekThumbEl.style.left = pct + '%';
    };

    const onLoadedMetadata = function () {
        if (!S.audio) return;
        const dur = S.audio.duration;
        if (S.currentIdx >= 0 && S.playlist[S.currentIdx]) {
            S.playlist[S.currentIdx].dur = formatTime(dur);
            renderPlaylist();
        }
    };

    const onEnded = function () {
        if (S.playlist.length === 0) return;
        if (S.shuffle) {
            let idx;
            do { idx = Math.floor(Math.random() * S.playlist.length); }
            while (idx === S.currentIdx && S.playlist.length > 1);
            loadTrack(idx);
            return;
        }
        if (S.currentIdx < S.playlist.length - 1) {
            loadTrack(S.currentIdx + 1);
        } else if (S.repeat) {
            loadTrack(0);
        } else {
            try { S.audio.pause(); } catch (e) {}
            updatePlayBtn();
            stopVisualizer();
        }
    };

    // ---- Визуализатор ----
    const startVisualizer = function () {
        if (S.rafId) return;
        if (!S.audio) return;

        if (!S.visCtx) {
            try {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                S.visCtx = new Ctx();
                S.visAnalyser = S.visCtx.createAnalyser();
                S.visAnalyser.fftSize = 128;
                S.visSource = S.visCtx.createMediaElementSource(S.audio);
                S.visSource.connect(S.visAnalyser);
                S.visAnalyser.connect(S.visCtx.destination);
            } catch (e) {
                console.warn('AudioContext not available:', e);
                S.visCtx = null;
                return;
            }
        }
        if (S.visCtx.state === 'suspended') {
            S.visCtx.resume().catch(function () {});
        }

        const data = new Uint8Array(S.visAnalyser.frequencyBinCount);

        const loop = function () {
            if (!S.audio || S.audio.paused) {
                S.rafId = null;
                S.visBars.forEach(b => b.style.height = '0%');
                return;
            }
            S.visAnalyser.getByteFrequencyData(data);
            for (let i = 0; i < N; i++) {
                const idx = Math.floor((i / N) * data.length);
                const v = data[idx] / 255;
                S.visBars[i].style.height = (v * 100) + '%';
            }
            S.rafId = requestAnimationFrame(loop);
        };
        S.rafId = requestAnimationFrame(loop);
    };

    const stopVisualizer = function () {
        if (S.rafId) { cancelAnimationFrame(S.rafId); S.rafId = null; }
        S.visBars.forEach(b => b.style.height = '0%');
    };

    // ---- Рендер плейлиста с drag&drop ----
    let dragSrcIdxs = [];

    const renderPlaylist = function () {
        plEl.innerHTML = '';

        if (S.playlist.length === 0) {
            plEl.innerHTML = '<div style="padding:10px;color:#666;text-align:center;">Плейлист пуст</div>';
            plInfoEl.textContent = '0 треков';
            return;
        }

        S.playlist.forEach(function (entry, idx) {
            const row = document.createElement('div');
            const isCurrent = idx === S.currentIdx;
            const isSel = S.selectedIdxs.has(idx);
            row.draggable = true;
            row.dataset.idx = String(idx);
            row.style.cssText =
                'display:flex;padding:2px 8px;cursor:pointer;white-space:nowrap;overflow:hidden;line-height:16px;' +
                (isCurrent ? 'background:#003300;color:#00ff00;' : '') +
                (isSel ? 'background:#0a2a3a;outline:1px solid #4aa3ff;outline-offset:-1px;' : '');

            row.innerHTML =
                '<span style="color:#808080;min-width:30px;text-align:right;padding-right:8px;">' + (idx + 1) + '.</span>' +
                '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;">' + FAR.escapeHtml(entry.name) + '</span>' +
                '<span style="color:#808080;padding-left:8px;">' + (entry.dur || '--:--') + '</span>';

            row.onclick = function (e) {
                if (e.shiftKey && S.anchorIdx >= 0) {
                    S.selectedIdxs.clear();
                    const a = Math.min(S.anchorIdx, idx);
                    const b = Math.max(S.anchorIdx, idx);
                    for (let i = a; i <= b; i++) S.selectedIdxs.add(i);
                } else if (e.ctrlKey || e.metaKey) {
                    if (S.selectedIdxs.has(idx)) S.selectedIdxs.delete(idx);
                    else S.selectedIdxs.add(idx);
                    S.anchorIdx = idx;
                } else {
                    S.selectedIdxs.clear();
                    S.selectedIdxs.add(idx);
                    S.anchorIdx = idx;
                }
                renderPlaylist();
            };

            row.ondblclick = function () { loadTrack(idx); };

            row.addEventListener('dragstart', function (e) {
                if (!S.selectedIdxs.has(idx)) {
                    S.selectedIdxs.clear();
                    S.selectedIdxs.add(idx);
                    S.anchorIdx = idx;
                    renderPlaylist();
                }
                dragSrcIdxs = Array.from(S.selectedIdxs).sort(function (a, b) { return a - b; });
                try {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', 'wm3-move');
                } catch (err) {}
            });

            row.addEventListener('dragover', function (e) {
                e.preventDefault();
                try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
                row.style.borderTop = '2px solid #4aa3ff';
            });

            row.addEventListener('dragleave', function () {
                row.style.borderTop = '';
            });

            row.addEventListener('drop', function (e) {
                e.preventDefault();
                row.style.borderTop = '';

                const fromIdxs = dragSrcIdxs.slice();
                if (fromIdxs.length === 0) return;
                if (fromIdxs.indexOf(idx) >= 0) return;

                const insertBefore = idx;
                const moved = fromIdxs.map(function (i) { return S.playlist[i]; });

                for (let i = fromIdxs.length - 1; i >= 0; i--) {
                    S.playlist.splice(fromIdxs[i], 1);
                }
                let adjustedInsert = insertBefore;
                for (const i of fromIdxs) {
                    if (i < insertBefore) adjustedInsert--;
                }
                S.playlist.splice.apply(S.playlist, [adjustedInsert, 0].concat(moved));

                if (S.currentIdx >= 0) {
                    if (fromIdxs.indexOf(S.currentIdx) >= 0) {
                        const posInMoved = fromIdxs.indexOf(S.currentIdx);
                        S.currentIdx = adjustedInsert + posInMoved;
                    } else {
                        let shift = 0;
                        for (const i of fromIdxs) {
                            if (i < S.currentIdx) shift--;
                        }
                        let newIdx = S.currentIdx + shift;
                        if (newIdx >= adjustedInsert) newIdx += moved.length;
                        S.currentIdx = newIdx;
                    }
                }

                S.selectedIdxs.clear();
                for (let i = 0; i < moved.length; i++) S.selectedIdxs.add(adjustedInsert + i);
                S.anchorIdx = adjustedInsert;

                renderPlaylist();
            });

            plEl.appendChild(row);
        });

        plInfoEl.textContent = S.playlist.length + ' треков' +
            (S.currentIdx >= 0 ? ' • играет #' + (S.currentIdx + 1) : '');
    };

    // ---- Операции с плейлистом ----
    const addTrackByPath = function (path, name) {
        const norm = FAR.normPath(path);
        if (!norm) return false;
        S.playlist.push({
            path: norm,
            name: name || norm.split('/').pop(),
            dur: '--:--'
        });
        return true;
    };

    const addFileDialog = async function () {
        const picked = await FAR.WM.openFileDialog({
            parentId: win.id,
            title: 'Добавить mp3 в плейлист',
            side: side
        });
        if (!picked) return;
        if (!FAR.isMp3(picked)) {
            FAR.toast('Выбранный файл — не аудио', 'warning');
            return;
        }
        addTrackByPath(picked.path, picked.name);
        renderPlaylist();
        FAR.toast('Добавлено: ' + picked.name, 'success');
    };

    const addDirDialog = async function () {
        const dir = await FAR.WM.pickFolder(side);
        if (!dir) return;

        FAR.toast('Сканирование каталога…', 'info');
        const files = await FAR.WM._mp3ScanDir(side, dir);
        if (files.length === 0) {
            FAR.toast('В каталоге нет mp3', 'warning');
            return;
        }
        let added = 0;
        for (const f of files) {
            if (addTrackByPath(f.path, f.name)) added++;
        }
        renderPlaylist();
        FAR.toast('Добавлено: ' + added + ' из ' + files.length, 'success');
    };

    const savePlaylist = async function () {
        if (S.playlist.length === 0) {
            FAR.toast('Плейлист пуст', 'warning');
            return;
        }

        const targetPath = await FAR.WM.savePlaylistDialog(side, 'Playlist');
        if (!targetPath) return;

        const payload = {
            type: 'fbmp3',
            version: 1,
            savedAt: new Date().toISOString(),
            tracks: S.playlist.map(function (e) { return FAR.normPath(e.path); })
        };
        const json = JSON.stringify(payload, null, 2);

        try {
            const blob = new Blob([json], { type: 'application/json' });
            const docId = 'f:' + encodeURIComponent(targetPath);
            const ctx = FAR.side[side];

            let rev = null;
            try {
                const ex = await ctx.db.get(docId);
                rev = ex._rev;
            } catch (e) { if (e.status !== 404) throw e; }

            const doc = {
                _id: docId,
                type: 'file',
                path: targetPath,
                name: targetPath.split('/').pop(),
                size: blob.size,
                mtime: Date.now(),
                binary: false,
                contentType: 'application/json'
            };
            if (rev) doc._rev = rev;
            await ctx.db.put(doc);
            const fresh = await ctx.db.get(docId);
            await ctx.db.putAttachment(docId, 'b', fresh._rev, blob, 'application/json');

            FAR.toast('Плейлист сохранён: ' + targetPath, 'success');

            try { await FAR.reloadPanel(side); } catch (e) {}
            try { FAR.renderPanel(side); } catch (e) {}
        } catch (e) {
            console.error('[WM mp3] save playlist:', e);
            FAR.toast('Ошибка сохранения: ' + e.message, 'error');
        }
    };

    const loadPlaylistFromPath = async function (path) {
        try {
            const r = await FAR.WM._mp3ReadFileBody(side, path);
            const text = new TextDecoder('utf-8').decode(r.data);
            const data = JSON.parse(text);

            let tracks = [];
            if (data && Array.isArray(data.tracks)) tracks = data.tracks;
            else if (Array.isArray(data)) tracks = data;
            else throw new Error('Файл не является плейлистом');

            // ---- 1. Заменяем плейлист содержимым .fbmp3 ----
            S.playlist = [];
            S.currentIdx = -1;
            S.selectedIdxs.clear();
            S.anchorIdx = -1;

            if (S.audio) {
                try {
                    S.audio.pause();
                    S.audio.removeAttribute('src');
                    S.audio.load();
                } catch (e) { /* ignore */ }
            }
            if (S.blobUrl) {
                try { URL.revokeObjectURL(S.blobUrl); } catch (e) {}
                S.blobUrl = null;
            }
            stopVisualizer();

            for (const t of tracks) {
                if (typeof t === 'string') {
                    addTrackByPath(t, t.split('/').pop());
                } else if (t && typeof t === 'object' && t.path) {
                    addTrackByPath(t.path, t.name || t.path.split('/').pop());
                }
            }

            const loadedFromFile = S.playlist.length;

            const folders = new Set();
            for (const e of S.playlist) {
                const norm = FAR.normPath(e.path);
                const slash = norm.lastIndexOf('/');
                const dir = slash === -1 ? '' : norm.substring(0, slash);
                folders.add(dir);
            }

            let added = 0;
            const foldersArr = Array.from(folders);

            for (const dir of foldersArr) {
                try {
                    const files = await FAR.WM._mp3ScanDir(side, dir);
                    for (const f of files) {
                        if (addTrackByPath(f.path, f.name)) added++;
                    }
                } catch (e) {
                    console.warn('[WM mp3] scan folder failed:', dir, e);
                }
            }

            renderPlaylist();

            let msg = 'Загружено треков: ' + loadedFromFile;
            if (added > 0) {
                msg += '  •  добавлено новых: ' + added;
            }
            FAR.toast(msg, 'success');
            marqueeEl.textContent = msg;

            if (S.playlist.length > 0) {
                loadTrack(0);
            }
        } catch (e) {
            console.error('[WM mp3] load playlist:', e);
            FAR.toast('Ошибка загрузки плейлиста: ' + e.message, 'error');
        }
    };

    const loadPlaylistDialog = async function () {
        const picked = await FAR.WM.openFileDialogMulti({
            parentId: win.id,
            title: 'Выбрать файлы (.mp3 / .fbmp3)',
            side: side
        });
        if (!picked || picked.length === 0) return;

        let totalAdded = 0;
        let playlistsExpanded = 0;
        let skipped = 0;
        let errors = 0;

        for (const item of picked) {
            if (FAR.WM.isFbmp3(item)) {
                try {
                    const r = await FAR.WM._mp3ReadFileBody(side, item.path);
                    const text = new TextDecoder('utf-8').decode(r.data);
                    const data = JSON.parse(text);

                    let tracks = [];
                    if (data && Array.isArray(data.tracks)) tracks = data.tracks;
                    else if (Array.isArray(data)) tracks = data;
                    else throw new Error('файл не является плейлистом');

                    for (const t of tracks) {
                        if (typeof t === 'string') {
                            addTrackByPath(t, t.split('/').pop());
                            totalAdded++;
                        } else if (t && typeof t === 'object' && t.path) {
                            addTrackByPath(t.path, t.name || t.path.split('/').pop());
                            totalAdded++;
                        }
                    }
                    playlistsExpanded++;
                } catch (e) {
                    console.warn('[WM mp3] expand playlist failed:', item.path, e);
                    FAR.toast('Не удалось прочитать ' + item.name + ': ' + e.message, 'error');
                    errors++;
                }
                continue;
            }

            if (FAR.isMp3(item)) {
                addTrackByPath(item.path, item.name);
                totalAdded++;
                continue;
            }

            skipped++;
        }

        renderPlaylist();

        let msg = 'Добавлено треков: ' + totalAdded;
        const parts = [];
        if (playlistsExpanded > 0) parts.push('плейлистов: ' + playlistsExpanded);
        if (skipped > 0) parts.push('пропущено: ' + skipped);
        if (errors > 0) parts.push('ошибок: ' + errors);
        if (parts.length) msg += ' (' + parts.join(', ') + ')';

        FAR.toast(msg, totalAdded > 0 ? 'success' : 'warning');
        marqueeEl.textContent = msg;

        const isPlaying = S.audio && !S.audio.paused;
        if (!isPlaying && S.playlist.length > 0 && S.currentIdx < 0) {
            loadTrack(0);
        }
    };

    // ------------------------------------------------------------
    // Убрать выделенные треки ИЗ СПИСКА (не из БД!)
    // ------------------------------------------------------------
    // Если среди удаляемых был текущий трек — останавливаем
    // воспроизведение и сбрасываем currentIdx = -1.
    const removeSelectedFromList = function () {
        if (S.selectedIdxs.size === 0) {
            FAR.toast('Ничего не выделено', 'info');
            return;
        }

        const toRemove = Array.from(S.selectedIdxs).sort(function (a, b) { return a - b; });
        const removeSet = new Set(toRemove);

        const currentRemoved = S.currentIdx >= 0 && removeSet.has(S.currentIdx);

        let shiftBeforeCurrent = 0;
        if (S.currentIdx >= 0) {
            for (const i of toRemove) {
                if (i < S.currentIdx) shiftBeforeCurrent++;
            }
        }

        const newList = [];
        for (let i = 0; i < S.playlist.length; i++) {
            if (removeSet.has(i)) continue;
            newList.push(S.playlist[i]);
        }

        S.playlist = newList;
        S.selectedIdxs.clear();
        S.anchorIdx = -1;

        if (currentRemoved) {
            S.currentIdx = -1;
            if (S.audio) {
                try { S.audio.pause(); } catch (e) {}
                try {
                    S.audio.removeAttribute('src');
                    S.audio.load();
                } catch (e) {}
            }
            if (S.blobUrl) {
                try { URL.revokeObjectURL(S.blobUrl); } catch (e) {}
                S.blobUrl = null;
            }
            stopVisualizer();
            updatePlayBtn();
            timeEl.textContent = '00:00';
            seekFillEl.style.width = '0%';
            seekThumbEl.style.left = '0%';
            marqueeEl.textContent = 'Воспроизведение остановлено';
        } else if (S.currentIdx >= 0) {
            S.currentIdx -= shiftBeforeCurrent;
        }

        renderPlaylist();
        FAR.toast('Убрано из списка: ' + toRemove.length, 'success');
    };

    // ---- Обработчики кнопок ----
    win.bodyEl.addEventListener('click', async function (e) {
        const btn = e.target.closest('[data-cmd]');
        if (!btn) return;
        const cmd = btn.dataset.cmd;
        switch (cmd) {
            case 'add-file': await addFileDialog(); break;
            case 'add-dir':  await addDirDialog();  break;
            case 'save-pl':  await savePlaylist();  break;
            case 'load-pl':  await loadPlaylistDialog(); break;
            case 'remove-sel':
                removeSelectedFromList();
                break;
            case 'clear-pl':
                S.playlist = [];
                S.currentIdx = -1;
                S.selectedIdxs.clear();
                S.anchorIdx = -1;
                if (S.audio) {
                    try { S.audio.pause(); S.audio.removeAttribute('src'); S.audio.load(); } catch (er) {}
                }
                renderPlaylist();
                marqueeEl.textContent = 'Плейлист очищен';
                break;
            case 'play':
                if (!S.audio) { if (S.playlist.length) loadTrack(0); break; }
                if (S.audio.paused) {
                    try { await S.audio.play(); startVisualizer(); } catch (er) {}
                } else {
                    S.audio.pause();
                }
                updatePlayBtn();
                break;
            case 'stop':
                if (S.audio) { S.audio.pause(); S.audio.currentTime = 0; }
                updatePlayBtn(); stopVisualizer();
                break;
            case 'rew':
                if (S.audio) S.audio.currentTime = Math.max(0, S.audio.currentTime - 5);
                break;
            case 'fwd':
                if (S.audio) S.audio.currentTime = Math.min(S.audio.duration || 0, S.audio.currentTime + 5);
                break;
            case 'prev':
                if (S.playlist.length === 0) break;
                if (S.shuffle) {
                    let i;
                    do { i = Math.floor(Math.random() * S.playlist.length); }
                    while (i === S.currentIdx && S.playlist.length > 1);
                    loadTrack(i);
                } else if (S.currentIdx > 0) {
                    loadTrack(S.currentIdx - 1);
                } else if (S.repeat) {
                    loadTrack(S.playlist.length - 1);
                }
                break;
            case 'next':
                if (S.playlist.length === 0) break;
                if (S.shuffle) {
                    let i;
                    do { i = Math.floor(Math.random() * S.playlist.length); }
                    while (i === S.currentIdx && S.playlist.length > 1);
                    loadTrack(i);
                } else if (S.currentIdx < S.playlist.length - 1) {
                    loadTrack(S.currentIdx + 1);
                } else if (S.repeat) {
                    loadTrack(0);
                }
                break;
            case 'repeat':
                S.repeat = !S.repeat;
                updateModeButtons();
                break;
            case 'shuffle':
                S.shuffle = !S.shuffle;
                updateModeButtons();
                break;
        }
    });

    volEl.addEventListener('input', function () {
        if (S.audio) S.audio.volume = Math.max(0, Math.min(1, Number(volEl.value) / 100));
    });

    seekEl.addEventListener('click', function (e) {
        if (!S.audio || !S.audio.duration) return;
        const rect = seekEl.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        S.audio.currentTime = pct * S.audio.duration;
    });

    // ------------------------------------------------------------
    // Клавиатура: Delete — убрать выделенные из списка
    // ------------------------------------------------------------
    // Capture-фаза, чтобы обогнать глобальный 22-keyboard.js
    // (там Delete = FAR.deleteSelected для панелей).
    const onKeyDownMp3 = function (e) {
        if (FAR.WM.state.activeWindowId !== win.id) return;
        if (!FAR.WM.getWindow(win.id)) {
            document.removeEventListener('keydown', onKeyDownMp3, true);
            return;
        }

        const t = e.target;
        const tag = (t && t.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;

        // Delete — убрать выделенные из списка
        if (e.key === 'Delete') {
            if (S.selectedIdxs.size === 0) return;
            e.preventDefault();
            e.stopPropagation();
            removeSelectedFromList();
            return;
        }

        // Ctrl+A — выделить все треки в плейлисте
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
            e.preventDefault();
            e.stopPropagation();
            S.selectedIdxs.clear();
            for (let i = 0; i < S.playlist.length; i++) S.selectedIdxs.add(i);
            S.anchorIdx = 0;
            renderPlaylist();
            return;
        }
    };
    document.addEventListener('keydown', onKeyDownMp3, true);

    // Снимаем обработчик при закрытии окна
    const prevOnClose = win.onClose;
    win.onClose = function (w) {
        try { document.removeEventListener('keydown', onKeyDownMp3, true); } catch (e) {}
        if (typeof prevOnClose === 'function') {
            try { prevOnClose(w); } catch (e) {}
        }
    };

    // ------------------------------------------------------------
    // Публичный API плеера (для onReopen и внешних вызовов)
    // ------------------------------------------------------------
    win.props._mp3Api = {
        openFileAndPlay: async function (fileItem) {
            if (!fileItem) return;
            const filePath = FAR.normPath(fileItem.path);
            if (!filePath) return;

            const startLen = S.playlist.length;

            // Если файл УЖЕ есть в плейлисте — считаем это
            // повторным открытием и добавляем ТОЛЬКО сам файл
            // (получается дубликат). Если файла ещё нет — первое
            // открытие: добавляем все mp3 из папки + сам файл.
            const alreadyInList = S.playlist.some(function (e) {
                return FAR.normPath(e.path) === filePath;
            });

            if (!alreadyInList) {
                const dir = filePath.includes('/')
                    ? filePath.substring(0, filePath.lastIndexOf('/'))
                    : '';
                try {
                    const children = await FAR.listDirFromSide(side, dir, { includeDocs: true });
                    for (const it of children) {
                        if (!it.isFolder && FAR.isMp3(it)) {
                            addTrackByPath(it.path, it.name);
                        }
                    }
                } catch (e) { /* ignore */ }
            } else {
                // Дубликат: добавляем только сам файл
                addTrackByPath(filePath, fileItem.name || filePath.split('/').pop());
            }

            // На всякий случай: если файл не попал ни из папки,
            // ни явно — добавляем.
            let found = false;
            for (let i = startLen; i < S.playlist.length; i++) {
                if (FAR.normPath(S.playlist[i].path) === filePath) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                addTrackByPath(filePath, fileItem.name || filePath.split('/').pop());
            }

            renderPlaylist();

            // Играем последний добавленный экземпляр файла
            let idx = -1;
            for (let i = S.playlist.length - 1; i >= startLen; i--) {
                if (FAR.normPath(S.playlist[i].path) === filePath) {
                    idx = i;
                    break;
                }
            }
            if (idx >= 0) loadTrack(idx);
        },

        loadPlaylistFromPath: function (path) {
            return loadPlaylistFromPath(path);
        },

        addFile: function (fileItem) {
            if (!fileItem) return false;
            const ok = addTrackByPath(
                fileItem.path,
                fileItem.name || (fileItem.path || '').split('/').pop()
            );
            renderPlaylist();
            return ok;
        }
    };

    updateModeButtons();

    // ---- Стартовая загрузка ----
    if (props.playlistPath) {
        await loadPlaylistFromPath(props.playlistPath);
    } else if (props.file && FAR.WM.isFbmp3(props.file)) {
        await loadPlaylistFromPath(props.file.path);
    } else if (props.file && FAR.isMp3(props.file)) {
        // Первое открытие плеера с mp3-файлом:
        // добавляем все mp3 из папки и запускаем выбранный.
        const dir = FAR.normPath(props.file.path).includes('/')
            ? FAR.normPath(props.file.path).substring(0, FAR.normPath(props.file.path).lastIndexOf('/'))
            : '';
        try {
            const children = await FAR.listDirFromSide(side, dir, { includeDocs: true });
            for (const it of children) {
                if (!it.isFolder && FAR.isMp3(it)) {
                    addTrackByPath(it.path, it.name);
                }
            }
        } catch (e) { /* ignore */ }

        // Страховка: если файл не попал из папки — добавляем явно
        let curIdx = -1;
        for (let i = 0; i < S.playlist.length; i++) {
            if (FAR.normPath(S.playlist[i].path) === FAR.normPath(props.file.path)) {
                curIdx = i;
                break;
            }
        }
        if (curIdx < 0) {
            addTrackByPath(props.file.path, props.file.name);
            curIdx = S.playlist.length - 1;
        }

        renderPlaylist();
        if (curIdx >= 0) loadTrack(curIdx);
    } else {
        renderPlaylist();
    }

    renderPlaylist();
};

FAR.WM.registerApp({
    id: 'mp3',
    title: 'MP3-плеер',
    icon: '🎵',
    keywords: 'музыка mp3 audio плеер playlist плейлист fbmp3',
    singleton: true,
    width: 950,
    height: 720,

    open: async function (win, props) {
        await FAR.WM._mountMp3Player(win, props);
    },

    onClose: function (win) {
        FAR.WM._finalizeMp3Player(win);
    },

    /**
     * Вызывается, когда плеер УЖЕ открыт, а пользователь
     * пытается открыть в нём новый файл через Проводник.
     * Singleton-логика openApp не создаёт новое окно — она
     * вызывает onReopen с новыми props. Здесь мы решаем,
     * что делать: добавить трек, загрузить плейлист и т.п.
     */
    onReopen: function (win, newProps) {
        const api = win.props && win.props._mp3Api;
        if (!api) return;

        if (newProps.playlistPath) {
            // Открыли .fbmp3 — загружаем плейлист
            api.loadPlaylistFromPath(newProps.playlistPath);
        } else if (newProps.file) {
            if (typeof FAR.WM.isFbmp3 === 'function' && FAR.WM.isFbmp3(newProps.file)) {
                api.loadPlaylistFromPath(newProps.file.path);
            } else if (typeof FAR.isMp3 === 'function' && FAR.isMp3(newProps.file)) {
                // Открыли .mp3 — добавляем в плейлист и играем
                api.openFileAndPlay(newProps.file);
            }
        }
    }
});
