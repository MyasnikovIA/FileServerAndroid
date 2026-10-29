// ============================================================
// 52-videochat-viewer.js — просмотр WebRTC-трансляции.
// ============================================================
// Сервер: VideoChatServer (порт = videochat.port в config.json).
// Сигналинг: ws://<host>:<port>/ws/subscribe?room=<room>.
//
// Использует shared-core FAR._createVideoChatViewer(hostEl, opts),
// который возвращает {connect, disconnect, getState, destroy}.
// В панельном режиме обёртка открывает модалку, в оконном —
// регистрируется как WM-приложение 'videochat'.

FAR._vcModalApi = null;

// ============================================================
// Публичное API
// ============================================================

/**
 * Открыть просмотрщик трансляции.
 * @param {Object} [opts]
 *   @param {string} [opts.room]        — комната (по умолчанию 'main')
 *   @param {number} [opts.port]        — порт WS (по умолчанию FAR.videoChatPort)
 *   @param {boolean}[opts.autoConnect] — сразу подключиться
 */
FAR.openVideoChat = function (opts) {
    opts = opts || {};

    if (!FAR.videoChatEnabled) {
        FAR.toast('Просмотр трансляций отключён на сервере', 'warning');
        return;
    }

    // Оконный режим → WM-приложение
    if (typeof FAR.WM !== 'undefined' && FAR.WM.state && FAR.WM.state.active
        && FAR.WM.getApp && FAR.WM.getApp('videochat')) {
        return FAR.WM.openApp('videochat', {
            props: {
                room: opts.room || '',
                port: opts.port,
                autoConnect: opts.autoConnect !== undefined
                    ? opts.autoConnect
                    : !!opts.room
            }
        });
    }

    FAR._openVideoChatModal(opts);
};

FAR._openVideoChatModal = function (opts) {
    const modal  = document.getElementById('videoChatViewerModal');
    const host   = document.getElementById('videoChatViewerHost');
    const title  = document.getElementById('videoChatViewerTitle');

    if (!modal || !host) {
        console.error('[vc] #videoChatViewerModal или #videoChatViewerHost не найден');
        FAR.toast('Модалка просмотра не найдена', 'error');
        return;
    }

    if (FAR._vcModalApi) {
        try { FAR._vcModalApi.destroy(); } catch (e) {}
        FAR._vcModalApi = null;
    }

    if (title) {
        title.textContent = opts.room
            ? '📺 Трансляция: ' + opts.room
            : '📺 Трансляция';
    }

    FAR._vcModalApi = FAR._createVideoChatViewer(host, {
        room: opts.room || 'main',
        port: opts.port,
        autoConnect: opts.autoConnect !== undefined ? opts.autoConnect : !!opts.room
    });

    modal.classList.remove('hidden');
};

FAR.closeVideoChatViewer = function () {
    const modal = document.getElementById('videoChatViewerModal');
    if (modal) modal.classList.add('hidden');

    if (FAR._vcModalApi) {
        try { FAR._vcModalApi.destroy(); } catch (e) {}
        FAR._vcModalApi = null;
    }
};

FAR.closeVideoChatViewerOutside = function (e) {
    if (e.target === e.currentTarget) FAR.closeVideoChatViewer();
};

FAR.videoChatToggleFullscreen = function () {
    const modal = document.getElementById('videoChatViewerModal');
    if (!modal) return;
    const stage = modal.querySelector('.vc-stage');
    if (!stage) return;

    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isFs) {
        if (stage.requestFullscreen) stage.requestFullscreen();
        else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
};

// ============================================================
// ЯДРО: shared-core, используется и в модалке, и в WM-окне.
// ============================================================

FAR._createVideoChatViewer = function (hostEl, opts) {
    opts = opts || {};
    if (!hostEl) throw new Error('_createVideoChatViewer: hostEl required');

    hostEl.innerHTML =
        '<div class="vc-toolbar">' +
        '<label class="vc-room-label">Комната:</label>' +
        '<input type="text" class="vc-room-input" value="' +
        FAR.escapeHtml(opts.room || 'main') +
        '" autocomplete="off" spellcheck="false">' +
        '<button class="vc-btn vc-connect-btn">▶ Подключиться</button>' +
        '<button class="vc-btn vc-disconnect-btn" disabled>■ Отключиться</button>' +
        '</div>' +
        '<div class="vc-stage">' +
        '<video class="vc-video" playsinline autoplay muted></video>' +
        '<div class="vc-overlay">' +
        '<div class="vc-status">Введите имя комнаты и нажмите «Подключиться»</div>' +
        '</div>' +
        '</div>';

    const $ = (sel) => hostEl.querySelector(sel);
    const roomInput     = $('.vc-room-input');
    const connectBtn    = $('.vc-connect-btn');
    const disconnectBtn = $('.vc-disconnect-btn');
    const video         = $('.vc-video');
    const overlay       = $('.vc-overlay');
    const statusEl      = $('.vc-status');

    const S = {
        ws: null,
        pc: null,
        viewerId: null,
        room: '',
        pendingCandidates: [],
        connected: false,
        destroyed: false
    };

    function setStatus(text, isError) {
        statusEl.textContent = text || '';
        statusEl.style.color = isError ? '#f38ba8' : '#cdd6f4';
        if (isError) overlay.classList.remove('hidden');
    }

    function updateButtons() {
        connectBtn.disabled = S.connected;
        disconnectBtn.disabled = !S.connected;
        roomInput.disabled = S.connected;
    }

    function createPeer() {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        const localPc = pc;

        pc.ontrack = function (event) {
            if (event.streams && event.streams[0]) {
                video.srcObject = event.streams[0];
            } else if (video.srcObject instanceof MediaStream) {
                video.srcObject.addTrack(event.track);
            } else {
                video.srcObject = new MediaStream([event.track]);
            }
            overlay.classList.add('hidden');
            const p = video.play();
            if (p && p.catch) p.catch(function () {});
        };

        pc.onicecandidate = function (event) {
            if (event.candidate && S.ws && S.ws.readyState === WebSocket.OPEN) {
                S.ws.send(JSON.stringify({
                    target: 'publisher',
                    candidate: event.candidate.toJSON()
                }));
            }
        };

        pc.onconnectionstatechange = function () {
            const st = localPc.connectionState;
            if (st === 'connected') {
                setStatus('Подключено');
                overlay.classList.add('hidden');
            } else if (st === 'failed') {
                setStatus('Соединение потеряно', true);
            } else if (st === 'disconnected') {
                setStatus('Отключено', true);
            }
        };

        return pc;
    }

    function buildWsUrl(room) {
        const ctx = FAR.side && FAR.side[FAR.activePanel];
        const baseUrl = (ctx && ctx.conn && ctx.conn.url)
            ? String(ctx.conn.url).replace(/\/+$/, '')
            : location.origin;

        let host;
        try { host = new URL(baseUrl).hostname; }
        catch (e) { host = location.hostname; }

        const wsPort = opts.port || FAR.videoChatPort || 8081;
        // Определяем протокол: wss для HTTPS, ws для HTTP
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';

        return wsProto + '//' + host + ':' + wsPort +
            '/ws/subscribe?room=' + encodeURIComponent(room);
    }

    function connect(room) {
        disconnect();

        S.room = room || 'main';
        setStatus('Подключение к серверу…');

        let ws;
        try {
            ws = new WebSocket(buildWsUrl(S.room));
        } catch (e) {
            setStatus('Ошибка WebSocket: ' + e.message, true);
            return;
        }

        S.ws = ws;
        S.connected = true;
        updateButtons();

        ws.onopen = function () {
            setStatus('Ожидание трансляции в комнате «' + S.room + '»…');
        };

        ws.onmessage = async function (event) {
            if (typeof event.data !== 'string') return;
            if (S.destroyed) return;

            let msg;
            try { msg = JSON.parse(event.data); } catch (e) { return; }

            // Первое сообщение — наш viewerId
            if (msg.viewerId && !msg.sdp && !msg.candidate && !msg.target) {
                S.viewerId = msg.viewerId;
                return;
            }

            // SDP от публикатора (offer)
            if (msg.sdp) {
                if (!S.pc) S.pc = createPeer();

                try {
                    await S.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));

                    // Применяем накопленные кандидаты
                    for (const cand of S.pendingCandidates) {
                        try { await S.pc.addIceCandidate(cand); } catch (e) {}
                    }
                    S.pendingCandidates.length = 0;

                    if (msg.sdp.type === 'offer') {
                        const answer = await S.pc.createAnswer();
                        await S.pc.setLocalDescription(answer);
                        ws.send(JSON.stringify({
                            target: 'publisher',
                            sdp: S.pc.localDescription.toJSON()
                        }));
                    }
                } catch (e) {
                    console.error('[vc] sdp error:', e);
                    setStatus('Ошибка SDP: ' + e.message, true);
                }
                return;
            }

            // ICE-кандидат от публикатора
            if (msg.candidate) {
                const cand = new RTCIceCandidate(msg.candidate);
                if (S.pc && S.pc.remoteDescription && S.pc.remoteDescription.type) {
                    try { await S.pc.addIceCandidate(cand); } catch (e) {}
                } else {
                    S.pendingCandidates.push(cand);
                }
                return;
            }
        };

        ws.onerror = function () {
            if (S.destroyed) return;
            setStatus('Ошибка соединения с сервером', true);
        };

        ws.onclose = function () {
            if (S.destroyed) return;
            S.connected = false;
            setStatus('Соединение закрыто', true);
            updateButtons();
        };
    }

    function disconnect() {
        if (S.ws) {
            try { S.ws.close(); } catch (e) {}
            S.ws = null;
        }
        if (S.pc) {
            try { S.pc.close(); } catch (e) {}
            S.pc = null;
        }
        if (video.srcObject) {
            try { video.srcObject = null; } catch (e) {}
        }
        S.viewerId = null;
        S.pendingCandidates = [];
        S.connected = false;
        updateButtons();
        overlay.classList.remove('hidden');
        setStatus('Отключено');
    }

    connectBtn.addEventListener('click', function () {
        const room = (roomInput.value || '').trim() || 'main';
        connect(room);
    });

    disconnectBtn.addEventListener('click', disconnect);

    roomInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            connectBtn.click();
        }
    });

    if (opts.autoConnect && opts.room) {
        setTimeout(function () { connect(opts.room); }, 100);
    }

    return {
        connect: connect,
        disconnect: disconnect,
        getState: function () { return S; },
        destroy: function () {
            S.destroyed = true;
            disconnect();
            hostEl.innerHTML = '';
        }
    };
};

// ============================================================
// WM-приложение (регистрируется здесь же, если WM загружен)
// ============================================================

FAR._registerVideoChatWmApp = function () {
    if (typeof FAR.WM === 'undefined' || typeof FAR.WM.registerApp !== 'function') {
        return;
    }
    if (FAR.WM.getApp && FAR.WM.getApp('videochat')) return;

    FAR.WM.registerApp({
        id: 'videochat',
        title: 'Трансляция',
        icon: '📺',
        keywords: 'трансляция видеотрансляция stream webrtc videochat',
        singleton: true,
        width: 1100,
        height: 720,
        open: async function (win, props) {
            win.el.querySelector('.wm-title-text').textContent =
                '📺 ' + (props.room ? 'Трансляция: ' + props.room : 'Трансляция');

            win.bodyEl.innerHTML = '';
            win.bodyEl.style.display = 'flex';
            win.bodyEl.style.flexDirection = 'column';
            win.bodyEl.style.minHeight = '0';

            if (win.props._vcApi) {
                try { win.props._vcApi.destroy(); } catch (e) {}
                win.props._vcApi = null;
            }

            win.props._vcApi = FAR._createVideoChatViewer(win.bodyEl, {
                room: props.room || 'main',
                port: props.port,
                autoConnect: props.autoConnect
            });
        },
        onClose: function (win) {
            if (win.props && win.props._vcApi) {
                try { win.props._vcApi.destroy(); } catch (e) {}
                win.props._vcApi = null;
            }
        }
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', FAR._registerVideoChatWmApp);
} else {
    FAR._registerVideoChatWmApp();
}