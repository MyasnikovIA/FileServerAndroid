// ============================================================
// 56-gpu-monitor.js — мониторинг загрузки видеокарт через nvidia-smi
// ============================================================
//
// Данные приходят С СЕРВЕРА (endpoint /api/gpu в FileServer,
// класс GpuHandler) — сервер сам запускает nvidia-smi и парсит
// вывод. Клиент только опрашивает JSON и рендерит.
//
// Работает в двух режимах:
//   • панельный — открывается модалка;
//   • оконный   — регистрируется как WM-приложение 'gpu'.

FAR.GpuMonitor = FAR.GpuMonitor || {};

FAR.GpuMonitor.LS_REFRESH_KEY     = 'filebd_gpu_refresh_ms';
FAR.GpuMonitor.DEFAULT_REFRESH_MS = 1000;
FAR.GpuMonitor.MIN_REFRESH_MS     = 300;
FAR.GpuMonitor.MAX_REFRESH_MS     = 30000;

FAR.GpuMonitor._modalApi = null;

// ============================================================
// Публичное API
// ============================================================

FAR.openGpuMonitor = function (opts) {
    opts = opts || {};

    if (typeof FAR.WM !== 'undefined' && FAR.WM.state && FAR.WM.state.active
        && FAR.WM.getApp && FAR.WM.getApp('gpu')) {
        return FAR.WM.openApp('gpu', { props: opts });
    }

    FAR._openGpuModal(opts);
};

FAR._openGpuModal = function (opts) {
    const modal = document.getElementById('gpuMonitorModal');
    const host  = document.getElementById('gpuMonitorHost');
    const title = document.getElementById('gpuMonitorTitle');

    if (!modal || !host) {
        console.error('[GPU] #gpuMonitorModal или #gpuMonitorHost не найден');
        FAR.toast('Модалка монитора GPU не найдена', 'error');
        return;
    }

    if (FAR.GpuMonitor._modalApi) {
        try { FAR.GpuMonitor._modalApi.destroy(); } catch (e) {}
        FAR.GpuMonitor._modalApi = null;
    }

    if (title) title.textContent = '🎮 Загрузка видеокарт';

    FAR.GpuMonitor._modalApi = FAR._createGpuMonitor(host, opts);
    modal.classList.remove('hidden');
};

FAR.closeGpuMonitor = function () {
    const modal = document.getElementById('gpuMonitorModal');
    if (modal) modal.classList.add('hidden');

    if (FAR.GpuMonitor._modalApi) {
        try { FAR.GpuMonitor._modalApi.destroy(); } catch (e) {}
        FAR.GpuMonitor._modalApi = null;
    }
};

FAR.closeGpuMonitorOutside = function (e) {
    if (e.target === e.currentTarget) FAR.closeGpuMonitor();
};

// ============================================================
// Ядро: FAR._createGpuMonitor(hostEl, opts)
// ============================================================

FAR._createGpuMonitor = function (hostEl, opts) {
    opts = opts || {};
    if (!hostEl) throw new Error('_createGpuMonitor: hostEl required');

    let refreshMs = opts.refreshMs || FAR.GpuMonitor._loadRefreshMs();

    hostEl.innerHTML =
        '<div class="gpu-toolbar">' +
        '  <div class="gpu-status" data-role="status">' +
        '    <span class="dot"></span>' +
        '    <span data-role="statusText">Подключение…</span>' +
        '  </div>' +
        '  <label class="gpu-refresh-label">Обновление:' +
        '    <input type="number" data-role="refresh" min="' + FAR.GpuMonitor.MIN_REFRESH_MS + '"' +
        '           max="' + FAR.GpuMonitor.MAX_REFRESH_MS + '" step="100"' +
        '           value="' + refreshMs + '" class="gpu-refresh-input"> мс' +
        '  </label>' +
        '  <button class="gpu-btn" data-role="refreshNow" title="Обновить сейчас">🔄 Обновить</button>' +
        '</div>' +
        '<div class="gpu-body" data-role="body">' +
        '  <div class="gpu-loading">Загрузка данных nvidia-smi…</div>' +
        '</div>';

    const elStatus     = hostEl.querySelector('[data-role="status"]');
    const elStatusTxt  = hostEl.querySelector('[data-role="statusText"]');
    const elRefresh    = hostEl.querySelector('[data-role="refresh"]');
    const elRefreshNow = hostEl.querySelector('[data-role="refreshNow"]');
    const elBody       = hostEl.querySelector('[data-role="body"]');

    const S = {
        timer: null,
        busy: false,
        destroyed: false,
        lastData: null,
        errorCount: 0
    };

    function setStatus(text, cls) {
        elStatusTxt.textContent = text || '';
        elStatus.className = 'gpu-status' + (cls ? ' ' + cls : '');
    }

    function getBaseUrl() {
        const ctx = FAR.side && FAR.side[FAR.activePanel];
        if (ctx && ctx.db && ctx.db.baseUrl) {
            return String(ctx.db.baseUrl).replace(/\/+$/, '');
        }
        return location.origin;
    }

    function buildHeaders() {
        const headers = {};
        const ctx = FAR.side && FAR.side[FAR.activePanel];
        const token = (ctx && ctx.db && ctx.db.token) || FAR.authToken;
        if (token) headers['Authorization'] = 'Bearer ' + token;
        return headers;
    }

    async function fetchData() {
        if (S.busy || S.destroyed) return;
        S.busy = true;

        try {
            const res = await fetch(getBaseUrl() + '/api/gpu', {
                headers: buildHeaders(),
                credentials: 'include',
                cache: 'no-store'
            });

            if (res.status === 404) {
                throw new Error('Endpoint /api/gpu не зарегистрирован. Перезапустите FileServer.');
            }
            if (!res.ok) {
                throw new Error('HTTP ' + res.status);
            }

            const data = await res.json();
            S.lastData = data;
            S.errorCount = 0;
            render(data);

            if (data.available) {
                setStatus('Обновлено ' + new Date().toLocaleTimeString('ru-RU', { hour12: false }), 'online');
            } else {
                setStatus('GPU недоступны: ' + (data.error || '—'), 'error');
            }
        } catch (e) {
            S.errorCount++;
            setStatus('Ошибка: ' + e.message, 'error');
            if (!S.lastData) {
                elBody.innerHTML = '<div class="gpu-error">Не удалось получить данные: ' +
                    FAR.escapeHtml(e.message) + '</div>';
            }
        } finally {
            S.busy = false;
        }
    }

    // ============================================================
    // Рендер
    // ============================================================

    function fmtNum(v, unit, digits) {
        if (v === null || v === undefined) return '—';
        if (typeof v !== 'number' || isNaN(v)) return '—';
        const d = digits === undefined ? 0 : digits;
        return v.toFixed(d) + (unit ? ' ' + unit : '');
    }

    function render(data) {
        if (!data) return;

        if (!data.available) {
            elBody.innerHTML = '<div class="gpu-error">' +
                FAR.escapeHtml(data.error || 'GPU недоступны на сервере') +
                '</div>';
            return;
        }

        const gpus = data.gpus || [];
        const procs = data.processes || [];

        if (gpus.length === 0) {
            elBody.innerHTML = '<div class="gpu-empty">Не найдено ни одной видеокарты.</div>';
            return;
        }

        // Первый рендер — полностью. Дальше — точечное обновление,
        // чтобы не сбрасывать scroll и не мигать.
        if (!elBody.querySelector('.gpu-card')) {
            let html = '';
            gpus.forEach(function (g) { html += renderGpuCard(g, procs); });
            elBody.innerHTML = html;
            return;
        }

        gpus.forEach(function (g) {
            const card = elBody.querySelector('.gpu-card[data-gpu-idx="' + g.index + '"]');
            if (card) {
                updateGpuCard(card, g, procs);
            } else {
                elBody.insertAdjacentHTML('beforeend', renderGpuCard(g, procs));
            }
        });

        elBody.querySelectorAll('.gpu-card').forEach(function (card) {
            const idx = parseInt(card.dataset.gpuIdx, 10);
            if (!gpus.some(function (g) { return g.index === idx; })) {
                card.remove();
            }
        });
    }

    function renderGpuCard(g, procs) {
        const utilPct  = Math.max(0, Math.min(100, g.utilizationGpu || 0));
        const memPct   = Math.max(0, Math.min(100, g.memoryPercent || 0));
        const powerPct = Math.max(0, Math.min(100, g.powerPercent || 0));
        const tempClass = (g.temperature >= 80) ? 'hot'
            : (g.temperature >= 65) ? 'warm' : '';

        const gpuProcs = (procs || []).filter(function (p) {
            return p.gpuIndex === g.index;
        });

        return '' +
            '<div class="gpu-card" data-gpu-idx="' + g.index + '">' +
            '  <div class="gpu-card-header">' +
            '    <span class="gpu-index">#' + g.index + '</span>' +
            '    <span class="gpu-name">' + FAR.escapeHtml(g.name || 'GPU') + '</span>' +
            '    <span class="gpu-pstate" title="P-State">' + FAR.escapeHtml(g.pstate || '—') + '</span>' +
            '  </div>' +
            '  <div class="gpu-metrics">' +
            '    <div class="gpu-metric">' +
            '      <div class="gpu-metric-label">GPU загрузка</div>' +
            '      <div class="gpu-metric-value" data-role="util-val">' + fmtNum(g.utilizationGpu, '%') + '</div>' +
            '      <div class="gpu-bar"><div class="gpu-bar-fill util" data-role="util-bar" style="width:' + utilPct + '%"></div></div>' +
            '    </div>' +
            '    <div class="gpu-metric">' +
            '      <div class="gpu-metric-label">Память</div>' +
            '      <div class="gpu-metric-value" data-role="mem-val">' +
            fmtNum(g.memoryUsed, 'MiB') + ' / ' + fmtNum(g.memoryTotal, 'MiB') +
            ' (' + fmtNum(g.memoryPercent, '%') + ')' +
            '      </div>' +
            '      <div class="gpu-bar"><div class="gpu-bar-fill mem" data-role="mem-bar" style="width:' + memPct + '%"></div></div>' +
            '    </div>' +
            '    <div class="gpu-metric">' +
            '      <div class="gpu-metric-label">Питание</div>' +
            '      <div class="gpu-metric-value" data-role="pwr-val">' +
            fmtNum(g.powerDraw, 'W') + ' / ' + fmtNum(g.powerLimit, 'W') +
            '      </div>' +
            '      <div class="gpu-bar"><div class="gpu-bar-fill pwr" data-role="pwr-bar" style="width:' + powerPct + '%"></div></div>' +
            '    </div>' +
            '    <div class="gpu-metric">' +
            '      <div class="gpu-metric-label">Температура</div>' +
            '      <div class="gpu-metric-value ' + tempClass + '" data-role="temp-val">' + fmtNum(g.temperature, '°C') + '</div>' +
            '      <div class="gpu-metric-sub" data-role="fan-val">Кулер: ' + fmtNum(g.fanSpeed, '%') + '</div>' +
            '    </div>' +
            '  </div>' +
            '  <div class="gpu-card-footer">' +
            '    <span>Persist: <b>' + FAR.escapeHtml(g.persistenceMode || '—') + '</b></span>' +
            '    <span>Display: <b>' + FAR.escapeHtml(g.displayActive || '—') + '</b></span>' +
            '  </div>' +
            renderProcsBlock(gpuProcs) +
            '</div>';
    }

    function updateGpuCard(card, g, procs) {
        const utilPct  = Math.max(0, Math.min(100, g.utilizationGpu || 0));
        const memPct   = Math.max(0, Math.min(100, g.memoryPercent || 0));
        const powerPct = Math.max(0, Math.min(100, g.powerPercent || 0));

        const setText = function (sel, txt) {
            const el = card.querySelector(sel);
            if (el) el.textContent = txt;
        };
        const setWidth = function (sel, pct) {
            const el = card.querySelector(sel);
            if (el) el.style.width = pct + '%';
        };

        setText('[data-role="util-val"]', fmtNum(g.utilizationGpu, '%'));
        setWidth('[data-role="util-bar"]', utilPct);

        setText('[data-role="mem-val"]',
            fmtNum(g.memoryUsed, 'MiB') + ' / ' + fmtNum(g.memoryTotal, 'MiB') +
            ' (' + fmtNum(g.memoryPercent, '%') + ')');
        setWidth('[data-role="mem-bar"]', memPct);

        setText('[data-role="pwr-val"]',
            fmtNum(g.powerDraw, 'W') + ' / ' + fmtNum(g.powerLimit, 'W'));
        setWidth('[data-role="pwr-bar"]', powerPct);

        const tempEl = card.querySelector('[data-role="temp-val"]');
        if (tempEl) {
            tempEl.textContent = fmtNum(g.temperature, '°C');
            tempEl.className = 'gpu-metric-value ' +
                (g.temperature >= 80 ? 'hot' : (g.temperature >= 65 ? 'warm' : ''));
        }
        setText('[data-role="fan-val"]', 'Кулер: ' + fmtNum(g.fanSpeed, '%'));

        const gpuProcs = (procs || []).filter(function (p) {
            return p.gpuIndex === g.index;
        });
        const oldProcs = card.querySelector('.gpu-procs');
        if (oldProcs) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = renderProcsBlock(gpuProcs);
            oldProcs.replaceWith(tempDiv.firstChild);
        }
    }

    function renderProcsBlock(gpuProcs) {
        if (!gpuProcs || gpuProcs.length === 0) {
            return '<div class="gpu-procs empty">Нет активных процессов</div>';
        }
        let html = '<div class="gpu-procs">' +
            '<div class="gpu-procs-title">Процессы (' + gpuProcs.length + ')</div>' +
            '<table class="gpu-procs-table">' +
            '<thead><tr><th>PID</th><th>Имя</th><th>Память</th><th>Тип</th></tr></thead><tbody>';
        gpuProcs.forEach(function (p) {
            html += '<tr>' +
                '<td>' + p.pid + '</td>' +
                '<td title="' + FAR.escapeHtml(p.name) + '">' + FAR.escapeHtml(p.name) + '</td>' +
                '<td>' + fmtNum(p.usedMemory, 'MiB') + '</td>' +
                '<td>' + FAR.escapeHtml(p.type || '—') + '</td>' +
                '</tr>';
        });
        html += '</tbody></table></div>';
        return html;
    }

    // ============================================================
    // Таймер
    // ============================================================

    function startTimer() {
        stopTimer();
        if (refreshMs <= 0) return;
        S.timer = setInterval(fetchData, refreshMs);
    }

    function stopTimer() {
        if (S.timer) {
            clearInterval(S.timer);
            S.timer = null;
        }
    }

    elRefresh.addEventListener('change', function () {
        let v = parseInt(elRefresh.value, 10);
        if (!v || v < FAR.GpuMonitor.MIN_REFRESH_MS) v = FAR.GpuMonitor.MIN_REFRESH_MS;
        if (v > FAR.GpuMonitor.MAX_REFRESH_MS) v = FAR.GpuMonitor.MAX_REFRESH_MS;
        elRefresh.value = v;
        refreshMs = v;
        FAR.GpuMonitor._saveRefreshMs(v);
        startTimer();
    });

    elRefreshNow.addEventListener('click', function () {
        fetchData();
    });

    fetchData();
    startTimer();

    return {
        getState: function () { return S; },
        destroy: function () {
            S.destroyed = true;
            stopTimer();
            hostEl.innerHTML = '';
        }
    };
};

// ============================================================
// localStorage
// ============================================================

FAR.GpuMonitor._loadRefreshMs = function () {
    try {
        const v = parseInt(localStorage.getItem(FAR.GpuMonitor.LS_REFRESH_KEY), 10);
        if (v >= FAR.GpuMonitor.MIN_REFRESH_MS && v <= FAR.GpuMonitor.MAX_REFRESH_MS) {
            return v;
        }
    } catch (e) { /* ignore */ }
    return FAR.GpuMonitor.DEFAULT_REFRESH_MS;
};

FAR.GpuMonitor._saveRefreshMs = function (v) {
    try {
        localStorage.setItem(FAR.GpuMonitor.LS_REFRESH_KEY, String(v));
    } catch (e) { /* ignore */ }
};

// ============================================================
// WM-приложение
// ============================================================

FAR._registerGpuMonitorWmApp = function () {
    if (typeof FAR.WM === 'undefined' || typeof FAR.WM.registerApp !== 'function') return;
    if (FAR.WM.getApp && FAR.WM.getApp('gpu')) return;

    FAR.WM.registerApp({
        id: 'gpu',
        title: 'Загрузка GPU',
        icon: '🎮',
        keywords: 'gpu видеокарта nvidia загрузка монитор',
        singleton: true,
        width: 980,
        height: 720,
        open: async function (win, props) {
            const titleEl = win.el.querySelector('.wm-title-text');
            if (titleEl) titleEl.textContent = '🎮 Загрузка видеокарт';

            win.bodyEl.innerHTML = '';
            win.bodyEl.style.display = 'flex';
            win.bodyEl.style.flexDirection = 'column';
            win.bodyEl.style.minHeight = '0';

            if (win.props._gpuApi) {
                try { win.props._gpuApi.destroy(); } catch (e) {}
                win.props._gpuApi = null;
            }

            win.props._gpuApi = FAR._createGpuMonitor(win.bodyEl, props || {});
        },
        onClose: function (win) {
            if (win.props && win.props._gpuApi) {
                try { win.props._gpuApi.destroy(); } catch (e) {}
                win.props._gpuApi = null;
            }
        }
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', FAR._registerGpuMonitorWmApp);
} else {
    FAR._registerGpuMonitorWmApp();
}