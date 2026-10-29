// ============================================================
// Мульти-БД: ядро — контексты панелей, алиасы, подключение,
// хранение «последних введённых данных» для каждой панели.
// ============================================================
//
// Модуль подключается ПОСЛЕ 34-context-menu.js и ПЕРЕД 35b/35c/35d,
// которые используют созданные здесь структуры (FAR.side, алиасы,
// FAR.applyConnectionToSide, FAR.loadSideConnFromLS, ...).
//
// Отвечает за:
//   1. Создание FAR.side.left / FAR.side.right.
//   2. Подмену FAR.leftPath / FAR.leftFiles / ... на геттеры.
//   3. Совместимость: FAR.db / FAR.fileIndex = активная панель.
//   4. Применение подключения к стороне/обеим панелям.
//   5. Хранение side-подключений в localStorage.

// ============================================================
// 0. Константы localStorage для «последних» подключений
// ============================================================

FAR.LS_CONN_LEFT  = 'filebd_conn_left';
FAR.LS_CONN_RIGHT = 'filebd_conn_right';

// ============================================================
// 1. Создание контекстов панелей и алиасы
// ============================================================

FAR.side = {
    left:  null,
    right: null
};

FAR.createSideContext = function (side) {
    return {
        side: side,
        db: null,
        conn: null,          // { url, db, user, pass }
        fullUrl: '',
        fileIndex: [],
        path: '/',
        files: [],
        cursor: -1,
        selectedIdx: new Set(),
        anchor: -1,
        loading: false
    };
};

FAR.side.left  = FAR.createSideContext('left');
FAR.side.right = FAR.createSideContext('right');

// ---- Алиасы: FAR.leftPath <-> FAR.side.left.path и т.п. ----
(function installSideAliases() {
    function alias(prop, side, field) {
        Object.defineProperty(FAR, prop, {
            configurable: true,
            get: function () { return FAR.side[side][field]; },
            set: function (v) { FAR.side[side][field] = v; }
        });
    }
    ['left', 'right'].forEach(function (side) {
        alias(side + 'Path',        side, 'path');
        alias(side + 'Files',       side, 'files');
        alias(side + 'Cursor',      side, 'cursor');
        alias(side + 'SelectedIdx', side, 'selectedIdx');
        alias(side + 'Anchor',      side, 'anchor');
    });
})();

// ---- Совместимость: FAR.db / FAR.fileIndex = активная панель ----
// Старый код, читающий FAR.db / FAR.fileIndex, продолжит работать —
// он увидит БД и индекс ТОЙ панели, что сейчас активна.
(function installActivePanelAliases() {
    Object.defineProperty(FAR, 'db', {
        configurable: true,
        get: function () {
            const s = FAR.side[FAR.activePanel];
            return s ? s.db : null;
        },
        set: function (v) {
            // Установка FAR.db = X трактуется как «обеим панелям»
            // (обратная совместимость при первичном подключении).
            FAR.side.left.db  = v;
            FAR.side.right.db = v;
        }
    });

    Object.defineProperty(FAR, 'fileIndex', {
        configurable: true,
        get: function () {
            const s = FAR.side[FAR.activePanel];
            return s ? s.fileIndex : [];
        },
        set: function (v) {
            FAR.side.left.fileIndex  = v;
            FAR.side.right.fileIndex = v;
        }
    });
})();

// ============================================================
// 2. Заполнение контекста подключением
// ============================================================

FAR.applyConnectionToSide = function (side, cfg, db, fullUrl) {
    const s = FAR.side[side];
    if (!s) return;
    s.db = db;
    s.conn = cfg;
    s.fullUrl = fullUrl || '';
    s.fileIndex = [];
    s.path = '/';
    s.files = [];
    s.cursor = -1;
    s.selectedIdx.clear();
    s.anchor = -1;
    s.loading = false;
};

FAR.applyConnectionToBoth = function (cfg, db, fullUrl) {
    FAR.applyConnectionToSide('left',  cfg, db, fullUrl);
    FAR.applyConnectionToSide('right', cfg, db, fullUrl);
    FAR.currentConn = cfg;
};

// ============================================================
// 3. Хранение «последних введённых данных» для каждой панели
// ============================================================

FAR.saveSideConnToLS = function (side, cfg) {
    try {
        const key = side === 'left' ? FAR.LS_CONN_LEFT : FAR.LS_CONN_RIGHT;
        localStorage.setItem(key, JSON.stringify(cfg));
    } catch (e) { /* ignore */ }
};

FAR.loadSideConnFromLS = function (side) {
    try {
        const key = side === 'left' ? FAR.LS_CONN_LEFT : FAR.LS_CONN_RIGHT;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || !obj.url || !obj.db) return null;
        return obj;
    } catch (e) {
        return null;
    }
};

FAR.clearSideConnFromLS = function (side) {
    try {
        const key = side === 'left' ? FAR.LS_CONN_LEFT : FAR.LS_CONN_RIGHT;
        localStorage.removeItem(key);
    } catch (e) { /* ignore */ }
};

/**
 * Возвращает «последние данные» для модалки подключения.
 * Приоритет:
 *   1) conn текущего контекста стороны (если side задан)
 *   2) LS этой стороны
 *   3) глобальный LS (filebd_conn)
 *   4) дефолт (хост:5984 / FileBD)
 */
FAR.getConnDefaultsForSide = function (side, forceType) {
    // 1. Текущий контекст панели
    if (side && FAR.side[side] && FAR.side[side].conn) {
        return FAR.side[side].conn;
    }
    // 2. LS панели
    if (side) {
        const s = FAR.loadSideConnFromLS(side);
        if (s && (!forceType || (s.type || 'couchdb') === forceType)) return s;
    }
    // 3. Глобальный LS
    const g = FAR.loadConnFromLS();
    if (g && (!forceType || (g.type || 'couchdb') === forceType)) return g;
    // 4. Дефолт
    return FAR.getDefaultConnForType
        ? FAR.getDefaultConnForType(forceType || 'couchdb')
        : FAR.getDefaultConn();
};

// ============================================================
// 4. Хелперы: получить контекст стороны
// ============================================================

FAR.getSideContext = function (side) {
    return FAR.side[side] || null;
};

FAR.getActiveContext = function () {
    return FAR.side[FAR.activePanel] || null;
};