// ============================================================
// 61-open-in-tab.js — открытие файла в новой вкладке браузера (обёртка)
// ============================================================
//
// Назначение:
//   Генерирует автономную HTML-страницу (обёртку) для выбранного файла
//   и открывает её в новой вкладке. В обёртке разворачивается нужный
//   просмотрщик/эмулятор со всеми необходимыми библиотеками.
//
// Если пользователь сохранит страницу (Ctrl+S) и откроет позже,
// она подгрузит библиотеки и сам файл по прямым URL (если сервер доступен).
//
// Используется из контекстного меню WM-режима:
//   «📂 Открыть как» → «📑 Открыть приложение в новом окне»
// (см. 46-wm-explorer.js → FAR.WM._showExplorerContextMenu).

FAR.OpenInTab = FAR.OpenInTab || {};

// ------------------------------------------------------------
// Вспомогательные функции
// ------------------------------------------------------------

/**
 * Возвращает базовый URL сервера для данной панели.
 */
FAR.OpenInTab._getBaseUrl = function (side) {
    const ctx = FAR.side && FAR.side[side];
    if (!ctx || !ctx.db) return null;
    return String(ctx.db.baseUrl || '').replace(/\/+$/, '');
};

/**
 * Строит прямой URL к файлу.
 *
 * ВАЖНО: мы ВСЕГДА добавляем ?token=..., потому что при открытии
 * из blob: или file: браузер не передаёт cookie, и сервер вернёт 403.
 * Токен также нужен для работы ?token= в AuthService.
 */
FAR.OpenInTab.buildUrl = function (item, side) {
    if (!item || !item.path) return null;

    const baseUrl = FAR.OpenInTab._getBaseUrl(side);
    if (!baseUrl) return null;

    const ctx = FAR.side[side];
    const normPath = FAR.normPath(item.path);
    if (!normPath) return null;

    const encoded = normPath
        .split('/')
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');

    let url = baseUrl + '/' + encoded;

    // Всегда добавляем токен
    const token = (ctx && ctx.db && ctx.db.token) || FAR.authToken;
    if (token) {
        url += (url.includes('?') ? '&' : '?') +
            'token=' + encodeURIComponent(token);
    }

    return url;
};

// ------------------------------------------------------------
// Генераторы HTML-обёрток
// ------------------------------------------------------------

/**
 * Генерирует HTML-обёртку для эмулятора (EmulatorJS).
 */
FAR.OpenInTab._buildEmulatorHtml = function (fileUrl, fileName, core, baseUrl) {
    // Абсолютные пути к библиотекам EmulatorJS
    const pathToData = baseUrl + '/lib/js-emulator/';

    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Эмулятор: ${FAR.escapeHtml(fileName)}</title>
    <style>
        body, html { margin: 0; padding: 0; height: 100%; background: #1e1e2e; color: #cdd6f4; overflow: hidden; }
        #game-container { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
        .loader { display: flex; flex-direction: column; align-items: center; gap: 15px; }
        .spinner { width: 50px; height: 50px; border: 4px solid #313244; border-top-color: #89b4fa; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div id="game-container">
        <div class="loader" id="loading">
            <div class="spinner"></div>
            <div>Загрузка эмулятора...</div>
        </div>
    </div>
    
    <script>
        window.EJS_player = '#game-container';
        window.EJS_core = '${FAR.escapeHtml(core)}';
        window.EJS_gameUrl = '${FAR.escapeHtml(fileUrl)}';
        window.EJS_gameName = '${FAR.escapeHtml(fileName)}';
        window.EJS_pathtodata = '${pathToData}';
        window.EJS_color = '#89b4fa';
        window.EJS_startOnLoaded = true;
    </script>
    <script src="${pathToData}loader.js"></script>
</body>
</html>`;
};

/**
 * Генерирует HTML-обёртку для видео (HTML5 Video).
 */
FAR.OpenInTab._buildVideoHtml = function (fileUrl, fileName) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Видео: ${FAR.escapeHtml(fileName)}</title>
    <style>
        body, html { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
        video { width: 100%; height: 100%; object-fit: contain; outline: none; }
    </style>
</head>
<body>
    <video src="${FAR.escapeHtml(fileUrl)}" controls autoplay playsinline></video>
</body>
</html>`;
};

/**
 * Генерирует HTML-обёртку для аудио (HTML5 Audio).
 */
FAR.OpenInTab._buildAudioHtml = function (fileUrl, fileName) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Аудио: ${FAR.escapeHtml(fileName)}</title>
    <style>
        body, html { margin: 0; padding: 0; height: 100%; background: #1e1e2e; color: #cdd6f4; display: flex; align-items: center; justify-content: center; font-family: sans-serif; }
        .container { text-align: center; background: #313244; padding: 40px; border-radius: 10px; border: 1px solid #45475a; }
        h2 { margin-top: 0; font-size: 18px; word-break: break-all; }
        audio { width: 100%; min-width: 300px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h2>${FAR.escapeHtml(fileName)}</h2>
        <audio src="${FAR.escapeHtml(fileUrl)}" controls autoplay></audio>
    </div>
</body>
</html>`;
};

/**
 * Генерирует HTML-обёртку для изображения.
 */
FAR.OpenInTab._buildImageHtml = function (fileUrl, fileName) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Изображение: ${FAR.escapeHtml(fileName)}</title>
    <style>
        body, html { margin: 0; padding: 0; height: 100%; background: #1e1e2e; display: flex; align-items: center; justify-content: center; }
        img { max-width: 100%; max-height: 100%; object-fit: contain; }
    </style>
</head>
<body>
    <img src="${FAR.escapeHtml(fileUrl)}" alt="${FAR.escapeHtml(fileName)}">
</body>
</html>`;
};

/**
 * Генерирует HTML-обёртку для PDF.
 */
FAR.OpenInTab._buildPdfHtml = function (fileUrl, fileName) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>PDF: ${FAR.escapeHtml(fileName)}</title>
    <style>
        body, html { margin: 0; padding: 0; height: 100%; background: #333; }
        embed { width: 100%; height: 100%; }
    </style>
</head>
<body>
    <embed src="${FAR.escapeHtml(fileUrl)}" type="application/pdf" width="100%" height="100%">
</body>
</html>`;
};

/**
 * Генерирует HTML-обёртку для текстового файла.
 */
FAR.OpenInTab._buildTextHtml = function (fileUrl, fileName) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Текст: ${FAR.escapeHtml(fileName)}</title>
    <style>
        body { margin: 0; padding: 20px; background: #1e1e2e; color: #cdd6f4; font-family: monospace; font-size: 14px; }
        pre { white-space: pre-wrap; word-wrap: break-word; background: #181825; padding: 15px; border-radius: 5px; border: 1px solid #313244; }
        .header { margin-bottom: 10px; color: #89b4fa; font-family: sans-serif; font-weight: bold; }
    </style>
</head>
<body>
    <div class="header">${FAR.escapeHtml(fileName)}</div>
    <pre id="content">Загрузка...</pre>
    <script>
        fetch('${FAR.escapeHtml(fileUrl)}')
            .then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .then(t => {
                document.getElementById('content').textContent = t;
            })
            .catch(e => {
                document.getElementById('content').textContent = 'Ошибка загрузки: ' + e.message;
            });
    </script>
</body>
</html>`;
};

/**
 * Генерирует HTML-обёртку для панорамы.
 */
FAR.OpenInTab._buildPanoramaHtml = function (fileUrl, fileName, baseUrl) {
    const pannellumCss = baseUrl + '/lib/Pannellum2_5_6/pannellum.css';
    const pannellumJs = baseUrl + '/lib/Pannellum2_5_6/pannellum.js';
    const libpannellumJs = baseUrl + '/lib/Pannellum2_5_6/libpannellum.js';

    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Панорама: ${FAR.escapeHtml(fileName)}</title>
    <link rel="stylesheet" href="${pannellumCss}">
    <style>
        body, html { margin: 0; padding: 0; height: 100%; background: #000; }
        #panorama { width: 100%; height: 100%; }
    </style>
</head>
<body>
    <div id="panorama"></div>
    
    <script src="${pannellumJs}"></script>
    <script src="${libpannellumJs}"></script>
    <script>
        pannellum.viewer('panorama', {
            type: 'equirectangular',
            panorama: '${FAR.escapeHtml(fileUrl)}',
            autoLoad: true,
            autoRotate: false,
            showControls: true,
            crossOrigin: 'anonymous'
        });
    </script>
</body>
</html>`;
};

/**
 * Генерирует HTML-обёртку для JSDOS.
 */
FAR.OpenInTab._buildJsdosHtml = function (fileUrl, fileName, baseUrl) {
    const jsdosJs = baseUrl + '/lib/js-dos/js-dos.js';
    const pathPrefix = baseUrl + '/lib/js-dos/';

    return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><title>${FAR.escapeHtml(fileName)}</title>
<style>body,html{margin:0;padding:0;height:100%;background:#000;}</style>
</head><body>
<div id="dos" style="width:100%;height:100%;"></div>
<script src="${jsdosJs}"></script>
<script>
  window.emulators = { pathPrefix: '${pathPrefix}' };
  window.Dos(document.getElementById('dos'), { wdosboxUrl: '${pathPrefix}wdosbox.js', pathPrefix: '${pathPrefix}' }).run('${FAR.escapeHtml(fileUrl)}');
</script>
</body></html>`;
};

/**
 * Генерирует HTML-обёртку для G-code.
 */
FAR.OpenInTab._buildGcodeHtml = function (fileUrl, fileName) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>G-code: ${FAR.escapeHtml(fileName)}</title>
    <style>
        body, html { margin: 0; padding: 0; height: 100%; background: #1e1e2e; color: #cdd6f4; font-family: sans-serif; overflow: hidden; }
        #viewport { width: 100%; height: 100%; }
    </style>
</head>
<body>
    <div id="viewport">Загрузка G-code...</div>
    <script>
        // Упрощённый парсер G-code для генерации SVG (копия логики из 59-gcode-viewer.js)
        fetch('${FAR.escapeHtml(fileUrl)}').then(r => r.text()).then(text => {
            let currX = 0, currY = 0, isAbs = true;
            let travel = "", cut = "";
            let minX = 0, minY = 0, maxX = 0, maxY = 0;
            text.split(/\\r?\\n/).forEach(line => {
                line = line.replace(/;.*$/, '').trim();
                if (!line) return;
                if (/G90\\b/.test(line)) isAbs = true;
                if (/G91\\b/.test(line)) isAbs = false;
                const matchG = line.match(/G0?([01])\\b/);
                if (matchG) {
                    const isRapid = matchG[1] === '0';
                    const xm = line.match(/X(-?\\d*\\.?\\d+)/);
                    const ym = line.match(/Y(-?\\d*\\.?\\d+)/);
                    let nx = xm ? parseFloat(xm[1]) : currX;
                    let ny = ym ? parseFloat(ym[1]) : currY;
                    if (!isAbs) { nx += currX; ny += currY; }
                    
                    const svgY1 = -currY;
                    const svgY2 = -ny;
                    
                    if (nx < minX) minX = nx;
                    if (ny < minY) minY = ny;
                    if (nx > maxX) maxX = nx;
                    if (ny > maxY) maxY = ny;
                    
                    if (isRapid) travel += \`M\${currX},\${svgY1} L\${nx},\${svgY2} \`;
                    else cut += \`M\${currX},\${svgY1} L\${nx},\${svgY2} \`;
                    
                    currX = nx; currY = ny;
                }
            });
            
            const pad = 10;
            const w = (maxX - minX) + pad * 2;
            const h = (maxY - minY) + pad * 2;
            const ox = -minX + pad;
            const oy = -minY + pad;
            
            const svg = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \${w} \${h}" width="100%" height="100%">
                <rect width="100%" height="100%" fill="#ffffff" />
                <g transform="translate(\${ox}, \${oy})" fill="none">
                    <path d="\${travel}" stroke="#888" stroke-width="0.5" stroke-dasharray="2 2" />
                    <path d="\${cut}" stroke="#4a8cff" stroke-width="1" />
                </g>
            </svg>\`;
            
            document.getElementById('viewport').innerHTML = svg;
        }).catch(e => {
            document.getElementById('viewport').innerText = 'Ошибка загрузки: ' + e.message;
        });
    </script>
</body>
</html>`;
};

// ------------------------------------------------------------
// Публичное API
// ------------------------------------------------------------

/**
 * Открывает файл в новой вкладке браузера в виде специализированной HTML-обёртки.
 *
 * @param {Object} item  — элемент файлового списка.
 * @param {string} [side] — 'left' | 'right', по умолчанию FAR.activePanel
 * @returns {boolean} true, если окно/вкладка были открыты
 */
FAR.OpenInTab.open = function (item, side) {
    if (!item || item.isFolder) {
        FAR.toast('Выберите файл (не папку)', 'warning');
        return false;
    }

    side = side || FAR.activePanel;

    const fileUrl = FAR.OpenInTab.buildUrl(item, side);
    const baseUrl = FAR.OpenInTab._getBaseUrl(side);

    if (!fileUrl || !baseUrl) {
        FAR.toast('Не удалось построить URL файла', 'warning');
        return false;
    }

    const fileName = item.name || FAR.normPath(item.path).split('/').pop();
    let html = '';

    // Маршрутизация по типу файла
    if (typeof FAR.isEmulatorFile === 'function' && FAR.isEmulatorFile(item)) {
        const core = FAR._getEmulatorCore(item);
        html = FAR.OpenInTab._buildEmulatorHtml(fileUrl, fileName, core, baseUrl);
    } else if (typeof FAR.isJsdos === 'function' && FAR.isJsdos(item)) {
        html = FAR.OpenInTab._buildJsdosHtml(fileUrl, fileName, baseUrl);
    } else if (typeof FAR.isVideo === 'function' && FAR.isVideo(item)) {
        html = FAR.OpenInTab._buildVideoHtml(fileUrl, fileName);
    } else if (typeof FAR.isMp3 === 'function' && FAR.isMp3(item)) {
        html = FAR.OpenInTab._buildAudioHtml(fileUrl, fileName);
    } else if (typeof FAR.isPdf === 'function' && FAR.isPdf(item)) {
        html = FAR.OpenInTab._buildPdfHtml(fileUrl, fileName);
    } else if (typeof FAR.isGcode === 'function' && FAR.isGcode(item)) {
        html = FAR.OpenInTab._buildGcodeHtml(fileUrl, fileName);
    } else if (typeof FAR.isPanorama === 'function') {
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
            html = FAR.OpenInTab._buildPanoramaHtml(fileUrl, fileName, baseUrl);
        } else {
            html = FAR.OpenInTab._buildImageHtml(fileUrl, fileName);
        }
    } else if (typeof FAR.isTextFile === 'function' && FAR.isTextFile(item)) {
        html = FAR.OpenInTab._buildTextHtml(fileUrl, fileName);
    } else {
        // По умолчанию — открываем как файл (браузер сам разберётся)
        html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${FAR.escapeHtml(fileName)}</title></head>
<body style="background:#1e1e2e;color:#cdd6f4;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;">
    <h3>${FAR.escapeHtml(fileName)}</h3>
    <p>Этот тип файлов не имеет встроенного просмотрщика.</p>
    <a href="${FAR.escapeHtml(fileUrl)}" download style="padding:10px 20px;background:#89b4fa;color:#1e1e2e;text-decoration:none;border-radius:5px;font-weight:bold;margin-top:20px;">Скачать файл</a>
</body></html>`;
    }

    // Создаём Blob и открываем
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    // noopener — не даём новой вкладке доступ к window.opener
    const win = window.open(blobUrl, '_blank', 'noopener');
    if (!win) {
        FAR.toast('Браузер заблокировал новое окно', 'warning');
        URL.revokeObjectURL(blobUrl);
        return false;
    }

    // Отзываем URL через минуту (даём время браузеру загрузить)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

    return true;
};

// ------------------------------------------------------------
// Удобная глобальная обёртка (на случай внешних вызовов)
// ------------------------------------------------------------

FAR.openInNewTab = function (item, side) {
    return FAR.OpenInTab.open(item, side);
};