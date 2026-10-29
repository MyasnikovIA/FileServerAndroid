// ============================================================
// MP3-плеер в стиле Winamp (36-mp3-viewer.js)
// ============================================================
//
// Воспроизводит аудиофайлы из FileBD через HTML5 <audio>.
// Внешний вид — стилизованное окно Winamp 2.x:
//   • основное окно с дисплеем, визуализатором, кнопками;
//   • плейлист всех mp3-файлов ТЕКУЩЕЙ папки;
//   • режимы REPEAT / SHUFFLE.
//
// ВАЖНО: этот модуль не заменяет существующие просмотрщики —
// он добавляется в openFile() как ещё одна ветка (36-mp3-viewer).
//
// Эквалайзер удалён.
// ============================================================

// ==== Состояние ====
FAR._mp3Audio       = null;     // HTMLAudioElement
FAR._mp3CurrentItem = null;     // fileIndex-элемент
FAR._mp3CurrentSide = null;     // 'left' | 'right'
FAR._mp3BlobUrl     = null;     // текущий blob URL для revoke
FAR._mp3Playlist    = [];       // [{ item, name, dur }]
FAR._mp3PlaylistIdx = -1;
FAR._mp3RafId       = null;
FAR._mp3VisBars     = [];       // DOM-узлы для баров визуализатора
FAR._mp3VisCtx      = null;     // AudioContext
FAR._mp3VisAnalyser = null;     // AnalyserNode
FAR._mp3VisSource   = null;     // MediaElementSource

// ==== Режимы воспроизведения ====
FAR._mp3Repeat  = true;    // повтор плейлиста включён по умолчанию
FAR._mp3Shuffle = false;   // случайный порядок выключен по умолчанию

// ==== Защита от гонок при переключении треков ====
FAR._mp3LoadToken = 0;

// ============================================================
// Проверка: является ли файл MP3 / аудио
// ============================================================

FAR.MP3_EXTS = ['mp3', 'm4a', 'ogg', 'wav', 'flac', 'aac', 'opus'];

FAR.isMp3 = function (item) {
    if (!item || item.isFolder) return false;

    const name = item.name || item.path || '';
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (FAR.MP3_EXTS.indexOf(ext) !== -1) return true;

    const ct = (item.contentType || '').toLowerCase();
    if (ct.indexOf('audio/') === 0) return true;

    return false;
};

// ============================================================
// Открытие / закрытие
// ============================================================

FAR.openMp3Viewer = async function (item, side) {
    side = side || FAR.activePanel;

    if (!FAR.ensureDb()) return;
    if (typeof FAR._ensureItemName === 'function') FAR._ensureItemName(item);

    // Закрываем другие модалки-просмотрщики
    try { FAR.closeViewer(); } catch (e) {}
    try { FAR.closePanoramaViewer(); } catch (e) {}
    try { if (typeof FAR.closeJsdosViewer    === 'function') FAR.closeJsdosViewer();    } catch (e) {}
    try { if (typeof FAR.closeNesViewer      === 'function') FAR.closeNesViewer();      } catch (e) {}
    try { if (typeof FAR.closeEmulatorViewer === 'function') FAR.closeEmulatorViewer(); } catch (e) {}
    try { if (typeof FAR.closePdfViewer      === 'function') FAR.closePdfViewer();      } catch (e) {}

    FAR._mp3CurrentItem = item;
    FAR._mp3CurrentSide = side;

    const modal = document.getElementById('mp3ViewerModal');
    const title = document.getElementById('mp3ViewerTitle');
    const info  = document.getElementById('mp3ViewerInfo');
    const loading = document.getElementById('mp3Loading');
    const loadingText = document.getElementById('mp3LoadingText');

    if (!modal) {
        console.error('mp3-viewer: #mp3ViewerModal не найден в DOM');
        return;
    }

    title.textContent = '🎵 ' + (item.name || item.path);
    info.textContent = '';
    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    loadingText.textContent = 'Загрузка MP3…';

    // === Инициализация UI (только бары визуализатора + режимы) ===
    FAR._mp3InitUI();
    FAR._mp3UpdateModeButtons();

    // === Плейлист — только текущая директория ===
    await FAR._mp3BuildPlaylist(item, side);

    // === Загрузка трека ===
    try {
        await FAR._mp3LoadTrack(item, side);
        loading.classList.add('hidden');
    } catch (e) {
        console.error('openMp3Viewer:', e);
        loading.classList.add('hidden');
        FAR.toast('Не удалось открыть MP3: ' + e.message, 'error');
    }
};

FAR.closeMp3Viewer = function () {
    const modal = document.getElementById('mp3ViewerModal');
    if (modal) modal.classList.add('hidden');

    // Инвалидируем все текущие загрузки
    FAR._mp3LoadToken++;

    // Корректно останавливаем <audio>
    if (FAR._mp3Audio) {
        try { FAR._mp3Audio.pause(); } catch (e) {}
        try {
            FAR._mp3Audio.removeAttribute('src');
            FAR._mp3Audio.load();
        } catch (e) {}
        FAR._mp3Audio = null;
    }

    // Отключаем визуализацию
    FAR._mp3StopVisualizer();

    // Отключаем AudioContext
    if (FAR._mp3VisCtx) {
        try { FAR._mp3VisCtx.close(); } catch (e) {}
        FAR._mp3VisCtx = null;
        FAR._mp3VisAnalyser = null;
        FAR._mp3VisSource = null;
    }

    // Освобождаем blob URL
    if (FAR._mp3BlobUrl) {
        try { URL.revokeObjectURL(FAR._mp3BlobUrl); } catch (e) {}
        FAR._mp3BlobUrl = null;
    }

    FAR._mp3CurrentItem = null;
    FAR._mp3CurrentSide = null;
    FAR._mp3Playlist = [];
    FAR._mp3PlaylistIdx = -1;

    // Сброс режимов к дефолту
    FAR._mp3Repeat  = true;
    FAR._mp3Shuffle = false;
    FAR._mp3UpdateModeButtons();

    // Сброс UI
    const timeEl = document.getElementById('mp3Time');
    if (timeEl) timeEl.textContent = '00:00';

    const seekFill = document.getElementById('mp3SeekFill');
    if (seekFill) seekFill.style.width = '0%';

    const seekThumb = document.getElementById('mp3SeekThumb');
    if (seekThumb) seekThumb.style.left = '0%';

    const btnPlay = document.getElementById('mp3BtnPlay');
    if (btnPlay) btnPlay.textContent = '▶';

    const pl = document.getElementById('mp3Playlist');
    if (pl) pl.innerHTML = '';

    const plInfo = document.getElementById('mp3PlaylistInfo');
    if (plInfo) plInfo.textContent = '—';
};

FAR.closeMp3ViewerOutside = function (e) {
    if (e.target === e.currentTarget) FAR.closeMp3Viewer();
};

// ============================================================
// Плейлист — только текущая директория
// ============================================================

/**
 * Собирает плейлист из mp3-файлов ТЕКУЩЕЙ директории панели.
 * Без рекурсии. Если директория ещё не загружена — грузит её.
 */
FAR._mp3BuildPlaylist = async function (currentItem, side) {
    const ctx = FAR.side[side];
    if (!ctx || !ctx.db) {
        FAR._mp3Playlist = [];
        FAR._mp3PlaylistIdx = -1;
        FAR._mp3RenderPlaylist();
        return;
    }

    // Если директория ещё не загружена — грузим
    const curPath = FAR.normPath(ctx.path);
    if (ctx._loadedDir !== curPath || !Array.isArray(ctx.files)) {
        try {
            await FAR.ensureDirLoaded(side, ctx.path, { silent: true });
        } catch (e) {
            console.warn('_mp3BuildPlaylist: ensureDirLoaded failed:', e);
        }
    }

    // ctx.files — только дети текущей директории (не рекурсивно!)
    const items = Array.isArray(ctx.files) ? ctx.files : [];

    const mp3Items = items.filter(function (it) {
        return it && !it.isFolder && FAR.isMp3(it);
    });

    FAR._mp3Playlist = mp3Items.map(function (it) {
        FAR._ensureItemName(it);
        return { item: it, name: it.name, dur: '--:--' };
    });

    // Индекс текущего файла
    FAR._mp3PlaylistIdx = mp3Items.findIndex(function (it) {
        return it._id === currentItem._id;
    });

    FAR._mp3RenderPlaylist();
};

FAR._mp3RenderPlaylist = function () {
    const listEl = document.getElementById('mp3Playlist');
    const infoEl = document.getElementById('mp3PlaylistInfo');
    if (!listEl) return;

    listEl.innerHTML = '';

    if (FAR._mp3Playlist.length === 0) {
        listEl.innerHTML = '<div style="padding:10px;color:#666;">Плейлист пуст</div>';
        if (infoEl) infoEl.textContent = '0 треков';
        return;
    }

    FAR._mp3Playlist.forEach(function (entry, idx) {
        const item = document.createElement('div');
        item.className = 'winamp-pl-item' + (idx === FAR._mp3PlaylistIdx ? ' active' : '');
        item.innerHTML =
            '<span class="pl-num">' + (idx + 1) + '.</span>' +
            '<span class="pl-name">' + FAR.escapeHtml(entry.name) + '</span>' +
            '<span class="pl-dur">' + entry.dur + '</span>';

        item.addEventListener('click', function () {
            FAR._mp3PlayTrackByIndex(idx);
        });

        listEl.appendChild(item);
    });

    if (infoEl) {
        infoEl.textContent = FAR._mp3Playlist.length + ' треков' +
            (FAR._mp3PlaylistIdx >= 0
                ? ' • играет #' + (FAR._mp3PlaylistIdx + 1)
                : '');
    }
};

// ============================================================
// Загрузка трека в <audio>
// ============================================================

FAR._mp3LoadTrack = async function (item, side) {
    // Токен текущей загрузки: если за время await пришёл другой трек,
    // устаревший вызов сам себя отменит в конце.
    const myToken = ++FAR._mp3LoadToken;

    // Создаём <audio>, если его ещё нет
    if (!FAR._mp3Audio) {
        FAR._mp3Audio = new Audio();
        FAR._mp3Audio.preload = 'auto';
        FAR._mp3Audio.setAttribute('playsinline', '');
        FAR._mp3AttachAudioEvents();
    }

    const audio = FAR._mp3Audio;

    // === Корректно останавливаем предыдущий трек ===
    try { audio.pause(); } catch (e) {}

    // Снимаем src и вызываем load() — это освобождает внутренние
    // буферы <audio> и предотвращает AbortError при следующем play().
    try {
        audio.removeAttribute('src');
        audio.load();
    } catch (e) {}

    // Старый blob освобождаем сразу после отвязки src.
    if (FAR._mp3BlobUrl) {
        try { URL.revokeObjectURL(FAR._mp3BlobUrl); } catch (e) {}
        FAR._mp3BlobUrl = null;
    }

    // === Читаем тело файла ===
    const { data, contentType } = await FAR.readFileBodyFromSide(side, item);

    // Если за время чтения пользователь выбрал другой трек — выходим
    if (myToken !== FAR._mp3LoadToken) return;

    const blob = new Blob([data], { type: contentType || 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    FAR._mp3BlobUrl = url;

    // === Устанавливаем новый src ===
    audio.src = url;
    try { audio.load(); } catch (e) {}

    // Обновляем info и marquee
    const infoEl = document.getElementById('mp3ViewerInfo');
    if (infoEl) infoEl.textContent = '🎵 ' + FAR.formatSize(data.length);

    const marquee = document.getElementById('mp3Marquee');
    if (marquee) {
        marquee.textContent = item.name + '  •  ' + FAR.formatSize(data.length) +
            '  •  ' + (item.contentType || 'audio/mpeg');
    }

    FAR._mp3RenderPlaylist();

    // === Запускаем воспроизведение ===
    try {
        await audio.play();
        if (myToken !== FAR._mp3LoadToken) return;   // устарело
        FAR._mp3UpdatePlayBtn();
        FAR._mp3StartVisualizer();
    } catch (e) {
        // AbortError — штатная ситуация: мы сами прервали play(),
        // когда пользователь быстро переключил трек. Молча игнорируем.
        if (e && e.name === 'AbortError') return;

        // NotAllowedError — автоплей заблокирован браузером.
        // Это ожидаемо: пользователь должен кликнуть по кнопке Play.
        if (e && e.name === 'NotAllowedError') {
            FAR._mp3UpdatePlayBtn();
            return;
        }

        // Остальные ошибки — логируем, но не спамим в тост.
        console.warn('mp3 play error:', e && e.name, e && e.message);
        FAR._mp3UpdatePlayBtn();
    }
};

FAR._mp3AttachAudioEvents = function () {
    const a = FAR._mp3Audio;
    if (!a) return;

    a.addEventListener('timeupdate',     FAR._mp3OnTimeUpdate);
    a.addEventListener('loadedmetadata', FAR._mp3OnLoadedMetadata);
    a.addEventListener('ended',          FAR._mp3OnEnded);
    a.addEventListener('play',           FAR._mp3UpdatePlayBtn);
    a.addEventListener('pause',          FAR._mp3UpdatePlayBtn);
    a.addEventListener('error',          FAR._mp3OnAudioError);
};

FAR._mp3OnAudioError = function (e) {
    const a = FAR._mp3Audio;
    if (!a) return;

    const err = a.error;
    // Коды: 1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED
    let reason = 'неизвестная ошибка';
    if (err) {
        switch (err.code) {
            case 1: reason = 'воспроизведение прервано';            break;
            case 2: reason = 'сетевая ошибка';                       break;
            case 3: reason = 'ошибка декодирования';                 break;
            case 4: reason = 'формат не поддерживается или источник недоступен'; break;
        }
        if (err.message) reason += ' (' + err.message + ')';
    }

    // Код 1 (ABORTED) — норма при переключении треков, не пугаем пользователя.
    if (err && err.code === 1) return;

    console.warn('[mp3] audio error:', reason, '| src =', a.currentSrc || a.src);
    FAR.toast('Ошибка аудио: ' + reason, 'error');
};

// ============================================================
// Управление воспроизведением
// ============================================================

FAR.mp3TogglePlay = function () {
    if (!FAR._mp3Audio) return;
    if (FAR._mp3Audio.paused) {
        FAR._mp3Audio.play().then(function () {
            FAR._mp3UpdatePlayBtn();
            FAR._mp3StartVisualizer();
        }).catch(function (e) {
            if (e && e.name === 'AbortError') return;
            console.warn('mp3 play error:', e && e.name, e && e.message);
        });
    } else {
        FAR._mp3Audio.pause();
        FAR._mp3UpdatePlayBtn();
    }
};

FAR.mp3Stop = function () {
    if (!FAR._mp3Audio) return;
    FAR._mp3Audio.pause();
    FAR._mp3Audio.currentTime = 0;
    FAR._mp3UpdatePlayBtn();
    FAR._mp3StopVisualizer();
};

FAR.mp3Rewind = function () {
    if (!FAR._mp3Audio) return;
    FAR._mp3Audio.currentTime = Math.max(0, FAR._mp3Audio.currentTime - 5);
};

FAR.mp3Forward = function () {
    if (!FAR._mp3Audio) return;
    const dur = FAR._mp3Audio.duration || 0;
    FAR._mp3Audio.currentTime = Math.min(dur, FAR._mp3Audio.currentTime + 5);
};

FAR.mp3Prev = function () {
    if (FAR._mp3Playlist.length === 0) return;

    if (FAR._mp3Shuffle) {
        FAR._mp3PlayRandom();
        return;
    }

    if (FAR._mp3PlaylistIdx > 0) {
        FAR._mp3PlayTrackByIndex(FAR._mp3PlaylistIdx - 1);
        return;
    }

    // Мы на первом треке — если Repeat включён, идём на последний
    if (FAR._mp3Repeat) {
        FAR._mp3PlayTrackByIndex(FAR._mp3Playlist.length - 1);
    } else {
        FAR.mp3Stop();
    }
};

FAR.mp3Next = function () {
    if (FAR._mp3Playlist.length === 0) return;

    // Shuffle — всегда случайный следующий
    if (FAR._mp3Shuffle) {
        FAR._mp3PlayRandom();
        return;
    }

    if (FAR._mp3PlaylistIdx >= 0 && FAR._mp3PlaylistIdx < FAR._mp3Playlist.length - 1) {
        FAR._mp3PlayTrackByIndex(FAR._mp3PlaylistIdx + 1);
        return;
    }

    // Дошли до конца — если Repeat включён, начинаем сначала
    if (FAR._mp3Repeat) {
        FAR._mp3PlayTrackByIndex(0);
    }
};

FAR._mp3PlayTrackByIndex = async function (idx) {
    const entry = FAR._mp3Playlist[idx];
    if (!entry) return;

    FAR._mp3PlaylistIdx = idx;
    FAR._mp3CurrentItem = entry.item;

    const side = FAR._mp3CurrentSide || FAR.activePanel;
    const title = document.getElementById('mp3ViewerTitle');
    if (title) title.textContent = '🎵 ' + entry.name;

    FAR._mp3RenderPlaylist();

    // === Синхронизация выделения в панели — только в
    // классическом режиме. В оконном режиме это мешает,
    // потому что renderPanel(side) рендерит в окно Проводника.
    if (!FAR.WM || !FAR.WM.state.active) {
        FAR._mp3SyncPanelSelection(entry.item, side);
    }

    try {
        await FAR._mp3LoadTrack(entry.item, side);
    } catch (e) {
        console.error('_mp3PlayTrackByIndex:', e);
        FAR.toast('Не удалось открыть трек: ' + e.message, 'error');
    }
};

FAR._mp3UpdatePlayBtn = function () {
    const btn = document.getElementById('mp3BtnPlay');
    if (!btn || !FAR._mp3Audio) return;
    btn.textContent = FAR._mp3Audio.paused ? '▶' : '⏸';
};

// ============================================================
// Прогресс / время
// ============================================================

FAR._mp3OnTimeUpdate = function () {
    const a = FAR._mp3Audio;
    if (!a) return;

    const cur = a.currentTime || 0;
    const dur = a.duration || 0;
    const pct = dur > 0 ? (cur / dur) * 100 : 0;

    const timeEl = document.getElementById('mp3Time');
    if (timeEl) timeEl.textContent = FAR._mp3FormatTime(cur);

    const fill = document.getElementById('mp3SeekFill');
    if (fill) fill.style.width = pct + '%';

    const thumb = document.getElementById('mp3SeekThumb');
    if (thumb) thumb.style.left = pct + '%';
};

FAR._mp3OnLoadedMetadata = function () {
    const a = FAR._mp3Audio;
    if (!a) return;

    const dur = a.duration;
    if (FAR._mp3PlaylistIdx >= 0 && FAR._mp3Playlist[FAR._mp3PlaylistIdx]) {
        FAR._mp3Playlist[FAR._mp3PlaylistIdx].dur = FAR._mp3FormatTime(dur);
        FAR._mp3RenderPlaylist();
    }

    // kbps / kHz / ch — заглушки в стиле Winamp
    const kbpsEl = document.getElementById('mp3Kbps');
    const khzEl  = document.getElementById('mp3Khz');
    const chEl   = document.getElementById('mp3Ch');

    if (kbpsEl) kbpsEl.textContent = '--';
    if (khzEl)  khzEl.textContent  = '--';
    if (chEl)   chEl.textContent   = '--';
};

FAR._mp3OnEnded = function () {
    if (!FAR._mp3Audio) return;

    const hasNext = FAR._mp3PlaylistIdx >= 0 &&
                    FAR._mp3PlaylistIdx < FAR._mp3Playlist.length - 1;

    if (hasNext) {
        FAR.mp3Next();
        return;
    }

    if (FAR._mp3Repeat) {
        if (FAR._mp3Shuffle) {
            FAR._mp3PlayRandom();
        } else if (FAR._mp3Playlist.length > 0) {
            FAR._mp3PlayTrackByIndex(0);
        }
        return;
    }

    FAR._mp3StopOnEnd();
};

FAR._mp3StopOnEnd = function () {
    if (!FAR._mp3Audio) return;
    try { FAR._mp3Audio.pause(); } catch (e) {}
    try { FAR._mp3Audio.currentTime = 0; } catch (e) {}
    FAR._mp3UpdatePlayBtn();
    FAR._mp3StopVisualizer();

    const fill = document.getElementById('mp3SeekFill');
    if (fill) fill.style.width = '0%';
    const thumb = document.getElementById('mp3SeekThumb');
    if (thumb) thumb.style.left = '0%';
    const timeEl = document.getElementById('mp3Time');
    if (timeEl) timeEl.textContent = '00:00';
};

FAR._mp3PlayRandom = function () {
    const n = FAR._mp3Playlist.length;
    if (n === 0) return;
    if (n === 1) {
        FAR._mp3PlayTrackByIndex(0);
        return;
    }

    let idx;
    do {
        idx = Math.floor(Math.random() * n);
    } while (idx === FAR._mp3PlaylistIdx);

    FAR._mp3PlayTrackByIndex(idx);
};

FAR._mp3FormatTime = function (sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
};

FAR.mp3SeekClick = function (event) {
    if (!FAR._mp3Audio || !FAR._mp3Audio.duration) return;
    const bar = document.getElementById('mp3Seek');
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    FAR._mp3Audio.currentTime = pct * FAR._mp3Audio.duration;
};

// ============================================================
// Громкость / баланс
// ============================================================

FAR.mp3SetVolume = function (val) {
    if (!FAR._mp3Audio) return;
    FAR._mp3Audio.volume = Math.max(0, Math.min(1, Number(val) / 100));
};

FAR.mp3SetBalance = function (val) {
    // В HTML5 <audio> нет прямого StereoPanner без AudioContext.
    // Оставляем визуальный слайдер.
    FAR._mp3Balance = Number(val) || 0;
};

// ============================================================
// Режимы REPEAT / SHUFFLE
// ============================================================

FAR.mp3ToggleRepeat = function () {
    FAR._mp3Repeat = !FAR._mp3Repeat;
    FAR._mp3UpdateModeButtons();
    FAR.toast('Повтор: ' + (FAR._mp3Repeat ? 'вкл' : 'выкл'), 'info');
};

FAR.mp3ToggleShuffle = function () {
    FAR._mp3Shuffle = !FAR._mp3Shuffle;
    FAR._mp3UpdateModeButtons();
    FAR.toast('Случайный порядок: ' + (FAR._mp3Shuffle ? 'вкл' : 'выкл'), 'info');
};

FAR._mp3UpdateModeButtons = function () {
    const rep = document.getElementById('mp3BtnRepeat');
    const shf = document.getElementById('mp3BtnShuffle');
    if (rep) rep.classList.toggle('active', !!FAR._mp3Repeat);
    if (shf) shf.classList.toggle('active', !!FAR._mp3Shuffle);
};

// ============================================================
// UI: визуализатор (без эквалайзера)
// ============================================================

FAR._mp3InitUI = function () {
    FAR._mp3BuildVisualizerBars();
    FAR._mp3UpdateModeButtons();
};

FAR._mp3BuildVisualizerBars = function () {
    const container = document.getElementById('mp3Visualizer');
    if (!container) return;

    container.innerHTML = '';
    FAR._mp3VisBars = [];
    const N = 40;
    for (let i = 0; i < N; i++) {
        const bar = document.createElement('div');
        bar.className = 'bar';
        container.appendChild(bar);
        FAR._mp3VisBars.push(bar);
    }
};

// ============================================================
// Визуализатор (Web Audio API)
// ============================================================

FAR._mp3StartVisualizer = function () {
    if (FAR._mp3RafId) return;
    if (!FAR._mp3Audio) return;

    // AudioContext создаётся один раз
    if (!FAR._mp3VisCtx) {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            FAR._mp3VisCtx = new Ctx();
            FAR._mp3VisAnalyser = FAR._mp3VisCtx.createAnalyser();
            FAR._mp3VisAnalyser.fftSize = 128;
            FAR._mp3VisSource = FAR._mp3VisCtx.createMediaElementSource(FAR._mp3Audio);
            FAR._mp3VisSource.connect(FAR._mp3VisAnalyser);
            FAR._mp3VisAnalyser.connect(FAR._mp3VisCtx.destination);
        } catch (e) {
            console.warn('AudioContext not available:', e);
            FAR._mp3VisCtx = null;
            return;
        }
    }

    if (FAR._mp3VisCtx.state === 'suspended') {
        FAR._mp3VisCtx.resume().catch(function () {});
    }

    const data = new Uint8Array(FAR._mp3VisAnalyser.frequencyBinCount);
    const N = FAR._mp3VisBars.length;

    const loop = function () {
        if (!FAR._mp3Audio || FAR._mp3Audio.paused) {
            FAR._mp3RafId = null;
            FAR._mp3VisBars.forEach(function (b) { b.style.height = '0%'; });
            return;
        }

        FAR._mp3VisAnalyser.getByteFrequencyData(data);

        for (let i = 0; i < N; i++) {
            const idx = Math.floor((i / N) * data.length);
            const v = data[idx] / 255;
            FAR._mp3VisBars[i].style.height = (v * 100) + '%';
        }

        FAR._mp3RafId = requestAnimationFrame(loop);
    };

    FAR._mp3RafId = requestAnimationFrame(loop);
};

FAR._mp3StopVisualizer = function () {
    if (FAR._mp3RafId) {
        cancelAnimationFrame(FAR._mp3RafId);
        FAR._mp3RafId = null;
    }
    FAR._mp3VisBars.forEach(function (b) { b.style.height = '0%'; });
};

// ============================================================
// Скачивание
// ============================================================

FAR.downloadCurrentMp3 = async function () {
    if (!FAR._mp3CurrentItem) {
        FAR.toast('Нет активного трека', 'warning');
        return;
    }
    const side = FAR._mp3CurrentSide || FAR.activePanel;
    try {
        const { data, contentType } = await FAR.readFileBodyFromSide(side, FAR._mp3CurrentItem);
        const blob = new Blob([data], { type: contentType || 'audio/mpeg' });
        FAR.saveBlobAs(blob, FAR.sanitizeFileName(FAR._mp3CurrentItem.name));
        FAR.toast('Файл сохранён', 'success');
    } catch (e) {
        FAR.toast('Ошибка скачивания: ' + e.message, 'error');
    }
};

/**
 * Синхронизирует выделение и курсор на панели-источнике
 * с текущим играющим треком.
 *
 * Использует FAR._selectFileInPanel (определена в 24-panorama-viewer.js),
 * которая:
 *   • ищет файл в текущей директории панели;
 *   • если файл в другой директории — переходит туда;
 *   • выставляет selectedIdx / cursor / anchor;
 *   • перерисовывает панель и прокручивает к курсору.
 *
 * Если функция недоступна (например, модуль 24 не загружен) —
 * падаем на ручной минимум: находим файл среди ctx.files и
 * выделяем его, не меняя директорию.
 */
FAR._mp3SyncPanelSelection = function (item, side) {
    if (!item || !item._id) return;
    side = side || FAR._mp3CurrentSide || FAR.activePanel;

    // Основной путь: FAR._selectFileInPanel из 24-panorama-viewer.js
    if (typeof FAR._selectFileInPanel === 'function') {
        try {
            FAR._selectFileInPanel(item, side);
            return;
        } catch (e) {
            console.warn('_mp3SyncPanelSelection: _selectFileInPanel failed:', e);
        }
    }

    // Fallback: выделяем в текущей директории, если файл там есть
    const ctx = FAR.side[side];
    if (!ctx || !Array.isArray(ctx.files)) return;

    const idx = ctx.files.findIndex(function (f) {
        return f && f._id === item._id;
    });
    if (idx < 0) return;

    ctx.selectedIdx.clear();
    ctx.selectedIdx.add(idx);
    ctx.cursor = idx;
    ctx.anchor = idx;

    try { FAR.renderPanel(side, { skipLoad: true }); } catch (e) {}
    try { FAR.scrollCursorIntoView(side); } catch (e) {}
    try { FAR.saveUiState(); } catch (e) {}
};