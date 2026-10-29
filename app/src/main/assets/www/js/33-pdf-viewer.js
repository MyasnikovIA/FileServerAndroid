// ============================================================
// Просмотр PDF через PDFObject в полноэкранной модалке
// ============================================================

FAR._pdfCurrentItem   = null;   // fileIndex-элемент текущего PDF
FAR._pdfCurrentBlobUrl = null;  // Blob URL текущего PDF
FAR._pdfBlobUrls      = [];     // Все созданные Blob URL для очистки

/**
 * Проверяет, является ли файл PDF.
 * По расширению .pdf или contentType application/pdf.
 */
FAR.isPdf = function(item) {
    if (!item || item.isFolder) return false;

    const name = item.name || item.path || '';
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return true;

    const ct = (item.contentType || '').toLowerCase();
    if (ct === 'application/pdf' || ct.indexOf('application/pdf') === 0) return true;

    return false;
};

/**
 * Открывает PDF в полноэкранной модалке.
 */
FAR.openPdfViewer = async function(item, side) {
    side = side || FAR.activePanel;

    if (!FAR.ensureDb()) return;
    if (typeof FAR._ensureItemName === 'function') {
        FAR._ensureItemName(item);
    }

    // Закрываем прочие модалки
    try { FAR.closeViewer(); } catch (e) {}
    try { FAR.closePanoramaViewer(); } catch (e) {}
    try { if (typeof FAR.closeJsdosViewer    === 'function') FAR.closeJsdosViewer();    } catch (e) {}
    try { if (typeof FAR.closeNesViewer      === 'function') FAR.closeNesViewer();      } catch (e) {}
    try { if (typeof FAR.closeEmulatorViewer === 'function') FAR.closeEmulatorViewer(); } catch (e) {}

    FAR._pdfCurrentItem = item;
    FAR._pdfCurrentSide = side;
    FAR._pdfBlobUrls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    FAR._pdfBlobUrls = [];

    const modal       = document.getElementById('pdfViewerModal');
    const title       = document.getElementById('pdfViewerTitle');
    const info        = document.getElementById('pdfViewerInfo');
    const loading     = document.getElementById('pdfLoading');
    const loadingText = document.getElementById('pdfLoadingText');
    const root        = document.getElementById('pdfRoot');

    title.textContent = '📄 ' + (item.name || item.path);
    info.textContent = '';
    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    loadingText.textContent = 'Загрузка PDF…';

    // Очищаем контейнер
    root.innerHTML = '';

    // === Проверяем наличие библиотеки PDFObject ===
    if (typeof PDFObject === 'undefined' || !PDFObject || typeof PDFObject.embed !== 'function') {
        loading.classList.add('hidden');
        FAR._pdfRenderFallback(root, item, 'Библиотека PDFObject не загружена.\n' +
            'Проверьте подключение lib/PDFObject/pdfobject.min.js');
        FAR.toast('PDFObject не найден', 'error');
        return;
    }

    // === Загружаем файл из БД конкретной панели ===
    let blob = null;
    try {
        const { data, contentType } = await FAR.readFileBodyFromSide(side, item);
        blob = new Blob([data], { type: contentType || 'application/pdf' });
        info.textContent = `📄 ${FAR.formatSize(data.length)}`;
    } catch (e) {
        console.error('openPdfViewer: readFileBodyFromSide failed:', e);
        loading.classList.add('hidden');
        FAR._pdfRenderFallback(root, item, 'Не удалось загрузить PDF: ' + e.message);
        FAR.toast('Ошибка загрузки PDF: ' + e.message, 'error');
        return;
    }

    const blobUrl = URL.createObjectURL(blob);
    FAR._pdfBlobUrls.push(blobUrl);
    FAR._pdfCurrentBlobUrl = blobUrl;

    // Даём модалке отрисоваться
    await new Promise(function(resolve) { setTimeout(resolve, 30); });

    // === Встраиваем PDF через PDFObject ===
    try {
        if (PDFObject.supportsPDFs) {
            PDFObject.embed(blobUrl, '#pdfRoot', {
                title: item.name || 'PDF',
                omitInlineStyles: false
            });
            loading.classList.add('hidden');
            FAR.setStatus('📄 PDF: ' + (item.name || item.path));
            FAR.toast('PDF открыт', 'success');
        } else {
            loading.classList.add('hidden');
            FAR._pdfRenderFallback(root, item,
                'Этот браузер не умеет встраивать PDF inline.\n' +
                'Скачайте файл и откройте его во внешней программе.');
        }
    } catch (e) {
        console.error('openPdfViewer: embed failed:', e);
        loading.classList.add('hidden');
        FAR._pdfRenderFallback(root, item, 'Ошибка встраивания PDF: ' + e.message);
        FAR.toast('Ошибка встраивания PDF: ' + e.message, 'error');
    }
};

/**
 * Рисует фолбэк-заглушку, если PDF не удалось встроить.
 */
FAR._pdfRenderFallback = function(root, item, message) {
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'pdf-fallback';

    const icon = document.createElement('div');
    icon.className = 'pdf-fallback-icon';
    icon.textContent = '📄';

    const txt = document.createElement('div');
    txt.className = 'pdf-fallback-text';
    txt.textContent = message || 'PDF не может быть показан в браузере.';

    const btn = document.createElement('button');
    btn.textContent = '📥 Скачать PDF';
    btn.onclick = function() { FAR.downloadCurrentPdf(); };

    box.appendChild(icon);
    box.appendChild(txt);
    box.appendChild(btn);
    root.appendChild(box);
};

/**
 * Закрывает модалку PDF и выгружает ресурсы.
 */
FAR.closePdfViewer = function() {
    const modal = document.getElementById('pdfViewerModal');
    if (modal) modal.classList.add('hidden');

    // Чистим DOM (в т.ч. iframe, который держит PDF)
    const root = document.getElementById('pdfRoot');
    if (root) root.innerHTML = '';

    // Освобождаем Blob URL
    FAR._pdfBlobUrls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    FAR._pdfBlobUrls = [];

    FAR._pdfCurrentBlobUrl = null;
    FAR._pdfCurrentItem = null;
    FAR._pdfCurrentSide = null;
};

FAR.closePdfViewerOutside = function(e) {
    if (e.target === e.currentTarget) FAR.closePdfViewer();
};

/**
 * Скачивает оригинальный PDF.
 */
FAR.downloadCurrentPdf = async function() {
    if (!FAR._pdfCurrentItem) {
        FAR.toast('Нет активного PDF', 'warning');
        return;
    }
    const side = FAR._pdfCurrentSide || FAR.activePanel;
    try {
        const { data, contentType } = await FAR.readFileBodyFromSide(side, FAR._pdfCurrentItem);
        const blob = new Blob([data], { type: contentType || 'application/pdf' });
        const name = FAR._pdfCurrentItem.name ||
                     (FAR._pdfCurrentItem.path.split('/').pop()) || 'document.pdf';
        FAR.saveBlobAs(blob, FAR.sanitizeFileName(name));
        FAR.toast('PDF сохранён', 'success');
    } catch (e) {
        FAR.toast('Ошибка скачивания: ' + e.message, 'error');
    }
};