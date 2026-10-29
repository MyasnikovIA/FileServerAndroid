// ============================================================
// Удаление выделенного (файлы + папки с содержимым).
// ============================================================
//
// Использует свой инстанс прогресса — не конфликтует с copy/move.

FAR.deleteSelected = async function () {
    if (!FAR.ensureDb()) return;

    const side = FAR.activePanel;
    const ctx = FAR.side[side];
    if (!ctx || !ctx.db) { FAR.toast('Панель не подключена', 'warning'); return; }

    const selected = FAR.getSelectedItemsFromActivePanel();
    if (selected.length === 0) { FAR.toast('Ничего не выбрано', 'warning'); return; }

    // 1. Собираем плоский список документов к удалению
    const filesToDelete = [];
    const folderIdsToDelete = [];
    const seenIds = new Set();

    for (const sel of selected) {
        const item = sel.item;

        if (item.isFolder) {
            if (!seenIds.has(item._id)) {
                seenIds.add(item._id);
                folderIdsToDelete.push(item._id);
                filesToDelete.push({ _id: item._id, path: item.path });
            }

            try {
                const children = await FAR.listRecursiveFromSide(side, item.path);
                for (const c of children) {
                    if (seenIds.has(c._id)) continue;
                    seenIds.add(c._id);
                    filesToDelete.push({ _id: c._id, path: c.path });
                    if (c.isFolder || c.docType === 'folder') {
                        folderIdsToDelete.push(c._id);
                    }
                }
            } catch (e) {
                FAR.toast('Ошибка обхода ' + item.path + ': ' + e.message, 'error');
            }
        } else {
            if (seenIds.has(item._id)) continue;
            seenIds.add(item._id);
            filesToDelete.push({ _id: item._id, path: item.path });
        }
    }

    if (filesToDelete.length === 0) {
        FAR.toast('Нечего удалять', 'warning');
        return;
    }

    if (!confirm(`Удалить ${selected.length} элемент(ов)?\n(Всего будет удалено ${filesToDelete.length} документов)`)) return;

    const prog = FAR.startProgress('🗑️', `Удаление ${filesToDelete.length} документов`, filesToDelete.length, function () {});

    // 2. Удаляем: сначала глубоко вложенные, потом родительские папки
    filesToDelete.sort(function (a, b) {
        return (b.path || '').length - (a.path || '').length;
    });

    let ok = 0, err = 0;
    const deletedIds = new Set();

    for (let i = 0; i < filesToDelete.length; i++) {
        if (prog.state.cancelled) break;
        const f = filesToDelete[i];
        prog.update(i, filesToDelete.length, f.path, err);
        try {
            const d = await ctx.db.get(f._id);
            await ctx.db.remove(d);
            deletedIds.add(f._id);
            ok++;
            prog.log(`✅ ${f.path}`, 'ok');
        } catch (e) {
            if (e.status === 404) {
                deletedIds.add(f._id);
                ok++;
                prog.log(`⏭ ${f.path} — уже удалён`, 'warn');
            } else {
                err++;
                prog.log(`❌ ${f.path}: ${e.message}`, 'err');
            }
        }
        prog.update(i + 1, filesToDelete.length, f.path, err);
    }

    // 3. Чистим выделение и перезагружаем панель
    ctx.selectedIdx.clear();
    ctx.anchor = -1;

    if (ctx.files.length > 0 && ctx.cursor >= ctx.files.length) {
        ctx.cursor = ctx.files.length - 1;
    }

    prog.finish(err);
    prog.log(`━━━ Готово: ${ok} удалено, ${err} ошибок`, ok > 0 ? 'ok' : 'err');

    await FAR.reloadPanel(side);
    FAR.setStatus(`✅ Удалено: ${ok}, ошибок: ${err}`);
    FAR.toast(`Удалено ${ok} из ${filesToDelete.length}`, ok ? 'success' : 'error');
};