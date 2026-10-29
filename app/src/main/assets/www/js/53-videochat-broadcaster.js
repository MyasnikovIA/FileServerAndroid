// ============================================================
// 53-videochat-broadcaster.js — запуск трансляции через плагин
// «Video Chat Broadcaster (WebRTC) 3.0.0».
// ============================================================
// Добавлена поддержка трансляции экрана (Screen Sharing).

FAR.Broadcaster = FAR.Broadcaster || {};

FAR.Broadcaster.state = {
    detected: false,        // плагин обнаружен
    detecting: false,       // идёт ping
    started: false,         // start-broadcast успешно отправлен
    room: 'main',           // комната, в которой вещаем
    source: 'camera',       // 'camera' | 'screen'
    _msgId: 0,
    _pending: new Map(),    // __id → { resolve, reject, timer }
    _listenerInstalled: false,
    _nativePopup: null
};

// Колбэк для UI — переопределяется в _createBroadcasterUI
FAR.Broadcaster.onStateChange = null;

// ============================================================
// Связь с плагином
// ============================================================

FAR.Broadcaster._ensureListener = function () {
    if (FAR.Broadcaster.state._listenerInstalled) return;
    FAR.Broadcaster.state._listenerInstalled = true;

    window.addEventListener('message', function (e) {
        if (e.source !== window) return;
        const d = e.data;
        if (!d || typeof d !== 'object') return;

        // Приветствие от bridge.js при загрузке content-script
        if (d.__extReady) {
            FAR.Broadcaster.state.detected = true;
            console.log('[Broadcaster] plugin ready (extReady)');
            if (typeof FAR.Broadcaster.onStateChange === 'function') {
                try { FAR.Broadcaster.onStateChange(); } catch (err) {}
            }
            return;
        }

        // Ответ на наш запрос
        if (d.__replyTo !== undefined) {
            const pending = FAR.Broadcaster.state._pending.get(d.__replyTo);
            if (pending) {
                clearTimeout(pending.timer);
                FAR.Broadcaster.state._pending.delete(d.__replyTo);
                pending.resolve(d);
            }
        }
    });
};

FAR.Broadcaster._send = function (type, payload, timeoutMs) {
    FAR.Broadcaster._ensureListener();

    return new Promise(function (resolve, reject) {
        const id = 'bc-' + (++FAR.Broadcaster.state._msgId) + '-' + Date.now();
        const timer = setTimeout(function () {
            FAR.Broadcaster.state._pending.delete(id);
            reject(new Error('Плагин не ответил (таймаут)'));
        }, timeoutMs || 2000);

        FAR.Broadcaster.state._pending.set(id, { resolve: resolve, reject: reject, timer: timer });

        try {
            window.postMessage({
                __toExt: true,
                type: type,
                payload: payload || {},
                __id: id
            }, '*');
        } catch (e) {
            clearTimeout(timer);
            FAR.Broadcaster.state._pending.delete(id);
            reject(e);
        }
    });
};

FAR.Broadcaster.detect = async function (timeoutMs) {
    if (FAR.Broadcaster.state.detecting) {
        await new Promise(function (r) { setTimeout(r, 400); });
        return FAR.Broadcaster.state.detected;
    }

    FAR.Broadcaster.state.detecting = true;
    try {
        const resp = await FAR.Broadcaster._send('ext-ping', {}, timeoutMs || 1500);
        if (resp && resp.ok) {
            FAR.Broadcaster.state.detected = true;
            return true;
        }
        return false;
    } catch (e) {
        FAR.Broadcaster.state.detected = false;
        return false;
    } finally {
        FAR.Broadcaster.state.detecting = false;
    }
};

FAR.Broadcaster.start = async function (room, source) {
    room = String(room || 'main').trim() || 'main';
    source = source || 'camera'; // 'camera' или 'screen'

    // Проверяем, является ли контекст безопасным (HTTPS или localhost)
    const isSecure = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost';

    if (isSecure) {
        try {
            FAR.Broadcaster.startNative(room, source);
            FAR.Broadcaster.state.started = true;
            FAR.Broadcaster.state.room = room;
            FAR.Broadcaster.state.source = source;
            try { localStorage.setItem('filebd_vc_broadcast_room', room); } catch (e) {}
            return { ok: true, native: true };
        } catch (e) {
            throw new Error('Не удалось запустить нативную трансляцию: ' + e.message);
        }
    }

    // Если контекст небезопасный (HTTP), используем плагин
    if (!FAR.Broadcaster.state.detected) {
        const ok = await FAR.Broadcaster.detect();
        if (!ok) {
            throw new Error(
                'Плагин «Video Chat Broadcaster (WebRTC)» не обнаружен. ' +
                'Установите расширение в Chrome/Edge и перезагрузите страницу. ' +
                'Либо используйте HTTPS для нативной трансляции.'
            );
        }
    }

    const resp = await FAR.Broadcaster._send('start-broadcast', {
        room: room,
        source: source
    }, 5000);

    if (!resp || !resp.ok) {
        throw new Error(
            (resp && resp.error) ||
            'Не удалось запустить трансляцию.'
        );
    }

    FAR.Broadcaster.state.started = true;
    FAR.Broadcaster.state.room = room;
    FAR.Broadcaster.state.source = source;

    try { localStorage.setItem('filebd_vc_broadcast_room', room); } catch (e) {}

    return resp;
};

FAR.Broadcaster.startNative = function (room, source) {
    room = String(room || 'main').trim() || 'main';
    source = source || 'camera';

    const wsPort = FAR.videoChatPort || 8081;
    const host = location.hostname;
    // Определяем протокол: wss для HTTPS, ws для HTTP
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsProto + '//' + host + ':' + wsPort + '/ws/publish?room=' + encodeURIComponent(room);

    const popup = window.open('', 'broadcaster_native', 'width=640,height=480,menubar=no,toolbar=no,location=no,status=no');
    if (!popup) {
        throw new Error('Браузер заблокировал всплывающее окно. Разрешите popup для этого сайта.');
    }

    FAR.Broadcaster._nativePopup = popup;

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Broadcasting (Native)</title>
            <style>
                html, body { height: 100%; margin: 0; box-sizing: border-box; }
                body { font-family: system-ui, sans-serif; background: #111; color: #eee; display: flex; flex-direction: column; padding: 8px; }
                video { flex: 1; min-height: 0; width: 100%; background: #000; border-radius: 6px; display: block; object-fit: contain; }
                #status { flex-shrink: 0; margin-top: 6px; font-size: 12px; color: #bbb; word-break: break-all; min-height: 16px; }
                #viewers { flex-shrink: 0; margin-top: 4px; font-size: 11px; color: #89b4fa; }
                button { flex-shrink: 0; margin-top: 8px; width: 100%; padding: 7px; cursor: pointer; border: none; border-radius: 4px; background: #c42b1c; color: white; font-weight: bold; }
                button:hover { background: #e03e2d; }
            </style>
        </head>
        <body>
        <video id="preview" autoplay muted playsinline></video>
        <div id="status">starting…</div>
        <div id="viewers"></div>
        <button id="stop">Stop broadcasting</button>
        <script>
        (function() {
            const wsUrl = ${JSON.stringify(wsUrl)};
            const source = ${JSON.stringify(source)};

            const statusEl = document.getElementById('status');
            const viewersEl = document.getElementById('viewers');
            const preview = document.getElementById('preview');
            const stopBtn = document.getElementById('stop');

            const setStatus = (s) => { console.log('[capture]', s); statusEl.textContent = s; };
            const setViewers = (n) => { viewersEl.textContent = n ? 'Зрителей: ' + n : ''; };

            const peers = new Map();
            let ws = null;
            let stream = null;

            document.addEventListener('DOMContentLoaded', async () => {
                try {
                    if (source === 'screen') {
                        setStatus('Запрос доступа к экрану...');
                        stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: true });
                    } else {
                        setStatus('Запрос доступа к камере...');
                        stream = await navigator.mediaDevices.getUserMedia({
                            video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
                            audio: { echoCancellation: true, noiseSuppression: true }
                        });
                    }

                    preview.srcObject = stream;

                    const videoTrack = stream.getVideoTracks()[0];
                    if (videoTrack) {
                        videoTrack.onended = () => {
                            setStatus('Трансляция остановлена пользователем');
                            stop();
                        };
                    }

                    setStatus('Подключение к ' + wsUrl + '...');
                    ws = new WebSocket(wsUrl);

                    ws.onopen = () => { setStatus('Подключено. Ожидание зрителей...'); };

                    ws.onmessage = (event) => {
                        if (typeof event.data !== 'string') return;
                        let msg;
                        try { msg = JSON.parse(event.data); } catch (e) { return; }

                        if (msg.viewerJoined) { handleViewerJoined(msg.viewerJoined); return; }
                        if (msg.viewerLeft) { closePeer(msg.viewerLeft); return; }

                        if (msg.viewerId && msg.sdp && msg.sdp.type === 'answer') {
                            const pc = peers.get(msg.viewerId);
                            if (pc) pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)).catch(err => console.warn('[capture] answer error:', err));
                            return;
                        }

                        if (msg.viewerId && msg.candidate) {
                            const pc = peers.get(msg.viewerId);
                            if (pc) pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(err => console.warn('[capture] candidate error:', err));
                            return;
                        }
                    };

                    ws.onclose = () => { setStatus('Соединение закрыто'); cleanup(); };
                    ws.onerror = (err) => { setStatus('Ошибка WebSocket. Проверьте IP и порт.'); console.error(err); };

                } catch (err) {
                    setStatus('Ошибка захвата: ' + err.message);
                    console.error('[capture]', err);
                }
            });

            async function handleViewerJoined(viewerId) {
                closePeer(viewerId);
                const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
                stream.getTracks().forEach(track => pc.addTrack(track, stream));

                pc.onicecandidate = (event) => {
                    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ target: viewerId, candidate: event.candidate.toJSON() }));
                    }
                };

                pc.onconnectionstatechange = () => {
                    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(viewerId);
                };

                peers.set(viewerId, pc);
                setViewers(peers.size);
                setStatus('Зритель подключился: ' + viewerId.substring(0, 8) + '…');

                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    ws.send(JSON.stringify({ target: viewerId, sdp: pc.localDescription.toJSON() }));
                } catch (e) {
                    console.error('[capture] offer error:', e);
                    closePeer(viewerId);
                }
            }

            function closePeer(viewerId) {
                const pc = peers.get(viewerId);
                if (pc) {
                    try { pc.close(); } catch (e) {}
                    peers.delete(viewerId);
                    setViewers(peers.size);
                }
            }

            function cleanup() {
                for (const viewerId of Array.from(peers.keys())) closePeer(viewerId);
                if (ws && ws.readyState === WebSocket.OPEN) { try { ws.close(); } catch (e) {} }
                ws = null;
                if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
            }

            function stop() {
                cleanup();
                setTimeout(() => window.close(), 200);
            }

            stopBtn.onclick = stop;
            window.addEventListener('beforeunload', cleanup);
            window.addEventListener('message', (e) => {
                if (e.data && e.data.type === 'stop-broadcast') stop();
            });
        })();
        <\/script>
        </body>
        </html>
    `;

    popup.document.open();
    popup.document.write(html);
    popup.document.close();
};

FAR.Broadcaster.stop = async function () {
    // Если открыт нативный popup - закрываем
    if (FAR.Broadcaster._nativePopup && !FAR.Broadcaster._nativePopup.closed) {
        try { FAR.Broadcaster._nativePopup.postMessage({ type: 'stop-broadcast' }, '*'); } catch (e) {}
        setTimeout(() => { try { FAR.Broadcaster._nativePopup.close(); } catch (e) {} }, 300);
        FAR.Broadcaster._nativePopup = null;
    }
    FAR.Broadcaster.state.started = false;

    // Если плагин - отправляем stop
    if (FAR.Broadcaster.state.detected) {
        try {
            const resp = await FAR.Broadcaster._send('stop-broadcast', {}, 3000);
            return resp;
        } catch (e) {
            throw e;
        }
    }
    return { ok: true };
};

FAR.Broadcaster.getDefaultRoom = function () {
    try {
        return localStorage.getItem('filebd_vc_broadcast_room') || 'main';
    } catch (e) { return 'main'; }
};

// ============================================================
// Публичное API: открыть лаунчер
// ============================================================

FAR.openBroadcaster = function (opts) {
    opts = opts || {};

    if (!FAR.videoChatEnabled) {
        FAR.toast('Трансляции отключены на сервере (videochat.enabled = false)', 'warning');
        return;
    }

    if (typeof FAR.WM !== 'undefined' && FAR.WM.state && FAR.WM.state.active
        && FAR.WM.getApp && FAR.WM.getApp('broadcaster')) {
        return FAR.WM.openApp('broadcaster', { props: opts });
    }

    FAR._openBroadcasterModal(opts);
};

FAR._bcModalApi = null;

FAR._openBroadcasterModal = function (opts) {
    const modal = document.getElementById('videoChatBroadcasterModal');
    const host  = document.getElementById('videoChatBroadcasterHost');
    const title = document.getElementById('videoChatBroadcasterTitle');

    if (!modal || !host) return;

    if (FAR._bcModalApi) {
        try { FAR._bcModalApi.destroy(); } catch (e) {}
        FAR._bcModalApi = null;
    }

    if (title) title.textContent = '🎥 Начать трансляцию';

    FAR._bcModalApi = FAR._createBroadcasterUI(host, opts);
    modal.classList.remove('hidden');
};

FAR.closeBroadcaster = function () {
    const modal = document.getElementById('videoChatBroadcasterModal');
    if (modal) modal.classList.add('hidden');

    if (FAR._bcModalApi) {
        try { FAR._bcModalApi.destroy(); } catch (e) {}
        FAR._bcModalApi = null;
    }
};

FAR.closeBroadcasterOutside = function (e) {
    if (e.target === e.currentTarget) FAR.closeBroadcaster();
};

// ============================================================
// Shared-core: UI лаунчера
// ============================================================

FAR._createBroadcasterUI = function (hostEl, opts) {
    opts = opts || {};
    if (!hostEl) throw new Error('_createBroadcasterUI: hostEl required');

    const wsPort = FAR.videoChatPort || 8081;
    const isSecure = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost';

    hostEl.innerHTML =
        '<div class="vc-bc-block">' +
        '<div class="vc-bc-status-row" data-role="status-row">' +
        '<span class="vc-bc-status-icon" data-role="status-icon">⏳</span>' +
        '<div class="vc-bc-status-text" data-role="status-text">Проверка статуса…</div>' +
        '</div>' +
        '<div class="vc-bc-field">' +
        '<label for="vcBcSource">Источник видео</label>' +
        '<select id="vcBcSource" class="vc-bc-input">' +
        '<option value="camera">📷 Веб-камера</option>' +
        '<option value="screen">🖥️ Экран монитора</option>' +
        '</select>' +
        '</div>' +
        '<div class="vc-bc-field">' +
        '<label for="vcBcRoom">Комната (Room)</label>' +
        '<input type="text" id="vcBcRoom" class="vc-bc-input" autocomplete="off" spellcheck="false">' +
        '</div>' +
        '<div class="vc-bc-actions">' +
        '<button class="vc-bc-btn vc-bc-start" data-role="start">▶ Начать трансляцию</button>' +
        '<button class="vc-bc-btn vc-bc-stop"  data-role="stop" disabled>■ Остановить</button>' +
        '<button class="vc-bc-btn vc-bc-watch" data-role="watch" disabled>📺 Смотреть</button>' +
        '</div>' +
        '<div class="vc-bc-hint">' +
        '💡 Трансляция идёт через P2P WebRTC: медиа передаётся напрямую ' +
        'зрителям, сервер используется только для сигналинга. ' +
        'Порт <code>' + FAR.escapeHtml(String(wsPort)) + '</code> должен быть открыт.' +
        '</div>' +
        '</div>';

    const statusRow  = hostEl.querySelector('[data-role="status-row"]');
    const statusIcon = hostEl.querySelector('[data-role="status-icon"]');
    const statusText = hostEl.querySelector('[data-role="status-text"]');
    const sourceSelect = hostEl.querySelector('#vcBcSource');
    const roomInput  = hostEl.querySelector('#vcBcRoom');
    const startBtn   = hostEl.querySelector('[data-role="start"]');
    const stopBtn    = hostEl.querySelector('[data-role="stop"]');
    const watchBtn   = hostEl.querySelector('[data-role="watch"]');

    roomInput.value = opts.room || FAR.Broadcaster.getDefaultRoom();
    if (opts.source) sourceSelect.value = opts.source;

    function setStatus(icon, textHtml, cls) {
        statusIcon.textContent = icon;
        statusText.innerHTML = textHtml;
        statusRow.className = 'vc-bc-status-row' + (cls ? ' ' + cls : '');
    }

    function updateButtons() {
        const detected = FAR.Broadcaster.state.detected;
        const started = FAR.Broadcaster.state.started;
        startBtn.disabled = (!detected && !isSecure) || started;
        stopBtn.disabled  = !started;
        watchBtn.disabled = !started;
        roomInput.disabled = started;
        sourceSelect.disabled = started;
    }

    async function downloadExtensionZip(browserPath, browserName) {
        if (typeof JSZip === 'undefined') {
            FAR.toast('Библиотека JSZip не загружена', 'error');
            return;
        }

        const files = [
            'manifest.json', 'background.js', 'bridge.js', 'capture.html', 'capture.js', 'popup.html', 'popup.js'
        ];

        const zip = new JSZip();
        const folder = zip.folder("VideoChat_Broadcaster_" + browserName);

        setStatus('⏳', 'Подготовка архива для ' + browserName + '...', '');

        try {
            for (const file of files) {
                const url = browserPath + '/' + file;
                const res = await fetch(url);
                if (!res.ok) throw new Error('Не найден файл: ' + file);
                const content = await res.blob();
                folder.file(file, content);
            }

            const blob = await zip.generateAsync({ type: 'blob' });
            FAR.saveBlobAs(blob, "VideoChat_Broadcaster_" + browserName + ".zip");
            FAR.toast('Архив с плагином успешно скачан', 'success');
            render();
        } catch (e) {
            console.error('[Broadcaster] ZIP error:', e);
            setStatus('❌', 'Ошибка создания архива: ' + FAR.escapeHtml(e.message) + '<br><small>Попробуйте скачать вручную из папки ' + browserPath + '</small>', 'err');
            FAR.toast('Ошибка создания архива: ' + e.message, 'error');
        }
    }

    function render() {
        const detected = FAR.Broadcaster.state.detected;
        const started = FAR.Broadcaster.state.started;
        const room = FAR.Broadcaster.state.room || roomInput.value || 'main';
        const src = FAR.Broadcaster.state.source === 'screen' ? 'Экран' : 'Камера';

        if (started) {
            setStatus(
                '🔴',
                'Трансляция (' + src + ') запущена в комнате <b>' + FAR.escapeHtml(room) + '</b>.' +
                '<br><small>Окно с захватом открылось отдельно. Разрешите доступ.</small>',
                'ok'
            );
        } else if (isSecure) {
            setStatus('✅', 'Режим HTTPS: трансляция доступна без плагина.', 'ok');
        } else if (detected) {
            setStatus('✅', 'Плагин <b>Video Chat Broadcaster</b> обнаружен.', 'ok');
        } else {
            const ua = navigator.userAgent;
            let browserName = "Browser";
            let downloadPath = "extension/WebRTC";

            if (ua.indexOf("Edg") > -1) {
                browserName = "Edge";
                downloadPath = "extension/WebRTC/microsoft_edge";
            } else if (ua.indexOf("Firefox") > -1) {
                browserName = "Firefox";
                downloadPath = "extension/WebRTC/firefox";
            } else if (ua.indexOf("Chrome") > -1) {
                browserName = "Chrome";
                downloadPath = "extension/WebRTC/chrome";
            }

            const downloadBtnHtml =
                '<br><br>' +
                '<button id="btn-dl-plugin" ' +
                'style="padding:6px 14px;background:#89b4fa;color:#1e1e2e;' +
                'border:none;border-radius:4px;font-weight:bold;font-size:13px;' +
                'cursor:pointer;box-shadow:0 2px 5px rgba(0,0,0,0.2);">' +
                '📥 Скачать плагин (.zip) для ' + browserName +
                '</button>';

            setStatus(
                '❌',
                'Плагин <b>Video Chat Broadcaster</b> не обнаружен.' +
                '<br><small>Установите расширение или перейдите на HTTPS.</small>' +
                downloadBtnHtml,
                'err'
            );

            const dlBtn = statusText.querySelector('#btn-dl-plugin');
            if (dlBtn) {
                dlBtn.onclick = function() {
                    downloadExtensionZip(downloadPath, browserName);
                };
            }
        }
        updateButtons();
    }

    async function detectWithRetries() {
        if (isSecure) { render(); return; }
        if (FAR.Broadcaster.state.detected) { render(); return; }
        for (let i = 0; i < 4; i++) {
            const ok = await FAR.Broadcaster.detect(1000);
            if (ok) break;
            await new Promise(function (r) { setTimeout(r, 400); });
        }
        render();
    }

    startBtn.addEventListener('click', async function () {
        const room = (roomInput.value || '').trim() || 'main';
        const source = sourceSelect.value;
        startBtn.disabled = true;
        startBtn.textContent = '⏳ Запуск…';

        try {
            await FAR.Broadcaster.start(room, source);
            FAR.toast('Трансляция запущена', 'success');
            render();
        } catch (e) {
            FAR.toast(e.message, 'error');
            setStatus('❌', FAR.escapeHtml(e.message), 'err');
            startBtn.disabled = false;
            startBtn.textContent = '▶ Начать трансляцию';
        }
    });

    stopBtn.addEventListener('click', async function () {
        stopBtn.disabled = true;
        try {
            await FAR.Broadcaster.stop();
            FAR.toast('Трансляция остановлена', 'info');
            render();
        } catch (e) {
            FAR.toast('Не удалось остановить: ' + e.message, 'warning');
            stopBtn.disabled = false;
        }
    });

    watchBtn.addEventListener('click', function () {
        const room = FAR.Broadcaster.state.room || roomInput.value || 'main';
        FAR.openVideoChat({ room: room, autoConnect: true });
    });

    roomInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!startBtn.disabled) startBtn.click();
        }
    });

    FAR.Broadcaster.onStateChange = function () { render(); };

    render();
    detectWithRetries();

    return {
        destroy: function () {
            FAR.Broadcaster.onStateChange = null;
            hostEl.innerHTML = '';
        }
    };
};

// ============================================================
// WM-приложение 'broadcaster'
// ============================================================

FAR._registerBroadcasterWmApp = function () {
    if (typeof FAR.WM === 'undefined' || typeof FAR.WM.registerApp !== 'function') return;
    if (FAR.WM.getApp && FAR.WM.getApp('broadcaster')) return;

    FAR.WM.registerApp({
        id: 'broadcaster',
        title: 'Начать трансляцию',
        icon: '🎥',
        keywords: 'трансляция вещание broadcast camera screen экран',
        singleton: true,
        width: 560,
        height: 520,
        open: async function (win, props) {
            win.el.querySelector('.wm-title-text').textContent = '🎥 Начать трансляцию';
            win.bodyEl.innerHTML = '';
            win.bodyEl.style.cssText = 'display:flex;flex-direction:column;min-height:0;padding:16px;overflow:auto;background:#1e1e2e;';

            if (win.props._bcApi) {
                try { win.props._bcApi.destroy(); } catch (e) {}
            }
            win.props._bcApi = FAR._createBroadcasterUI(win.bodyEl, props || {});
        },
        onClose: function (win) {
            if (win.props && win.props._bcApi) {
                try { win.props._bcApi.destroy(); } catch (e) {}
                win.props._bcApi = null;
            }
        }
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', FAR._registerBroadcasterWmApp);
} else {
    FAR._registerBroadcasterWmApp();
}

FAR.Broadcaster._ensureListener();

setTimeout(function () {
    FAR.Broadcaster.detect(1000).catch(function () {});
}, 500);

document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('videoChatBroadcasterModal');
    if (!modal || modal.classList.contains('hidden')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
    FAR.closeBroadcaster();
}, true);