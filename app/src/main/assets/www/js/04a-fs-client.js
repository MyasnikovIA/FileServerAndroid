// ============================================================
// 04a-fs-client.js — PouchDB-совместимый клиент к FileServer.
// Поддерживает Basic Auth и Bearer-токен.
// ============================================================

FAR.FsClient = function (baseUrl, opts) {
    opts = opts || {};
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.user  = opts.user  || '';
    this.pass  = opts.pass  || '';
    this.token = opts.token || '';
    this.type = 'filesystem';
    this.id = 'fsdb-' + this.baseUrl +
        (this.token ? ':token' : (this.user ? ':' + this.user : ''));
    this._eventSource = null;
    this.onFileEvent = null;
};

FAR.FsClient.prototype._authHeader = function () {
    // Приоритет: Bearer-токен (когда он есть — используем только его)
    if (this.token) return 'Bearer ' + this.token;
    if (!this.user) return null;
    const raw = this.user + ':' + (this.pass || '');
    const bytes = new TextEncoder().encode(raw);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return 'Basic ' + btoa(bin);
};

FAR.FsClient.prototype._fetch = function (url, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    // Cookie отправляются автоматически и сохраняются из ответов.
    opts.credentials = 'include';
    const auth = this._authHeader();
    if (auth) opts.headers['Authorization'] = auth;
    return fetch(url, opts);
};

// ============================================================
// Ретраи для идемпотентных запросов.
//
// Зачем: при параллельных копированиях сервер может ответить
// 5xx (временная перегрузка / гонка за директорию / race при
// создании временного файла). Повтор с экспоненциальной паузой
// почти всегда проходит со второй-третьей попытки.
//
// ВАЖНО: opts.body должен быть ArrayBuffer/Uint8Array/undefined —
// он не «вычитывается» fetch'ем, поэтому повтор безопасен.
// ReadableStream повторять нельзя — здесь такие тела не используются.
//
// Параметры:
//   maxAttempts = 4           — всего попыток (1 + 3 ретрая)
//   delays      = [150,400,900,1800] мс  — паузы перед 2-й, 3-й, 4-й попыткой
//                                          (плюс джиттер 0–100 мс)
// ============================================================
FAR.FsClient.prototype._fetchWithRetry = async function (url, opts, retryOpts) {
    opts = opts || {};
    retryOpts = retryOpts || {};

    const maxAttempts = retryOpts.maxAttempts || 4;
    const delays = retryOpts.delays || [150, 400, 900, 1800];
    const method = (opts.method || 'GET').toUpperCase();

    let lastErr = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const res = await this._fetch(url, opts);

            // Ретраим 5xx (500, 502, 503, 504) — кроме последней попытки
            const is5xx = res.status >= 500 && res.status < 600;
            if (is5xx && attempt < maxAttempts - 1) {
                // Сливаем тело, чтобы освободить соединение
                try { await res.text(); } catch (e) { /* ignore */ }

                const base = delays[attempt] || delays[delays.length - 1];
                const jitter = Math.floor(Math.random() * 100);
                const wait = base + jitter;

                console.warn(
                    '[FsClient] ' + method + ' ' + url +
                    ' → ' + res.status + ', retry #' + (attempt + 1) +
                    ' in ' + wait + 'ms'
                );
                await new Promise(r => setTimeout(r, wait));
                continue;
            }

            return res;
        } catch (e) {
            // Сетевая ошибка (DNS, CORS, offline и т.п.) — тоже ретраим
            lastErr = e;

            if (attempt < maxAttempts - 1) {
                const base = delays[attempt] || delays[delays.length - 1];
                const jitter = Math.floor(Math.random() * 100);
                const wait = base + jitter;

                console.warn(
                    '[FsClient] ' + method + ' ' + url +
                    ' network error (' + (e && e.message) + '), retry #' +
                    (attempt + 1) + ' in ' + wait + 'ms'
                );
                await new Promise(r => setTimeout(r, wait));
                continue;
            }

            throw e;
        }
    }

    throw lastErr || new Error('Max retries exceeded for ' + method + ' ' + url);
};

FAR.FsClient.prototype._url = function (path, params) {
    params = params || {};
    const q = Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + '=' +
            encodeURIComponent(params[k] == null ? '' : params[k]);
    }).join('&');
    return this.baseUrl + path + (q ? '?' + q : '');
};

// ---- helpers ----

FAR.FsClient.prototype._kindFromId = function (id) {
    if (typeof id !== 'string' || id.length < 2) return null;
    const c = id.charAt(0);
    if (c === 'd') return 'folder';
    if (c === 'f') return 'file';
    return null;
};

FAR.FsClient.prototype._pathFromId = function (id) {
    if (typeof id !== 'string' || id.length < 2) return '';
    return FAR.normPath(decodeURIComponent(id.substring(2)));
};

FAR.FsClient.prototype._pathFromKey = function (key) {
    if (typeof key !== 'string' || key.length < 2) return '';
    let enc = key.substring(2);
    if (enc.endsWith('\ufff0')) enc = enc.slice(0, -1);
    let decoded;
    try { decoded = decodeURIComponent(enc); } catch (e) { decoded = enc; }
    return FAR.normPath(decoded);
};

FAR.FsClient.prototype._entryToDoc = function (entry, kind) {
    const norm = FAR.normPath(entry.path);
    const name = entry.name || (norm.includes('/') ? norm.split('/').pop() : norm);
    if (kind === 'folder' || entry.isFolder) {
        return {
            _id: 'd:' + encodeURIComponent(norm),
            _rev: '1-' + (entry.mtime || 0),
            type: 'folder',
            path: norm, name: name,
            mtime: entry.mtime || 0,
            quotaMb: entry.quotaMb,
            usedBytes: entry.usedBytes,
            access: entry.access || []
        };
    }
    const ct = entry.contentType || 'application/octet-stream';
    return {
        _id: 'f:' + encodeURIComponent(norm),
        _rev: '1-' + (entry.mtime || 0),
        type: 'file',
        path: norm, name: name,
        size: entry.size || 0,
        mtime: entry.mtime || 0,
        binary: !!entry.binary,
        contentType: ct,
        _attachments: { b: { content_type: ct, length: entry.size || 0, stub: true } }
    };
};

FAR.FsClient._errorFromResponse = async function (res) {
    let msg = 'HTTP ' + res.status;
    try {
        const text = await res.text();
        if (!text) return msg;
        try {
            const body = JSON.parse(text);
            if (body && body.error) {
                msg = body.error;
                if (res.status === 507 && body.scope !== undefined) {
                    msg += ' — шары "' + body.scope + '"';
                    msg += ' (лимит ' + body.quotaMb + ' MB';
                    msg += ', занято ' + FAR.formatSize(body.usedBytes || 0);
                    msg += ', свободно ' + FAR.formatSize(body.freeBytes || 0);
                    msg += ', нужно ' + FAR.formatSize(body.deltaBytes || 0) + ')';
                } else if (body.message) {
                    msg += ': ' + body.message;
                }
            } else if (body && body.message) {
                msg = body.message;
            } else if (text.length < 240) {
                msg = 'HTTP ' + res.status + ' ' + text;
            }
        } catch (jsonErr) {
            msg = text.length > 240 ? text.substring(0, 240) + '…' : text;
        }
    } catch (readErr) { /* ignore */ }
    return msg;
};

// ---- info ----

FAR.FsClient.prototype.info = async function () {
    const res = await this._fetchWithRetry(this._url('/api/info'));
    if (res.status === 401) {
        const e = new Error('Неверный логин или пароль'); e.status = 401; throw e;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const info = await res.json();
    return {
        db_name: info.type || 'filesystem',
        doc_count: 0,
        update_seq: Date.now(),
        backend_adapter: 'FileServer',
        username: info.username,
        anonymous: info.anonymous,
        console: !!info.console,
        videoChatEnabled: !!info.videoChatEnabled,
        videoChatPort: info.videoChatPort,
        shares: info.shares || [],
        userQuotaMb: info.userQuotaMb,
        userUsedBytes: info.userUsedBytes,
        version: info.version
    };
};

// ---- allDocs ----

FAR.FsClient.prototype.allDocs = async function (opts) {
    opts = opts || {};

    if (opts.keys && Array.isArray(opts.keys)) {
        const rows = [];
        for (const key of opts.keys) {
            try {
                const doc = await this.get(key);
                const row = { id: key, key: key, value: { rev: doc._rev } };
                if (opts.include_docs) row.doc = doc;
                rows.push(row);
            } catch (e) {
                rows.push({ id: key, key: key, error: 'not_found' });
            }
        }
        return { rows: rows, total_rows: rows.length, offset: 0 };
    }

    if (!opts.startkey && !opts.endkey) {
        const res = await this._fetchWithRetry(this._url('/api/list', { path: '', recursive: 1 }));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        let entries = data.entries || [];
        if (opts.limit) entries = entries.slice(0, opts.limit);

        const rows = [];
        for (const entry of entries) {
            const docId = (entry.isFolder ? 'd:' : 'f:') +
                encodeURIComponent(FAR.normPath(entry.path));
            const row = { id: docId, key: docId, value: { rev: '1-' + (entry.mtime || 0) } };
            if (opts.include_docs) row.doc = this._entryToDoc(entry, entry.isFolder ? 'folder' : 'file');
            rows.push(row);
        }
        return { rows: rows, total_rows: rows.length, offset: 0 };
    }

    const kind = this._kindFromId(opts.startkey);
    const prefix = this._pathFromKey(opts.startkey);
    const recursive = !!opts.recursive;

    const res = await this._fetchWithRetry(this._url('/api/list', {
        path: prefix, recursive: recursive ? 1 : 0
    }));
    if (!res.ok) {
        if (res.status === 404) return { rows: [], total_rows: 0, offset: 0 };
        throw new Error('HTTP ' + res.status);
    }
    const data = await res.json();
    const entries = data.entries || [];

    const rows = [];
    for (const entry of entries) {
        const eKind = entry.isFolder ? 'folder' : 'file';
        if (kind && eKind !== kind) continue;
        const docId = (entry.isFolder ? 'd:' : 'f:') +
            encodeURIComponent(FAR.normPath(entry.path));
        const row = { id: docId, key: docId, value: { rev: '1-' + (entry.mtime || 0) } };
        if (opts.include_docs) row.doc = this._entryToDoc(entry, eKind);
        rows.push(row);
    }
    return { rows: rows, total_rows: rows.length, offset: 0 };
};

// ---- get ----

FAR.FsClient.prototype.get = async function (id) {
    const kind = this._kindFromId(id);
    if (!kind) {
        const err = new Error('Invalid ID: ' + id);
        err.status = 400; err.name = 'bad_request'; throw err;
    }
    const path = this._pathFromId(id);

    const res = await this._fetchWithRetry(this._url('/api/stat', { path: path }));

    if (res.status === 404) {
        const err = new Error('missing'); err.status = 404; err.name = 'not_found'; throw err;
    }
    if (res.status === 401) {
        const err = new Error('unauthorized'); err.status = 401; err.name = 'unauthorized'; throw err;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const entry = await res.json();
    const actualKind = entry.isFolder ? 'folder' : 'file';
    if (actualKind !== kind) {
        const err = new Error('missing'); err.status = 404; err.name = 'not_found'; throw err;
    }
    return this._entryToDoc(entry, actualKind);
};

// ---- put ----

FAR.FsClient.prototype.put = async function (doc) {
    if (!doc || !doc._id) throw new Error('put: _id is required');
    const kind = this._kindFromId(doc._id);
    const path = this._pathFromId(doc._id);

    if (kind === 'folder') {
        const res = await this._fetchWithRetry(this._url('/api/mkdir', { path: path }), { method: 'POST' });
        if (!res.ok) {
            const msg = await FAR.FsClient._errorFromResponse(res);
            const e = new Error(msg);
            e.status = res.status;
            throw e;
        }
        return { ok: true, id: doc._id, rev: '1-' + Date.now() };
    }

    let data = new Uint8Array(0);
    if (doc._attachments && doc._attachments.b && doc._attachments.b.data) {
        try {
            const bin = atob(doc._attachments.b.data);
            data = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        } catch (e) {
            throw new Error('Invalid base64: ' + e.message);
        }
    }

    const ct = (doc._attachments && doc._attachments.b && doc._attachments.b.content_type)
        || doc.contentType || 'application/octet-stream';

    const res = await this._fetchWithRetry(this._url('/api/write', { path: path }), {
        method: 'PUT',
        headers: { 'Content-Type': ct },
        body: data
    });
    if (!res.ok) {
        const msg = await FAR.FsClient._errorFromResponse(res);
        const e = new Error(msg);
        e.status = res.status;
        throw e;
    }
    return { ok: true, id: doc._id, rev: '1-' + Date.now() };
};

// ---- remove ----

FAR.FsClient.prototype.remove = async function (doc) {
    const id = typeof doc === 'string' ? doc : (doc && doc._id);
    if (!id) throw new Error('remove: _id is required');
    const path = this._pathFromId(id);

    const res = await this._fetchWithRetry(this._url('/api/delete', { path: path }), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
    return { ok: true };
};

// ============================================================
// getAttachment — читает тело файла через ПРЯМОЙ URL.
// ============================================================
FAR.FsClient.prototype.getAttachment = async function (id, name, opts) {
    opts = opts || {};
    const path = this._pathFromId(id);

    const encodedPath = String(path)
        .split('/')
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');

    const url = this.baseUrl + '/' + encodedPath;

    const res = await this._fetchWithRetry(url);

    if (res.status === 404) {
        const err = new Error('missing');
        err.status = 404;
        err.name = 'not_found';
        throw err;
    }
    if (res.status === 401) {
        const err = new Error('unauthorized');
        err.status = 401;
        err.name = 'unauthorized';
        throw err;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);

    if (opts.binary) return await res.blob();
    return await res.text();
};

// ---- putAttachment ----
//
// ЕДИНАЯ АТОМАРНАЯ ЗАПИСЬ: один PUT /api/write с содержимым.
// При превышении квоты (507) файл не создаётся вовсе.
//
// Ретраи на 5xx: при параллельных копированиях сервер может
// ответить 500 из-за гонки — повтор с экспоненциальной паузой
// проходит со 2-3 попытки.
FAR.FsClient.prototype.putAttachment = async function (id, name, rev, blob, contentType) {
    const path = this._pathFromId(id);
    let body = blob;
    if (blob && typeof blob.arrayBuffer === 'function') body = await blob.arrayBuffer();

    const res = await this._fetchWithRetry(this._url('/api/write', { path: path }), {
        method: 'PUT',
        headers: { 'Content-Type': contentType || 'application/octet-stream' },
        body: body
    });
    if (!res.ok) {
        const msg = await FAR.FsClient._errorFromResponse(res);
        const err = new Error(msg);
        err.status = res.status;
        throw err;
    }
    return { ok: true, id: id, rev: '1-' + Date.now() };
};

FAR.FsClient.prototype.close = async function () {
    if (this._eventSource) {
        try { this._eventSource.close(); } catch (e) {}
        this._eventSource = null;
    }
};

// ---- SSE ----

FAR.FsClient.prototype.startWatching = function () {
    if (this._eventSource) return;
    if (typeof EventSource === 'undefined') return;

    let url = this.baseUrl + '/api/events';
    if (this.token) url += '?token=' + encodeURIComponent(this.token);

    const es = new EventSource(url);
    this._eventSource = es;
    const self = this;
    es.addEventListener('change', function (e) {
        let payload = null;
        try { payload = JSON.parse(e.data); } catch (err) { return; }
        if (typeof self.onFileEvent === 'function') {
            try { self.onFileEvent(payload); } catch (err) {}
        }
    });
    es.addEventListener('ready', function () {
        console.log('[FsClient] SSE ready');
    });
};

FAR.FsClient.prototype.stopWatching = function () {
    if (this._eventSource) {
        try { this._eventSource.close(); } catch (e) {}
        this._eventSource = null;
    }
};

// ============================================================
// Статические хелперы
// ============================================================

FAR.FsClient.login = async function (baseUrl, user, pass) {
    const url = String(baseUrl || '').replace(/\/+$/, '') + '/api/login';

    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ user: user, pass: pass || '' })
        });
    } catch (netErr) {
        const e = new Error('Сеть недоступна: ' + netErr.message);
        e.name = 'NetworkError';
        throw e;
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        const err = new Error(data.error || ('HTTP ' + res.status));
        err.status = res.status;
        throw err;
    }
    return data;
};

FAR.FsClient.logout = async function (baseUrl, token) {
    const url = String(baseUrl || '').replace(/\/+$/, '') + '/api/logout';
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: token })
    });
    return res.ok;
};

FAR.FsClient.prototype.directUrl = function (share, relPath, opts) {
    opts = opts || {};
    const encoded = (relPath || '').split('/').map(encodeURIComponent).join('/');
    let url = this.baseUrl + '/' + encodeURIComponent(share) + '/' + encoded;
    if (this.token && !opts.noToken) {
        url += '?token=' + encodeURIComponent(this.token);
    }
    return url;
};