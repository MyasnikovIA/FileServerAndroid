// ============================================================
// Скачивание выделенного одним ZIP-архивом.
// ============================================================
//
// Свой инстанс прогресса.

FAR.downloadSelectedAsZip = async function () {
    if (!FAR.ensureDb()) return;

    const side = FAR.activePanel;
    const ctx = FAR.side[side];
    if (!ctx || !ctx.db) { FAR.toast('Панель не подключена', 'warning'); return; }

    const selected = FAR.getSelectedItemsFromActivePanel();
    if (selected.length === 0) { FAR.toast('Ничего не выбрано', 'warning'); return; }

    // 1. Собираем список файлов для архива
    const toZip = [];

    for (const sel of selected) {
        const item = sel.item;

        if (item.isFolder) {
            const srcFolderPath = FAR.normPath(item.path);
            const folderName = FAR.sanitizeFileName(item.name || srcFolderPath.split('/').pop());

            try {
                const children = await FAR.listRecursiveFromSide(side, srcFolderPath);
                const prefix = srcFolderPath + '/';
                for (const c of children) {
                    if (c.isFolder || c.docType === 'folder') continue;
                    const rel = FAR.normPath(c.path).substring(prefix.length);
                    if (!rel) continue;
                    const zipPath = folderName + '/' +
                        rel.split('/').map(FAR.sanitizeFileName).join('/');
                    toZip.push({ zipPath: zipPath, item: c });
                }
            } catch (e) {
                FAR.toast('Ошибка обхода ' + item.path + ': ' + e.message, 'error');
            }
        } else {
            toZip.push({ zipPath: FAR.sanitizeFileName(item.name), item: item });
        }
    }

    if (toZip.length === 0) { FAR.toast('Нет файлов для архивации', 'warning'); return; }

    const zipName = selected.length === 1 && selected[0].item.isFolder
        ? FAR.sanitizeFileName(selected[0].item.name) + '.zip'
        : 'files.zip';

    const prog = FAR.startProgress('🗜️', `Упаковка ${toZip.length} файлов в ${zipName}`, toZip.length, function () {});

    let ok = 0, err = 0;
    const zip = new JSZip();

    for (let i = 0; i < toZip.length; i++) {
        if (prog.state.cancelled) break;
        const zipPath = toZip[i].zipPath;
        const item = toZip[i].item;
        prog.update(i, toZip.length, zipPath, err);
        prog.log(`🗜️ + ${zipPath}`, 'info');
        try {
            const res = await FAR.readFileBodyFromSide(side, item);
            zip.file(zipPath, res.data, {
                binary: true,
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });
            ok++;
            prog.log(`✅ ${zipPath} (${FAR.formatSize(res.data.length)})`, 'ok');
        } catch (e) {
            err++;
            prog.log(`❌ ${zipPath}: ${e.message}`, 'err');
        }
        prog.update(i + 1, toZip.length, zipPath, err);
    }

    if (ok === 0) {
        prog.finish(err);
        prog.log(`━━━ Нечего сохранять`, 'err');
        FAR.setStatus('❌ Архив пуст');
        FAR.toast('Архив пуст', 'error');
        return;
    }

    prog.log(`📦 Генерация архива…`, 'info');
    prog.update(toZip.length, toZip.length, 'Генерация архива…', err);

    try {
        // Прогресс генерации zip - через тот же инстанс
        const blob = await zip.generateAsync(
            { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
            function(metadata) {
                const pct = Math.round(metadata.percent);
                prog.update(toZip.length, toZip.length, 'Генерация архива… ' + pct + '%', err);
            }
        );

        FAR.saveBlobAs(blob, zipName);
        prog.log(`✅ ${zipName} (${FAR.formatSize(blob.size)})`, 'ok');
        prog.log(`━━━ Готово: ${ok} файлов упаковано, ${err} ошибок`, ok > 0 ? 'ok' : 'err');

        prog.finish(err);
        FAR.setStatus(`✅ Архив ${zipName}: ${ok} файлов`);
        FAR.toast(`Архив ${zipName} сохранён`, 'success');
    } catch (e) {
        prog.log(`❌ Ошибка генерации архива: ${e.message}`, 'err');
        prog.finish(err + 1);
        FAR.setStatus('❌ Ошибка архива');
        FAR.toast('Ошибка генерации архива: ' + e.message, 'error');
    }
};