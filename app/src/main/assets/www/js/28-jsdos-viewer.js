// ============================================================
// 28-jsdos-viewer.js — Просмотр JSDOS-игр в полноэкранной модалке
// ============================================================

FAR._jsdosInstance = null;
FAR._jsdosCurrentItem = null;
FAR._jsdosCurrentUrl = null;
FAR._jsdosBlobUrls = [];
FAR._jsdosRunTimeout = null;

// Сколько ждём run() (загрузка ядра + bundle + инициализация).
// Если игра требует «Click to start» — таймаут успеет сработать раньше.
FAR.JSDOS_RUN_TIMEOUT_MS = 60000;

FAR.isJsdos = function (item) {
    if (!item || item.isFolder) return false;
    const ext = (item.name.split('.').pop() || '').toLowerCase();
    return ext === 'jsdos';
};

/**
 * Переводит фокус на canvas JSDOS, чтобы клавиатура уходила
 * внутрь эмулятора, а не в панели FAR.
 */
FAR._jsdosFocus = function (root) {
    if (!root) return;
    try {
        root.setAttribute('tabindex', '0');
        root.focus();
    } catch (e) { /* ignore */ }

    setTimeout(function () {
        try {
            const canvas = root.querySelector('canvas');
            if (canvas) {
                canvas.setAttribute('tabindex', '0');
                canvas.style.outline = 'none';
                canvas.style.imageRendering = 'pixelated';
                canvas.focus();
            }
        } catch (e) { /* ignore */ }
    }, 100);
};

/**
 * Возвращает фокус в файловый менеджер.
 */
FAR._jsdosBlur = function (root) {
    try { if (root) root.blur(); } catch (e) { /* ignore */ }
    try {
        if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
        }
    } catch (e) { /* ignore */ }
    try { document.body.focus(); } catch (e) { /* ignore */ }
};

/**
 * Открывает .jsdos-архив в полноэкранной модалке.
 *
 * Логика совместима с js-dos 6.x (lib/js-dos/js-dos.js).
 * - clickToStart:true — нужен, чтобы:
 *     1) оверлей «Click to start» показался ровно после готовности;
 *     2) пользователь кликнул и браузер разрешил аудио (autoplay-policy).
 * - Никаких CSS-хаков с position:absolute на прямых потомках
 *   .jsdos-root — это ломает flex-layout js-dos.
 */
FAR.openJsdosViewer = async function (item, side) {
    side = side || FAR.activePanel;

    if (!FAR.ensureDb()) return;
    if (typeof FAR._ensureItemName === 'function') FAR._ensureItemName(item);

    if (!window.Dos) {
        FAR.toast('Библиотека JS-DOS не загружена', 'error');
        console.error('[JSDOS] window.Dos не определён — проверьте подключение lib/js-dos/js-dos.js');
        return;
    }

    try { FAR.closeViewer(); } catch (e) {}
    try { FAR.closePanoramaViewer(); } catch (e) {}

    FAR._jsdosCurrentItem = item;
    FAR._jsdosCurrentSide = side;
    FAR._jsdosBlobUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    FAR._jsdosBlobUrls = [];

    const modal       = document.getElementById('jsdosViewerModal');
    const title       = document.getElementById('jsdosViewerTitle');
    const info        = document.getElementById('jsdosViewerInfo');
    const loading     = document.getElementById('jsdosLoading');
    const loadingText = document.getElementById('jsdosLoadingText');
    const root        = document.getElementById('jsdosRoot');

    if (!modal || !root) {
        console.error('[JSDOS] Модалка #jsdosViewerModal или #jsdosRoot не найдена');
        FAR.toast('Модалка JSDOS не найдена', 'error');
        return;
    }

    title.textContent = '🕹️ ' + item.name;
    info.textContent = '';
    modal.classList.remove('hidden');
    if (loading) loading.classList.remove('hidden');
    if (loadingText) loadingText.textContent = 'Загрузка игры…';

    // Уничтожаем предыдущий инстанс и сбрасываем таймаут
    if (FAR._jsdosInstance) {
        try { FAR._jsdosInstance.stop(); } catch (e) {}
        FAR._jsdosInstance = null;
    }
    if (FAR._jsdosRunTimeout) {
        clearTimeout(FAR._jsdosRunTimeout);
        FAR._jsdosRunTimeout = null;
    }

    root.innerHTML = '';

    // 1. Читаем тело .jsdos-файла из БД
    let url = null;
    let fileSize = 0;
    try {
        const { data, contentType } = await FAR.readFileBodyFromSide(side, item);
        const blob = new Blob([data], { type: contentType || 'application/octet-stream' });
        url = URL.createObjectURL(blob);
        FAR._jsdosBlobUrls.push(url);
        FAR._jsdosCurrentUrl = url;
        fileSize = data.length;
        info.textContent = `📦 ${FAR.formatSize(fileSize)}`;
    } catch (e) {
        console.error('[JSDOS] readFileBodyFromSide failed:', e);
        if (loading) loading.classList.add('hidden');
        FAR.toast('Не удалось прочитать файл: ' + e.message, 'error');
        return;
    }

    // 2. Даём модалке отрисоваться
    await new Promise(function (resolve) { setTimeout(resolve, 50); });

    // 3. Настраиваем pathPrefix для js-dos
    const pathPrefix = new URL('lib/js-dos/', window.location.href).href;
    console.log('[JSDOS] pathPrefix =', pathPrefix);

    if (typeof window.emulators !== 'undefined') {
        window.emulators.pathPrefix = pathPrefix;
        if (!window.emulators.wdosboxJs) {
            window.emulators.wdosboxJs = 'wdosbox.js';
        }
    } else {
        console.warn('[JSDOS] window.emulators не определён — js-dos.js мог не загрузиться полностью');
    }

    // 4. Создаём инстанс js-dos.
    //    clickToStart:true — критично для стабильного запуска:
    //      • браузер разрешает аудио только по user gesture;
    //      • js-dos показывает свой оверлей «Click to start»,
    //        скрывая наш .jsdos-loading.
    try {
        FAR._jsdosInstance = window.Dos(root, {
            wdosboxUrl: pathPrefix + 'wdosbox.js',
            pathPrefix: pathPrefix,
            clickToStart: true
        });
    } catch (e) {
        console.error('[JSDOS] Dos() failed:', e);
        if (loading) loading.classList.add('hidden');
        FAR.toast('Ошибка инициализации JSDOS: ' + e.message, 'error');
        return;
    }

    // 5. Запускаем игру с таймаутом, чтобы не зависнуть,
    //    если ядро не загрузилось или bundle повреждён.
    const runPromise = FAR._jsdosInstance.run(url);
    const timeoutPromise = new Promise(function (_, reject) {
        FAR._jsdosRunTimeout = setTimeout(function () {
            reject(new Error(
                'Таймаут запуска (' + (FAR.JSDOS_RUN_TIMEOUT_MS / 1000) +
                ' сек). Возможно, ядро wdosbox.js не загрузилось ' +
                'или .jsdos bundle повреждён.'
            ));
        }, FAR.JSDOS_RUN_TIMEOUT_MS);
    });

    try {
        await Promise.race([runPromise, timeoutPromise]);

        if (FAR._jsdosRunTimeout) {
            clearTimeout(FAR._jsdosRunTimeout);
            FAR._jsdosRunTimeout = null;
        }
        if (loading) loading.classList.add('hidden');

        FAR.setStatus('🕹️ JSDOS: ' + item.name);
        FAR.toast('Игра запущена', 'success');

        FAR._jsdosFocus(root);
    } catch (e) {
        if (FAR._jsdosRunTimeout) {
            clearTimeout(FAR._jsdosRunTimeout);
            FAR._jsdosRunTimeout = null;
        }
        console.error('[JSDOS] run failed:', e);

        // Останавливаем «подвисший» инстанс
        if (FAR._jsdosInstance) {
            try { FAR._jsdosInstance.stop(); } catch (e2) {}
            FAR._jsdosInstance = null;
        }

        if (loading) loading.classList.add('hidden');
        FAR.toast('Не удалось запустить игру: ' + e.message, 'error');
    }
};

/**
 * Закрывает модалку JSDOS.
 */
FAR.closeJsdosViewer = function () {
    const modal = document.getElementById('jsdosViewerModal');
    if (modal) modal.classList.add('hidden');

    if (FAR._jsdosRunTimeout) {
        clearTimeout(FAR._jsdosRunTimeout);
        FAR._jsdosRunTimeout = null;
    }

    if (FAR._jsdosInstance) {
        try { FAR._jsdosInstance.stop(); } catch (e) {}
        FAR._jsdosInstance = null;
    }

    FAR._jsdosBlobUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    FAR._jsdosBlobUrls = [];
    FAR._jsdosCurrentUrl = null;

    const root = document.getElementById('jsdosRoot');
    if (root) root.innerHTML = '';

    FAR._jsdosBlur(root);

    FAR._jsdosCurrentItem = null;
    FAR._jsdosCurrentSide = null;
};

FAR.closeJsdosViewerOutside = function (e) {
    if (e.target === e.currentTarget) FAR.closeJsdosViewer();
};

/**
 * Скачивает оригинальный .jsdos-файл.
 */
FAR.downloadCurrentJsdos = async function () {
    if (!FAR._jsdosCurrentItem) {
        FAR.toast('Нет активной игры', 'warning');
        return;
    }
    const side = FAR._jsdosCurrentSide || FAR.activePanel;
    try {
        const { data, contentType } = await FAR.readFileBodyFromSide(side, FAR._jsdosCurrentItem);
        const blob = new Blob([data], { type: contentType || 'application/octet-stream' });
        FAR.saveBlobAs(blob, FAR.sanitizeFileName(FAR._jsdosCurrentItem.name));
        FAR.toast('Файл сохранён', 'success');
    } catch (e) {
        FAR.toast('Ошибка скачивания: ' + e.message, 'error');
    }
};