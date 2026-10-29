FAR.setStatus = function(t) {
    document.getElementById('statusText').textContent = t;
};

FAR.showLoading = function(text, sub) {
    document.getElementById('loadingOverlay').classList.remove('hidden');
    document.getElementById('loadingText').textContent = text || '';
    document.getElementById('loadingSub').textContent = sub || '';
};
FAR.updateLoadingSub = function(text) {
    document.getElementById('loadingSub').textContent = text || '';
};
FAR.hideLoading = function() {
    document.getElementById('loadingOverlay').classList.add('hidden');
};

FAR.formatSize = function(b) {
    if (!b) return '0 B';
    if (b > 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
    if (b > 1048576) return (b / 1048576).toFixed(2) + ' MB';
    if (b > 1024) return (b / 1024).toFixed(1) + ' KB';
    return b + ' B';
};

FAR.escapeHtml = function(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
};

FAR.hexPreview = function(data) {
    return Array.from(data.slice(0, 256))
        .map(b => b.toString(16).padStart(2, '0')).join(' ');
};

FAR.toast = function(msg, type) {
    type = type || 'info';
    const c = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 3000);
};

FAR.sanitizeFileName = function(name) {
    return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+$/, '_');
};

FAR.normPath = function(p) {
    if (p === null || p === undefined) return '';
    let s = String(p).trim();
    if (!s) return '';
    s = s.replace(/\\/g, '/');
    s = s.replace(/^\/+|\/+$/g, '');
    s = s.replace(/\/+/g, '/');
    return s;
};

/**
 * Нормализует адрес FileServer.
 *
 * Пользователь может ввести адрес без схемы:
 *   • "www.example.com:8080"   → "http://www.example.com:8080"
 *   • "example.com"            → "http://example.com"
 *   • "//example.com:8080"     → "http://example.com:8080"   (protocol-relative)
 *   • "http://example.com/"    → "http://example.com"
 *   • "https://example.com"    → "https://example.com"       (без изменений)
 *
 * Без этого fetch() падает с ошибкой:
 *   "URL scheme 'www.example.com' is not supported"
 *
 * Используется:
 *   • в FAR.connectToDb  — единая точка нормализации при подключении;
 *   • (опционально) в UI  — при показе/сохранении адреса.
 *
 * @param {string} raw
 * @returns {string} нормализованный URL или '' для пустого входа
 */
FAR.normalizeServerUrl = function (raw) {
    let s = String(raw || '').trim();
    if (!s) return '';

    // protocol-relative: //host → http://host
    if (s.startsWith('//')) {
        s = 'http:' + s;
    }
    // схема уже есть (http://, https://, ftp://, ws:// и т.п.) — не трогаем
    else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
        s = 'http://' + s;
    }

    // убираем хвостовые слэши (http://host:8080/ → http://host:8080)
    return s.replace(/\/+$/, '');
};

/**
 * Загружает внешний скрипт ровно один раз.
 * Возвращает Promise, который резолвится после загрузки.
 * Повторные вызовы с тем же src возвращают тот же Promise.
 */
FAR._loadedScripts = FAR._loadedScripts || {};

FAR.loadScriptOnce = function (src) {
    if (FAR._loadedScripts[src]) return FAR._loadedScripts[src];

    FAR._loadedScripts[src] = new Promise(function (resolve, reject) {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = function () { resolve(); };
        s.onerror = function () {
            delete FAR._loadedScripts[src];
            reject(new Error('Не удалось загрузить ' + src));
        };
        document.head.appendChild(s);
    });

    return FAR._loadedScripts[src];
};

// ============================================================
// Сохранение/восстановление положения курсора (localStorage)
// ============================================================

/**
 * Сохраняет текущее состояние панелей в localStorage.
 * Вызывается при любом изменении активной панели, пути или курсора.
 */
FAR.saveUiState = function() {
    try {
        const state = {
            activePanel: FAR.activePanel,
            leftPath: FAR.leftPath,
            rightPath: FAR.rightPath,
            leftCursor: FAR.leftCursor,
            rightCursor: FAR.rightCursor,
            leftFile: FAR._getFileAt(FAR.leftFiles, FAR.leftCursor),
            rightFile: FAR._getFileAt(FAR.rightFiles, FAR.rightCursor)
        };
        localStorage.setItem(FAR.LS_UI_KEY, JSON.stringify(state));
    } catch (e) {
        /* localStorage может быть недоступен — молча игнорируем */
    }
};

/**
 * Читает сохранённое состояние панелей из localStorage.
 * Возвращает объект или null.
 */
FAR.loadUiState = function() {
    try {
        const raw = localStorage.getItem(FAR.LS_UI_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object') return null;
        return obj;
    } catch (e) {
        return null;
    }
};

/**
 * Возвращает имя файла в списке по индексу или '' если индекса нет.
 */
FAR._getFileAt = function(list, idx) {
    if (!list || idx === null || idx === undefined) return '';
    if (idx < 0 || idx >= list.length) return '';
    const item = list[idx];
    if (!item) return '';
    return item.name || '';
};

/**
 * Восстанавливает состояние панелей из localStorage.
 */
FAR.restoreUiState = function() {
    const st = FAR.loadUiState();
    if (!st) return false;

    if (st.activePanel === 'left' || st.activePanel === 'right') {
        FAR.activePanel = st.activePanel;
        const pl = document.getElementById('panelLeft');
        const pr = document.getElementById('panelRight');
        if (pl && pr) {
            pl.classList.toggle('active', st.activePanel === 'left');
            pr.classList.toggle('active', st.activePanel === 'right');
        }
    }

    const restorePromises = [];

    if (typeof st.leftPath === 'string' && st.leftPath) {
        FAR.side.left.path = st.leftPath;
        FAR.side.left._loadedDir = null;
        restorePromises.push(
            FAR.ensureDirLoaded('left', st.leftPath, { silent: true }).catch(function(e) {
                // Игнорируем ошибку 403/404 при автовосстановлении
                console.warn('[restoreUiState] Не удалось восстановить левую панель:', e.message);
            })
        );
    }

    if (typeof st.rightPath === 'string' && st.rightPath) {
        FAR.side.right.path = st.rightPath;
        FAR.side.right._loadedDir = null;
        restorePromises.push(
            FAR.ensureDirLoaded('right', st.rightPath, { silent: true }).catch(function(e) {
                // Игнорируем ошибку 403/404 при автовосстановлении
                console.warn('[restoreUiState] Не удалось восстановить правую панель:', e.message);
            })
        );
    }

    return Promise.all(restorePromises).then(function() {
        FAR.renderPanel('left',  { skipLoad: true });
        FAR.renderPanel('right', { skipLoad: true });

        FAR._restoreCursor('left',  st.leftFile,  st.leftCursor);
        FAR._restoreCursor('right', st.rightFile, st.rightCursor);

        FAR.renderPanel('left',  { skipLoad: true });
        FAR.renderPanel('right', { skipLoad: true });

        return true;
    });
};

FAR._restoreCursor = function(side, fileName, cursorIdx) {
    const files = side === 'left' ? FAR.leftFiles : FAR.rightFiles;
    let idx = -1;

    if (fileName) {
        idx = files.findIndex(function(f) { return f.name === fileName; });
    }

    if (idx === -1 && typeof cursorIdx === 'number' && cursorIdx >= 0 && cursorIdx < files.length) {
        idx = cursorIdx;
    }

    if (idx < 0) {
        if (side === 'left') {
            FAR.leftCursor = -1;
            FAR.leftSelectedIdx.clear();
            FAR.leftAnchor = -1;
        } else {
            FAR.rightCursor = -1;
            FAR.rightSelectedIdx.clear();
            FAR.rightAnchor = -1;
        }
        return;
    }

    if (side === 'left') {
        FAR.leftCursor = idx;
        FAR.leftSelectedIdx.clear();
        FAR.leftSelectedIdx.add(idx);
        FAR.leftAnchor = idx;
    } else {
        FAR.rightCursor = idx;
        FAR.rightSelectedIdx.clear();
        FAR.rightSelectedIdx.add(idx);
        FAR.rightAnchor = idx;
    }
};

/**
 * Сохраняет Blob как файл через временный <a download>.
 */
FAR.saveBlobAs = function (blob, fileName) {
    if (!(blob instanceof Blob)) {
        throw new Error('saveBlobAs: ожидался Blob, получено ' +
            (blob && blob.constructor && blob.constructor.name));
    }

    const name = String(fileName || 'file.bin');

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();

    setTimeout(function () {
        try { document.body.removeChild(a); } catch (e) {}
        try { URL.revokeObjectURL(url); } catch (e) {}
    }, 1000);
};

/**
 * Формирует человекочитаемую метку подключения:
 *   "admin@127.0.0.1:8080"
 *   "anonymous@127.0.0.1:8080"
 *   "— нет подключения —"
 */
FAR.connLabel = function (conn) {
    if (!conn || !conn.url) return '— нет подключения —';
    const host = String(conn.url).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const user = conn.user || 'anonymous';
    return user + '@' + host;
};

/**
 * Определяет MIME-тип по имени/расширению файла.
 */
FAR.guessMimeByName = function (name) {
    if (!name) return '';
    const ext = String(name).split('.').pop().toLowerCase();

    const map = {
        'png':   'image/png',
        'jpg':   'image/jpeg',
        'jpeg':  'image/jpeg',
        'gif':   'image/gif',
        'webp':  'image/webp',
        'svg':   'image/svg+xml',
        'bmp':   'image/bmp',
        'ico':   'image/x-icon',
        'tif':   'image/tiff',
        'tiff':  'image/tiff',
        'avif':  'image/avif',

        'mp3':   'audio/mpeg',
        'm4a':   'audio/mp4',
        'aac':   'audio/aac',
        'ogg':   'audio/ogg',
        'oga':   'audio/ogg',
        'opus':  'audio/opus',
        'wav':   'audio/wav',
        'flac':  'audio/flac',

        'mp4':   'video/mp4',
        'm4v':   'video/mp4',
        'webm':  'video/webm',
        'mkv':   'video/x-matroska',
        'mov':   'video/quicktime',
        'ogv':   'video/ogg',
        'avi':   'video/x-msvideo',
        'ts':    'video/mp2t',

        'pdf':   'application/pdf',
        'zip':   'application/zip',
        'rar':   'application/vnd.rar',
        '7z':    'application/x-7z-compressed',
        'tar':   'application/x-tar',
        'gz':    'application/gzip',

        'html':  'text/html; charset=utf-8',
        'htm':   'text/html; charset=utf-8',
        'css':   'text/css; charset=utf-8',
        'js':    'application/javascript; charset=utf-8',
        'mjs':   'application/javascript; charset=utf-8',
        'json':  'application/json; charset=utf-8',
        'xml':   'application/xml; charset=utf-8',
        'txt':   'text/plain; charset=utf-8',
        'md':    'text/markdown; charset=utf-8',
        'csv':   'text/csv; charset=utf-8',
        'log':   'text/plain; charset=utf-8',
        'yaml':  'application/x-yaml; charset=utf-8',
        'yml':   'application/x-yaml; charset=utf-8',
        'ini':   'text/plain; charset=utf-8',
        'cfg':   'text/plain; charset=utf-8',

        'woff':  'font/woff',
        'woff2': 'font/woff2',
        'ttf':   'font/ttf',
        'otf':   'font/otf'
    };

    return map[ext] || '';
};

// ============================================================
// Прямые ссылки на файлы
// ============================================================

/**
 * Строит прямой URL к файлу из share.
 */
FAR.buildDirectFileUrl = function (item, side) {
    if (!item || !item.path) return null;

    side = side || FAR.activePanel;
    const ctx = FAR.side[side];
    if (!ctx || !ctx.db) return null;

    const effectiveUrl = String(ctx.db.baseUrl || '').replace(/\/+$/, '');
    const originalUrl  = String((ctx.conn && ctx.conn.url) || '').replace(/\/+$/, '');
    if (!effectiveUrl) return null;

    const isProxy = effectiveUrl !== originalUrl;
    const path = FAR.normPath(item.path);
    if (!path) return null;

    const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    let url = effectiveUrl + '/' + encoded;

    if (isProxy && ctx.db.token) {
        url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(ctx.db.token);
    }

    return url;
};

/**
 * Открывает файл в новом окне браузера.
 */
FAR.openFileInNewWindow = async function (item, side) {
    if (!item || item.isFolder) {
        FAR.toast('Выберите файл (не папку)', 'warning');
        return;
    }

    const url = FAR.buildDirectFileUrl(item, side);
    if (!url) {
        FAR.toast('Не удалось определить адрес файла', 'warning');
        return;
    }

    try {
        const res = await fetch(url, { method: 'HEAD' });

        if (res.status === 401) {
            FAR.toast('Сессия истекла — войдите заново', 'warning');
            FAR.openConnModal();
            return;
        }
        if (res.status === 403) {
            FAR.toast('Нет доступа к файлу', 'error');
            return;
        }
        if (res.status === 404) {
            FAR.toast('Файл не найден на сервере', 'warning');
            return;
        }
        if (!res.ok) {
            FAR.toast('Файл недоступен (HTTP ' + res.status + ')', 'warning');
            return;
        }
    } catch (e) {
        console.warn('[openFileInNewWindow] HEAD check failed:', e);
    }

    const win = window.open(url, '_blank', 'noopener');
    if (!win) {
        FAR.toast('Браузер заблокировал новое окно', 'warning');
    }
};