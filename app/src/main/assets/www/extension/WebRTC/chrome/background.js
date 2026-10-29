// background.js
//
// Фоновый скрипт (Service Worker) для Chrome/Edge (Manifest V3).
// Отвечает за создание и закрытие окна захвата (popup).

let captureWindowId = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'start') {
    // Запуск из popup (иконка расширения).
    // Флаг secure по умолчанию false, так как мы не знаем контекст открытой вкладки.
    startCapture(msg.room, msg.host, msg.source, false)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'page-start-broadcast') {
    // Запуск со страницы (через bridge.js).
    // Принимаем флаг secure, чтобы знать, работать по wss:// или ws://
    startCapture(msg.room || 'main', msg.host || 'localhost', msg.source, msg.secure)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'stop') {
    stopAll();
    sendResponse({ ok: true });
    return;
  }
});

async function startCapture(room, host, source, secure) {
  // Закрываем предыдущее окно захвата, если оно было открыто
  if (captureWindowId !== null) {
    try { await chrome.windows.remove(captureWindowId); } catch (e) { /* ignore */ }
    captureWindowId = null;
  }

  // Формируем URL с параметрами, включая secure=1 или secure=0
  const url = chrome.runtime.getURL(
      `capture.html?room=${encodeURIComponent(room)}&host=${encodeURIComponent(host)}&source=${encodeURIComponent(source || 'camera')}&secure=${secure ? '1' : '0'}`
  );

  // Открываем отдельное всплывающее окно
  const win = await chrome.windows.create({
    url,
    type: 'popup',
    width: 640,
    height: 480
  });

  captureWindowId = win.id;
  return { ok: true };
}

function stopAll() {
  if (captureWindowId !== null) {
    chrome.windows.remove(captureWindowId).catch(() => {});
    captureWindowId = null;
  }
}

// Если пользователь закрыл окно вручную, сбрасываем ID
chrome.windows.onRemoved.addListener((id) => {
  if (id === captureWindowId) {
    captureWindowId = null;
  }
});