const $ = id => document.getElementById(id);

(async () => {
  const cfg = await chrome.storage.local.get(['room', 'server', 'source']);
  $('room').value = cfg.room || 'main';
  $('source').value = cfg.source || 'camera';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let defaultHost = 'localhost';
  if (tab && /^https?:\/\//.test(tab.url || '')) {
    try { defaultHost = new URL(tab.url).hostname; } catch {}
  }

  $('server').value = cfg.server || defaultHost;
})();

$('start').onclick = async () => {
  const room = $('room').value.trim() || 'main';
  const host = $('server').value.trim() || 'localhost';
  const source = $('source').value;

  await chrome.storage.local.set({ room, server: host, source });
  $('status').textContent = 'starting…';

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'start', room, host, source
    });
    if (resp && resp.ok) window.close();
    else $('status').textContent = 'error: ' + (resp && resp.error);
  } catch (e) {
    $('status').textContent = 'Error: ' + e.message;
  }
};

$('stop').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'stop' });
  $('status').textContent = 'stopped.';
};