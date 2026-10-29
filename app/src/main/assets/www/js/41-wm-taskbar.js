// ============================================================
// 41-wm-taskbar.js — панель задач
// ============================================================

/**
 * Полная перерисовка кнопок задач.
 * Вызывается WM при каждом изменении списка окон/фокуса.
 */
FAR.WM._renderTaskbar = function () {
    const container = document.getElementById('wmTaskButtons');
    if (!container) return;
    container.innerHTML = '';

    // Сортируем по времени создания, чтобы кнопки не прыгали
    const wins = FAR.WM.state.windows.slice().sort((a, b) => a.createdAt - b.createdAt);

    wins.forEach(function (w) {
        const btn = document.createElement('button');
        btn.className = 'wm-tb-btn';
        if (w.id === FAR.WM.state.activeWindowId) btn.classList.add('active');
        if (!w.minimized) btn.classList.add('running');

        const emoji = document.createElement('span');
        emoji.textContent = w.icon || '🪟';

        const label = document.createElement('span');
        label.className = 'wm-tb-label';
        label.textContent = w.title;

        btn.appendChild(emoji);
        btn.appendChild(label);

        btn.title = w.title;
        btn.addEventListener('click', function () {
            const activeId = FAR.WM.state.activeWindowId;
            if (w.id === activeId && !w.minimized) {
                // Повторный клик по активной — свернуть
                FAR.WM.minimizeWindow(w.id);
            } else {
                FAR.WM.restoreWindow(w.id);
            }
        });

        container.appendChild(btn);
    });

    FAR.WM.updateTray();
    try {
        if (FAR.FS && typeof FAR.FS._updateTrayButton === 'function') {
            FAR.FS._updateTrayButton();
        }
    } catch (e) { /* ignore */ }
};

// ============================================================
// Трей: обновление по событиям
// ============================================================

// Дополнительная «докрутка» трея прогресса — раз в секунду
setInterval(function () {
    if (FAR.WM.state.active) FAR.WM.updateTray();
}, 1000);