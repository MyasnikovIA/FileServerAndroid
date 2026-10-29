FAR.migrateLeadingSlashes = async function() {
    if (!FAR.ensureDb()) return;
    if (!confirm('Перезаписать документы с ведущим слэшем в path?\nЭто исправит старые «невидимые» файлы.')) return;

    FAR.showLoading('Миграция…', 'Поиск документов с ведущим слэшем');
    let fixed = 0, errors = 0, skipped = 0;

    try {
        const all = await FAR.db.allDocs({ include_docs: true, limit: 50000 });
        for (const row of all.rows) {
            const d = row.doc;
            if (!d || d._id.startsWith('_design/') || d._id.startsWith('_local/')) continue;
            if (d.type !== 'file' && d.type !== 'folder') continue;

            const rawPath = d.path || d.name || '';
            const fixedPath = FAR.normPath(rawPath);
            if (!fixedPath) { skipped++; continue; }
            if (fixedPath === rawPath && !d._id.startsWith('f:%2F') && !d._id.startsWith('d:%2F')) continue;

            try {
                const prefix = d.type === 'folder' ? 'd:' : 'f:';
                const newId = prefix + encodeURIComponent(fixedPath);
                if (newId === d._id) continue;

                let att = null, attType = null;
                if (d._attachments && d._attachments.b) {
                    try {
                        att = await FAR.db.getAttachment(d._id, 'b');
                        attType = d.contentType || 'application/octet-stream';
                    } catch (e) {}
                }

                try { const ex = await FAR.db.get(newId); await FAR.db.remove(ex); }
                catch (e) { if (e.status !== 404) throw e; }

                const nd = Object.assign({}, d, { _id: newId, path: fixedPath });
                delete nd._rev;
                delete nd._attachments;

                await FAR.db.put(nd);

                if (att) {
                    const fresh = await FAR.db.get(newId);
                    await FAR.db.putAttachment(newId, 'b', fresh._rev, att, attType);
                }

                await FAR.db.remove(d);
                fixed++;
                console.log('migrated:', rawPath, '→', fixedPath);
            } catch (e) {
                errors++;
                console.warn('migrate error:', d._id, e.message);
            }
        }

        FAR.hideLoading();
        FAR.toast(`Миграция: исправлено ${fixed}, пропущено ${skipped}, ошибок ${errors}`, fixed ? 'success' : 'warning');
        await FAR.loadFiles();
        FAR.renderPanel('left');
        FAR.renderPanel('right');
    } catch (e) {
        FAR.hideLoading();
        FAR.toast('Ошибка миграции: ' + e.message, 'error');
        console.error(e);
    }
};