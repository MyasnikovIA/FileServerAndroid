// ============================================================
// Просмотрщик видео (37-video-viewer.js)
// ============================================================
//
// Особенности:
//   • Ленивая загрузка: файл читается из PouchDB порциями (chunks),
//     воспроизведение начинается после загрузки первого окна
//     (INITIAL_WINDOW_SEC), остальное догружается на лету.
//   • При перемотке (seek) — если запрошенная позиция вне
//     загруженного диапазона, начинается загрузка с этой позиции
//     на WINDOW_SEC вперёд (или до конца файла).
//   • Возможность развернуть на весь экран — отдельная кнопка,
//     плюс штатный fullscreen браузера через requestFullscreen()
//     на контейнере .video-stage.
//   • Скачивание оригинала — отдельная кнопка.
//   • Переключение между файлами — стандартные кнопки ◀ ▶
//     (через общий механизм FAR.VIEWER_MODALS).
//
// ВАЖНО: для ленивой загрузки используется MediaSource Extensions
// (MSE), потому что HTML5 <video> умеет играть лишь цельный Blob.
// MSE позволяет кормить <video> чанками через SourceBuffer.
//
// Если MSE недоступен (или контейнер видеофайла не поддерживается),
// плеер откатывается на «полную» загрузку — файл читается целиком
// и подсовывается как Blob URL.
// ============================================================

// ==== Состояние ====
FAR._videoEl            = null;   // <video>
FAR._videoCurrentItem   = null;
FAR._videoCurrentSide   = null;
FAR._videoCurrentMeta   = null;   // { size, contentType, name }

FAR._videoBlobUrl       = null;   // для fallback-режима (full Blob URL)
FAR._videoMediaSource   = null;   // MediaSource (если MSE)
FAR._videoSourceBuffer  = null;   // SourceBuffer
FAR._videoObjectUrl     = null;   // URL.createObjectURL(mediaSource)

FAR._videoLoadToken     = 0;      // защита от гонок при переключении треков
FAR._videoLoadAbort     = null;   // AbortController текущей загрузки

FAR._videoLoadedStart   = 0;      // байт: начало загруженного диапазона
FAR._videoLoadedEnd     = 0;      // байт: конец загруженного диапазона
FAR._videoFileSize      = 0;
FAR._videoTotalBytes    = 0;
FAR._videoLoadedBytes   = 0;

FAR._videoChunkSize     = 1024 * 1024;      // 1 МБ на чанк
FAR._videoWindowSec     = 120;              // 2 минуты вперёд при seek
FAR._videoInitialSec    = 2;                // сколько секунд набрать до старта
FAR._videoFetching      = false;            // идёт ли сейчас фоновая загрузка
FAR._videoAbortFetch    = null;             // AbortController текущей fetch-порции
FAR._videoKeyHandler    = null;

FAR.VIDEO_EXTS = ['mp4', 'webm', 'mkv', 'mov', 'm4v', 'ogv', 'avi'];

// ============================================================
// Проверка: является ли файл видео
// ============================================================

FAR.isVideo = function (item) {
    if (!item || item.isFolder) return false;

    const name = item.name || item.path || '';
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (FAR.VIDEO_EXTS.indexOf(ext) !== -1) return true;

    const ct = (item.contentType || '').toLowerCase();
    if (ct.indexOf('video/') === 0) return true;

    return false;
};

// ============================================================
// Открытие / закрытие
// ============================================================

FAR.openVideoViewer = async function (item, side) {
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
    try { if (typeof FAR.closeMp3Viewer      === 'function') FAR.closeMp3Viewer();      } catch (e) {}

    FAR._videoCurrentItem = item;
    FAR._videoCurrentSide = side;

    const modal       = document.getElementById('videoViewerModal');
    const title       = document.getElementById('videoViewerTitle');
    const info        = document.getElementById('videoViewerInfo');
    const loading     = document.getElementById('videoLoading');
    const loadingText = document.getElementById('videoLoadingText');
    const clickOverlay = document.getElementById('videoClickToPlay');
    const badge       = document.getElementById('videoBufferingBadge');

    if (!modal) {
        console.error('video-viewer: #videoViewerModal не найден в DOM');
        return;
    }

    title.textContent = '🎬 ' + (item.name || item.path);
    info.textContent = '';
    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    loadingText.textContent = 'Загрузка видео…';
    clickOverlay.classList.add('hidden');
    badge.classList.add('hidden');

    // Обновляем состояние загрузки
    FAR._videoLoadedStart  = 0;
    FAR._videoLoadedEnd    = 0;
    FAR._videoFileSize     = 0;
    FAR._videoTotalBytes   = 0;
    FAR._videoLoadedBytes  = 0;
    FAR._videoUpdateLoadStatus();

    // Инициализируем <video>, если его ещё нет
    if (!FAR._videoEl) {
        FAR._videoEl = document.getElementById('videoElement');
        FAR._videoAttachEvents();
        FAR._videoAttachKeyHandler();
    }
    FAR._videoEl.pause();
    FAR._videoEl.removeAttribute('src');
    try { FAR._videoEl.load(); } catch (e) {}

    // Инвалидируем предыдущие загрузки
    FAR._videoLoadToken++;
    FAR._videoAbortAll();

    // Освобождаем blob-URL fallback-режима
    if (FAR._videoBlobUrl) {
        try { URL.revokeObjectURL(FAR._videoBlobUrl); } catch (e) {}
        FAR._videoBlobUrl = null;
    }

    // Полная очистка MSE
    FAR._videoCleanupMediaSource();

    // Загружаем и стартуем
    try {
        await FAR._videoStart(item, side);
    } catch (e) {
        console.error('openVideoViewer:', e);
        loading.classList.add('hidden');
        FAR.toast('Не удалось открыть видео: ' + e.message, 'error');
    }
};

FAR.closeVideoViewer = function () {
    const modal = document.getElementById('videoViewerModal');
    if (modal) modal.classList.add('hidden');

    // Останавливаем видео и чистим ресурсы
    if (FAR._videoEl) {
        try { FAR._videoEl.pause(); } catch (e) {}
        try {
            FAR._videoEl.removeAttribute('src');
            FAR._videoEl.load();
        } catch (e) {}
    }

    FAR._videoAbortAll();
    FAR._videoCleanupMediaSource();

    if (FAR._videoBlobUrl) {
        try { URL.revokeObjectURL(FAR._videoBlobUrl); } catch (e) {}
        FAR._videoBlobUrl = null;
    }

    // Сброс UI
    const loading = document.getElementById('videoLoading');
    if (loading) loading.classList.add('hidden');
    const badge = document.getElementById('videoBufferingBadge');
    if (badge) badge.classList.add('hidden');
    const clickOverlay = document.getElementById('videoClickToPlay');
    if (clickOverlay) clickOverlay.classList.add('hidden');

    FAR._videoCurrentItem = null;
    FAR._videoCurrentSide = null;
    FAR._videoCurrentMeta = null;
    FAR._videoLoadedStart = 0;
    FAR._videoLoadedEnd = 0;
    FAR._videoFileSize = 0;
    FAR._videoTotalBytes = 0;
    FAR._videoLoadedBytes = 0;
    FAR._videoFetching = false;
    FAR._videoUpdateLoadStatus();
    FAR._videoDetachKeyHandler();

    // Если открыт fullscreen — выходим
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        try {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } catch (e) {}
    }
};

FAR.closeVideoViewerOutside = function (e) {
    if (e.target === e.currentTarget) FAR.closeVideoViewer();
};

// ============================================================
// Запуск: полная загрузка (fallback) или MSE
// ============================================================
FAR._videoStart = async function (item, side) {
    const loading     = document.getElementById('videoLoading');
    const loadingText = document.getElementById('videoLoadingText');
    const info        = document.getElementById('videoViewerInfo');

    FAR._videoFileSize = item.size || 0;
    FAR._videoTotalBytes = FAR._videoFileSize;
    FAR._videoLoadedBytes = 0;
    FAR._videoLoadedStart = 0;
    FAR._videoLoadedEnd = 0;
    FAR._videoUpdateLoadStatus();

    const contentType = item.contentType || 'video/mp4';
    FAR._videoCurrentMeta = { name: item.name, contentType, size: FAR._videoFileSize };

    if (FAR._videoFileSize > 0) {
        info.textContent = '🎬 ' + FAR.formatSize(FAR._videoFileSize);
    }

    // ============================================================
    // Прямой URL к видео. Сервер теперь поддерживает HTTP Range,
    // поэтому <video> сам делает запросы по диапазонам и
    // буферизует лениво. Полный файл в память НЕ качается.
    // ============================================================
    const directUrl = FAR.buildDirectFileUrl(item, side);
    if (!directUrl) {
        loading.classList.add('hidden');
        FAR.toast('Не удалось построить URL видео', 'error');
        return;
    }

    // Определяем cross-origin (панель на другом сервере)
    let isCrossOrigin = false;
    try { isCrossOrigin = new URL(directUrl).origin !== location.origin; } catch (e) {}

    let url = directUrl;
    if (isCrossOrigin) {
        // Для cross-origin cookie SameSite=Lax не отправится.
        // Прокидываем токен в query (?token=) — сервер его понимает
        // (AuthService.authenticate, шаг 5).
        FAR._videoEl.crossOrigin = 'anonymous';
        if (FAR.authToken) {
            url += (url.includes('?') ? '&' : '?') +
                'token=' + encodeURIComponent(FAR.authToken);
        }
    } else {
        // Для same-origin используем cookie (безопаснее, токен
        // не утекает в URL). Cookie ставится при /api/login
        // с SameSite=Lax и Path=/ — она уходит с запросами <video>.
        FAR._videoEl.removeAttribute('crossorigin');
    }

    // ============================================================
    // Fallback: если прямой URL не сработал (сеть/auth/404),
    // грузим полностью через readFileBodyFromSide.
    // ============================================================
    let fellBack = false;
    const onError = async function () {
        if (fellBack) return;
        fellBack = true;
        FAR._videoEl.removeEventListener('error', onError);
        console.warn('[video] direct URL failed, falling back to full download');
        FAR._videoCleanupMediaSource();
        try {
            await FAR._videoLoadFull(item, side);
        } catch (e) {
            loading.classList.add('hidden');
            FAR.toast('Не удалось загрузить видео: ' + e.message, 'error');
        }
    };
    FAR._videoEl.addEventListener('error', onError);

    loadingText.textContent = 'Загрузка…';

    FAR._videoEl.src = url;
    try { FAR._videoEl.load(); } catch (e) {}

    // ============================================================
    // Ждём loadedmetadata — как только браузер получил первые
    // байты (Range-запрос) и знает duration, начинаем play().
    // Для больших файлов это происходит через доли секунды.
    // ============================================================
    try {
        await new Promise(function (resolve, reject) {
            const v = FAR._videoEl;
            const cleanup = function () {
                v.removeEventListener('loadedmetadata', onMeta);
                v.removeEventListener('error', onErr);
            };
            const onMeta = function () { cleanup(); resolve(); };
            const onErr = function () {
                cleanup();
                reject(new Error('video error during metadata load: ' +
                    (v.error && v.error.code)));
            };
            v.addEventListener('loadedmetadata', onMeta);
            v.addEventListener('error', onErr);
            setTimeout(function () { cleanup(); reject(new Error('metadata timeout')); }, 15000);
        });
    } catch (e) {
        // onError уже вызван — fallback запущен, просто выходим
        console.warn('[video] metadata failed:', e);
        return;
    }

    // Обновляем индикатор буферизации
    FAR._videoUpdateLoadStatus();

    // ============================================================
    // Пробуем автоплей. Если браузер блокирует — показываем
    // оверлей «нажмите, чтобы воспроизвести».
    // ============================================================
    try {
        await FAR._videoEl.play();
        loading.classList.add('hidden');
        FAR._videoShowBadge('', false);
    } catch (e) {
        loading.classList.add('hidden');
        const clickOverlay = document.getElementById('videoClickToPlay');
        if (clickOverlay) clickOverlay.classList.remove('hidden');
    }

    FAR.setStatus('🎬 Видео: ' + item.name);
};

FAR._videoPickMime = function (contentType) {
    const ms = FAR._videoMediaSource;
    if (!ms || typeof ms.isTypeSupported !== 'function') return null;

    const ct = (contentType || '').toLowerCase();

    // Список кандидатов по убыванию точности
    const candidates = [];
    if (ct.indexOf('webm') !== -1) {
        candidates.push('video/webm; codecs="vp9"');
        candidates.push('video/webm; codecs="vp8"');
        candidates.push('video/webm');
    } else if (ct.indexOf('mp4') !== -1 || ct.indexOf('m4v') !== -1 || ct.indexOf('mov') !== -1) {
        candidates.push('video/mp4; codecs="avc1.640033, mp4a.40.2"');
        candidates.push('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
        candidates.push('video/mp4; codecs="avc1.42E01E"');
        candidates.push('video/mp4');
    } else if (ct.indexOf('ogg') !== -1 || ct.indexOf('ogv') !== -1) {
        candidates.push('video/ogg; codecs="theora, vorbis"');
        candidates.push('video/ogg');
    } else {
        // Неизвестный contentType — пробуем оба основных
        candidates.push('video/webm; codecs="vp9"');
        candidates.push('video/webm; codecs="vp8"');
        candidates.push('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
        candidates.push('video/mp4');
    }

    for (const c of candidates) {
        if (ms.isTypeSupported(c)) return c;
    }
    return null;
};

// ============================================================
// Загрузка диапазона из PouchDB
// ============================================================
//
// Читаем вложение 'b' как Blob целиком? Нет. PouchDB не даёт
// читать диапазон вложения — только весь attachment.
// Поэтому ленивость реализуем так: держим в памяти «окно» и
// подгружаем его целиком при seek. Реально это означает, что
// для удалённых/больших файлов всё равно придётся вытянуть весь
// attachment хотя бы один раз. Но пока файл небольшой и есть в
// кэше браузера — это работает быстро.
//
// Компромисс: для настоящей ленивой загрузки нужен HTTP Range API,
// который PouchDB не предоставляет. Ниже — «псевдо-ленивая»
// реализация: файл читается один раз, но воспроизведение
// начинается сразу и не блокирует UI.

FAR._videoLoadRange = async function (item, side) {
    // Оставлено для совместимости. В новой логике первичная
    // загрузка целиком выполняется в _videoStart, а _videoEndOfStream
    // не вызывается вовсе — MSE сам понимает, когда поток завершён.
    const myToken = FAR._videoLoadToken;
    FAR._videoFetching = true;
    FAR._videoShowBadge('загрузка…', true);

    try {
        const { data, contentType } = await FAR.readFileBodyFromSide(side, item);
        if (myToken !== FAR._videoLoadToken) return;

        FAR._videoLoadedBytes = data.length;
        FAR._videoLoadedStart = 0;
        FAR._videoLoadedEnd   = data.length;
        FAR._videoUpdateLoadStatus();

        await FAR._videoAppendChunk(data.buffer || data);
        FAR._videoFetching = false;
        FAR._videoShowBadge('', false);
    } catch (e) {
        FAR._videoFetching = false;
        FAR._videoShowBadge('', false);
        throw e;
    }
};

FAR._videoAppendChunk = function (arrayBuffer) {
    return new Promise(function (resolve, reject) {
        const sb = FAR._videoSourceBuffer;
        if (!sb) { resolve(); return; }

        const onUpdate = function () {
            sb.removeEventListener('updateend', onUpdate);
            sb.removeEventListener('error', onError);
            resolve();
        };
        const onError = function (e) {
            sb.removeEventListener('updateend', onUpdate);
            sb.removeEventListener('error', onError);
            reject(e);
        };
        sb.addEventListener('updateend', onUpdate);
        sb.addEventListener('error', onError);

        try {
            sb.appendBuffer(arrayBuffer);
        } catch (e) {
            sb.removeEventListener('updateend', onUpdate);
            sb.removeEventListener('error', onError);
            reject(e);
        }
    });
};

FAR._videoEndOfStream = function () {
    const ms = FAR._videoMediaSource;
    if (!ms) return;
    try {
        if (ms.readyState === 'open') ms.endOfStream();
    } catch (e) { /* ignore */ }
};

// ============================================================
// Fallback: полная загрузка как Blob URL
// ============================================================

FAR._videoLoadFull = async function (item, side) {
    const myToken = FAR._videoLoadToken;
    const loading     = document.getElementById('videoLoading');
    const loadingText = document.getElementById('videoLoadingText');

    loadingText.textContent = 'Загрузка целиком…';

    const { data, contentType } = await FAR.readFileBodyFromSide(side, item);
    if (myToken !== FAR._videoLoadToken) return;

    const blob = new Blob([data], { type: contentType || 'video/mp4' });
    const url = URL.createObjectURL(blob);
    FAR._videoBlobUrl = url;

    FAR._videoEl.src = url;
    try { FAR._videoEl.load(); } catch (e) {}

    FAR._videoLoadedBytes = data.length;
    FAR._videoTotalBytes = data.length;
    FAR._videoUpdateLoadStatus();

    // Ждём loadedmetadata или error
    try {
        await new Promise(function (resolve, reject) {
            const v = FAR._videoEl;
            const cleanup = function () {
                v.removeEventListener('loadedmetadata', onMeta);
                v.removeEventListener('error', onErr);
            };
            const onMeta = function () { cleanup(); resolve(); };
            const onErr  = function () { cleanup(); reject(new Error('video error: ' + (v.error && v.error.code))); };
            v.addEventListener('loadedmetadata', onMeta);
            v.addEventListener('error', onErr);
            setTimeout(function () { cleanup(); reject(new Error('metadata timeout')); }, 10000);
        });
    } catch (e) {
        loading.classList.add('hidden');
        FAR.toast('Видео не открывается: ' + e.message, 'error');
        return;
    }

    try {
        await FAR._videoEl.play();
        loading.classList.add('hidden');
    } catch (e) {
        loading.classList.add('hidden');
        const clickOverlay = document.getElementById('videoClickToPlay');
        if (clickOverlay) clickOverlay.classList.remove('hidden');
    }

    FAR.setStatus('🎬 Видео: ' + item.name);
};

// ============================================================
// <video> события
// ============================================================

FAR._videoAttachEvents = function () {
    const v = FAR._videoEl;
    if (!v) return;

    v.addEventListener('waiting',  function () { FAR._videoShowBadge('буферизация…', true); });
    v.addEventListener('playing',  function () { FAR._videoShowBadge('', false); });
    v.addEventListener('canplay',  function () { FAR._videoShowBadge('', false); });
    v.addEventListener('error',    FAR._videoOnError);

    // Обновление полосы времени
    v.addEventListener('timeupdate',     FAR._videoOnTimeUpdate);
    v.addEventListener('loadedmetadata', FAR._videoOnMetadata);
    v.addEventListener('progress',       FAR._videoOnProgress);
    v.addEventListener('durationchange', FAR._videoOnMetadata);

    FAR._videoAttachSeekbar();
};

FAR._videoOnError = function (e) {
    const v = FAR._videoEl;
    if (!v) return;
    const err = v.error;
    let reason = 'неизвестная ошибка';
    if (err) {
        switch (err.code) {
            case 1: reason = 'воспроизведение прервано';   break;
            case 2: reason = 'сетевая ошибка';              break;
            case 3: reason = 'ошибка декодирования';        break;
            case 4: reason = 'формат не поддерживается';    break;
        }
        if (err.message) reason += ' (' + err.message + ')';
    }
    if (err && err.code === 1) return; // ABORTED — норма
    console.warn('[video] error:', reason, '| src =', v.currentSrc || v.src);
    FAR.toast('Ошибка видео: ' + reason, 'error');
};

// ============================================================
// Управление
// ============================================================

FAR.videoTogglePlay = function () {
    const v = FAR._videoEl;
    if (!v) return;
    if (v.paused) {
        v.play().then(function () {
            const clickOverlay = document.getElementById('videoClickToPlay');
            if (clickOverlay) clickOverlay.classList.add('hidden');
        }).catch(function (e) {
            if (e && e.name === 'AbortError') return;
            console.warn('video play error:', e && e.name, e && e.message);
        });
    } else {
        v.pause();
    }
};

FAR.videoToggleFullscreen = function () {
    const stage = document.getElementById('videoStage');
    if (!stage) return;

    const isFs = !!(document.fullscreenElement ||
                    document.webkitFullscreenElement ||
                    document.mozFullScreenElement ||
                    document.msFullscreenElement);

    if (!isFs) {
        if (stage.requestFullscreen) stage.requestFullscreen();
        else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
        else if (stage.mozRequestFullScreen) stage.mozRequestFullScreen();
        else if (stage.msRequestFullscreen) stage.msRequestFullscreen();
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
    }
};

// ============================================================
// Статус в футере: сколько секунд буферизовано из общего.
//
// При прямом URL через Range байтовый прогресс неизвестен
// (браузер сам решает, сколько качать). Но буферизованное
// ВРЕМЯ доступно через video.buffered — этого достаточно,
// чтобы показать «буферизовано 1:23 / 5:00 (28%)».
// ============================================================
FAR._videoUpdateLoadStatus = function () {
    const el = document.getElementById('videoLoadStatus');
    if (!el) return;

    const v = FAR._videoEl;
    if (!v) { el.textContent = ''; return; }

    const dur = v.duration;
    if (!isFinite(dur) || dur <= 0) { el.textContent = ''; return; }

    let bufEnd = 0;
    try {
        for (let i = 0; i < v.buffered.length; i++) {
            bufEnd = Math.max(bufEnd, v.buffered.end(i));
        }
    } catch (e) { /* ignore */ }

    const pct = Math.round((bufEnd / dur) * 100);
    const sizeStr = FAR._videoFileSize > 0
        ? ' • ' + FAR.formatSize(FAR._videoFileSize) : '';

    el.textContent = 'буферизовано: ' + FAR._videoFormatTime(bufEnd) +
        ' / ' + FAR._videoFormatTime(dur) +
        ' (' + pct + '%)' + sizeStr;
};

FAR._videoShowBadge = function (text, show) {
    const badge = document.getElementById('videoBufferingBadge');
    const txt = document.getElementById('videoBufferingText');
    if (!badge) return;
    if (show && text) {
        if (txt) txt.textContent = text;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
};

// ============================================================
// Очистка ресурсов
// ============================================================

FAR._videoAbortAll = function () {
    if (FAR._videoAbortFetch) {
        try { FAR._videoAbortFetch.abort(); } catch (e) {}
        FAR._videoAbortFetch = null;
    }
    FAR._videoFetching = false;
};

FAR._videoCleanupMediaSource = function () {
    // Закрываем SourceBuffer
    if (FAR._videoSourceBuffer) {
        try {
            const ms = FAR._videoMediaSource;
            if (ms && ms.readyState === 'open') {
                ms.removeSourceBuffer(FAR._videoSourceBuffer);
            }
        } catch (e) { /* ignore */ }
        FAR._videoSourceBuffer = null;
    }

    // Закрываем MediaSource
    if (FAR._videoMediaSource) {
        try {
            if (FAR._videoMediaSource.readyState === 'open') {
                FAR._videoMediaSource.endOfStream();
            }
        } catch (e) {}
        FAR._videoMediaSource = null;
    }

    // Освобождаем objectURL
    if (FAR._videoObjectUrl) {
        try { URL.revokeObjectURL(FAR._videoObjectUrl); } catch (e) {}
        FAR._videoObjectUrl = null;
    }
};

// ============================================================
// Скачивание
// ============================================================

FAR.downloadCurrentVideo = async function () {
    if (!FAR._videoCurrentItem) {
        FAR.toast('Нет активного видео', 'warning');
        return;
    }
    const side = FAR._videoCurrentSide || FAR.activePanel;
    try {
        const { data, contentType } = await FAR.readFileBodyFromSide(side, FAR._videoCurrentItem);
        const blob = new Blob([data], { type: contentType || 'video/mp4' });
        FAR.saveBlobAs(blob, FAR.sanitizeFileName(FAR._videoCurrentItem.name));
        FAR.toast('Видео сохранено', 'success');
    } catch (e) {
        FAR.toast('Ошибка скачивания: ' + e.message, 'error');
    }
};

FAR._videoSeekbarDrag = {
    active: false,
    wasPlaying: false
};



FAR._videoAttachSeekbar = function () {
    const track = document.getElementById('videoSeekTrack');
    if (!track) return;
    if (track._farBound) return;
    track._farBound = true;

    const isFullscreen = function () {
        return !!(document.fullscreenElement ||
                  document.webkitFullscreenElement ||
                  document.mozFullScreenElement ||
                  document.msFullscreenElement);
    };

    const posToRatio = function (clientX) {
        const rect = track.getBoundingClientRect();
        const x = clientX - rect.left;
        return Math.max(0, Math.min(1, x / rect.width));
    };

    const seekTo = function (ratio) {
        const v = FAR._videoEl;
        if (!v || !isFinite(v.duration) || v.duration <= 0) return;
        try {
            v.currentTime = ratio * v.duration;
        } catch (e) { /* ignore */ }
    };

    // Клик по полосе — мгновенный переход
    track.addEventListener('click', function (e) {
        if (FAR._videoSeekbarDrag.active) return;
        seekTo(posToRatio(e.clientX));
    });

    // Начало перетаскивания
    track.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        FAR._videoSeekbarDrag.active = true;
        FAR._videoSeekbarDrag.wasPlaying = FAR._videoEl && !FAR._videoEl.paused;

        if (FAR._videoEl) {
            try { FAR._videoEl.pause(); } catch (err) {}
        }

        const onMove = function (ev) {
            const ratio = posToRatio(ev.clientX);
            FAR._videoSeekbarPreview(ratio);
        };

        const onUp = function (ev) {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);

            const ratio = posToRatio(ev.clientX);
            seekTo(ratio);
            FAR._videoSeekbarDrag.active = false;

            // Возобновляем воспроизведение, если играло до перетаскивания
            if (FAR._videoSeekbarDrag.wasPlaying && FAR._videoEl) {
                FAR._videoEl.play().catch(function () {});
            }
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    });

    // Наведение на полосу — курсор pointer
    track.style.cursor = 'pointer';
};

FAR._videoSeekbarPreview = function (ratio) {
    const fill = document.getElementById('videoSeekFill');
    const thumb = document.getElementById('videoSeekThumb');
    const timeEl = document.getElementById('videoTimeDisplay');
    const v = FAR._videoEl;

    if (fill)  fill.style.width  = (ratio * 100) + '%';
    if (thumb) thumb.style.left  = (ratio * 100) + '%';
    if (timeEl && v && isFinite(v.duration)) {
        const t = ratio * v.duration;
        timeEl.textContent = FAR._videoFormatTime(t) + ' / ' + FAR._videoFormatTime(v.duration);
    }
};
FAR._videoOnTimeUpdate = function () {
    const v = FAR._videoEl;
    if (!v) return;
    if (FAR._videoSeekbarDrag.active) return; // не мешаем перетаскиванию

    const dur = v.duration;
    if (!isFinite(dur) || dur <= 0) return;

    const ratio = v.currentTime / dur;
    const fill  = document.getElementById('videoSeekFill');
    const thumb = document.getElementById('videoSeekThumb');
    const timeEl = document.getElementById('videoTimeDisplay');
    // Скрываем полосу в fullscreen через JS (дублирует CSS)
    const seekbar = document.getElementById('videoSeekbar');
    const isFs = !!(document.fullscreenElement ||
                    document.webkitFullscreenElement ||
                    document.mozFullScreenElement ||
                    document.msFullscreenElement);
    if (seekbar) {
        seekbar.style.display = isFs ? 'none' : '';
    }

    if (fill)  fill.style.width  = (ratio * 100) + '%';
    if (thumb) thumb.style.left  = (ratio * 100) + '%';
    if (timeEl) {
        timeEl.textContent =
            FAR._videoFormatTime(v.currentTime) + ' / ' +
            FAR._videoFormatTime(dur);
    }
};

FAR._videoOnMetadata = function () {
    FAR._videoOnTimeUpdate();
};

FAR._videoOnProgress = function () {
    const v = FAR._videoEl;
    if (!v || !v.buffered || v.buffered.length === 0) return;
    if (!isFinite(v.duration) || v.duration <= 0) return;

    // Показываем буферизованный диапазон на полосе
    let bufEnd = 0;
    for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime) {
            bufEnd = v.buffered.end(i);
            break;
        }
        bufEnd = Math.max(bufEnd, v.buffered.end(i));
    }

    const buffered = document.getElementById('videoSeekBuffered');
    if (buffered) {
        buffered.style.width = ((bufEnd / v.duration) * 100) + '%';
    }

    // Обновляем строку статуса в футере
    FAR._videoUpdateLoadStatus();
};

FAR._videoFormatTime = function (sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
};


FAR._videoAttachKeyHandler = function () {
    if (FAR._videoKeyHandler) return;

    FAR._videoKeyHandler = function (e) {
        const modal = document.getElementById('videoViewerModal');
        if (!modal || modal.classList.contains('hidden')) return;
        if (!FAR._videoEl) return;

        // Не перехватываем, если фокус в поле ввода
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

        let handled = false;

        if (e.key === 'ArrowLeft') {
            try {
                FAR._videoEl.currentTime = Math.max(0, FAR._videoEl.currentTime - 5);
            } catch (err) {}
            handled = true;
        } else if (e.key === 'ArrowRight') {
            try {
                FAR._videoEl.currentTime = Math.min(
                    FAR._videoEl.duration || Infinity,
                    FAR._videoEl.currentTime + 5
                );
            } catch (err) {}
            handled = true;
        } else if (e.key === ' ' || e.code === 'Space') {
            FAR.videoTogglePlay();
            handled = true;
        } else if (e.key === 'f' || e.key === 'F') {
            FAR.videoToggleFullscreen();
            handled = true;
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    document.addEventListener('keydown', FAR._videoKeyHandler, true);
};

FAR._videoDetachKeyHandler = function () {
    if (!FAR._videoKeyHandler) return;
    document.removeEventListener('keydown', FAR._videoKeyHandler, true);
    FAR._videoKeyHandler = null;
};