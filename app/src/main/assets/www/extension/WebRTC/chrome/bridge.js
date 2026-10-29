// bridge.js
(() => {
    window.postMessage({ __extReady: true }, '*');

    window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        if (!e.data || !e.data.__toExt) return;

        const { type, payload, __id } = e.data;
        const reply = (r) => window.postMessage({ __replyTo: __id, ...r }, '*');

        if (type === 'ext-ping') {
            reply({ ok: true });
            return;
        }

        let host = 'localhost';
        try { host = location.hostname; } catch (e) {}

        if (type === 'start-broadcast') {
            chrome.runtime.sendMessage({
                type: 'page-start-broadcast',
                room: (payload && payload.room) || 'main',
                source: (payload && payload.source) || 'camera',
                host: host,
                secure: location.protocol === 'https:'
            }).then(reply).catch((err) => reply({ ok: false, error: err.message }));
            return;
        }

        if (type === 'stop-broadcast') {
            chrome.runtime.sendMessage({ type: 'stop' })
                .then(reply)
                .catch((err) => reply({ ok: false, error: err.message }));
            return;
        }
    });
})();