// ============================================================
// 38-browser-viewer.js — «Браузер» с IFRAME и редиректом в нативное окно.
// ============================================================

FAR._browserIsLocalUrl = function (url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const parsed = new URL(url, location.href);
        const h = parsed.hostname;
        if (!h) return false;
        return h === '127.0.0.1'
            || h === 'localhost'
            || h === '[::1]'
            || h === '::1'
            || h === location.hostname;
    } catch (e) {
        return false;
    }
};

FAR._openNativeBrowser = function (url, title) {
    if (!window.AndroidBridge) return false;
    if (typeof window.AndroidBridge.openInAppBrowser !== 'function') return false;
    try {
        const ok = window.AndroidBridge.openInAppBrowser(url || '', title || '');
        return !!ok;
    } catch (e) {
        console.warn('[browser] openInAppBrowser failed:', e);
        return false;
    }
};

FAR.openBrowser = function (url, opts) {
    opts = opts || {};

    // Перенаправляем внешние ссылки в нативное окно браузера
    if (window.AndroidBridge
        && typeof window.AndroidBridge.openInAppBrowser === 'function'
        && url
        && !FAR._browserIsLocalUrl(url)) {
        const title = opts.title || ('🌐 ' + url.replace(/^https?:\/\//, '').split('/')[0]);
        if (FAR._openNativeBrowser(url, title)) {
            console.log('[browser] external URL → Native Window:', url);
            // Закрываем пустое окно WM, если оно успело открыться
            if (opts.winId && FAR.WM) FAR.WM.closeWindow(opts.winId, true);
            return;
        }
    }

    // ---- Оконный режим (для локальных файлов) ----
    if (typeof FAR.WM !== 'undefined' && FAR.WM.state && FAR.WM.state.active) {
        return FAR.WM.openApp('browser', {
            props: {
                url: url || '',
                title: opts.title || null,
                homeUrl: opts.homeUrl || url || ''
            }
        });
    }

    // ---- Панельный режим: модалка ----
    return FAR._openBrowserModal(url, opts);
};



FAR._browserModalApi = null;

FAR._openBrowserModal = function (url, opts) {
    const modal = document.getElementById('browserModal');
    const host = document.getElementById('browserModalHost');
    const titleEl = document.getElementById('browserModalTitle');

    if (!modal || !host) return;

    if (FAR._browserModalApi) {
        try { FAR._browserModalApi.destroy(); } catch (e) {}
        FAR._browserModalApi = null;
    }

    if (titleEl) titleEl.textContent = opts.title || '🌐 Браузер';

    FAR._browserModalApi = FAR._createBrowser(host, {
        url: url,
        homeUrl: opts.homeUrl || url || '',
        trusted: !!opts.trusted,
        onChangeTitle: function (title) {
            if (titleEl) titleEl.textContent = title;
        }
    });

    modal.classList.remove('hidden');
};

FAR.closeBrowser = function () {
    const modal = document.getElementById('browserModal');
    if (modal) modal.classList.add('hidden');
    if (FAR._browserModalApi) {
        try { FAR._browserModalApi.destroy(); } catch (e) {}
        FAR._browserModalApi = null;
    }
};

FAR.closeBrowserOutside = function (e) {
    if (e.target === e.currentTarget) FAR.closeBrowser();
};

FAR.isHtmlFile = function (item) {
    if (!item || item.isFolder) return false;
    const name = item.name || item.path || '';
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'html' || ext === 'htm') return true;
    const ct = (item.contentType || '').toLowerCase();
    return ct.indexOf('text/html') === 0;
};

FAR.openBrowserFromItem = function (item, side) {
    if (!item || item.isFolder) return;
    const direct = FAR.buildDirectFileUrl(item, side);
    if (!direct) return;
    FAR.openBrowser(direct, {
        title: '🌐 ' + (item.name || 'Браузер'),
        homeUrl: direct
    });
};

FAR._browserNormalizeInput = function (input) {
    let s = String(input || '').trim();
    if (!s) return '';

    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('/')) {
        const base = FAR._browserBaseUrl();
        return base ? base + s : s;
    }

    if (/^[^\s/]+\.[^\s/]+/.test(s) && !s.includes(' ')) {
        // Если указан порт или локальный IP — используем http://
        if (/^[^\s/]+:\d+/.test(s) || /^(\d{1,3}\.){3}\d{1,3}/.test(s)) {
            return 'http://' + s;
        }
        return 'https://' + s;
    }

    const base = FAR._browserBaseUrl();
    if (base) {
        const path = s.replace(/^\/+/, '');
        const encoded = path.split('/').filter(Boolean)
            .map(encodeURIComponent).join('/');
        return base + '/' + encoded;
    }
    return s;
};

FAR._browserBaseUrl = function () {
    const ctx = FAR.side && FAR.side[FAR.activePanel];
    if (ctx && ctx.conn && ctx.conn.url) {
        return String(ctx.conn.url).replace(/\/+$/, '');
    }
    return location.origin;
};

FAR._createBrowser = function (hostEl, opts) {
    opts = opts || {};

    hostEl.innerHTML =
        '<div class="browser-toolbar">' +
        '<button class="browser-btn bm-back"    title="Назад">◀</button>' +
        '<button class="browser-btn bm-fwd"     title="Вперёд">▶</button>' +
        '<button class="browser-btn bm-reload"  title="Обновить">⟳</button>' +
        '<button class="browser-btn bm-stop"    title="Стоп">✕</button>' +
        '<button class="browser-btn bm-home"    title="На главную">⌂</button>' +
        '<input type="text" class="browser-url-input" placeholder="https://…  или  /Documents/index.html" autocomplete="off" spellcheck="false">' +
        '<button class="browser-btn bm-star browser-btn-star" title="Добавить в закладки">☆</button>' +
        '<button class="browser-btn bm-go browser-btn-go" title="Перейти">→</button>' +
        '<button class="browser-btn bm-external" title="Открыть во внешнем браузере">↗</button>' +
        '</div>' +
        '<div class="browser-bookmarks-bar"></div>' +
        '<div class="browser-progress"><div class="browser-progress-fill"></div></div>' +
        '<div class="browser-body">' +
        '<iframe class="browser-iframe"' +
        ' sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"' +
        ' referrerpolicy="strict-origin-when-cross-origin"' +
        ' allow="fullscreen; autoplay; clipboard-read; clipboard-write; encrypted-media; gamepad"' +
        ' title="Browser content"></iframe>' +
        '</div>' +
        '<div class="browser-footer">' +
        '<span class="browser-status">Готово</span>' +
        '<span class="browser-info"></span>' +
        '</div>';

    const $ = (sel) => hostEl.querySelector(sel);
    const elBack     = $('.bm-back');
    const elFwd      = $('.bm-fwd');
    const elReload   = $('.bm-reload');
    const elStop     = $('.bm-stop');
    const elHome     = $('.bm-home');
    const elInput    = $('.browser-url-input');
    const elStar     = $('.bm-star');
    const elGo       = $('.bm-go');
    const elExternal = $('.bm-external');
    const elBookmarksBar = $('.browser-bookmarks-bar');
    const elProgress = $('.browser-progress');
    const elProgressFill = $('.browser-progress-fill');
    const elIframe   = $('.browser-iframe');
    const elStatus   = $('.browser-status');
    const elInfo     = $('.browser-info');

    if (opts.trusted) elIframe.removeAttribute('sandbox');

    const S = { url: '', homeUrl: opts.homeUrl || '', history: [], historyIdx: -1, destroyed: false };

    function setStatus(text, cls) {
        elStatus.textContent = text || '';
        elStatus.className = 'browser-status' + (cls ? ' ' + cls : '');
    }
    function setInfo(text) { elInfo.textContent = text || ''; }
    function progressStart() { elProgress.classList.remove('done'); elProgress.classList.add('active'); }
    function progressStop() {
        elProgress.classList.remove('active');
        elProgress.classList.add('done');
        setTimeout(function () {
            if (S.destroyed) return;
            elProgress.classList.remove('done');
            elProgressFill.style.width = '0';
        }, 300);
    }
    function setUrlInput(url) { if (document.activeElement !== elInput) elInput.value = url || ''; }
    function updateNavButtons() {
        elBack.disabled = (S.historyIdx <= 0);
        elFwd.disabled  = (S.historyIdx >= S.history.length - 1);
    }
    function syncTitleFromIframe() {
        if (typeof opts.onChangeTitle !== 'function') return;
        let pageTitle = '';
        try { pageTitle = elIframe.contentDocument ? elIframe.contentDocument.title : ''; } catch (e) { }
        opts.onChangeTitle(pageTitle ? '🌐 ' + pageTitle : '🌐 Браузер');
    }

    async function navigate(rawUrl, options) {
        options = options || {};
        const url = FAR._browserNormalizeInput(rawUrl);
        if (!url) return;

        // Если это внешний URL — выходим из WebView и открываем в Chrome
        if (window.AndroidBridge && typeof window.AndroidBridge.openInAppBrowser === 'function' && !FAR._browserIsLocalUrl(url)) {
            const title = '🌐 ' + url.replace(/^https?:\/\//, '').split('/')[0];
            if (FAR._openNativeBrowser(url, title)) {
                setStatus('Открыто в Chrome: ' + url, 'ok');
                return;
            }
        }

        if (options.pushHistory !== false) {
            S.history = S.history.slice(0, S.historyIdx + 1);
            S.history.push(url);
            S.historyIdx = S.history.length - 1;
        }

        S.url = url;
        setUrlInput(url);
        updateNavButtons();
        setStatus('Загрузка…', 'load');
        progressStart();

        try { elIframe.src = url; } catch (e) { progressStop(); }
    }

    elBack.addEventListener('click', () => { if (S.historyIdx > 0) { S.historyIdx--; navigate(S.history[S.historyIdx], { pushHistory: false }); } });
    elFwd.addEventListener('click', () => { if (S.historyIdx < S.history.length - 1) { S.historyIdx++; navigate(S.history[S.historyIdx], { pushHistory: false }); } });
    elReload.addEventListener('click', () => { if (S.url) navigate(S.url, { pushHistory: false }); });
    elStop.addEventListener('click', () => { progressStop(); setStatus('Остановлено'); });
    elHome.addEventListener('click', () => navigate(S.homeUrl || FAR._browserBaseUrl(), { pushHistory: true }));
    elGo.addEventListener('click', () => navigate(elInput.value.trim(), { pushHistory: true }));

    elExternal.addEventListener('click', function () {
        if (!S.url) return;
        window.open(S.url, '_blank', 'noopener');
    });

    elInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); elGo.click(); }
    });

    function updateStar() {
        const has = S.url ? FAR.Bookmarks.has(S.url) : false;
        elStar.textContent = has ? '★' : '☆';
        elStar.classList.toggle('active', has);
    }

    elStar.addEventListener('click', function () {
        if (!S.url) return;
        let title = S.url;
        try { if (elIframe.contentDocument && elIframe.contentDocument.title) title = elIframe.contentDocument.title; } catch (e) { }
        FAR.Bookmarks.toggle({ url: S.url, title: title });
    });

    const unsubscribeBookmarks = FAR.Bookmarks.subscribe(function (items) {
        // ... (упрощенный рендер закладок)
        updateStar();
    });

    elIframe.addEventListener('load', function () {
        if (S.destroyed) return;
        progressStop();
        try {
            const realUrl = elIframe.contentWindow && elIframe.contentWindow.location ? elIframe.contentWindow.location.href : '';
            if (realUrl && realUrl !== 'about:blank') { S.url = realUrl; setUrlInput(realUrl); }
        } catch (e) { }
        syncTitleFromIframe();
        setStatus('Готово', 'ok');
        setInfo(S.url && S.url.length > 90 ? S.url.substring(0, 87) + '…' : S.url);
        updateNavButtons();
        updateStar();
    });

    if (opts.url) navigate(opts.url, { pushHistory: true });
    else { updateNavButtons(); updateStar(); }

    return {
        navigate: navigate,
        getState: () => S,
        destroy: function () {
            S.destroyed = true;
            try { unsubscribeBookmarks(); } catch (e) {}
            try { elIframe.src = 'about:blank'; } catch (e) {}
        }
    };
};