// background.js — Firefox-версия.
//
// Отличия от Chrome-версии:
//   • используется browser.* API (промисы), а не колбэки chrome.*;
//   • captureWindowId получаем из windows.create() через await;
//   • если popup-окно закрыто пользователем вручную, срабатывает
//     browser.windows.onRemoved — сбрасываем captureWindowId.

const api = typeof browser !== 'undefined' ? browser : chrome;

let captureWindowId = null;

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'start') {
        // Запуск из popup (флаг secure по умолчанию false)
        startCapture(msg.room, msg.host, msg.source, false)
            .then(r => sendResponse(r))
            .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    if (msg.type === 'page-start-broadcast') {
        // Запуск со страницы (принимаем флаг secure)
        startCapture(msg.room || 'main', msg.host || 'localhost', msg.source, msg.secure)
            .then(r => sendResponse(r))
            .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    if (msg.type === 'stop') {
        stopAll()
            .then(() => sendResponse({ ok: true }))
            .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }
});

async function startCapture(room, host, source, secure) {
    if (captureWindowId !== null) {
        try { await api.windows.remove(captureWindowId); } catch (e) { /* ignore */ }
        captureWindowId = null;
    }

    // Передаем флаг secure в URL
    const url = api.runtime.getURL(
        `capture.html?room=${encodeURIComponent(room)}&host=${encodeURIComponent(host)}&source=${encodeURIComponent(source || 'camera')}&secure=${secure ? '1' : '0'}`
    );

    const win = await api.windows.create({
        url,
        type: 'popup',
        width: 640,
        height: 480
    });

    captureWindowId = win.id;
    return { ok: true };
}

async function stopAll() {
    if (captureWindowId !== null) {
        try { await api.windows.remove(captureWindowId); } catch (e) { /* ignore */ }
        captureWindowId = null;
    }
}

api.windows.onRemoved.addListener((id) => {
    if (id === captureWindowId) {
        captureWindowId = null;
    }
});