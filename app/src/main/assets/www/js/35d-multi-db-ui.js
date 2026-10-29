// ============================================================
// Мульти-БД: UI — индикаторы подключения в заголовках панелей
// и переключатель БД по клику на путь.
// ============================================================
//
// Модуль подключается ПОСЛЕ 35a-multi-db-core.js,
// т.к. использует FAR.side[side].
// Подключается ДО 23-main.js, чтобы setupPanelDbSwitcher
// был доступен на DOMContentLoaded.

FAR.updateConnIndicators = function () {
    ['left', 'right'].forEach(function (side) {
        const pathEl = document.getElementById(side === 'left' ? 'pathLeft' : 'pathRight');
        if (!pathEl) return;
        const s = FAR.side[side];
        const label = (s && s.conn) ? FAR.connLabel(s.conn) : '— не подключено —';
        pathEl.title = 'Источник: ' + label + '\nКлик — сменить сервер для этой панели';
    });
};

/**
 * Клик по «пути» в шапке панели — открывает модалку подключения
 * для этой панели (одной).
 */
FAR.setupPanelDbSwitcher = function () {
    ['left', 'right'].forEach(function (side) {
        const panel = document.getElementById(side === 'left' ? 'panelLeft' : 'panelRight');
        if (!panel || panel._farDbSwitchBound) return;
        panel._farDbSwitchBound = true;

        const pathEl = panel.querySelector('.path');
        if (!pathEl) return;

        pathEl.style.cursor = 'pointer';
        pathEl.title = 'Клик — сменить БД для этой панели';
        pathEl.addEventListener('click', function (e) {
            e.stopPropagation();
            FAR.openConnModal(false, side);
        });
    });
};