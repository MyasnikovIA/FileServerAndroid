// ============================================================
// Просмотр NES-игр (JSNES) в полноэкранной модалке
// ============================================================

FAR._nesBrowser = null;
FAR._nesCurrentItem = null;
FAR._nesBlobUrls = [];
FAR._jsnesLoadPromise = null;   // Promise загрузки jsnes.min.js

/**
 * Проверяет, является ли файл NES-ROM.
 */
FAR.isNes = function(item) {
    if (!item || item.isFolder) return false;
    const ext = (item.name.split('.').pop() || '').toLowerCase();
    return ext === 'nes';
};

/**
 * Асинхронно загружает jsnes.min.js динамически.
 * Возвращает Promise<jsnes>.
 *
 * Почему так: при обычном <script src> UMD-обёртка jsnes.min.js
 * видит window.module / window.exports (которые могут быть
 * определены расширениями браузера или другой библиотекой)
 * и идёт по ветке CommonJS, не создавая window.jsnes.
 *
 * Здесь мы временно "прячем" module/exports, исполняем код как
 * Blob URL через <script>, и восстанавливаем их после.
 */
FAR._loadJsnesDynamically = function() {
    if (window.jsnes && window.jsnes.Browser) {
        return Promise.resolve(window.jsnes);
    }
    if (FAR._jsnesLoadPromise) {
        return FAR._jsnesLoadPromise;
    }

    FAR._jsnesLoadPromise = (async function() {
        const url = 'lib/js-nes/jsnes.min.js';

        console.log('[JSNES] Загрузка:', url);

        // 1. Скачиваем исходник
        const res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) {
            throw new Error('Не удалось скачать ' + url + ' (HTTP ' + res.status + ')');
        }
        const code = await res.text();
        console.log('[JSNES] Размер:', code.length, 'байт');

        // 2. Прячем CommonJS-переменные, чтобы UMD выбрал ветку globalThis
        const savedExports = window.exports;
        const savedModule  = window.module;
        try {
            window.exports = undefined;
            window.module  = undefined;
        } catch (e) { /* ignore */ }

        // 3. Создаём Blob URL и исполняем через <script>
        const blob = new Blob([code], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);

        try {
            await new Promise(function(resolve, reject) {
                const script = document.createElement('script');
                script.src = blobUrl;
                script.onload = function() {
                    URL.revokeObjectURL(blobUrl);
                    script.remove();
                    resolve();
                };
                script.onerror = function() {
                    URL.revokeObjectURL(blobUrl);
                    script.remove();
                    reject(new Error('Ошибка исполнения ' + url));
                };
                document.head.appendChild(script);
            });
        } finally {
            // 4. Восстанавливаем
            try {
                window.exports = savedExports;
                window.module  = savedModule;
            } catch (e) { /* ignore */ }
        }

        // 5. Проверяем результат
        if (!window.jsnes || !window.jsnes.Browser) {
            throw new Error('jsnes.min.js выполнен, но window.jsnes не создан');
        }

        console.log('[JSNES] Загружено, Browser:', typeof window.jsnes.Browser);
        return window.jsnes;
    })();

    // Если загрузка провалилась — сбрасываем промис, чтобы можно было повторить
    FAR._jsnesLoadPromise.catch(function() {
        FAR._jsnesLoadPromise = null;
    });

    return FAR._jsnesLoadPromise;
};

/**
 * Открывает NES-ROM в полноэкранной модалке.
 */
FAR.openNesViewer = async function(item, side) {
    side = side || FAR.activePanel;

    if (!FAR.ensureDb()) return;
    if (typeof FAR._ensureItemName === 'function') {
        FAR._ensureItemName(item);
    }

    // Закрываем другие модалки, если открыты
    try { FAR.closeViewer(); } catch (e) {}
    try { FAR.closePanoramaViewer(); } catch (e) {}
    try { if (typeof FAR.closeJsdosViewer === 'function') FAR.closeJsdosViewer(); } catch (e) {}

    FAR._nesCurrentItem = item;
    FAR._nesCurrentSide = side;
    FAR._nesBlobUrls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    FAR._nesBlobUrls = [];

    const modal = document.getElementById('nesViewerModal');
    const title = document.getElementById('nesViewerTitle');
    const info = document.getElementById('nesViewerInfo');
    const loading = document.getElementById('nesLoading');
    const loadingText = document.getElementById('nesLoadingText');
    const root = document.getElementById('nesRoot');

    title.textContent = '🎮 ' + item.name;
    info.textContent = '';
    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    loadingText.textContent = 'Загрузка библиотеки эмулятора…';

    // Уничтожаем предыдущий инстанс
    if (FAR._nesBrowser) {
        try { FAR._nesBrowser.destroy(); } catch (e) {}
        FAR._nesBrowser = null;
    }

    root.innerHTML = '';

    // === ШАГ 1: загрузить JSNES ===
    let jsnesLib = null;
    try {
        jsnesLib = await FAR._loadJsnesDynamically();
    } catch (e) {
        console.error('[JSNES] load failed:', e);
        loading.classList.add('hidden');
        FAR.toast('Не удалось загрузить эмулятор: ' + e.message, 'error');
        return;
    }

    // === ШАГ 2: загрузить ROM ===
    loadingText.textContent = 'Загрузка ROM…';
    let romBuffer = null;
    try {
        const { data } = await FAR.readFileBodyFromSide(side, item);
        romBuffer = data;
        info.textContent = `💾 ${FAR.formatSize(data.length)}`;
    } catch (e) {
        console.error('openNesViewer: readFileBodyFromSide failed:', e);
        loading.classList.add('hidden');
        FAR.toast('Не удалось загрузить ROM: ' + e.message, 'error');
        return;
    }

    // Диагностика
    try {
        const head = Array.from(romBuffer.slice(0, 16))
            .map(b => b.toString(16).padStart(2, '0')).join(' ');
        console.log('[NES] ROM header:', head);
    } catch (e) { /* ignore */ }

    await new Promise(function(resolve) { setTimeout(resolve, 30); });

    // === ШАГ 3: создаём эмулятор и запускаем игру ===
    try {
        loadingText.textContent = 'Инициализация…';

        FAR._nesBrowser = new jsnesLib.Browser({
            container: root,
            onError: function(e) {
                console.error('JSNES error:', e);
                FAR.toast('Ошибка NES: ' + (e && e.message ? e.message : e), 'error');
            }
        });

        // ============================================================
        // ВАЖНО: передаём Uint8Array напрямую.
        // См. комментарий в 45-wm-bridge.js#_mountNesViewer.
        // ============================================================
        FAR._nesBrowser.loadROM(romBuffer);

        setTimeout(function() {
            try { FAR._nesBrowser && FAR._nesBrowser.fitInParent(); } catch (e) {}
        }, 100);
        setTimeout(function() {
            try { FAR._nesBrowser && FAR._nesBrowser.fitInParent(); } catch (e) {}
        }, 400);

        loading.classList.add('hidden');
        FAR.setStatus('🎮 NES: ' + item.name);
        FAR.toast('Игра запущена', 'success');

    } catch (e) {
        console.error('openNesViewer: loadROM failed:', e);
        loading.classList.add('hidden');
        FAR.toast('Не удалось запустить игру: ' + e.message, 'error');
    }
};

/**
 * Закрывает модалку NES.
 */
FAR.closeNesViewer = function() {
    const modal = document.getElementById('nesViewerModal');
    if (modal) modal.classList.add('hidden');

    if (FAR._nesBrowser) {
        try { FAR._nesBrowser.destroy(); } catch (e) {}
        FAR._nesBrowser = null;
    }

    FAR._nesBlobUrls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    FAR._nesBlobUrls = [];

    const root = document.getElementById('nesRoot');
    if (root) root.innerHTML = '';

    FAR._nesCurrentItem = null;
    FAR._nesCurrentSide = null;
};

FAR.closeNesViewerOutside = function(e) {
    if (e.target === e.currentTarget) FAR.closeNesViewer();
};

/**
 * Скачивает оригинальный .nes файл.
 */
FAR.downloadCurrentNes = async function() {
    if (!FAR._nesCurrentItem) {
        FAR.toast('Нет активной игры', 'warning');
        return;
    }
    const side = FAR._nesCurrentSide || FAR.activePanel;
    try {
        const { data, contentType } = await FAR.readFileBodyFromSide(side, FAR._nesCurrentItem);
        const blob = new Blob([data], { type: contentType || 'application/octet-stream' });
        FAR.saveBlobAs(blob, FAR.sanitizeFileName(FAR._nesCurrentItem.name));
        FAR.toast('Файл сохранён', 'success');
    } catch (e) {
        FAR.toast('Ошибка скачивания: ' + e.message, 'error');
    }
};