// ============================================================
// Drag&drop файлов/папок из Проводника ОС в панель +
// drag&drop файлов МЕЖДУ панелями (panel-to-panel).
// + глобальный реестр внешних drop-target'ов (Ollama и др.)
// ============================================================

FAR._dragCounter = 0;

// ← НОВОЕ: реестр внешних приёмников drag&drop
FAR._externalDropTargets = FAR._externalDropTargets || [];

/**
 * Регистрирует внешний drop-target.
 * target должен иметь:
 *   containsPoint(x, y) → boolean
 *   acceptDrop(items, sourceSide) → void|Promise
 *   onHover?(isOver:boolean)      → void (необязательно)
 * Возвращает функцию unregister().
 */
FAR.registerExternalDropTarget = function (target) {
    if (!target
        || typeof target.containsPoint !== 'function'
        || typeof target.acceptDrop !== 'function') {
        console.warn('[registerExternalDropTarget] invalid target');
        return function () {};
    }
    FAR._externalDropTargets.push(target);
    return function unregister() {
        const idx = FAR._externalDropTargets.indexOf(target);
        if (idx >= 0) {
            FAR._externalDropTargets.splice(idx, 1);
            // Снимаем hover, если он остался
            if (target._hover && typeof target.onHover === 'function') {
                try { target.onHover(false); } catch (e) {}
                target._hover = false;
            }
        }
    };
};

FAR._findExternalDropTarget = function (x, y) {
    // Идём с конца — последний зарегистрированный имеет приоритет
    for (let i = FAR._externalDropTargets.length - 1; i >= 0; i--) {
        const t = FAR._externalDropTargets[i];
        try {
            if (t.containsPoint(x, y)) return t;
        } catch (e) { /* ignore */ }
    }
    return null;
};

FAR._setExternalHover = function (target) {
    for (const t of FAR._externalDropTargets) {
        const shouldBe = (t === target);
        if (!!t._hover !== shouldBe) {
            t._hover = shouldBe;
            if (typeof t.onHover === 'function') {
                try { t.onHover(shouldBe); } catch (e) {}
            }
        }
    }
};

// ============================================================
// OS → panel
// ============================================================

FAR.getDropTargetPath = function(panelId) {
    const side = panelId === 'panelLeft' ? 'left' : 'right';
    const ctx = FAR.side[side];
    return ctx ? ctx.path : '/';
};

FAR.setupPanelDragDrop = function(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(evt) {
        document.addEventListener(evt, function(e) {
            if (e.target.closest && e.target.closest('.panel')) return;
            e.preventDefault();
        });
    });

    panel.addEventListener('dragenter', function(e) {
        e.preventDefault();
        e.stopPropagation();
        FAR._dragCounter++;
        if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
            panel.classList.add('drag-over');
            const hint = panel.querySelector('.drop-path');
            if (hint) hint.textContent = FAR.getDropTargetPath(panelId);
        }
    });

    panel.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (!panel.classList.contains('drag-over') &&
            e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
            panel.classList.add('drag-over');
            const hint = panel.querySelector('.drop-path');
            if (hint) hint.textContent = FAR.getDropTargetPath(panelId);
        }
    });

    panel.addEventListener('dragleave', function(e) {
        e.preventDefault();
        e.stopPropagation();
        FAR._dragCounter--;
        if (FAR._dragCounter <= 0) {
            FAR._dragCounter = 0;
            panel.classList.remove('drag-over');
        }
    });

    panel.addEventListener('drop', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        FAR._dragCounter = 0;
        panel.classList.remove('drag-over');

        if (!FAR.ensureDb()) return;

        const targetPath = FAR.getDropTargetPath(panelId);
        const files = await FAR.collectFilesFromDataTransfer(e.dataTransfer);

        if (files.length === 0) {
            FAR.toast('Не удалось получить файлы из перетаскивания', 'warning');
            return;
        }

        FAR.setActivePanel(panelId === 'panelLeft' ? 'left' : 'right');
        await FAR.uploadFilesToPath(files, targetPath);
    });

    FAR._setupPanelItemDrag(panelId);
};

FAR.collectFilesFromDataTransfer = async function(dataTransfer) {
    const result = [];
    if (!dataTransfer) return result;

    if (dataTransfer.items && dataTransfer.items.length > 0) {
        const items = Array.from(dataTransfer.items);
        const hasEntries = items.some(it => typeof it.webkitGetAsEntry === 'function');

        if (hasEntries) {
            const promises = items.map(function(it) {
                if (typeof it.webkitGetAsEntry !== 'function') return Promise.resolve();
                const entry = it.webkitGetAsEntry();
                if (!entry) return Promise.resolve();
                return FAR.traverseEntry(entry, '', result);
            });
            await Promise.all(promises);
            return result;
        }
    }

    if (dataTransfer.files && dataTransfer.files.length > 0) {
        for (const file of Array.from(dataTransfer.files)) {
            result.push({
                name: file.name,
                blob: file,
                contentType: file.type || 'application/octet-stream',
                relativePath: ''
            });
        }
    }

    return result;
};

FAR.traverseEntry = function(entry, relativePath, result) {
    return new Promise(function(resolve) {
        if (entry.isFile) {
            entry.file(function(file) {
                result.push({
                    name: file.name,
                    blob: file,
                    contentType: file.type || 'application/octet-stream',
                    relativePath: relativePath
                });
                resolve();
            }, function(err) {
                console.warn('file error:', entry.name, err);
                resolve();
            });
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const allEntries = [];

            const readBatch = function() {
                reader.readEntries(function(entries) {
                    if (entries.length === 0) {
                        const newRelative = relativePath
                            ? relativePath + '/' + entry.name
                            : entry.name;
                        Promise.all(allEntries.map(function(e) {
                            return FAR.traverseEntry(e, newRelative, result);
                        })).then(function() { resolve(); });
                        return;
                    }
                    allEntries.push(...entries);
                    readBatch();
                }, function(err) {
                    console.warn('readEntries error:', entry.name, err);
                    resolve();
                });
            };
            readBatch();
        } else {
            resolve();
        }
    });
};

// ============================================================
// Внутренний drag&drop между панелями (panel → panel)
// + внешние приёмники
// ============================================================

FAR._panelDragState = null;

FAR._setupPanelItemDrag = function (panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    if (panel._farItemDragBound) return;
    panel._farItemDragBound = true;

    const side = panelId === 'panelLeft' ? 'left' : 'right';

    panel.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        if (!FAR.db) return;
        if (e.ctrlKey || e.metaKey) return;

        const itemEl = e.target.closest('.file-item');
        if (!itemEl) return;

        const idx = parseInt(itemEl.getAttribute('data-index'), 10);
        if (isNaN(idx) || idx === -1) return;

        const ctx = FAR.side[side];
        if (!ctx) return;
        if (!ctx.selectedIdx.has(idx)) return;

        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;

        const onMove = function (ev) {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!dragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                dragging = true;
                FAR._beginPanelDrag(side, ev.clientX, ev.clientY);
            }
            if (dragging) {
                FAR._updatePanelDrag(ev.clientX, ev.clientY);
                FAR._highlightPanelUnderCursor(ev.clientX, ev.clientY, side);
            }
        };

        const onUp = function (ev) {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);

            if (!dragging) return;

            // ← НОВОЕ: сначала внешние drop-target'ы (например, Ollama)
            const ext = FAR._findExternalDropTarget(ev.clientX, ev.clientY);
            if (ext && FAR._panelDragState) {
                const items = FAR._panelDragState.items.slice();
                const srcSide = FAR._panelDragState.sourceSide;
                FAR._endPanelDrag();
                try {
                    const ret = ext.acceptDrop(items, srcSide);
                    if (ret && typeof ret.catch === 'function') {
                        ret.catch(function (err) {
                            console.error('[external drop]', err);
                            FAR.toast('Не удалось принять файлы: ' + err.message, 'error');
                        });
                    }
                } catch (err) {
                    console.error('[external drop]', err);
                    FAR.toast('Не удалось принять файлы: ' + err.message, 'error');
                }
                return;
            }

            // Затем — панели FAR (как раньше)
            const targetPanel = FAR._getPanelUnderCursor(ev.clientX, ev.clientY);
            if (targetPanel && targetPanel !== panelId) {
                const targetSide = targetPanel === 'panelLeft' ? 'left' : 'right';
                const mode = ev.shiftKey ? 'move' : 'copy';
                FAR._performPanelDrop(targetSide, mode);
            } else {
                FAR._endPanelDrag();
            }
        };

        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
    });
};

FAR._beginPanelDrag = function (sourceSide, x, y) {
    const ctx = FAR.side[sourceSide];
    if (!ctx || ctx.selectedIdx.size === 0) return;

    const files = ctx.files || [];
    const items = [];
    for (const i of Array.from(ctx.selectedIdx)) {
        const f = files[i];
        if (f) items.push({
            _id: f._id, name: f.name, path: f.path, isFolder: f.isFolder
        });
    }
    if (items.length === 0) return;

    const ghost = document.createElement('div');
    ghost.className = 'panel-drag-ghost';
    ghost.textContent = items.length === 1
        ? '📦 ' + items[0].name
        : '📦 ' + items.length + ' элементов';
    ghost.style.cssText =
        'position:fixed;pointer-events:none;z-index:99999;' +
        'background:rgba(74,163,255,0.92);color:#fff;' +
        'padding:6px 12px;border-radius:5px;font-size:12px;' +
        'box-shadow:0 4px 12px rgba(0,0,0,0.5);' +
        'white-space:nowrap;';
    ghost.style.left = x + 'px';
    ghost.style.top  = y + 'px';
    document.body.appendChild(ghost);

    FAR._panelDragState = {
        sourceSide: sourceSide,
        items: items,
        ghost: ghost
    };

    FAR.setStatus('Перетаскивание: ' + items.length +
        ' элемент(ов). Отпустите на другой панели или в окне приёмника (Shift — перенос).');
};

FAR._updatePanelDrag = function (x, y) {
    if (!FAR._panelDragState || !FAR._panelDragState.ghost) return;
    FAR._panelDragState.ghost.style.left = x + 'px';
    FAR._panelDragState.ghost.style.top  = y + 'px';
};

FAR._endPanelDrag = function () {
    if (FAR._panelDragState && FAR._panelDragState.ghost) {
        try { FAR._panelDragState.ghost.remove(); } catch (e) {}
    }
    // ← НОВОЕ: снимаем hover со внешних приёмников
    if (typeof FAR._setExternalHover === 'function') {
        FAR._setExternalHover(null);
    }
    FAR._panelDragState = null;
    FAR.setStatus('');

    document.querySelectorAll('.panel.item-drag-over').forEach(function (el) {
        el.classList.remove('item-drag-over');
    });
};

FAR._getPanelUnderCursor = function (x, y) {
    const panels = ['panelLeft', 'panelRight'];
    for (const pid of panels) {
        const el = document.getElementById(pid);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right &&
            y >= rect.top && y <= rect.bottom) {
            return pid;
        }
    }
    return null;
};

FAR._highlightPanelUnderCursor = function (x, y, sourceSide) {
    // ← НОВОЕ: сначала проверяем внешние drop-target'ы
    const ext = FAR._findExternalDropTarget(x, y);
    if (ext) {
        // Снимаем подсветку с панелей
        document.querySelectorAll('.panel.item-drag-over').forEach(function (el) {
            el.classList.remove('item-drag-over');
        });
        FAR._setExternalHover(ext);
        return;
    }
    // Не над внешним — снимаем hover
    FAR._setExternalHover(null);

    // Панели FAR (как раньше)
    const target = FAR._getPanelUnderCursor(x, y);
    document.querySelectorAll('.panel.item-drag-over').forEach(function (el) {
        el.classList.remove('item-drag-over');
    });
    if (!target) return;
    const targetSide = target === 'panelLeft' ? 'left' : 'right';
    if (targetSide === sourceSide) return;
    const el = document.getElementById(target);
    if (el) el.classList.add('item-drag-over');
};

FAR._performPanelDrop = async function (targetSide, mode) {
    const state = FAR._panelDragState;
    FAR._endPanelDrag();
    if (!state) return;

    const srcSide = state.sourceSide;
    if (srcSide === targetSide) {
        FAR.toast('Перетащите в другую панель', 'info');
        return;
    }

    const sSrc = FAR.side[srcSide];
    const sDst = FAR.side[targetSide];
    if (!sSrc || !sSrc.db) { FAR.toast('Источник не подключён', 'warning'); return; }
    if (!sDst || !sDst.db) { FAR.toast('Цель не подключена', 'warning'); return; }

    const files = sSrc.files || [];
    const wantedIds = new Set(state.items.map(function (it) { return it._id; }));
    const indices = [];
    files.forEach(function (f, idx) {
        if (f && wantedIds.has(f._id)) indices.push(idx);
    });
    if (indices.length === 0) {
        FAR.toast('Файлы не найдены в текущей папке источника', 'warning');
        return;
    }

    const prevActive = FAR.activePanel;
    const prevSel = Array.from(sSrc.selectedIdx);
    const prevAnchor = sSrc.anchor;

    FAR.activePanel = srcSide;
    sSrc.selectedIdx.clear();
    indices.forEach(function (i) { sSrc.selectedIdx.add(i); });
    sSrc.anchor = indices[0];

    try {
        await FAR.transferBetweenSides(mode || 'copy');
    } catch (e) {
        console.error('[panel drop] transfer failed:', e);
        FAR.toast('Ошибка переноса: ' + e.message, 'error');
    } finally {
        FAR.activePanel = prevActive;
        sSrc.selectedIdx.clear();
        prevSel.forEach(function (i) { sSrc.selectedIdx.add(i); });
        sSrc.anchor = prevAnchor;
    }
};