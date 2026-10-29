FAR.showDebug = async function() {
    if (!FAR.ensureDb()) return;
    const el = document.getElementById('debugInfo');
    el.classList.toggle('active');
    if (!el.classList.contains('active')) return;

    el.textContent = 'Загрузка…';
    try {
        const all = await FAR.db.allDocs({ include_docs: true, limit: 200 });
        let out = '';

        const counts = {};
        all.rows.forEach(function(r) {
            const t = (r.doc && r.doc.type) || 'unknown';
            counts[t] = (counts[t] || 0) + 1;
        });
        out += '=== СВОДКА ПО ТИПАМ ===\n';
        for (const [t, n] of Object.entries(counts)) out += `  ${t}: ${n}\n`;

        out += '\n=== ПЕРВЫЕ 30 ФАЙЛОВ (path) ===\n';
        let shown = 0;
        for (const r of all.rows) {
            const d = r.doc;
            if (!d) continue;
            if (d.type === 'file') {
                out += `  _id = ${d._id}\n      path="${d.path || '(нет)'}" size=${d.size || 0}\n`;
                if (++shown >= 30) break;
            }
        }

        out += '\n=== ПЕРВЫЕ 10 ПАПОК (path) ===\n';
        shown = 0;
        for (const r of all.rows) {
            const d = r.doc;
            if (!d) continue;
            if (d.type === 'folder') {
                out += `  _id = ${d._id}\n      path="${d.path || '(нет)'}"\n`;
                if (++shown >= 10) break;
            }
        }

        el.textContent = out;
        console.log('=== DEBUG ===');
        console.log(out);
    } catch (e) {
        el.textContent = 'Ошибка: ' + e.message;
    }
};