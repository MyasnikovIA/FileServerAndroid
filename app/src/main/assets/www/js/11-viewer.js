// ============================================================
// Универсальный просмотрщик файлов + навигация ◀ / ▶
// ============================================================

FAR._viewerSide  = null;
FAR._viewerIndex = -1;
FAR._viewerToken = 0;

FAR.VIEWER_MODALS = [
    { modal: 'viewerModal',            prev: 'viewerPrevBtn', next: 'viewerNextBtn' },
    { modal: 'panoramaViewerModal',    prev: 'panoPrevBtn',   next: 'panoNextBtn'   },
    { modal: 'pdfViewerModal',         prev: 'pdfPrevBtn',    next: 'pdfNextBtn'    },
    { modal: 'mp3ViewerModal',         prev: 'mp3PrevBtn',    next: 'mp3NextBtn'    },
    { modal: 'videoViewerModal',       prev: 'videoPrevBtn',  next: 'videoNextBtn'  },
    { modal: 'jsdosViewerModal',       prev: 'jsdosPrevBtn',  next: 'jsdosNextBtn'  },
    { modal: 'emulatorViewerModal',    prev: 'emuPrevBtn',    next: 'emuNextBtn'    },
    { modal: 'lbrn2ViewerModal',       prev: 'lbrn2PrevBtn',  next: 'lbrn2NextBtn'  },
    { modal: 'gcodeViewerModal',       prev: 'gcodePrevBtn',  next: 'gcodeNextBtn'  }
];

FAR._viewerEnsureFn = function (name) {
    if (typeof FAR[name] === 'function') return true;
    console.error(
        '[viewer] Функция FAR.' + name + ' не найдена. ' +
        'Проверьте, что соответствующий модуль подключён в index.html ' +
        'и не упал с синтаксической ошибкой.'
    );
    return false;
};

FAR._viewerFindFileIndex = function (side, fromIndex, dir) {
    const ctx = FAR.side[side];
    const files = ctx ? ctx.files : null;
    if (!files || files.length === 0) return -1;

    let i = fromIndex + dir;
    while (i >= 0 && i < files.length) {
        const it = files[i];
        if (it && !it.isFolder) return i;
        i += dir;
    }
    return -1;
};

FAR._viewerResolveIndex = function (side, item) {
    if (!side || !item) return -1;
    const ctx = FAR.side[side];
    if (!ctx || !Array.isArray(ctx.files)) return -1;

    if (item._id) {
        for (let i = 0; i < ctx.files.length; i++) {
            const f = ctx.files[i];
            if (f && f._id === item._id) return i;
        }
    }
    if (item.path) {
        const np = FAR.normPath(item.path);
        for (let i = 0; i < ctx.files.length; i++) {
            const f = ctx.files[i];
            if (f && FAR.normPath(f.path) === np) return i;
        }
    }
    return -1;
};

FAR._viewerUpdateNavButtons = function () {
    const side  = FAR._viewerSide;
    const index = FAR._viewerIndex;

    let prevIdx = -1;
    let nextIdx = -1;

    if (side && FAR.side[side] && index >= 0) {
        prevIdx = FAR._viewerFindFileIndex(side, index, -1);
        nextIdx = FAR._viewerFindFileIndex(side, index, +1);
    }

    FAR.VIEWER_MODALS.forEach(function (pair) {
        const prevBtn = document.getElementById(pair.prev);
        const nextBtn = document.getElementById(pair.next);
        if (prevBtn) prevBtn.classList.toggle('hidden', prevIdx < 0);
        if (nextBtn) nextBtn.classList.toggle('hidden', nextIdx < 0);
    });
};

FAR._viewerCloseAll = function () {
    try { if (typeof FAR.closeViewer         === 'function') FAR.closeViewer();         } catch (e) {}
    try { if (typeof FAR.closePanoramaViewer === 'function') FAR.closePanoramaViewer(); } catch (e) {}
    try { if (typeof FAR.closePdfViewer      === 'function') FAR.closePdfViewer();      } catch (e) {}
    try { if (typeof FAR.closeMp3Viewer      === 'function') FAR.closeMp3Viewer();      } catch (e) {}
    try { if (typeof FAR.closeVideoViewer    === 'function') FAR.closeVideoViewer();    } catch (e) {}
    try { if (typeof FAR.closeJsdosViewer    === 'function') FAR.closeJsdosViewer();    } catch (e) {}
    try { if (typeof FAR.closeEmulatorViewer === 'function') FAR.closeEmulatorViewer(); } catch (e) {}
    try { if (typeof FAR.closeLbrn2Viewer    === 'function') FAR.closeLbrn2Viewer();    } catch (e) {}
    try { if (typeof FAR.closeGcodeViewer    === 'function') FAR.closeGcodeViewer();    } catch (e) {}
};

FAR.viewerNavigate = async function (dir) {
    const side  = FAR._viewerSide;
    const index = FAR._viewerIndex;
    if (!side || index < 0) return;

    const targetIdx = FAR._viewerFindFileIndex(side, index, dir);
    if (targetIdx < 0) {
        FAR._viewerUpdateNavButtons();
        return;
    }

    const files = FAR.side[side].files;
    const item  = files[targetIdx];
    if (!item) return;

    const prevSide  = FAR._viewerSide;
    const prevIndex = FAR._viewerIndex;
    FAR._viewerSide  = side;
    FAR._viewerIndex = targetIdx;

    FAR._viewerCloseAll();

    try {
        await FAR.openFile(item, side, targetIdx);
        if (typeof FAR._selectFileInPanel === 'function') {
            FAR._selectFileInPanel(item, side);
        }
    } catch (e) {
        console.error('viewerNavigate:', e);
        FAR._viewerSide  = prevSide;
        FAR._viewerIndex = prevIndex;
        FAR._viewerUpdateNavButtons();
        FAR.toast('Не удалось открыть файл: ' + e.message, 'error');
    }
};

FAR._viewerReadBody = async function (side, item) {
    if (typeof FAR.readFileBodyFromSide === 'function') {
        return FAR.readFileBodyFromSide(side, item);
    }
    if (typeof FAR.readFileBody === 'function') {
        return FAR.readFileBody(item);
    }
    throw new Error('Ни readFileBodyFromSide, ни readFileBody не загружены');
};

FAR.openFile = async function (item, side, index) {
    side = side || FAR.activePanel;
    if (typeof FAR.isApkFile === 'function'
        && FAR.isApkFile(item)
        && window.FAR.AndroidPrograms
        && FAR.AndroidPrograms.available) {
        FAR.AndroidPrograms.installApk(item.path);
        return;
    }

    const ctx = FAR.side[side];
    if (!ctx || !ctx.db) {
        FAR.toast('Панель не подключена к БД', 'warning');
        FAR.openConnModal(false, side);
        return;
    }

    FAR._viewerSide = side;
    FAR._viewerIndex = (typeof index === 'number' && index >= 0)
        ? index
        : FAR._viewerResolveIndex(side, item);

    const myToken = ++FAR._viewerToken;

    try {
        if (typeof FAR.isJsdos === 'function' && FAR.isJsdos(item)) {
            if (!FAR._viewerEnsureFn('openJsdosViewer')) return;
            await FAR.openJsdosViewer(item, side);
            if (myToken !== FAR._viewerToken) return;
            FAR._viewerUpdateNavButtons();
            return;
        }
    } catch (e) { console.warn('Ошибка проверки JSDOS:', e); }

    // Маршрутизация NES удалена, чтобы файл обрабатывался как EmulatorFile

    try {
        if (typeof FAR.isEmulatorFile === 'function' && FAR.isEmulatorFile(item)) {
            if (!FAR._viewerEnsureFn('openEmulatorViewer')) return;
            await FAR.openEmulatorViewer(item, side);
            if (myToken !== FAR._viewerToken) return;
            FAR._viewerUpdateNavButtons();
            return;
        }
    } catch (e) { console.warn('Ошибка проверки EmulatorJS:', e); }

    try {
        if (typeof FAR.isMp3 === 'function' && FAR.isMp3(item)) {
            if (!FAR._viewerEnsureFn('openMp3Viewer')) return;
            await FAR.openMp3Viewer(item, side);
            if (myToken !== FAR._viewerToken) return;
            FAR._viewerUpdateNavButtons();
            return;
        }
    } catch (e) { console.warn('Ошибка проверки MP3:', e); }

    try {
        if (typeof FAR.isVideo === 'function' && FAR.isVideo(item)) {
            if (!FAR._viewerEnsureFn('openVideoViewer')) return;
            await FAR.openVideoViewer(item, side);
            if (myToken !== FAR._viewerToken) return;
            FAR._viewerUpdateNavButtons();
            return;
        }
    } catch (e) { console.warn('Ошибка проверки видео:', e); }

    try {
        if (typeof FAR.isPdf === 'function' && FAR.isPdf(item)) {
            if (!FAR._viewerEnsureFn('openPdfViewer')) return;
            await FAR.openPdfViewer(item, side);
            if (myToken !== FAR._viewerToken) return;
            FAR._viewerUpdateNavButtons();
            return;
        }
    } catch (e) { console.warn('Ошибка проверки PDF:', e); }

    try {
        if (typeof FAR.isLbrn2 === 'function' && FAR.isLbrn2(item)) {
            if (!FAR._viewerEnsureFn('openLbrn2Viewer')) return;
            await FAR.openLbrn2Viewer(item, side);
            if (myToken !== FAR._viewerToken) return;
            FAR._viewerUpdateNavButtons();
            return;
        }
    } catch (e) { console.warn('Ошибка проверки LBRN2:', e); }

    try {
        if (typeof FAR.isGcode === 'function' && FAR.isGcode(item)) {
            if (!FAR._viewerEnsureFn('openGcodeViewer')) return;
            await FAR.openGcodeViewer(item, side);
            if (myToken !== FAR._viewerToken) return;
            FAR._viewerUpdateNavButtons();
            return;
        }
    } catch (e) { console.warn('Ошибка проверки G-code:', e); }

    try {
        if (typeof FAR.isPanorama === 'function') {
            const isPano = await FAR.isPanorama(item, side);
            if (myToken !== FAR._viewerToken) return;
            if (isPano) {
                if (!FAR._viewerEnsureFn('openPanoramaViewer')) return;
                await FAR.openPanoramaViewer(item, side);
                if (myToken !== FAR._viewerToken) return;
                FAR._viewerUpdateNavButtons();
                return;
            }
        }
    } catch (e) { console.warn('Ошибка проверки на панораму:', e); }

    try {
        if (typeof FAR.isHtmlFile === 'function' && FAR.isHtmlFile(item)) {
            if (typeof FAR.openBrowserFromItem === 'function') {
                FAR.openBrowserFromItem(item, side);
                FAR._viewerUpdateNavButtons();
                return;
            }
        }
    } catch (e) { console.warn('Ошибка проверки HTML:', e); }

    const modal = document.getElementById('viewerModal');
    const title = document.getElementById('viewerTitle');
    const body  = document.getElementById('viewerBody');
    const info  = document.getElementById('viewerInfo');

    if (!modal || !title || !body || !info) {
        console.error('[viewer] viewerModal/viewerTitle/viewerBody/viewerInfo не найдены в DOM');
        FAR.toast('Модалка просмотра не найдена', 'error');
        return;
    }

    modal.classList.remove('hidden');
    title.textContent = '📄 ' + item.name;
    body.innerHTML = '<div style="text-align:center;padding:40px;color:#a6adc8;">Загрузка…</div>';
    info.textContent = '';

    FAR._viewerUpdateNavButtons();

    try {
        const res = await FAR._viewerReadBody(side, item);
        if (myToken !== FAR._viewerToken) return;

        const data = res.data;
        const contentType = res.contentType || item.contentType || 'application/octet-stream';

        FAR.currentFileData = data;
        FAR.currentFileName = item.name;
        FAR.currentFileType = contentType;

        const ext = (item.name.split('.').pop() || '').toLowerCase();
        const imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp','ico'];
        const txtExts = ['txt','md','json','xml','csv','log','html','css','js','py','java','c','cpp','h','ini','cfg','yaml','yml'];

        if (imgExts.includes(ext)) {
            const blob = new Blob([data], {
                type: contentType.startsWith('image/')
                    ? contentType
                    : 'image/' + (ext === 'jpg' ? 'jpeg' : ext)
            });
            const url = URL.createObjectURL(blob);
            body.innerHTML = `<img src="${url}" alt="${FAR.escapeHtml(item.name)}">`;
            info.textContent = `📷 ${FAR.formatSize(data.length)}`;
        } else if (txtExts.includes(ext) || !item.binary) {
            try {
                const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
                body.innerHTML = `<pre>${FAR.escapeHtml(text)}</pre>`;
                info.textContent = `📝 ${FAR.formatSize(data.length)}`;
            } catch (e) {
                body.innerHTML = `<div style="color:#f9e2af;margin-bottom:8px;">Бинарные данные</div><pre>${FAR.hexPreview(data)}</pre>`;
                info.textContent = `📁 ${FAR.formatSize(data.length)}`;
            }
        } else {
            body.innerHTML = `<div style="color:#f9e2af;margin-bottom:8px;">Бинарный файл (${FAR.formatSize(data.length)})</div><pre>${FAR.hexPreview(data)}</pre>`;
            info.textContent = `📁 ${FAR.formatSize(data.length)}`;
        }
    } catch (e) {
        console.error('openFile:', e);
        body.innerHTML = `<div style="color:#f38ba8;">Ошибка: ${FAR.escapeHtml(e.message)}</div>`;
        info.textContent = 'Ошибка';
    }

    if (myToken !== FAR._viewerToken) return;
    FAR._viewerUpdateNavButtons();
};

FAR.closeViewer = function () {
    const modal = document.getElementById('viewerModal');
    if (modal) modal.classList.add('hidden');
    const body = document.getElementById('viewerBody');
    if (body) body.innerHTML = '';
    FAR.currentFileData = null;
    FAR._viewerUpdateNavButtons();
};

FAR.closeViewerOutside = function (e) {
    if (e.target === e.currentTarget) FAR.closeViewer();
};

FAR.downloadCurrentFile = async function () {
    if (!FAR.currentFileData) {
        FAR.toast('Нет данных', 'warning');
        return;
    }

    const prog = FAR.startProgress(
        '📥',
        `Скачивание "${FAR.currentFileName}" (${FAR.formatSize(FAR.currentFileData.length)})`,
        1,
        function () {}
    );

    prog.log(`📥 Подготовка ${FAR.currentFileName}`, 'info');
    prog.update(0, 1, FAR.currentFileName, 0);

    try {
        const blob = new Blob([FAR.currentFileData], { type: FAR.currentFileType });
        FAR.saveBlobAs(blob, FAR.sanitizeFileName(FAR.currentFileName));

        prog.update(1, 1, FAR.currentFileName, 0);
        prog.log(`✅ ${FAR.currentFileName} — сохранено`, 'ok');
        prog.finish(0);
        prog.log('━━━ Готово', 'ok');

        FAR.toast('Файл сохранён', 'success');
    } catch (e) {
        prog.log(`❌ ${FAR.currentFileName}: ${e.message}`, 'err');
        prog.finish(1);
        FAR.toast('Ошибка скачивания: ' + e.message, 'error');
    }
};