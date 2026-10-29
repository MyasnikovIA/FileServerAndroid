// ============================================================
// 38-browser-viewer.js — «Браузер» с IFRAME.
// ============================================================
//
// Работает в двух режимах:
//   • Панельный  → открывается как модалка на весь экран.
//   • Оконный    → WM-окно (ресайз, снапы, минимизация).
//
// Общий UI строится функцией FAR._createBrowser(hostEl, opts).
// Она возвращает API-объект с методами navigate/back/forward/etc.
//
// Закладки — отдельный модуль js/39-browser-bookmarks.js.
// Синхронизация: каждый инстанс браузера подписывается на
// FAR.Bookmarks.subscribe() и обновляет полосу закладок.
// ============================================================

// ------------------------------------------------------------
// Общая точка входа: открыть в модалке ИЛИ WM-окне.
// ------------------------------------------------------------

FAR.openBrowser = function (url, opts) {
    opts = opts || {};

    // ---- Оконный режим ----
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

// ------------------------------------------------------------
// Модалка (панельный режим)
// ------------------------------------------------------------

FAR._browserModalApi = null;

FAR._openBrowserModal = function (url, opts) {
    const modal = document.getElementById('browserModal');
    const host = document.getElementById('browserModalHost');
    const titleEl = document.getElementById('browserModalTitle');

    if (!modal || !host) {
        console.error('[browser] #browserModal или #browserModalHost не найден');
        FAR.toast('Модалка браузера не найдена', 'error');
        return;
    }

    // Уничтожаем предыдущий инстанс
    if (FAR._browserModalApi) {
        try { FAR._browserModalApi.destroy(); } catch (e) {}
        FAR._browserModalApi = null;
    }

    if (titleEl) titleEl.textContent = opts.title || '🌐 Браузер';

    // Создаём UI
    FAR._browserModalApi = FAR._createBrowser(host, {
        url: url,
        homeUrl: opts.homeUrl || url || '',
        trusted: !!opts.trusted,
        onChangeTitle: function (title) {
            if (titleEl) titleEl.textContent = title;
        }
    });

    modal.classList.remove('hidden');

    // Автофокус в адресную строку
    setTimeout(function () {
        try {
            const input = host.querySelector('.browser-url-input');
            if (input) { input.focus(); input.select(); }
        } catch (e) {}
    }, 50);
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

// ------------------------------------------------------------
// Проверка типа файла
// ------------------------------------------------------------

FAR.isHtmlFile = function (item) {
    if (!item || item.isFolder) return false;
    const name = item.name || item.path || '';
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'html' || ext === 'htm') return true;
    const ct = (item.contentType || '').toLowerCase();
    return ct.indexOf('text/html') === 0;
};

// ------------------------------------------------------------
// Открытие файла из панели
// ------------------------------------------------------------

FAR.openBrowserFromItem = function (item, side) {
    if (!item || item.isFolder) {
        FAR.toast('Выберите файл для открытия в браузере', 'warning');
        return;
    }
    const direct = FAR.buildDirectFileUrl(item, side);
    if (!direct) {
        FAR.toast('Не удалось построить URL файла', 'warning');
        return;
    }
    FAR.openBrowser(direct, {
        title: '🌐 ' + (item.name || 'Браузер'),
        homeUrl: direct
    });
};

// ------------------------------------------------------------
// Нормализация ввода URL
// ------------------------------------------------------------

FAR._browserNormalizeInput = function (input) {
    let s = String(input || '').trim();
    if (!s) return '';

    if (/^https?:\/\//i.test(s)) return s;

    if (s.startsWith('/')) {
        const base = FAR._browserBaseUrl();
        return base ? base + s : s;
    }

    if (s.startsWith('./') || s.startsWith('../')) {
        try {
            const base = FAR._browserBaseUrl();
            return new URL(s, base).href;
        } catch (e) {
            return s;
        }
    }

    if (/^[^\s/]+\.[^\s/]+/.test(s) && !s.includes(' ')) {
        return 'http://' + s;
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

// ============================================================
// ЯДРО: FAR._createBrowser(hostEl, opts)
// ============================================================
//
// Строит весь UI внутри hostEl и возвращает API-объект.
// hostEl — это либо #browserModalHost, либо win.bodyEl.

FAR._createBrowser = function (hostEl, opts) {
    opts = opts || {};

    if (!hostEl) throw new Error('_createBrowser: hostEl required');

    // ---- Разметка ----
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

    // ---- Trusted → снимаем sandbox ----
    if (opts.trusted) {
        elIframe.removeAttribute('sandbox');
    }

    // ---- Внутреннее состояние ----
    const S = {
        url: '',
        homeUrl: opts.homeUrl || '',
        history: [],
        historyIdx: -1,
        destroyed: false
    };

    // ---- Утилиты ----
    function setStatus(text, cls) {
        elStatus.textContent = text || '';
        elStatus.className = 'browser-status' + (cls ? ' ' + cls : '');
    }
    function setInfo(text) {
        elInfo.textContent = text || '';
    }
    function progressStart() {
        elProgress.classList.remove('done');
        elProgress.classList.add('active');
    }
    function progressStop() {
        elProgress.classList.remove('active');
        elProgress.classList.add('done');
        setTimeout(function () {
            if (S.destroyed) return;
            elProgress.classList.remove('done');
            elProgressFill.style.width = '0';
        }, 300);
    }
    function setUrlInput(url) {
        if (document.activeElement !== elInput) {
            elInput.value = url || '';
        }
    }
    function updateNavButtons() {
        elBack.disabled = (S.historyIdx <= 0);
        elFwd.disabled  = (S.historyIdx >= S.history.length - 1);
    }
    function syncTitleFromIframe() {
        if (typeof opts.onChangeTitle !== 'function') return;
        let pageTitle = '';
        try {
            pageTitle = elIframe.contentDocument && elIframe.contentDocument.title
                ? elIframe.contentDocument.title
                : '';
        } catch (e) { /* cross-origin */ }
        opts.onChangeTitle(pageTitle ? '🌐 ' + pageTitle : '🌐 Браузер');
    }

    // ---- Навигация ----
    async function navigate(rawUrl, options) {
        options = options || {};
        const url = FAR._browserNormalizeInput(rawUrl);
        if (!url) {
            setStatus('Пустой URL', 'error');
            return;
        }

        // HEAD-проверка для своих адресов
        const isOwn = FAR._isOurServer && FAR._isOurServer(url);
        if (isOwn && !options.skipHeadCheck) {
            try {
                const res = await fetch(url, { method: 'HEAD' });
                if (res.status === 401) {
                    setStatus('Сессия истекла', 'error');
                    FAR.toast('Сессия истекла — войдите заново', 'warning');
                    FAR.openConnModal();
                    return;
                }
                if (res.status === 403) { setStatus('Доступ запрещён (403)', 'error'); return; }
                if (res.status === 404) { setStatus('Файл не найден (404)', 'error'); return; }
            } catch (e) {
                console.warn('[browser] HEAD check failed:', e);
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

        try {
            elIframe.src = url;
        } catch (e) {
            console.error('[browser] set iframe.src failed:', e);
            setStatus('Ошибка загрузки', 'error');
            progressStop();
        }
    }

    // ---- Кнопки ----
    elBack.addEventListener('click', function () {
        if (S.historyIdx <= 0) return;
        S.historyIdx--;
        navigate(S.history[S.historyIdx], { pushHistory: false, skipHeadCheck: true });
    });
    elFwd.addEventListener('click', function () {
        if (S.historyIdx >= S.history.length - 1) return;
        S.historyIdx++;
        navigate(S.history[S.historyIdx], { pushHistory: false, skipHeadCheck: true });
    });
    elReload.addEventListener('click', function () {
        if (!S.url) return;
        navigate(S.url, { pushHistory: false, skipHeadCheck: true });
    });
    elStop.addEventListener('click', function () {
        progressStop();
        setStatus('Остановлено', '');
        try {
            // Прервать загрузку: переустанавливаем src текущего URL.
            if (S.url) elIframe.src = S.url;
        } catch (e) {}
    });
    elHome.addEventListener('click', function () {
        const home = S.homeUrl || FAR._browserBaseUrl();
        navigate(home, { pushHistory: true });
    });
    elGo.addEventListener('click', function () {
        const value = elInput.value.trim();
        if (!value) return;
        navigate(value, { pushHistory: true });
    });
    elExternal.addEventListener('click', function () {
        if (!S.url) { FAR.toast('Нет активного URL', 'warning'); return; }
        window.open(S.url, '_blank', 'noopener');
    });

    elInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); elGo.click(); }
    });

    // ---- Звёздочка (добавить/убрать из закладок) ----
    function updateStar() {
        if (!S.url) {
            elStar.textContent = '☆';
            elStar.classList.remove('active');
            return;
        }
        const has = FAR.Bookmarks.has(S.url);
        elStar.textContent = has ? '★' : '☆';
        elStar.classList.toggle('active', has);
    }

    elStar.addEventListener('click', function () {
        if (!S.url) { FAR.toast('Нет активного URL', 'warning'); return; }
        let title = S.url;
        try {
            if (elIframe.contentDocument && elIframe.contentDocument.title) {
                title = elIframe.contentDocument.title;
            }
        } catch (e) { /* cross-origin */ }
        FAR.Bookmarks.toggle({ url: S.url, title: title });
        // updateStar() вызовется через subscribe()
    });

    // ---- Полоса закладок ----
    function renderBookmarks(items) {
        elBookmarksBar.innerHTML = '';

        if (!items || items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'browser-bookmarks-empty';
            empty.textContent = 'Здесь пока нет закладок. Нажмите ☆ чтобы добавить текущую страницу.';
            elBookmarksBar.appendChild(empty);
            return;
        }

        items.forEach(function (bm) {
            const chip = document.createElement('div');
            chip.className = 'browser-bookmark' +
                (S.url === bm.url ? ' active' : '');
            chip.title = bm.title + '\n' + bm.url;

            const icon = document.createElement('span');
            icon.className = 'browser-bookmark-icon';
            icon.textContent = bm.icon || '🌐';

            const name = document.createElement('span');
            name.className = 'browser-bookmark-name';
            name.textContent = FAR.Bookmarks.displayNameFor(bm);

            chip.appendChild(icon);
            chip.appendChild(name);

            chip.addEventListener('click', function (e) {
                if (e.ctrlKey || e.metaKey) {
                    window.open(bm.url, '_blank', 'noopener');
                    return;
                }
                navigate(bm.url, { pushHistory: true });
            });

            chip.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                e.stopPropagation();
                FAR.BookmarksMenu.show(e.clientX, e.clientY, bm, function (action, b) {
                    if (action === 'open') navigate(b.url, { pushHistory: true });
                });
            });

            elBookmarksBar.appendChild(chip);
        });
    }

    // Подписка на изменения закладок (с обновлением активного чипа)
    const unsubscribeBookmarks = FAR.Bookmarks.subscribe(function (items) {
        renderBookmarks(items);
        updateStar();
    });

    // ---- События iframe ----
    elIframe.addEventListener('load', function () {
        if (S.destroyed) return;
        progressStop();

        try {
            const realUrl = elIframe.contentWindow && elIframe.contentWindow.location
                ? elIframe.contentWindow.location.href
                : '';
            if (realUrl && realUrl !== 'about:blank') {
                S.url = realUrl;
                setUrlInput(realUrl);
            }
        } catch (e) { /* cross-origin */ }

        syncTitleFromIframe();

        setStatus('Готово', 'ok');
        setInfo(S.url && S.url.length > 90 ? S.url.substring(0, 87) + '…' : S.url);

        updateNavButtons();
        updateStar();
        renderBookmarks(FAR.Bookmarks.all);   // обновить активный чип
    });

    elIframe.addEventListener('error', function () {
        if (S.destroyed) return;
        progressStop();
        setStatus('Ошибка загрузки', 'error');
    });

    // ---- Стартовая навигация ----
    if (opts.url) {
        navigate(opts.url, { pushHistory: true });
    } else {
        updateNavButtons();
        updateStar();
    }

    // ---- API ----
    return {
        navigate: navigate,
        getState: function () { return S; },
        destroy: function () {
            S.destroyed = true;
            try { unsubscribeBookmarks(); } catch (e) {}
            try { elIframe.src = 'about:blank'; } catch (e) {}
        }
    };
};

// ------------------------------------------------------------
// Инициализация (вызывается из 23-main.js)
// ------------------------------------------------------------

FAR.initBrowser = function () {
    // ESC в модалке — закрыть
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        const modal = document.getElementById('browserModal');
        if (!modal || modal.classList.contains('hidden')) return;
        const t = e.target;
        const tag = (t && t.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) {
            return;
        }
        FAR.closeBrowser();
    }, true);
};