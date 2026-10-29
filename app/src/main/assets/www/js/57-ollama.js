// ============================================================
// 57-ollama.js — Ollama Chat через FileServer
// ============================================================
//
// Возможности:
//   • Контекст (system prompt) — вкладка «📋 Контекст»
//   • Текстовые файлы (мультивыбор + drag&drop) — вкладка «📎 Файлы»
//   • Вложенные изображения (🖼 кнопка / Ctrl+V / drag&drop)
//   • Markdown: ```lang ... ``` → <pre><code> + кнопка «Копировать»
//   • Кнопка «🗑 VRAM» — выгрузка всех моделей из памяти
//   • Типы моделей: 📝 Text / 🖼 Vision / 🔢 Embed (optgroup + бейдж)
//   • GPU-панель (self-contained)
//
// Модель исполняется сервером через `ollama run <model>` /
// `ollama run <model> --image ...` (ProcessBuilder), без HTTP 11434.

FAR.Ollama = FAR.Ollama || {};

FAR.Ollama.LS_MODEL_KEY   = 'filebd_ollama_model';
FAR.Ollama.LS_CHAT_KEY    = 'filebd_ollama_chat';
FAR.Ollama.LS_CONTEXT_KEY = 'filebd_ollama_context';
FAR.Ollama.LS_FILES_KEY   = 'filebd_ollama_files';
FAR.Ollama.MAX_HISTORY    = 60;
FAR.Ollama.MAX_CONTEXT_BYTES    = 200 * 1024;
FAR.Ollama.MAX_IMAGE_BYTES      = 4 * 1024 * 1024;
FAR.Ollama.MAX_IMAGES_PER_MSG   = 8;
FAR.Ollama.MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;

// ============================================================
// Определение типа модели (локальный fallback, если сервер не прислал)
// ============================================================

FAR.Ollama.VISION_MODELS_RE = /^(llava|bakllava|moondream|llama3\.2-vision|llama4|qwen2\.?5?-vl|qwen2-vl|qwen3-vl|minicpm-v|gemma3|granite3\.2-vision|granite-vision|internvl|pixtral|bunny|molmo|llama-vision)/i;

FAR.Ollama.EMBED_MODELS_RE = /(embed|minilm|nomic-embed|bge-|mxbai-embed|jina-embed|snowflake-arctic-embed|text-embedding|^e5-)/i;

FAR.Ollama._detectTypeLocal = function (name) {
    if (!name) return 'txt';
    const base = String(name).split(':')[0].trim();
    if (FAR.Ollama.EMBED_MODELS_RE.test(base)) return 'embed';
    if (FAR.Ollama.VISION_MODELS_RE.test(base)) return 'img';
    return 'txt';
};

FAR.Ollama.isVisionModel = function (name) {
    return FAR.Ollama._detectTypeLocal(name) === 'img';
};

FAR.Ollama.MODEL_TYPE_INFO = {
    txt:   { icon: '📝', label: 'Text',   desc: 'Текстовая LLM — принимает только текст' },
    img:   { icon: '🖼', label: 'Vision', desc: 'Мультимодальная — принимает текст и изображения' },
    embed: { icon: '🔢', label: 'Embed',  desc: 'Эмбеддинги — только для векторного поиска, для чата не годятся' }
};

// ============================================================
// Публичное API
// ============================================================

FAR.Ollama._modalApi = null;

FAR.openOllama = function (opts) {
    opts = opts || {};
    if (typeof FAR.WM !== 'undefined' && FAR.WM.state && FAR.WM.state.active
        && FAR.WM.getApp && FAR.WM.getApp('ollama')) {
        return FAR.WM.openApp('ollama', { props: opts });
    }
    FAR._openOllamaModal(opts);
};

FAR._openOllamaModal = function (opts) {
    const modal = document.getElementById('ollamaModal');
    const host  = document.getElementById('ollamaModalHost');
    if (!modal || !host) {
        console.error('[Ollama] #ollamaModal или #ollamaModalHost не найден');
        FAR.toast('Модалка Ollama не найдена', 'error');
        return;
    }
    if (FAR.Ollama._modalApi) {
        try { FAR.Ollama._modalApi.destroy(); } catch (e) {}
        FAR.Ollama._modalApi = null;
    }
    FAR.Ollama._modalApi = FAR._createOllamaUI(host, opts);
    modal.classList.remove('hidden');
};

FAR.closeOllama = function () {
    const modal = document.getElementById('ollamaModal');
    if (modal) modal.classList.add('hidden');
    if (FAR.Ollama._modalApi) {
        try { FAR.Ollama._modalApi.destroy(); } catch (e) {}
        FAR.Ollama._modalApi = null;
    }
};

FAR.closeOllamaOutside = function (e) {
    if (e.target === e.currentTarget) FAR.closeOllama();
};

// ============================================================
// Утилиты
// ============================================================

FAR.Ollama._getBaseUrl = function () {
    const ctx = FAR.side && FAR.side[FAR.activePanel];
    if (ctx && ctx.db && ctx.db.baseUrl) {
        return String(ctx.db.baseUrl).replace(/\/+$/, '');
    }
    return location.origin;
};

FAR.Ollama._getHeaders = function (withJson) {
    const headers = {};
    if (withJson) headers['Content-Type'] = 'application/json';
    const ctx = FAR.side && FAR.side[FAR.activePanel];
    const token = (ctx && ctx.db && ctx.db.token) || FAR.authToken;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
};

FAR.Ollama._esc = function (s) {
    if (typeof FAR.escapeHtml === 'function') return FAR.escapeHtml(s);
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
};

FAR.Ollama._formatSize = function (n) {
    if (typeof FAR.formatSize === 'function') return FAR.formatSize(n);
    if (!n) return '0 B';
    if (n > 1048576) return (n / 1048576).toFixed(2) + ' MB';
    if (n > 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
};

// ============================================================
// Markdown
// ============================================================

FAR.Ollama._renderMarkdown = function (text) {
    text = String(text == null ? '' : text);
    const parts = [];
    let lastIdx = 0;
    let cursor  = 0;
    let inCode  = false;
    let codeLang = '';
    let codeStart = -1;

    while (cursor < text.length) {
        if (!inCode) {
            const openIdx = text.indexOf('```', cursor);
            if (openIdx === -1) break;
            if (openIdx > lastIdx) {
                parts.push({ type: 'text', content: text.substring(lastIdx, openIdx) });
            }
            const nlIdx = text.indexOf('\n', openIdx + 3);
            if (nlIdx === -1) {
                parts.push({ type: 'text', content: text.substring(openIdx) });
                lastIdx = text.length;
                break;
            }
            codeLang = text.substring(openIdx + 3, nlIdx).trim();
            codeStart = nlIdx + 1;
            inCode = true;
            cursor = codeStart;
        } else {
            const closeIdx = text.indexOf('```', cursor);
            if (closeIdx === -1) {
                parts.push({
                    type: 'code', lang: codeLang,
                    content: text.substring(codeStart), open: true
                });
                lastIdx = text.length;
                cursor = text.length;
                inCode = false;
                break;
            }
            parts.push({
                type: 'code', lang: codeLang,
                content: text.substring(codeStart, closeIdx)
            });
            cursor = closeIdx + 3;
            lastIdx = cursor;
            inCode = false;
        }
    }
    if (lastIdx < text.length) {
        if (inCode) {
            parts.push({
                type: 'code', lang: codeLang,
                content: text.substring(codeStart), open: true
            });
        } else {
            parts.push({ type: 'text', content: text.substring(lastIdx) });
        }
    }

    let html = '';
    for (const p of parts) {
        if (p.type === 'text') html += FAR.Ollama._renderInline(p.content);
        else html += FAR.Ollama._renderCodeBlock(p.lang, p.content, p.open);
    }
    return html;
};

FAR.Ollama._renderInline = function (text) {
    let s = FAR.Ollama._esc(text);
    s = s.replace(/`([^`\n]+)`/g, function (_, c) {
        return '<code>' + c + '</code>';
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return s;
};

FAR.Ollama._renderCodeBlock = function (lang, code, open) {
    const langLabel = lang
        ? '<span class="code-lang">' + FAR.Ollama._esc(lang) + '</span>'
        : '<span class="code-lang"></span>';
    return '<div class="code-block' + (open ? ' code-open' : '') + '">' +
        '  <div class="code-header">' + langLabel +
        '    <button type="button" class="code-copy" title="Копировать код">📋 Копировать</button>' +
        '  </div>' +
        '  <pre><code>' + FAR.Ollama._esc(code) + '</code></pre>' +
        '</div>';
};

FAR.Ollama._bindCopyButtons = function (container) {
    container.querySelectorAll('.code-copy').forEach(function (btn) {
        if (btn._farCopyBound) return;
        btn._farCopyBound = true;
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const block = btn.closest('.code-block');
            if (!block) return;
            const codeEl = block.querySelector('pre code');
            if (!codeEl) return;
            FAR.Ollama._copyToClipboard(codeEl.textContent || '', btn);
        });
    });
};

FAR.Ollama._copyToClipboard = function (text, btn) {
    const done = function () {
        if (!btn) return;
        const old = btn.textContent;
        btn.textContent = '✓ Скопировано';
        btn.classList.add('copied');
        setTimeout(function () {
            btn.textContent = old;
            btn.classList.remove('copied');
        }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
            FAR.Ollama._copyFallback(text, done);
        });
    } else {
        FAR.Ollama._copyFallback(text, done);
    }
};

FAR.Ollama._copyFallback = function (text, done) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        if (done) done();
    } catch (e) {
        FAR.toast('Не удалось скопировать', 'error');
    }
};

// ============================================================
// ЯДРО: FAR._createOllamaUI
// ============================================================

FAR._createOllamaUI = function (hostEl, opts) {
    opts = opts || {};
    if (!hostEl) throw new Error('_createOllamaUI: hostEl required');

    hostEl.innerHTML =
        '<div class="ollama-toolbar">' +
        '  <select class="ollama-model-select" data-role="model" title="Модель"></select>' +
        '  <span class="ollama-model-type ollama-model-type-none" data-role="model-type" title="Тип модели">—</span>' +
        '  <button class="ollama-btn" data-role="refresh-models" title="Обновить список моделей">🔄</button>' +
        '  <button class="ollama-btn" data-role="new-chat" title="Начать новый чат">🧹 Новый чат</button>' +
        '  <button class="ollama-btn ollama-btn-primary" data-role="toggle-sidebar" title="Показать/скрыть панель">📐 Панель</button>' +
        '  <button class="ollama-btn" data-role="running" title="Запущенные модели">📊 Running</button>' +
        '  <button class="ollama-btn ollama-btn-danger" data-role="stop-vram" title="Выгрузить все модели из VRAM">🗑 VRAM</button>' +
        '  <span class="ollama-status load" data-role="status">Подключение…</span>' +
        '</div>' +
        '<div class="ollama-body">' +
        '  <div class="ollama-chat" data-role="chat"></div>' +
        '  <div class="ollama-sidebar" data-role="sidebar">' +
        '    <div class="ollama-tabs">' +
        '      <button class="ollama-tab active" data-tab="gpu" type="button">🎮 GPU</button>' +
        '      <button class="ollama-tab" data-tab="context" type="button">📋 Контекст</button>' +
        '      <button class="ollama-tab" data-tab="files" type="button">📎 Файлы</button>' +
        '    </div>' +
        '    <div class="ollama-tab-content" data-tab-content="gpu">' +
        '      <div class="ollama-gpu-list" data-role="gpu-list">Загрузка…</div>' +
        '    </div>' +
        '    <div class="ollama-tab-content hidden" data-tab-content="context">' +
        '      <div class="ollama-sidebar-section">' +
        '        <div class="ollama-sidebar-label">Системный контекст</div>' +
        '        <textarea class="ollama-context-input" data-role="context" ' +
        '                  placeholder="Опишите контекст. Например: «Ты — опытный программист на Java. Отвечай кратко, показывай примеры кода в блоках.»"></textarea>' +
        '        <div class="ollama-sidebar-actions">' +
        '          <button class="ollama-btn ollama-btn-primary" data-role="save-context" type="button">💾 Сохранить</button>' +
        '          <button class="ollama-btn" data-role="clear-context" type="button">🧹 Очистить</button>' +
        '        </div>' +
        '      </div>' +
        '    </div>' +
        '    <div class="ollama-tab-content hidden" data-tab-content="files">' +
        '      <div class="ollama-sidebar-section">' +
        '        <div class="ollama-sidebar-label">Текстовые файлы в контексте</div>' +
        '        <div class="ollama-files-actions">' +
        '          <button class="ollama-btn ollama-btn-primary" data-role="add-files" type="button">➕ Добавить файлы</button>' +
        '          <button class="ollama-btn" data-role="clear-files" type="button">🧹 Убрать все</button>' +
        '        </div>' +
        '        <div class="ollama-files-list" data-role="files-list"></div>' +
        '        <div class="ollama-files-summary" data-role="files-summary"></div>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '</div>' +
        '<div class="ollama-attach-preview" data-role="attach-preview"></div>' +
        '<div class="ollama-input-row">' +
        '  <button class="ollama-attach-btn" data-role="attach" type="button" title="Прикрепить изображения">🖼</button>' +
        '  <textarea class="ollama-input" data-role="input" ' +
        '     placeholder="Введите сообщение… (Enter — отправить, Shift+Enter — новая строка, Ctrl+V — вставить картинку)" ' +
        '     rows="1"></textarea>' +
        '  <div class="ollama-input-actions">' +
        '    <button class="ollama-btn ollama-btn-primary" data-role="send" type="button">▶ Отправить</button>' +
        '    <button class="ollama-btn ollama-btn-danger" data-role="stop" type="button" disabled>■ Стоп</button>' +
        '  </div>' +
        '</div>';

    const $ = (sel) => hostEl.querySelector('[data-role="' + sel + '"]');
    const elModel      = $('model');
    const elModelType  = $('model-type');
    const elRefresh    = $('refresh-models');
    const elNewChat    = $('new-chat');
    const elToggleSide = $('toggle-sidebar');
    const elRunning    = $('running');
    const elStopVram   = $('stop-vram');
    const elStatus     = $('status');
    const elChat       = $('chat');
    const elSidebar    = $('sidebar');
    const elInput      = $('input');
    const elSend       = $('send');
    const elStop       = $('stop');
    const elAttach     = $('attach');
    const elAttachPreview = $('attach-preview');

    const elTabs       = hostEl.querySelectorAll('.ollama-tab');
    const elTabContent = hostEl.querySelectorAll('.ollama-tab-content');

    const elGpuList      = $('gpu-list');
    const elContext      = $('context');
    const elSaveCtx      = $('save-context');
    const elClearCtx     = $('clear-context');
    const elAddFiles     = $('add-files');
    const elClearFiles   = $('clear-files');
    const elFilesList    = $('files-list');
    const elFilesSummary = $('files-summary');

    // ============================================================
    // Состояние
    // ============================================================

    const S = {
        models: [],
        model: '',
        messages: [],
        streaming: false,
        abortController: null,
        destroyed: false,
        gpuTimer: null,
        gpuStopped: false,
        context: '',
        files: [],
        attachedImages: [],   // [{ name, size, dataUrl, base64 }]
        _unregisterDropTarget: null
    };

    // ============================================================
    // Status / LS
    // ============================================================

    function setStatus(text, cls) {
        elStatus.textContent = text || '';
        elStatus.className = 'ollama-status' + (cls ? ' ' + cls : '');
    }

    function lsGet(key, def) {
        try {
            const v = localStorage.getItem(key);
            return v == null ? def : v;
        } catch (e) { return def; }
    }
    function lsSet(key, val) {
        try { localStorage.setItem(key, val); } catch (e) {}
    }

    function loadModelFromLS() { return lsGet(FAR.Ollama.LS_MODEL_KEY, ''); }
    function saveModelToLS(name) { if (name) lsSet(FAR.Ollama.LS_MODEL_KEY, name); }

    function loadChatFromLS() {
        try {
            const raw = lsGet(FAR.Ollama.LS_CHAT_KEY, '');
            if (!raw) return [];
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            return arr.slice(-FAR.Ollama.MAX_HISTORY).map(function (m) {
                const copy = { role: m.role, content: m.content, _meta: m._meta };
                if (m._hadImages) copy._hadImages = true;
                return copy;
            });
        } catch (e) { return []; }
    }

    function saveChatToLS() {
        try {
            const minimal = S.messages.slice(-FAR.Ollama.MAX_HISTORY).map(function (m) {
                const copy = { role: m.role, content: m.content };
                if (m._meta) copy._meta = m._meta;
                if (Array.isArray(m.images) && m.images.length > 0) {
                    copy._hadImages = true;
                }
                return copy;
            });
            lsSet(FAR.Ollama.LS_CHAT_KEY, JSON.stringify(minimal));
        } catch (e) {}
    }

    function loadContextFromLS() { return lsGet(FAR.Ollama.LS_CONTEXT_KEY, ''); }
    function saveContextToLS(t) { lsSet(FAR.Ollama.LS_CONTEXT_KEY, t); }

    function loadFilesFromLS() {
        try {
            const raw = lsGet(FAR.Ollama.LS_FILES_KEY, '');
            if (!raw) return [];
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }
    function saveFilesToLS() {
        try {
            const minimal = S.files.map(function (f) {
                return { path: f.path, name: f.name, enabled: !!f.enabled };
            });
            lsSet(FAR.Ollama.LS_FILES_KEY, JSON.stringify(minimal));
        } catch (e) {}
    }

    // ============================================================
    // Tabs
    // ============================================================

    function switchTab(name) {
        elTabs.forEach(function (t) {
            t.classList.toggle('active', t.getAttribute('data-tab') === name);
        });
        elTabContent.forEach(function (c) {
            c.classList.toggle('hidden',
                c.getAttribute('data-tab-content') !== name);
        });
    }

    elTabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            switchTab(tab.getAttribute('data-tab'));
        });
    });

    // ============================================================
    // Типы моделей
    // ============================================================

    function getModelType(name) {
        if (!name) return 'txt';
        const m = S.models.find(function (x) { return x.name === name; });
        if (m && m.type) return m.type;
        return FAR.Ollama._detectTypeLocal(name);
    }

    // Глобальный доступ (для других модулей)
    FAR.Ollama._getModelType = getModelType;

    function updateModelTypeBadge() {
        if (!elModelType) return;

        if (!S.model) {
            elModelType.textContent = '—';
            elModelType.className = 'ollama-model-type ollama-model-type-none';
            elModelType.title = 'Модель не выбрана';
            return;
        }

        const type = getModelType(S.model);
        const info = FAR.Ollama.MODEL_TYPE_INFO[type] || FAR.Ollama.MODEL_TYPE_INFO.txt;
        elModelType.textContent = info.icon + ' ' + info.label;
        elModelType.className = 'ollama-model-type ollama-model-type-' + type;
        elModelType.title = info.desc;
    }

    // ============================================================
    // Модели
    // ============================================================

    async function loadModels(silent) {
        if (!silent) setStatus('Загрузка моделей…', 'load');
        try {
            const res = await fetch(FAR.Ollama._getBaseUrl() + '/api/ollama/models', {
                headers: FAR.Ollama._getHeaders(false),
                credentials: 'include',
                cache: 'no-store'
            });
            if (res.status === 503) throw new Error('Ollama отключен на сервере');
            if (res.status === 401) throw new Error('Требуется авторизация');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            S.models = Array.isArray(data.models) ? data.models : [];
            renderModelSelect();
            if (S.models.length === 0) {
                setStatus('Нет моделей. Выполните `ollama pull <model>` на сервере.', 'warn');
            } else if (!silent) {
                setStatus('Моделей: ' + S.models.length, 'ok');
            }
            return true;
        } catch (e) {
            console.error('[Ollama] loadModels:', e);
            setStatus('Ошибка моделей: ' + e.message, 'error');
            return false;
        }
    }

    function renderModelSelect() {
        const prev = S.model || loadModelFromLS();
        elModel.innerHTML = '';

        if (S.models.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '— нет моделей —';
            elModel.appendChild(opt);
            updateModelTypeBadge();
            return;
        }

        const groups = {
            txt:   { label: '📝 Текстовые (чат)',           items: [] },
            img:   { label: '🖼 Vision (чат + изображения)', items: [] },
            embed: { label: '🔢 Эмбеддинги (не для чата)',   items: [] }
        };

        S.models.forEach(function (m) {
            const t = m.type || FAR.Ollama._detectTypeLocal(m.name);
            if (groups[t]) groups[t].items.push(m);
            else groups.txt.items.push(m);
        });

        let selected = '';

        ['txt', 'img', 'embed'].forEach(function (key) {
            const g = groups[key];
            if (g.items.length === 0) return;

            const og = document.createElement('optgroup');
            og.label = g.label;
            const icon = FAR.Ollama.MODEL_TYPE_INFO[key].icon + ' ';

            g.items.forEach(function (m) {
                const opt = document.createElement('option');
                opt.value = m.name;
                const sizeTxt = (m.size_str || (m.size ? FAR.Ollama._formatSize(m.size) : ''));
                opt.textContent = icon + m.name + (sizeTxt ? ' (' + sizeTxt + ')' : '');
                opt.dataset.type = key;
                og.appendChild(opt);
                if (m.name === prev) selected = m.name;
            });

            elModel.appendChild(og);
        });

        const usable = S.models.filter(function (m) {
            const t = m.type || FAR.Ollama._detectTypeLocal(m.name);
            return t !== 'embed';
        });

        if (selected) {
            const saved = S.models.find(function (m) { return m.name === selected; });
            const savedType = saved
                ? (saved.type || FAR.Ollama._detectTypeLocal(saved.name))
                : 'txt';
            if (savedType === 'embed' && usable.length > 0) {
                selected = usable[0].name;
            }
        }

        if (selected) {
            elModel.value = selected;
            S.model = selected;
        } else if (usable.length > 0) {
            S.model = usable[0].name;
            elModel.value = S.model;
        } else {
            S.model = S.models[0].name;
            elModel.value = S.model;
        }

        updateModelTypeBadge();
    }

    async function pingOllama() {
        try {
            const res = await fetch(FAR.Ollama._getBaseUrl() + '/api/ollama/ping', {
                credentials: 'include', cache: 'no-store'
            });
            if (!res.ok) return false;
            const data = await res.json();
            if (!data.available) {
                setStatus('Ollama недоступен. Проверьте, что `ollama` есть в PATH.', 'error');
                return false;
            }
            return true;
        } catch (e) {
            setStatus('Ollama недоступен: ' + e.message, 'error');
            return false;
        }
    }

    // ============================================================
    // Context
    // ============================================================

    function initContext() {
        S.context = loadContextFromLS();
        elContext.value = S.context;
    }

    elSaveCtx.addEventListener('click', function () {
        S.context = (elContext.value || '').trim();
        saveContextToLS(S.context);
        FAR.toast(S.context
            ? 'Контекст сохранён (' + S.context.length + ' символов)'
            : 'Контекст очищен', 'success');
    });

    elClearCtx.addEventListener('click', function () {
        elContext.value = '';
        S.context = '';
        saveContextToLS('');
        FAR.toast('Контекст очищен', 'info');
    });

    // ============================================================
    // Files (текст)
    // ============================================================

    function textFileExtensions() {
        return ['txt','md','json','xml','csv','log','html','htm',
            'css','js','mjs','ts','jsx','tsx','vue','svelte',
            'py','java','c','cpp','cxx','h','hpp','cs','go','rs','rb',
            'php','pl','sh','bash','zsh','ps1','bat','cmd',
            'ini','cfg','conf','yaml','yml','toml','properties',
            'sql','gradle','pom','dockerfile','makefile','gitignore',
            'gitattributes','editorconfig','kt','kts','swift',
            'scala','clj','elm','ex','exs','erl','lua','r','m','mm',
            'tex','bib','rst','adoc','org','srt','vtt'];
    }

    function isTextFileByName(name) {
        const lower = String(name || '').toLowerCase();
        const ext = (lower.split('.').pop() || '');
        if (textFileExtensions().indexOf(ext) !== -1) return true;
        const base = lower.split('/').pop();
        if (['dockerfile', 'makefile', 'cmakelists.txt'].indexOf(base) !== -1) return true;
        return false;
    }

    function isTextFile(item) {
        if (!item || item.isFolder) return false;
        const name = (item.name || item.path || '');
        if (isTextFileByName(name)) return true;
        if (typeof FAR.isTextFile === 'function' && FAR.isTextFile(item)) return true;
        const ct = (item.contentType || '').toLowerCase();
        return ct.startsWith('text/') || ct.includes('json')
            || ct.includes('xml') || ct.includes('javascript');
    }

    async function initFiles() {
        const minimal = loadFilesFromLS();
        S.files = minimal.map(function (m) {
            return {
                path: m.path, name: m.name,
                enabled: m.enabled !== false,
                content: null, size: 0, error: null
            };
        });
        renderFiles();

        const side = FAR.activePanel;
        for (const f of S.files) {
            if (String(f.path).startsWith('[os] ')) continue;
            try {
                const item = await FAR._readDocByPathFromSide(side, f.path);
                if (!item || item.isFolder) { f.error = 'не найден'; continue; }
                const r = await FAR.readFileBodyFromSide(side, item);
                const text = new TextDecoder('utf-8').decode(r.data);
                f.content = text;
                f.size = text.length;
                f.error = null;
            } catch (e) {
                f.error = e.message || 'ошибка чтения';
            }
        }
        renderFiles();
    }

    function renderFiles() {
        elFilesList.innerHTML = '';

        if (S.files.length === 0) {
            elFilesList.innerHTML = '<div class="ollama-files-empty">Файлов нет.<br>Перетащите их сюда из панели FAR или из ОС.</div>';
            elFilesSummary.textContent = '';
            return;
        }

        S.files.forEach(function (f, idx) {
            const row = document.createElement('div');
            row.className = 'ollama-file-item'
                + (f.enabled ? '' : ' disabled')
                + (f.error ? ' error' : '');

            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'file-check';
            chk.checked = !!f.enabled;
            chk.addEventListener('change', function () {
                S.files[idx].enabled = chk.checked;
                saveFilesToLS();
                renderFiles();
            });

            const info = document.createElement('div');
            info.className = 'file-info';
            const nameEl = document.createElement('div');
            nameEl.className = 'file-name';
            nameEl.textContent = f.name;
            nameEl.title = f.path;
            const meta = document.createElement('div');
            meta.className = 'file-meta';
            if (f.error) {
                meta.textContent = '⚠ ' + f.error;
            } else if (f.content == null) {
                meta.textContent = 'загрузка…';
            } else {
                meta.textContent = FAR.Ollama._formatSize(f.size) +
                    ' • ' + (String(f.path).startsWith('[os] ') ? 'из ОС' : f.path);
            }
            info.appendChild(nameEl);
            info.appendChild(meta);

            const rm = document.createElement('button');
            rm.className = 'file-remove';
            rm.type = 'button';
            rm.textContent = '✕';
            rm.title = 'Убрать из контекста';
            rm.addEventListener('click', function () {
                S.files.splice(idx, 1);
                saveFilesToLS();
                renderFiles();
            });

            row.appendChild(chk);
            row.appendChild(info);
            row.appendChild(rm);
            elFilesList.appendChild(row);
        });

        const enabled = S.files.filter(function (f) {
            return f.enabled && f.content != null;
        });
        const totalSize = enabled.reduce(function (s, f) { return s + f.size; }, 0);
        const tooBig = totalSize > FAR.Ollama.MAX_CONTEXT_BYTES;
        elFilesSummary.textContent = 'Включено: ' + enabled.length +
            ' / ' + S.files.length +
            ' • ' + FAR.Ollama._formatSize(totalSize) +
            (tooBig ? ' ⚠ превышает ' +
                FAR.Ollama._formatSize(FAR.Ollama.MAX_CONTEXT_BYTES) : '');
        elFilesSummary.style.color = tooBig ? '#f38ba8' : '#6c7086';
    }

    elClearFiles.addEventListener('click', function () {
        if (S.files.length === 0) return;
        if (!confirm('Убрать все файлы из контекста?')) return;
        S.files = [];
        saveFilesToLS();
        renderFiles();
        FAR.toast('Файлы убраны', 'info');
    });

    // ============================================================
    // Изображения
    // ============================================================

    function dataUrlToBase64(dataUrl) {
        const idx = dataUrl.indexOf(',');
        return idx >= 0 ? dataUrl.substring(idx + 1) : dataUrl;
    }

    function bytesToBase64(bytes) {
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(bin);
    }

    function renderAttachPreview() {
        elAttachPreview.innerHTML = '';
        if (S.attachedImages.length === 0) return;

        S.attachedImages.forEach(function (img, idx) {
            const chip = document.createElement('div');
            chip.className = 'ollama-attach-chip';
            chip.title = img.name + ' (' + FAR.Ollama._formatSize(img.size) + ')';

            const i = document.createElement('img');
            i.src = img.dataUrl;
            i.alt = img.name;
            i.addEventListener('click', function () {
                openImageModal(img.dataUrl, img.name);
            });

            const rm = document.createElement('button');
            rm.className = 'attach-remove';
            rm.type = 'button';
            rm.textContent = '✕';
            rm.title = 'Убрать';
            rm.addEventListener('click', function (e) {
                e.stopPropagation();
                S.attachedImages.splice(idx, 1);
                renderAttachPreview();
                updateAttachButtonState();
            });

            chip.appendChild(i);
            chip.appendChild(rm);
            elAttachPreview.appendChild(chip);
        });
    }

    function updateAttachButtonState() {
        if (!S.model) {
            elAttach.classList.remove('warn');
            elAttach.title = 'Прикрепить изображения';
            return;
        }

        const type = getModelType(S.model);

        if (type === 'embed') {
            elAttach.classList.add('warn');
            elAttach.title = '⚠ "' + S.model + '" — эмбеддинг. Выберите 📝 или 🖼 модель.';
            return;
        }
        if (type === 'img') {
            elAttach.classList.remove('warn');
            elAttach.title = 'Прикрепить изображения (🖼 ' + S.model + ')';
            return;
        }
        // type === 'txt'
        if (S.attachedImages.length > 0) {
            elAttach.classList.add('warn');
            elAttach.title = '⚠ 📝 "' + S.model + '" не vision. ' +
                'Выберите 🖼 vision-модель (llava, moondream, llama3.2-vision, …).';
        } else {
            elAttach.classList.remove('warn');
            elAttach.title = 'Прикрепить изображения (требуется 🖼 vision-модель)';
        }
    }

    async function fileToImageAttachment(file) {
        if (!file) return null;
        if (!file.type || file.type.indexOf('image/') !== 0) {
            FAR.toast('Не изображение: ' + (file.name || '?'), 'warning');
            return null;
        }
        if (file.size > FAR.Ollama.MAX_IMAGE_BYTES) {
            FAR.toast('Файл слишком большой: ' + file.name +
                ' (' + FAR.Ollama._formatSize(file.size) + ' > ' +
                FAR.Ollama._formatSize(FAR.Ollama.MAX_IMAGE_BYTES) + ')', 'warning');
            return null;
        }
        return new Promise(function (resolve) {
            const reader = new FileReader();
            reader.onload = function () {
                const dataUrl = reader.result;
                resolve({
                    name: file.name || ('image-' + Date.now() + '.png'),
                    size: file.size,
                    dataUrl: dataUrl,
                    base64: dataUrlToBase64(dataUrl)
                });
            };
            reader.onerror = function () {
                FAR.toast('Не удалось прочитать: ' + file.name, 'error');
                resolve(null);
            };
            reader.readAsDataURL(file);
        });
    }

    async function addImageFiles(files) {
        if (!files || files.length === 0) return;
        if (S.attachedImages.length >= FAR.Ollama.MAX_IMAGES_PER_MSG) {
            FAR.toast('Максимум ' + FAR.Ollama.MAX_IMAGES_PER_MSG + ' картинок', 'warning');
            return;
        }
        let totalSize = S.attachedImages.reduce((s, i) => s + i.size, 0);
        let added = 0, skipped = 0;

        for (const f of files) {
            if (S.attachedImages.length >= FAR.Ollama.MAX_IMAGES_PER_MSG) {
                skipped++; continue;
            }
            const img = await fileToImageAttachment(f);
            if (!img) { skipped++; continue; }
            if (totalSize + img.size > FAR.Ollama.MAX_TOTAL_IMAGE_BYTES) {
                FAR.toast('Суммарный размер превысит ' +
                    FAR.Ollama._formatSize(FAR.Ollama.MAX_TOTAL_IMAGE_BYTES), 'warning');
                skipped++;
                continue;
            }
            S.attachedImages.push(img);
            totalSize += img.size;
            added++;
        }

        renderAttachPreview();
        updateAttachButtonState();

        if (added > 0) {
            FAR.toast('Прикреплено картинок: ' + added +
                (skipped ? ' • пропущено: ' + skipped : ''), 'success');
        }
    }

    function openImageModal(dataUrl, name) {
        const overlay = document.createElement('div');
        overlay.className = 'ollama-img-modal';
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = name || '';
        overlay.appendChild(img);
        overlay.addEventListener('click', function () { overlay.remove(); });
        const esc = function (e) {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', esc, true);
            }
        };
        document.addEventListener('keydown', esc, true);
        document.body.appendChild(overlay);
    }

    // ============================================================
    // Добавление файлов/картинок из drop
    // ============================================================

    const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

    async function addFilesFromFAR(items, sourceSide) {
        if (!items || items.length === 0) return;
        const side = sourceSide || FAR.activePanel;
        if (!FAR.side[side] || !FAR.side[side].db) {
            FAR.toast('Источник не подключён к БД', 'warning');
            return;
        }

        let addedText = 0, addedImages = 0, skipped = 0, err = 0;

        for (const it of items) {
            if (it.isFolder) { skipped++; continue; }

            const name = (it.name || it.path || '');
            const ext = (name.split('.').pop() || '').toLowerCase();

            // Изображения
            if (IMAGE_EXTS.indexOf(ext) !== -1) {
                try {
                    const item = { _id: it._id, name: it.name || name.split('/').pop() };
                    const r = await FAR.readFileBodyFromSide(side, item);
                    if (r.data.length > FAR.Ollama.MAX_IMAGE_BYTES) {
                        FAR.toast('Картинка слишком большая: ' + item.name, 'warning');
                        skipped++;
                        continue;
                    }
                    const ct = r.contentType || 'image/png';
                    const b64 = bytesToBase64(r.data);
                    const dataUrl = 'data:' + ct + ';base64,' + b64;
                    S.attachedImages.push({
                        name: item.name,
                        size: r.data.length,
                        dataUrl: dataUrl,
                        base64: b64
                    });
                    addedImages++;
                } catch (e) {
                    err++;
                }
                continue;
            }

            // Текст
            if (!isTextFileByName(name)) { skipped++; continue; }
            if (S.files.some(function (f) { return f.path === it.path; })) {
                skipped++;
                continue;
            }
            try {
                const item = { _id: it._id, name: it.name || name.split('/').pop() };
                const r = await FAR.readFileBodyFromSide(side, item);
                const text = new TextDecoder('utf-8').decode(r.data);
                S.files.push({
                    path: it.path,
                    name: item.name,
                    enabled: true,
                    content: text,
                    size: text.length,
                    error: null
                });
                addedText++;
            } catch (e) {
                S.files.push({
                    path: it.path,
                    name: it.name || name.split('/').pop(),
                    enabled: false,
                    content: null,
                    size: 0,
                    error: e.message || 'ошибка'
                });
                err++;
            }
        }

        saveFilesToLS();
        renderFiles();
        renderAttachPreview();
        updateAttachButtonState();

        if (addedImages > 0) switchTab('gpu');
        else if (addedText > 0) switchTab('files');

        const parts = [];
        if (addedText)   parts.push('текст: ' + addedText);
        if (addedImages) parts.push('картинки: ' + addedImages);
        if (skipped)     parts.push('пропущено: ' + skipped);
        if (err)         parts.push('ошибок: ' + err);
        if (parts.length) {
            FAR.toast('Из FAR: ' + parts.join(', '),
                (addedText + addedImages) > 0 ? 'success' : 'warning');
        }
    }

    async function addFilesFromOS(osFiles) {
        if (!osFiles || osFiles.length === 0) return;

        const imgBlobs = [];
        const textBlobs = [];
        for (const f of osFiles) {
            const type = (f.blob && f.blob.type) || '';
            if (type.indexOf('image/') === 0) imgBlobs.push(f.blob);
            else textBlobs.push(f);
        }

        if (imgBlobs.length > 0) {
            await addImageFiles(imgBlobs);
        }

        if (textBlobs.length > 0) {
            let added = 0, skipped = 0;
            for (const f of textBlobs) {
                const name = f.name || 'file.txt';
                if (!isTextFileByName(name)) { skipped++; continue; }
                try {
                    let text;
                    if (f.blob && typeof f.blob.text === 'function') {
                        text = await f.blob.text();
                    } else if (f.blob && typeof f.blob.arrayBuffer === 'function') {
                        const buf = await f.blob.arrayBuffer();
                        text = new TextDecoder('utf-8').decode(buf);
                    } else {
                        throw new Error('не удалось прочитать');
                    }
                    S.files.push({
                        path: '[os] ' + name + ' ' + Date.now(),
                        name: name,
                        enabled: true,
                        content: text,
                        size: text.length,
                        error: null
                    });
                    added++;
                } catch (e) {
                    skipped++;
                }
            }
            saveFilesToLS();
            renderFiles();
            if (added > 0) switchTab('files');
            if (added > 0 || skipped > 0) {
                FAR.toast('Файлы из ОС: добавлено ' + added +
                    (skipped ? ', пропущено ' + skipped : ''),
                    added > 0 ? 'success' : 'warning');
            }
        }
    }

    // ============================================================
    // Drop-target
    // ============================================================

    function setupDropTarget() {
        const overlay = document.createElement('div');
        overlay.className = 'ollama-drop-overlay hidden';
        overlay.innerHTML =
            '<div class="ollama-drop-icon">📥</div>' +
            '<div class="ollama-drop-text">Отпустите файлы, чтобы добавить их в контекст</div>';
        hostEl.appendChild(overlay);

        if (typeof FAR.registerExternalDropTarget === 'function') {
            S._unregisterDropTarget = FAR.registerExternalDropTarget({
                containsPoint: function (x, y) {
                    const rect = hostEl.getBoundingClientRect();
                    return x >= rect.left && x <= rect.right
                        && y >= rect.top && y <= rect.bottom;
                },
                onHover: function (isOver) {
                    overlay.classList.toggle('hidden', !isOver);
                },
                acceptDrop: async function (items, sourceSide) {
                    overlay.classList.add('hidden');
                    await addFilesFromFAR(items, sourceSide);
                }
            });
        }

        let hoverCount = 0;

        hostEl.addEventListener('dragenter', function (e) {
            if (!e.dataTransfer || !e.dataTransfer.types) return;
            if (Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') === -1) return;
            e.preventDefault();
            e.stopPropagation();
            hoverCount++;
            overlay.classList.remove('hidden');
        });
        hostEl.addEventListener('dragover', function (e) {
            if (!e.dataTransfer || !e.dataTransfer.types) return;
            if (Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') === -1) return;
            e.preventDefault();
            e.stopPropagation();
            try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
        });
        hostEl.addEventListener('dragleave', function (e) {
            if (!e.dataTransfer || !e.dataTransfer.types) return;
            if (Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') === -1) return;
            e.preventDefault();
            e.stopPropagation();
            hoverCount--;
            if (hoverCount <= 0) {
                hoverCount = 0;
                overlay.classList.add('hidden');
            }
        });
        hostEl.addEventListener('drop', async function (e) {
            if (!e.dataTransfer || !e.dataTransfer.types) return;
            if (Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') === -1) return;
            e.preventDefault();
            e.stopPropagation();
            hoverCount = 0;
            overlay.classList.add('hidden');
            try {
                let files = [];
                if (typeof FAR.collectFilesFromDataTransfer === 'function') {
                    files = await FAR.collectFilesFromDataTransfer(e.dataTransfer);
                } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    files = Array.from(e.dataTransfer.files).map(function (f) {
                        return {
                            name: f.name,
                            blob: f,
                            contentType: f.type || 'application/octet-stream',
                            relativePath: ''
                        };
                    });
                }
                await addFilesFromOS(files);
            } catch (err) {
                console.error('[Ollama drop]', err);
                FAR.toast('Не удалось принять файлы: ' + err.message, 'error');
            }
        });
    }

    // ============================================================
    // Кнопка «Добавить файлы» (мультивыбор)
    // ============================================================

    function openFileSelector(onDone) {
        const side = FAR.activePanel;
        if (!FAR.side[side] || !FAR.side[side].db) {
            FAR.toast('Панель не подключена к БД', 'warning');
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'ollama-fs-modal';
        overlay.innerHTML =
            '<div class="ollama-fs-dialog">' +
            '  <header>' +
            '    <h4>📎 Выбор текстовых файлов</h4>' +
            '    <button class="ollama-btn" data-role="close" type="button">✕</button>' +
            '  </header>' +
            '  <div class="fs-pathbar">' +
            '    <button class="ollama-btn" data-role="up" type="button" title="Вверх">⬆</button>' +
            '    <button class="ollama-btn" data-role="root" type="button" title="В корень">🏠</button>' +
            '    <input data-role="path" readonly>' +
            '  </div>' +
            '  <div class="fs-list" data-role="list"></div>' +
            '  <footer>' +
            '    <span class="fs-info" data-role="info"></span>' +
            '    <button class="ollama-btn" data-role="cancel" type="button">Отмена</button>' +
            '    <button class="ollama-btn ollama-btn-primary" data-role="ok" type="button" disabled>✓ Добавить</button>' +
            '  </footer>' +
            '</div>';
        document.body.appendChild(overlay);

        const elList  = overlay.querySelector('[data-role="list"]');
        const elPath  = overlay.querySelector('[data-role="path"]');
        const elInfo  = overlay.querySelector('[data-role="info"]');
        const elOk    = overlay.querySelector('[data-role="ok"]');
        const elClose = overlay.querySelector('[data-role="close"]');
        const elUp    = overlay.querySelector('[data-role="up"]');
        const elRoot  = overlay.querySelector('[data-role="root"]');
        const elCancel = overlay.querySelector('[data-role="cancel"]');

        const state = { path: '/', items: [], selected: new Map() };

        function close() {
            try { overlay.remove(); } catch (e) {}
            document.removeEventListener('keydown', onKey, true);
        }

        async function loadDir(path) {
            const norm = FAR.normPath(path);
            state.path = norm ? '/' + norm : '/';
            elPath.value = state.path;
            elList.innerHTML = '<div style="padding:20px;text-align:center;color:#6c7086;">Загрузка…</div>';
            try {
                const children = await FAR.listDirFromSide(side, norm, { includeDocs: true });
                state.items = children || [];
                renderList();
            } catch (e) {
                elList.innerHTML = '<div style="padding:20px;color:#f38ba8;">Ошибка: ' +
                    FAR.Ollama._esc(e.message) + '</div>';
            }
        }

        function renderList() {
            elList.innerHTML = '';

            const folders = state.items.filter(function (it) { return it.isFolder; });
            const files   = state.items.filter(function (it) { return !it.isFolder; });

            folders.forEach(function (it) {
                const row = document.createElement('div');
                row.className = 'fs-item folder';
                row.innerHTML = '<span class="fs-icon">📁</span>' +
                    '<span class="fs-name">' + FAR.Ollama._esc(it.name) + '</span>';
                row.addEventListener('click', function () { loadDir(it.path); });
                elList.appendChild(row);
            });

            files.forEach(function (it) {
                const isText = isTextFile(it);
                const checked = state.selected.has(it.path);

                const row = document.createElement('div');
                row.className = 'fs-item file' + (isText ? '' : ' not-text disabled');

                const chk = document.createElement('input');
                chk.type = 'checkbox';
                chk.checked = checked;
                chk.disabled = !isText;
                chk.addEventListener('change', function () {
                    if (chk.checked) state.selected.set(it.path, it);
                    else state.selected.delete(it.path);
                    updateFooter();
                });

                const icon = document.createElement('span');
                icon.className = 'fs-icon';
                icon.textContent = isText ? '📄' : '🚫';

                const name = document.createElement('span');
                name.className = 'fs-name';
                name.textContent = it.name;
                name.title = it.path;

                const size = document.createElement('span');
                size.className = 'fs-size';
                size.textContent = FAR.Ollama._formatSize(it.size || 0);

                row.appendChild(chk);
                row.appendChild(icon);
                row.appendChild(name);
                row.appendChild(size);

                if (isText) {
                    row.addEventListener('click', function (e) {
                        if (e.target === chk) return;
                        chk.checked = !chk.checked;
                        chk.dispatchEvent(new Event('change'));
                    });
                }

                elList.appendChild(row);
            });

            if (folders.length === 0 && files.length === 0) {
                elList.innerHTML = '<div style="padding:20px;text-align:center;color:#6c7086;">Папка пуста</div>';
            }
            updateFooter();
        }

        function updateFooter() {
            const n = state.selected.size;
            elInfo.textContent = n === 0
                ? 'Ничего не выбрано'
                : 'Выбрано: ' + n + ' файл(ов)';
            elOk.disabled = n === 0;
            elOk.textContent = n > 0 ? '✓ Добавить (' + n + ')' : '✓ Добавить';
        }

        elClose.addEventListener('click', close);
        elCancel.addEventListener('click', close);
        elOk.addEventListener('click', function () {
            const picked = Array.from(state.selected.values());
            close();
            try { onDone(picked); } catch (e) { console.error(e); }
        });

        elUp.addEventListener('click', function () {
            const cur = FAR.normPath(state.path);
            if (!cur) return;
            const parts = cur.split('/').filter(Boolean);
            parts.pop();
            loadDir(parts.length ? '/' + parts.join('/') : '/');
        });
        elRoot.addEventListener('click', function () { loadDir('/'); });

        const onKey = function (e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
            }
        };
        document.addEventListener('keydown', onKey, true);

        loadDir(state.path);
    }

    elAddFiles.addEventListener('click', function () {
        openFileSelector(async function (picked) {
            if (!picked || picked.length === 0) return;

            const side = FAR.activePanel;
            let added = 0, dup = 0, err = 0;

            for (const item of picked) {
                if (!isTextFile(item)) { err++; continue; }
                if (S.files.some(function (f) { return f.path === item.path; })) {
                    dup++;
                    continue;
                }
                try {
                    const r = await FAR.readFileBodyFromSide(side, item);
                    const text = new TextDecoder('utf-8').decode(r.data);
                    S.files.push({
                        path: item.path,
                        name: item.name,
                        enabled: true,
                        content: text,
                        size: text.length,
                        error: null
                    });
                    added++;
                } catch (e) {
                    S.files.push({
                        path: item.path,
                        name: item.name,
                        enabled: false,
                        content: null,
                        size: 0,
                        error: e.message || 'ошибка'
                    });
                    err++;
                }
            }

            saveFilesToLS();
            renderFiles();

            const parts = [];
            if (added) parts.push('Добавлено: ' + added);
            if (dup)   parts.push('дубликатов: ' + dup);
            if (err)   parts.push('ошибок: ' + err);
            if (parts.length) {
                FAR.toast(parts.join(' • '), added ? 'success' : 'warning');
            }
        });
    });

    // ============================================================
    // Chat
    // ============================================================

    function renderChat() {
        elChat.innerHTML = '';
        if (S.messages.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ollama-empty';
            empty.textContent = 'Начните диалог: введите вопрос и нажмите «Отправить».';
            elChat.appendChild(empty);
            return;
        }
        S.messages.forEach(function (msg) {
            elChat.appendChild(createMessageEl(msg));
        });
        scrollChatBottom();
    }

    function createMessageEl(msg) {
        const wrap = document.createElement('div');
        wrap.className = 'ollama-msg ' + (msg.role || 'assistant');

        const header = document.createElement('div');
        header.className = 'ollama-msg-header';
        header.textContent = msg.role === 'user'
            ? '👤 Вы'
            : msg.role === 'assistant' ? '🤖 Ollama' : '⚙ ' + msg.role;
        wrap.appendChild(header);

        if (Array.isArray(msg._thumbs) && msg._thumbs.length > 0) {
            const imgs = document.createElement('div');
            imgs.className = 'ollama-msg-images';
            msg._thumbs.forEach(function (t) {
                const im = document.createElement('img');
                im.src = t.dataUrl;
                im.alt = t.name || '';
                im.title = t.name || '';
                im.addEventListener('click', function () {
                    openImageModal(t.dataUrl, t.name);
                });
                imgs.appendChild(im);
            });
            wrap.appendChild(imgs);
        } else if (msg._hadImages) {
            const badge = document.createElement('div');
            badge.className = 'ollama-msg-image-lost';
            badge.textContent = '🖼 [изображение утеряно при перезагрузке]';
            wrap.appendChild(badge);
        }

        const body = document.createElement('div');
        body.className = 'ollama-msg-body';
        if (msg.role === 'assistant') {
            body.innerHTML = FAR.Ollama._renderMarkdown(msg.content || '');
        } else {
            body.textContent = msg.content || '';
        }
        wrap.appendChild(body);

        if (msg._meta) {
            const meta = document.createElement('div');
            meta.className = 'ollama-msg-meta';
            meta.textContent = msg._meta;
            wrap.appendChild(meta);
        }

        return wrap;
    }

    function scrollChatBottom() {
        try { elChat.scrollTop = elChat.scrollHeight; } catch (e) {}
    }

    function setStreaming(on) {
        S.streaming = on;
        elSend.disabled = on;
        elStop.disabled = !on;
        elInput.disabled = on;
        elModel.disabled = on;
        elNewChat.disabled = on;
        elRefresh.disabled = on;
        elStopVram.disabled = on;
        elAttach.disabled = on;
    }

    function buildMessagesForServer() {
        const out = [];

        if (S.context && S.context.trim()) {
            out.push({ role: 'system', content: S.context.trim() });
        }

        const enabledFiles = S.files.filter(function (f) {
            return f.enabled && f.content != null && !f.error;
        });
        if (enabledFiles.length > 0) {
            const totalSize = enabledFiles.reduce(function (s, f) { return s + f.size; }, 0);
            let filesText;
            if (totalSize > FAR.Ollama.MAX_CONTEXT_BYTES) {
                let budget = FAR.Ollama.MAX_CONTEXT_BYTES;
                const truncated = [];
                for (const f of enabledFiles) {
                    if (budget <= 0) break;
                    const take = Math.min(f.content.length, budget);
                    truncated.push(
                        'File: ' + f.name + '\n' +
                        '```\n' + f.content.substring(0, take) +
                        (take < f.content.length ? '\n… [truncated]' : '') + '\n```'
                    );
                    budget -= take;
                }
                filesText = truncated.join('\n\n');
            } else {
                filesText = enabledFiles.map(function (f) {
                    return 'File: ' + f.name + '\n' +
                        '```\n' + f.content + '\n```';
                }).join('\n\n');
            }
            out.push({ role: 'system', content: 'Files in context:\n\n' + filesText });
        }

        const history = S.messages.slice(0, -1); // без placeholder assistant

        // Изображения передаём ТОЛЬКО из последнего сообщения с images,
        // чтобы не раздувать JSON (сервер всё равно берёт только последнее).
        let lastImagesIdx = -1;
        for (let i = history.length - 1; i >= 0; i--) {
            if (Array.isArray(history[i].images) && history[i].images.length > 0) {
                lastImagesIdx = i;
                break;
            }
        }

        for (let i = 0; i < history.length; i++) {
            const m = history[i];
            const copy = { role: m.role, content: m.content };
            if (i === lastImagesIdx) {
                copy.images = m.images;
            } else if (Array.isArray(m.images) && m.images.length > 0) {
                copy.content = (copy.content || '') + '\n[ранее было приложено изображение]';
            }
            out.push(copy);
        }

        return out;
    }

    async function sendMessage() {
        const text = (elInput.value || '').trim();
        const hasImages = S.attachedImages.length > 0;
        if (!text && !hasImages) return;
        if (!S.model) {
            FAR.toast('Выберите модель', 'warning');
            return;
        }

        const modelType = getModelType(S.model);

        if (modelType === 'embed') {
            FAR.toast('🔢 "' + S.model + '" — эмбеддинг-модель. ' +
                'Она возвращает вектор, а не текст. Выберите 📝 Text или 🖼 Vision.',
                'error');
            return;
        }

        if (hasImages && modelType !== 'img') {
            FAR.toast('🖼 Модель "' + S.model + '" (📝 Text) не принимает изображения. ' +
                'Выберите 🖼 vision-модель из списка.', 'error');
            return;
        }

        // Формируем сообщение пользователя
        const userMsg = { role: 'user', content: text };
        if (hasImages) {
            userMsg.images = S.attachedImages.map(function (i) { return i.base64; });
            userMsg._thumbs = S.attachedImages.map(function (i) {
                return { dataUrl: i.dataUrl, name: i.name };
            });
        }
        S.messages.push(userMsg);
        elChat.appendChild(createMessageEl(userMsg));
        scrollChatBottom();

        elInput.value = '';
        elInput.style.height = '';
        S.attachedImages = [];
        renderAttachPreview();
        updateAttachButtonState();
        saveChatToLS();

        // Placeholder ассистента
        const assistMsg = { role: 'assistant', content: '' };
        S.messages.push(assistMsg);
        const assistEl = createMessageEl(assistMsg);
        elChat.appendChild(assistEl);
        const assistBody = assistEl.querySelector('.ollama-msg-body');
        assistBody.innerHTML = '<span class="ollama-cursor"></span>';

        scrollChatBottom();
        setStreaming(true);
        setStatus('⏳ Ожидание ответа…', 'load');

        S.abortController = new AbortController();
        const startTime = Date.now();
        let firstTokenMs = null;
        let dirty = true;
        let lastPaint = 0;
        let rafId = null;

        function scheduleRender() {
            dirty = true;
            if (rafId) return;
            rafId = requestAnimationFrame(function tick() {
                rafId = null;
                if (!dirty) return;
                const now = performance.now();
                if (now - lastPaint < 50) {
                    rafId = requestAnimationFrame(tick);
                    return;
                }
                dirty = false;
                lastPaint = now;
                paintAssist();
            });
        }

        function paintAssist() {
            assistBody.innerHTML = FAR.Ollama._renderMarkdown(assistMsg.content) +
                '<span class="ollama-cursor"></span>';
            FAR.Ollama._bindCopyButtons(assistBody);
            scrollChatBottom();
        }

        try {
            const messagesToSend = buildMessagesForServer();
            const res = await fetch(FAR.Ollama._getBaseUrl() + '/api/ollama/chat', {
                method: 'POST',
                headers: FAR.Ollama._getHeaders(true),
                credentials: 'include',
                signal: S.abortController.signal,
                body: JSON.stringify({
                    model: S.model,
                    messages: messagesToSend,
                    stream: true
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                let errMsg = 'HTTP ' + res.status;
                try { errMsg = (JSON.parse(errText).error) || errMsg; }
                catch (e) { if (errText) errMsg = errText.substring(0, 200); }
                throw new Error(errMsg);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const r = await reader.read();
                if (r.done) break;
                if (S.destroyed) { try { reader.cancel(); } catch (e) {} break; }
                buffer += decoder.decode(r.value, { stream: true });
                let idx;
                while ((idx = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, idx).trim();
                    buffer = buffer.slice(idx + 1);
                    if (!line) continue;
                    handleChunk(line);
                }
            }
            if (buffer.trim()) handleChunk(buffer.trim());

            if (!assistMsg.content) assistMsg.content = '(пустой ответ)';
            const totalMs = Date.now() - startTime;
            assistMsg._meta = '⏱ ' + (totalMs / 1000).toFixed(2) + 's' +
                (firstTokenMs !== null
                    ? ' • TTFT ' + (firstTokenMs / 1000).toFixed(2) + 's' : '');
            assistEl.appendChild(metaEl(assistMsg._meta));
            paintAssist();
            saveChatToLS();
            setStatus('✅ Готово (' + (totalMs / 1000).toFixed(1) + 's)', 'ok');

        } catch (e) {
            if (e.name === 'AbortError') {
                assistMsg.content += '\n\n_[остановлено пользователем]_';
                paintAssist();
                setStatus('⏹ Остановлено', 'warn');
            } else {
                console.error('[Ollama] chat error:', e);
                assistMsg.role = 'system';
                assistMsg.content = 'Ошибка: ' + e.message;
                assistBody.textContent = assistMsg.content;
                setStatus('Ошибка: ' + e.message, 'error');
            }
            saveChatToLS();
        } finally {
            if (rafId) { try { cancelAnimationFrame(rafId); } catch (e) {} }
            setStreaming(false);
            S.abortController = null;
            scrollChatBottom();
        }

        function handleChunk(line) {
            let chunk;
            try { chunk = JSON.parse(line); } catch (e) { return; }
            if (chunk.error) throw new Error(chunk.error);
            const msg = chunk.message;
            if (msg && typeof msg.content === 'string' && msg.content.length > 0) {
                if (firstTokenMs === null) firstTokenMs = Date.now() - startTime;
                assistMsg.content += msg.content;
                scheduleRender();
            }
        }

        function metaEl(txt) {
            const m = document.createElement('div');
            m.className = 'ollama-msg-meta';
            m.textContent = txt;
            return m;
        }
    }

    function stopStreaming() {
        if (!S.streaming || !S.abortController) return;
        try { S.abortController.abort(); } catch (e) {}
    }

    function startNewChat() {
        if (S.streaming) {
            if (!confirm('Остановить текущий ответ и начать новый чат?')) return;
            stopStreaming();
        }
        S.messages = [];
        renderChat();
        saveChatToLS();
        setStatus('Новый чат', 'ok');
        try { elInput.focus(); } catch (e) {}
    }

    // ============================================================
    // GPU
    // ============================================================

    function startGpuPanel() {
        S.gpuStopped = false;
        tickGpu();
        async function tickGpu() {
            if (S.gpuStopped || S.destroyed) return;
            await tickGpuOnce();
            if (!S.gpuStopped && !S.destroyed) {
                S.gpuTimer = setTimeout(tickGpu, 1500);
            }
        }
    }

    async function tickGpuOnce() {
        try {
            const res = await fetch(FAR.Ollama._getBaseUrl() + '/api/gpu', {
                headers: FAR.Ollama._getHeaders(false),
                credentials: 'include', cache: 'no-store'
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            renderGpu(data);
        } catch (e) {
            elGpuList.innerHTML = '<div class="ollama-gpu-error">' +
                FAR.Ollama._esc(e.message) + '</div>';
        }
    }

    function forceGpuRefresh() {
        if (S.gpuStopped) return;
        if (S.gpuTimer) {
            clearTimeout(S.gpuTimer);
            S.gpuTimer = null;
        }
        tickGpuOnce().then(function () {
            if (!S.gpuStopped && !S.destroyed) {
                S.gpuTimer = setTimeout(startGpuPanel, 100);
            }
        });
    }

    function renderGpu(data) {
        if (!data.available) {
            elGpuList.innerHTML = '<div class="ollama-gpu-empty">' +
                FAR.Ollama._esc(data.error || 'GPU недоступны') + '</div>';
            return;
        }
        const gpus = data.gpus || [];
        if (gpus.length === 0) {
            elGpuList.innerHTML = '<div class="ollama-gpu-empty">GPU не найдены</div>';
            return;
        }
        let html = '';
        gpus.forEach(function (g) {
            const util = Math.max(0, Math.min(100, g.utilizationGpu || 0));
            const mem  = Math.max(0, Math.min(100, g.memoryPercent || 0));
            const memUsed  = g.memoryUsed  != null ? g.memoryUsed  : 0;
            const memTotal = g.memoryTotal != null ? g.memoryTotal : 0;
            html +=
                '<div class="ollama-gpu-card">' +
                '  <div class="ollama-gpu-header">' +
                '    <span class="ollama-gpu-idx">#' + (g.index != null ? g.index : '?') + '</span>' +
                '    <span class="ollama-gpu-name" title="' + FAR.Ollama._esc(g.name) + '">' +
                FAR.Ollama._esc(g.name || 'GPU') + '</span>' +
                '  </div>' +
                '  <div class="ollama-gpu-row">' +
                '    <span>Загрузка</span>' +
                '    <span class="ollama-gpu-val">' + util + '%</span>' +
                '    <div class="ollama-gpu-bar"><div class="ollama-gpu-bar-fill" style="width:' + util + '%"></div></div>' +
                '  </div>' +
                '  <div class="ollama-gpu-row">' +
                '    <span>VRAM</span>' +
                '    <span class="ollama-gpu-val">' + memUsed + '/' + memTotal + ' MiB (' + mem + '%)</span>' +
                '    <div class="ollama-gpu-bar"><div class="ollama-gpu-bar-fill mem" style="width:' + mem + '%"></div></div>' +
                '  </div>' +
                '  <div class="ollama-gpu-row small">' +
                '    <span>🌡 ' + (g.temperature != null ? g.temperature + '°C' : '—') + '</span>' +
                '    <span>⚡ ' + (g.powerDraw != null ? g.powerDraw + 'W' : '—') + '</span>' +
                '    <span>🌀 ' + (g.fanSpeed != null ? g.fanSpeed + '%' : '—') + '</span>' +
                '  </div>' +
                '</div>';
        });
        elGpuList.innerHTML = html;
    }

    function stopGpuPanel() {
        S.gpuStopped = true;
        if (S.gpuTimer) {
            clearTimeout(S.gpuTimer);
            S.gpuTimer = null;
        }
    }

    // ============================================================
    // Running / VRAM
    // ============================================================

    async function showRunning() {
        setStatus('Загрузка running…', 'load');
        try {
            const res = await fetch(FAR.Ollama._getBaseUrl() + '/api/ollama/running', {
                headers: FAR.Ollama._getHeaders(false),
                credentials: 'include', cache: 'no-store'
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const models = data.models || [];
            if (models.length === 0) {
                setStatus('Нет запущенных моделей (VRAM свободна)', 'ok');
                return;
            }
            const parts = models.map(function (m) {
                const name = m.name || m.model || '?';
                const vram = m.size_str ? ' ' + m.size_str
                    : (m.size_vram ? ' ' + FAR.Ollama._formatSize(m.size_vram) : '');
                const proc = m.processor ? ' [' + m.processor + ']' : '';
                const until = m.until ? ' до ' + m.until : '';
                return name + vram + proc + until;
            });
            setStatus('Запущено: ' + parts.join(' • '), 'ok');
        } catch (e) {
            setStatus('Ошибка running: ' + e.message, 'error');
        }
    }

    async function stopAllModels() {
        if (S.streaming) {
            if (!confirm('Идёт генерация. Прервать и выгрузить все модели из VRAM?')) return;
            stopStreaming();
        }

        let running = [];
        try {
            const res = await fetch(FAR.Ollama._getBaseUrl() + '/api/ollama/running', {
                headers: FAR.Ollama._getHeaders(false),
                credentials: 'include', cache: 'no-store'
            });
            if (res.ok) {
                const data = await res.json();
                running = data.models || [];
            }
        } catch (e) { /* ignore */ }

        if (running.length === 0) {
            FAR.toast('Нет запущенных моделей — VRAM уже свободна', 'info');
            forceGpuRefresh();
            return;
        }

        const names = running.map(function (m) { return m.name || m.model; });
        const msg = 'Выгрузить из VRAM:\n\n' +
            names.map(function (n) { return '• ' + n; }).join('\n') +
            '\n\nПродолжить?';
        if (!confirm(msg)) return;

        setStatus('🗑 Выгрузка моделей из VRAM…', 'load');
        elStopVram.disabled = true;

        try {
            const res = await fetch(FAR.Ollama._getBaseUrl() + '/api/ollama/stop-all', {
                method: 'POST',
                headers: FAR.Ollama._getHeaders(true),
                credentials: 'include',
                body: JSON.stringify({})
            });
            const data = await res.json().catch(function () { return {}; });
            const stopped = Array.isArray(data.stopped) ? data.stopped : [];
            const errors  = Array.isArray(data.errors)  ? data.errors  : [];

            if (stopped.length > 0) {
                setStatus('✅ Выгружено из VRAM: ' + stopped.join(', '), 'ok');
                FAR.toast('Выгружено из VRAM: ' + stopped.length +
                    (errors.length ? ' • ошибок: ' + errors.length : ''),
                    errors.length ? 'warning' : 'success');
            } else {
                setStatus('⚠ Модели не выгружены', 'warn');
                FAR.toast('Не удалось выгрузить модели', 'warning');
            }
            if (errors.length > 0) {
                console.warn('[Ollama stop-all errors]', errors);
            }

            setTimeout(function () {
                forceGpuRefresh();
                showRunning();
            }, 300);

        } catch (e) {
            setStatus('Ошибка выгрузки: ' + e.message, 'error');
            FAR.toast('Ошибка выгрузки: ' + e.message, 'error');
        } finally {
            elStopVram.disabled = false;
        }
    }

    // ============================================================
    // Обработчики
    // ============================================================

    elModel.addEventListener('change', function () {
        S.model = elModel.value;
        saveModelToLS(S.model);
        updateModelTypeBadge();
        updateAttachButtonState();
        if (getModelType(S.model) === 'embed') {
            FAR.toast('🔢 "' + S.model + '" — эмбеддинг. Для чата выберите 📝 или 🖼 модель.', 'warning');
        }
    });

    elRefresh.addEventListener('click', function () { loadModels(false); });
    elNewChat.addEventListener('click', startNewChat);
    elRunning.addEventListener('click', showRunning);
    elStopVram.addEventListener('click', stopAllModels);

    elToggleSide.classList.add('ollama-btn-primary');
    elToggleSide.addEventListener('click', function () {
        if (elSidebar.classList.contains('collapsed')) {
            elSidebar.classList.remove('collapsed');
            elToggleSide.classList.add('ollama-btn-primary');
            if (!S.gpuTimer) startGpuPanel();
        } else {
            elSidebar.classList.add('collapsed');
            elToggleSide.classList.remove('ollama-btn-primary');
            stopGpuPanel();
        }
    });

    elSend.addEventListener('click', sendMessage);
    elStop.addEventListener('click', stopStreaming);

    elInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!S.streaming) sendMessage();
        }
    });

    elInput.addEventListener('input', function () {
        elInput.style.height = 'auto';
        elInput.style.height = Math.min(160, elInput.scrollHeight) + 'px';
    });

    // Прикрепление картинки через кнопку
    elAttach.addEventListener('click', function () {
        if (!S.model) {
            FAR.toast('Сначала выберите модель', 'warning');
            return;
        }
        if (getModelType(S.model) === 'embed') {
            FAR.toast('🔢 "' + S.model + '" — эмбеддинг. Для изображений нужна 🖼 vision-модель.', 'warning');
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.onchange = function () {
            addImageFiles(Array.from(input.files || []));
        };
        input.click();
    });

    // Вставка картинки из буфера (Ctrl+V)
    elInput.addEventListener('paste', async function (e) {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        const files = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file' && items[i].type.indexOf('image/') === 0) {
                const f = items[i].getAsFile();
                if (f) files.push(f);
            }
        }
        if (files.length === 0) return;
        e.preventDefault();
        await addImageFiles(files);
    });

    // ============================================================
    // Инициализация
    // ============================================================

    (async function init() {
        S.messages = loadChatFromLS();
        renderChat();
        initContext();
        await initFiles();

        setupDropTarget();

        renderAttachPreview();
        updateAttachButtonState();

        const available = await pingOllama();
        if (!available) {
            setStatus('Ollama недоступен. Проверьте, что `ollama` есть в PATH.', 'error');
            elModel.innerHTML = '<option value="">— недоступно —</option>';
            elSend.disabled = true;
            elStopVram.disabled = true;
            elAttach.disabled = true;
            return;
        }

        await loadModels(false);

        const savedModel = loadModelFromLS();
        if (savedModel && S.models.some(function (m) { return m.name === savedModel; })) {
            const savedMeta = S.models.find(function (m) { return m.name === savedModel; });
            const savedType = savedMeta
                ? (savedMeta.type || FAR.Ollama._detectTypeLocal(savedMeta.name))
                : 'txt';
            if (savedType !== 'embed') {
                S.model = savedModel;
                elModel.value = savedModel;
            }
        }
        updateModelTypeBadge();
        updateAttachButtonState();

        startGpuPanel();

        setTimeout(function () { try { elInput.focus(); } catch (e) {} }, 100);
    })();

    return {
        getState: function () { return S; },
        destroy: function () {
            S.destroyed = true;
            stopStreaming();
            stopGpuPanel();
            if (S.abortController) {
                try { S.abortController.abort(); } catch (e) {}
            }
            if (S._unregisterDropTarget) {
                try { S._unregisterDropTarget(); } catch (e) {}
                S._unregisterDropTarget = null;
            }
            S.attachedImages = [];
            hostEl.innerHTML = '';
        }
    };
};

// ============================================================
// WM-приложение 'ollama'
// ============================================================

FAR._registerOllamaWmApp = function () {
    if (typeof FAR.WM === 'undefined' || typeof FAR.WM.registerApp !== 'function') return;
    if (FAR.WM.getApp && FAR.WM.getApp('ollama')) return;

    FAR.WM.registerApp({
        id: 'ollama',
        title: 'Ollama Chat',
        icon: '🦙',
        keywords: 'ollama llm ai chat ии нейросеть gpt vision embed',
        singleton: true,
        width: 1200,
        height: 780,
        open: async function (win, props) {
            const titleEl = win.el.querySelector('.wm-title-text');
            if (titleEl) titleEl.textContent = '🦙 Ollama Chat';

            win.bodyEl.innerHTML = '';
            win.bodyEl.style.display = 'flex';
            win.bodyEl.style.flexDirection = 'column';
            win.bodyEl.style.minHeight = '0';
            win.bodyEl.style.background = '#1e1e2e';
            win.bodyEl.style.position = 'relative';

            if (win.props._ollamaApi) {
                try { win.props._ollamaApi.destroy(); } catch (e) {}
                win.props._ollamaApi = null;
            }

            win.props._ollamaApi = FAR._createOllamaUI(win.bodyEl, props || {});
        },
        onClose: function (win) {
            if (win.props && win.props._ollamaApi) {
                try { win.props._ollamaApi.destroy(); } catch (e) {}
                win.props._ollamaApi = null;
            }
        }
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', FAR._registerOllamaWmApp);
} else {
    FAR._registerOllamaWmApp();
}

document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('ollamaModal');
    if (!modal || modal.classList.contains('hidden')) return;
    const t = e.target;
    const tag = (t && t.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    FAR.closeOllama();
}, true);