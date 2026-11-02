// ============================================================
// 66-login-gate.js — центральная кнопка «Войти» на главном экране
// ============================================================
//
// Показывает по центру экрана большую кнопку «Войти», пока
// пользователь не подключён к FileServer и не активирован
// WM-режим. Кнопка открывает модалку авторизации (#connModal)
// через FAR.openConnModal(true).
//
// Скрывается автоматически:
//   • при успешном подключении  (FAR.applyConnectionToSide/Both)
//   • при входе в WM           (FAR.WM.enter)
//
// Снова показывается:
//   • при выходе из WM         (FAR.WM.exit — только если db=null)
//   • при логауте              (FAR.onAuthButton → сброс FAR.db)
//   • при загрузке страницы без валидного подключения

FAR.updateLoginGate = function () {
    const gate = document.getElementById('loginGate');
    if (!gate) return;

    const isWM = !!(FAR.WM && FAR.WM.state && FAR.WM.state.active);
    const isConnected = !!FAR.db;

    if (isWM || isConnected) {
        gate.classList.add('hidden');
    } else {
        gate.classList.remove('hidden');
    }
};

// ============================================================
// Хуки: обновляем состояние гейта при изменении подключения
// и при входе/выходе из WM.
// ============================================================

(function installLoginGateHooks() {

    // 1. Подключение к БД
    function hookConnection() {
        if (typeof FAR.applyConnectionToSide !== 'function') {
            setTimeout(hookConnection, 100);
            return;
        }
        if (FAR._loginGateConnHooked) return;
        FAR._loginGateConnHooked = true;

        const origSide = FAR.applyConnectionToSide;
        FAR.applyConnectionToSide = function () {
            const r = origSide.apply(this, arguments);
            setTimeout(FAR.updateLoginGate, 0);
            return r;
        };

        const origBoth = FAR.applyConnectionToBoth;
        FAR.applyConnectionToBoth = function () {
            const r = origBoth.apply(this, arguments);
            setTimeout(FAR.updateLoginGate, 0);
            return r;
        };
    }
    hookConnection();

    // 2. WM.enter / WM.exit
    function hookWM() {
        if (typeof FAR.WM === 'undefined' || typeof FAR.WM.enter !== 'function') {
            setTimeout(hookWM, 100);
            return;
        }
        if (FAR.WM._loginGateHooked) return;
        FAR.WM._loginGateHooked = true;

        const origEnter = FAR.WM.enter;
        FAR.WM.enter = function () {
            const r = origEnter.apply(this, arguments);
            setTimeout(FAR.updateLoginGate, 0);
            return r;
        };

        const origExit = FAR.WM.exit;
        FAR.WM.exit = function () {
            const r = origExit.apply(this, arguments);
            setTimeout(FAR.updateLoginGate, 0);
            return r;
        };
    }
    hookWM();
})();

// ============================================================
// Начальное состояние — при загрузке страницы
// ============================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(FAR.updateLoginGate, 0);
    });
} else {
    setTimeout(FAR.updateLoginGate, 0);
}