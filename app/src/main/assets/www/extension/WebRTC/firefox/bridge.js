// bridge.js — Firefox-версия.
//
// Изменения:
//   • используем browser.* (промисы) вместо chrome.* колбэков;
//   • отправляем «привет» один раз при загрузке — расширение готово
//     принимать запросы (тот же протокол, что и в Chrome).

(() => {
    const api = typeof browser !== 'undefined' ? browser : chrome;

    // Сообщаем странице, что расширение готово
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
        try { host = location.hostname; } catch (e) { /* ignore */ }

        if (type === 'start-broadcast') {
            api.runtime.sendMessage({
                type: 'page-start-broadcast',
                room: (payload && payload.room) || 'main',
                source: (payload && payload.source) || 'camera',
                host: host,
                secure: location.protocol === 'https:' // <--- ДОБАВЛЕНА ПЕРЕДАЧА ФЛАГА
            })
                .then(reply)
                .catch((err) => reply({ ok: false, error: err && err.message }));
            return;
        }

        if (type === 'stop-broadcast') {
            api.runtime.sendMessage({ type: 'stop' })
                .then(reply)
                .catch((err) => reply({ ok: false, error: err && err.message }));
            return;
        }
    });
})();