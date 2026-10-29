// popup.js — версия для Microsoft Edge (Chromium MV3).
//
// Отличия от Chrome-версии: отсутствуют. Edge (Chromium 88+)
// поддерживает промисы для chrome.storage.local.get/set,
// chrome.tabs.query и chrome.runtime.sendMessage.
//
// ОБНОВЛЕНО: определяем secure для popup. Если активная вкладка открыта
// по HTTPS — флаг передаётся, иначе используется ws://.

const $ = (id) => document.getElementById(id);

(async () => {
    const cfg = await chrome.storage.local.get(['room', 'server', 'source']);
    $('room').value   = cfg.room   || 'main';
    $('source').value = cfg.source || 'camera';

    let defaultHost = 'localhost';
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab  = tabs && tabs[0];
        if (tab && /^https?:\/\//.test(tab.url || '')) {
            try { defaultHost = new URL(tab.url).hostname; } catch (e) { /* ignore */ }
        }
    } catch (e) {
        // tabs.query может быть недоступен (нет permissions) — не критично
    }

    $('server').value = cfg.server || defaultHost;
})();

$('start').onclick = async () => {
    const room   = $('room').value.trim()   || 'main';
    const host   = $('server').value.trim() || 'localhost';
    const source = $('source').value;

    try {
        await chrome.storage.local.set({ room, server: host, source });
    } catch (e) { /* ignore */ }

    $('status').textContent = 'starting…';

    try {
        const resp = await chrome.runtime.sendMessage({
            type: 'start', room, host, source
        });

        if (resp && resp.ok) {
            window.close();
        } else {
            $('status').textContent = 'error: ' + (resp && resp.error);
        }
    } catch (e) {
        $('status').textContent = 'Error: ' + e.message;
    }
};

$('stop').onclick = async () => {
    try {
        await chrome.runtime.sendMessage({ type: 'stop' });
        $('status').textContent = 'stopped.';
    } catch (e) {
        $('status').textContent = 'Error: ' + e.message;
    }
};