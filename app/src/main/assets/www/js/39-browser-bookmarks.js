// ============================================================
// 39-browser-bookmarks.js — закладки для модуля «Браузер».
// ============================================================
//
// Хранилище: localStorage['filebd_browser_bookmarks']
// Формат:    [{ url, title, icon, createdAt }, ...]
//
// События:
//   FAR.Bookmarks.subscribe(fn) → unsubscribeFn
//   При изменении списка закладок вызываются все подписчики.
//   UI каждого открытого браузера обновляет полосу закладок.
// ============================================================

FAR.Bookmarks = (function () {
    const LS_KEY = 'filebd_browser_bookmarks';
    let items = [];
    const listeners = new Set();

    // ---- Загрузка ----
    function load() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) { items = []; return; }
            const arr = JSON.parse(raw);
            items = Array.isArray(arr) ? arr : [];
        } catch (e) {
            items = [];
        }
    }

    // ---- Сохранение ----
    function save() {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(items));
        } catch (e) { /* ignore */ }
    }

    // ---- Оповещение подписчиков ----
    function notify() {
        listeners.forEach(function (fn) {
            try { fn(items); } catch (e) { console.warn('[Bookmarks] listener:', e); }
        });
    }

    // ---- Публичный API ----
    const api = {
        get all() { return items.slice(); },

        has: function (url) {
            if (!url) return false;
            return items.some(function (b) { return b.url === url; });
        },

        add: function (bookmark) {
            if (!bookmark || !bookmark.url) return false;
            if (api.has(bookmark.url)) return false;
            items.push({
                url: String(bookmark.url),
                title: String(bookmark.title || bookmark.url),
                icon: String(bookmark.icon || '🌐'),
                createdAt: Date.now()
            });
            save();
            notify();
            return true;
        },

        remove: function (url) {
            if (!url) return false;
            const before = items.length;
            items = items.filter(function (b) { return b.url !== url; });
            if (items.length === before) return false;
            save();
            notify();
            return true;
        },

        update: function (url, patch) {
            if (!url || !patch) return false;
            let changed = false;
            items.forEach(function (b) {
                if (b.url === url) {
                    if (patch.title !== undefined) b.title = String(patch.title);
                    if (patch.icon  !== undefined) b.icon  = String(patch.icon);
                    changed = true;
                }
            });
            if (changed) { save(); notify(); }
            return changed;
        },

        toggle: function (bookmark) {
            if (!bookmark || !bookmark.url) return false;
            if (api.has(bookmark.url)) return api.remove(bookmark.url);
            return api.add(bookmark);
        },

        move: function (fromIdx, toIdx) {
            if (fromIdx === toIdx) return false;
            if (fromIdx < 0 || toIdx < 0) return false;
            if (fromIdx >= items.length || toIdx >= items.length) return false;
            const moved = items.splice(fromIdx, 1)[0];
            items.splice(toIdx, 0, moved);
            save();
            notify();
            return true;
        },

        subscribe: function (fn) {
            if (typeof fn !== 'function') return function () {};
            listeners.add(fn);
            try { fn(items); } catch (e) { /* ignore */ }
            return function () { listeners.delete(fn); };
        },

        /**
         * Возвращает иконку для URL.
         * Пока просто глобус. Позже можно добавить favicon-сервис.
         */
        iconFor: function (url) {
            return '🌐';
        },

        /**
         * Укороченное отображаемое имя для закладки.
         */
        displayNameFor: function (bookmark) {
            const t = bookmark.title || bookmark.url || '';
            if (t.length <= 32) return t;
            return t.substring(0, 30) + '…';
        }
    };

    load();
    return api;
})();

// ============================================================
// Контекстное меню для закладки (ПКМ)
// ============================================================

FAR.BookmarksMenu = {
    el: null,
    bookmark: null,
    onAction: null,

    _ensure: function () {
        if (this.el) return;
        const el = document.createElement('div');
        el.className = 'browser-bookmark-menu hidden';
        document.body.appendChild(el);
        this.el = el;

        document.addEventListener('mousedown', function (e) {
            if (!FAR.BookmarksMenu.el) return;
            if (FAR.BookmarksMenu.el.classList.contains('hidden')) return;
            if (FAR.BookmarksMenu.el.contains(e.target)) return;
            FAR.BookmarksMenu.hide();
        }, true);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') FAR.BookmarksMenu.hide();
        }, true);
    },

    show: function (x, y, bookmark, onAction) {
        this._ensure();
        this.bookmark = bookmark;
        this.onAction = onAction;

        const el = this.el;
        el.innerHTML = '';

        const makeItem = (label, cls, action) => {
            const item = document.createElement('div');
            item.className = 'bm-item' + (cls ? ' ' + cls : '');
            item.textContent = label;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                FAR.BookmarksMenu.hide();
                if (typeof action === 'function') action();
            });
            el.appendChild(item);
        };

        const makeSep = () => {
            const s = document.createElement('div');
            s.className = 'bm-sep';
            el.appendChild(s);
        };

        makeItem('📂 Открыть в текущей вкладке', '', () => {
            if (onAction) onAction('open', bookmark);
        });
        makeItem('🪟 Открыть в новой вкладке', '', () => {
            window.open(bookmark.url, '_blank', 'noopener');
        });
        makeSep();
        makeItem('✏️ Переименовать', '', () => {
            const newTitle = prompt('Новое имя закладки:', bookmark.title || bookmark.url);
            if (newTitle === null) return;
            FAR.Bookmarks.update(bookmark.url, { title: newTitle.trim() || bookmark.url });
        });
        makeSep();
        makeItem('🗑️ Удалить', 'danger', () => {
            FAR.Bookmarks.remove(bookmark.url);
        });

        el.classList.remove('hidden');

        // Позиционируем, не вылезая за края
        const rect = el.getBoundingClientRect();
        let left = x, top = y;
        if (left + rect.width > window.innerWidth - 4) left = window.innerWidth - rect.width - 4;
        if (top + rect.height > window.innerHeight - 4) top = window.innerHeight - rect.height - 4;
        if (left < 4) left = 4;
        if (top < 4) top = 4;
        el.style.left = left + 'px';
        el.style.top  = top + 'px';
    },

    hide: function () {
        if (this.el) this.el.classList.add('hidden');
    }
};