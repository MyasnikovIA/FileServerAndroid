// ============================================================
// 07-progress.js — мульти-инстансный прогресс операций.
// ============================================================
//
// Каждый вызов FAR.startProgress() создаёт НОВЫЙ инстанс
// со своим DOM-элементом .progress-content внутри
// #progressStack. Несколько копирований/загрузок могут идти
// параллельно, каждый со своим прогресс-баром.
//
// Инстанс имеет методы:
//   prog.update(current, total, currentItem?, errors?)
//   prog.log(msg, type?)
//   prog.finish(errorCount?)
//   prog.cancel()
//   prog.close()
//   prog.minimize()
//   prog.restore()
// и свойство prog.state — { active, cancelled, current, total,
//                            errors, logLines, … }
//
// Старый API (FAR.updateProgress, FAR.progressLog, FAR.finishProgress,
// FAR.cancelProgress, FAR.minimizeProgress, FAR.restoreProgress,
// FAR.closeProgress, FAR.closeProgressOrMinimize) сохранён для
// совместимости. Он направляет вызов в "текущий" инстанс либо в
// переданный первым аргументом (instance или id).
// ============================================================

// Принудительная перерисовка: даём браузеру отрисовать DOM.
FAR._nextPaint = function () {
    return new Promise(function (resolve) {
        requestAnimationFrame(function () {
            setTimeout(resolve, 0);
        });
    });
};

// ============================================================
// Менеджер инстансов
// ============================================================

FAR.progressManager = FAR.progressManager || {
    instances: new Map(),   // id → instance
    nextId: 1,
    currentId: null         // последний созданный (для обратной совместимости)
};

// Обратная совместимость: FAR.progress — ссылка на state "последнего"
// инстанса. Используется в тех местах, где читают FAR.progress.active
// или FAR.progress.logLines. Для проверки "есть ли хоть один активный"
// используйте FAR.hasActiveProgress().
FAR.progress = FAR.progress || {
    active: false, cancelled: false,
    current: 0, total: 0, errors: 0,
    title: '', icon: '', logLines: [],
    onCancel: null, minimized: false, autoCloseTimer: null
};

// ============================================================
// Drag карточки за заголовок
// ============================================================

FAR._installProgressDragFor = function (instance) {
    const content = instance.el;
    const header  = content.querySelector('.progress-header');
    if (!header) return;
    if (header._farDragBound) return;
    header._farDragBound = true;

    header.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        if (e.target.closest('button')) return;

        const startX = e.clientX;
        const startY = e.clientY;
        const rect = content.getBoundingClientRect();

        content.style.position = 'fixed';
        content.style.left = rect.left + 'px';
        content.style.top  = rect.top + 'px';
        content.style.width = rect.width + 'px';
        content.style.margin = '0';

        const onMove = function (ev) {
            let nx = rect.left + (ev.clientX - startX);
            let ny = rect.top  + (ev.clientY - startY);
            nx = Math.max(0, Math.min(window.innerWidth  - rect.width,  nx));
            ny = Math.max(0, Math.min(window.innerHeight - 40,          ny));
            content.style.left = nx + 'px';
            content.style.top  = ny + 'px';
            instance.pos = { x: nx, y: ny };
        };

        const onUp = function () {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
        };

        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
    });
};

// ============================================================
// Создание инстанса
// ============================================================

FAR._createProgressInstance = function (icon, title, total, onCancel) {
    const overlay = document.getElementById('progressOverlay');
    const stack   = document.getElementById('progressStack');
    if (!overlay || !stack) {
        throw new Error('progressOverlay/progressStack не найдены в DOM');
    }

    const id = 'prog-' + (FAR.progressManager.nextId++);

    const el = document.createElement('div');
    el.className = 'progress-content';
    el.dataset.progId = id;
    el.innerHTML =
        '<div class="progress-header">' +
        '  <div class="progress-title">' +
        '    <span class="op-icon" data-role="icon"></span>' +
        '    <span data-role="title"></span>' +
        '  </div>' +
        '  <div class="progress-actions">' +
        '    <button data-role="minimize" title="Свернуть">▼ Свернуть</button>' +
        '    <button data-role="close" title="Закрыть">✕</button>' +
        '  </div>' +
        '</div>' +
        '<div class="progress-body">' +
        '  <div class="progress-stats">' +
        '    <span>' +
        '      <span class="done" data-role="done">0</span> / ' +
        '      <span data-role="total"></span>' +
        '      <span class="errors" data-role="errors"></span>' +
        '    </span>' +
        '    <span class="percent" data-role="percent">0%</span>' +
        '  </div>' +
        '  <div class="progress-bar-track">' +
        '    <div class="progress-bar-fill" data-role="fill"></div>' +
        '  </div>' +
        '  <div class="progress-current" data-role="current">—</div>' +
        '  <div class="progress-log" data-role="log"></div>' +
        '</div>' +
        '<div class="progress-footer">' +
        '  <button class="btn-cancel" data-role="cancel">⛔ Отмена</button>' +
        '  <button class="btn-close"  data-role="finish" disabled>✓ Готово</button>' +
        '</div>';

    stack.appendChild(el);
    overlay.classList.remove('hidden');

    // --- state ---
    const state = {
        active: true,
        cancelled: false,
        current: 0,
        total: total,
        errors: 0,
        title: title,
        icon: icon,
        logLines: [],
        onCancel: onCancel || null,
        minimized: false,
        autoCloseTimer: null
    };

    // --- shortcut на DOM ---
    const $ = sel => el.querySelector('[data-role="' + sel + '"]');

    // --- instance ---
    const instance = {
        id: id,
        el: el,
        state: state,
        pos: null,

        update: function (current, total2, currentItem, errorCount) {
            state.current = current;
            state.total = total2;
            if (typeof errorCount === 'number') state.errors = errorCount;

            const pct = total2 > 0 ? Math.round((current / total2) * 100) : 0;
            $('done').textContent    = String(current);
            $('total').textContent   = String(total2);
            $('percent').textContent = pct + '%';
            $('fill').style.width    = pct + '%';

            if (state.errors > 0) $('errors').textContent = ' (ошибок: ' + state.errors + ')';
            else $('errors').textContent = '';

            if (currentItem) $('current').textContent = currentItem;
        },

        log: function (msg, type) {
            const cls = type || 'info';
            const logEl = $('log');
            const line = document.createElement('div');
            line.className = 'log-line ' + cls;
            const time = new Date().toLocaleTimeString('ru-RU', { hour12: false });
            line.textContent = '[' + time + '] ' + msg;
            logEl.appendChild(line);
            logEl.scrollTop = logEl.scrollHeight;
            state.logLines.push(line.textContent);
        },

        finish: function (errorCount) {
            state.active = false;
            if (typeof errorCount === 'number') state.errors = errorCount;

            $('percent').textContent = '100%';
            $('fill').style.width = '100%';
            if (state.errors > 0) {
                $('fill').className = 'progress-bar-fill error';
                $('errors').textContent = ' (ошибок: ' + state.errors + ')';
            }
            $('current').textContent = 'Завершено';
            $('cancel').disabled = true;
            $('cancel').style.display = 'none';
            $('finish').disabled = false;
            $('finish').style.display = '';

            if (state.autoCloseTimer) clearTimeout(state.autoCloseTimer);
            state.autoCloseTimer = setTimeout(function () {
                instance.close();
            }, 1200);
        },

        cancel: function () {
            if (!state.active) return;
            if (!confirm('Отменить операцию? Уже выполненные действия останутся.')) return;
            state.cancelled = true;
            instance.log('⛔ Отмена запрошена пользователем', 'warn');
            $('cancel').disabled = true;
            if (state.onCancel) {
                try { state.onCancel(); } catch (e) { console.warn('[progress] onCancel:', e); }
            }
        },

        close: function () {
            if (state.active) return; // пока идёт — не закрываем
            if (state.autoCloseTimer) {
                clearTimeout(state.autoCloseTimer);
                state.autoCloseTimer = null;
            }
            if (el.parentNode) el.parentNode.removeChild(el);
            FAR.progressManager.instances.delete(id);
            if (FAR.progressManager.currentId === id) {
                FAR.progressManager.currentId = null;
            }
            if (stack.children.length === 0) {
                overlay.classList.add('hidden');
            }
        },

        minimize: function () {
            state.minimized = true;
            el.classList.add('progress-minimized');
        },

        restore: function () {
            state.minimized = false;
            el.classList.remove('progress-minimized');
        }
    };

    // --- начальное заполнение ---
    $('icon').textContent  = icon  || '';
    $('title').textContent = title || '';
    $('total').textContent = String(total);

    // --- обработчики кнопок ---
    $('cancel').onclick = function () { instance.cancel(); };
    $('finish').onclick = function () { instance.close(); };
    $('minimize').onclick = function () { instance.minimize(); };
    $('close').onclick = function () {
        if (instance.state.active) instance.minimize();
        else instance.close();
    };

    // Двойной клик по заголовку — переключить свёрнутость
    el.querySelector('.progress-header').addEventListener('dblclick', function (e) {
        if (e.target.closest('button')) return;
        if (instance.state.minimized) instance.restore();
        else instance.minimize();
    });

    // Drag
    FAR._installProgressDragFor(instance);

    // Регистрируем инстанс
    FAR.progressManager.instances.set(id, instance);
    FAR.progressManager.currentId = id;

    // Обратная совместимость: FAR.progress указывает на state последнего
    FAR.progress = state;

    return instance;
};

// ============================================================
// Публичное API
// ============================================================

/**
 * Создаёт новый инстанс прогресса.
 *
 * @returns {Object} instance с методами update/log/finish/cancel/close/minimize/restore
 */
FAR.startProgress = function (icon, title, total, onCancel) {
    return FAR._createProgressInstance(icon, title, total, onCancel);
};

/**
 * Возвращает true, если есть хотя бы один активный прогресс.
 * Используйте вместо `FAR.progress.active` (это только последний инстанс).
 */
FAR.hasActiveProgress = function () {
    for (const inst of FAR.progressManager.instances.values()) {
        if (inst.state.active) return true;
    }
    return false;
};

/**
 * Резолвит инстанс для обратной совместимости.
 * @param {Object|string|null|undefined} progOrId
 *        instance (у него есть .update) | id | null/undefined
 */
FAR._resolveProgressInstance = function (progOrId) {
    if (progOrId && typeof progOrId === 'object' && typeof progOrId.update === 'function') {
        return progOrId;
    }
    if (typeof progOrId === 'string') {
        const byId = FAR.progressManager.instances.get(progOrId);
        if (byId) return byId;
    }
    // fallback: последний созданный
    if (FAR.progressManager.currentId) {
        const cur = FAR.progressManager.instances.get(FAR.progressManager.currentId);
        if (cur) return cur;
    }
    // fallback: последний активный
    let last = null;
    for (const inst of FAR.progressManager.instances.values()) {
        if (inst.state.active) last = inst;
    }
    return last;
};

// ---------- backward-compat API ----------
//
// Сигнатуры сохранены. Первый аргумент может быть instance/id
// (тогда работаем с ним), либо быть пропущен (тогда — "текущий").

FAR.updateProgress = function (progOrId, current, total, currentItem, errorCount) {
    // Поддержка старой сигнатуры (current, total, currentItem, errorCount)
    if (typeof progOrId === 'number') {
        errorCount  = currentItem;
        currentItem = total;
        total       = current;
        current     = progOrId;
        progOrId    = null;
    }
    const inst = FAR._resolveProgressInstance(progOrId);
    if (inst) inst.update(current, total, currentItem, errorCount);
};

FAR.progressLog = function (progOrId, msg, type) {
    let inst, actualMsg, actualType;
    if (progOrId && typeof progOrId === 'object' && typeof progOrId.log === 'function') {
        inst = progOrId;
        actualMsg  = msg;
        actualType = type;
    } else if (typeof progOrId === 'string' && FAR.progressManager.instances.has(progOrId)) {
        inst = FAR.progressManager.instances.get(progOrId);
        actualMsg  = msg;
        actualType = type;
    } else {
        // старая сигнатура: (msg, type)
        inst = FAR._resolveProgressInstance(null);
        actualMsg  = progOrId;
        actualType = msg;
    }
    if (inst) inst.log(actualMsg, actualType);
};

FAR.finishProgress = function (progOrId, errorCount) {
    if (typeof progOrId === 'number') {
        errorCount = progOrId;
        progOrId = null;
    }
    const inst = FAR._resolveProgressInstance(progOrId);
    if (inst) inst.finish(errorCount);
};

FAR.cancelProgress = function (progOrId) {
    const inst = FAR._resolveProgressInstance(progOrId);
    if (inst) inst.cancel();
};

FAR.closeProgress = function (progOrId) {
    const inst = FAR._resolveProgressInstance(progOrId);
    if (inst) inst.close();
};

FAR.minimizeProgress = function (progOrId) {
    const inst = FAR._resolveProgressInstance(progOrId);
    if (inst) inst.minimize();
};

FAR.restoreProgress = function (progOrId) {
    const inst = FAR._resolveProgressInstance(progOrId);
    if (inst) inst.restore();
};

FAR.closeProgressOrMinimize = function (progOrId) {
    const inst = FAR._resolveProgressInstance(progOrId);
    if (!inst) return;
    if (inst.state.active) inst.minimize();
    else inst.close();
};