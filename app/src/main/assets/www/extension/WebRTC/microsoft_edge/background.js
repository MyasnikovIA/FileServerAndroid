// background.js — версия для Microsoft Edge (Chromium MV3).
//
// Edge полностью совместим с Chrome MV3:
//   • chrome.runtime / chrome.windows / chrome.storage — те же API;
//   • service_worker запускается так же;
//   • все промисы (chrome.windows.create, chrome.runtime.sendMessage)
//     работают начиная с Edge 88 (Chromium 88).
//
// ОБНОВЛЕНО: принимаем флаг secure из bridge.js и передаём его
// в capture.html как URL-параметр, чтобы capture.js выбрал
// wss:// вместо ws:// на HTTPS-страницах.

let captureWindowId = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'start') {
        // Запуск из popup (флаг secure неизвестен — по умолчанию false)
        startCapture(msg.room, msg.host, msg.source, false)
            .then(r => sendResponse(r))
            .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    if (msg.type === 'page-start-broadcast') {
        // Запуск со страницы — принимаем флаг secure
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
    // Закрываем предыдущее окно захвата, если оно было
    if (captureWindowId !== null) {
        try { await chrome.windows.remove(captureWindowId); } catch (e) { /* ignore */ }
        captureWindowId = null;
    }

    // Передаём secure в URL
    const url = chrome.runtime.getURL(
        `capture.html?room=${encodeURIComponent(room)}&host=${encodeURIComponent(host)}&source=${encodeURIComponent(source || 'camera')}&secure=${secure ? '1' : '0'}`
    );

    const win = await chrome.windows.create({
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
        try { await chrome.windows.remove(captureWindowId); } catch (e) { /* ignore */ }
        captureWindowId = null;
    }
}

chrome.windows.onRemoved.addListener((id) => {
    if (id === captureWindowId) {
        captureWindowId = null;
    }
});