/*
 * Pannellum - An HTML5 based Panorama Viewer (Optimized)
 * Copyright (c) 2011-2019 Matthew Petroff
 *
 * Оптимизированная версия с сохранением всей функциональности
 */

/**
 * Получение данных JSON через синхронный XHR
 */
function getJsonUrlData(url, data) {
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, false);
        xhr.send(data);

        if (xhr.status !== 200) {
            console.warn('JSON not found:', url, 'Status:', xhr.status);
            return { error: xhr.status + ' : ' + xhr.statusText };
        }

        try {
            var result = JSON.parse(xhr.response);
            return result;
        } catch (parseError) {
            console.warn('Invalid JSON response from:', url);
            return { error: 'Invalid JSON' };
        }
    } catch (e) {
        console.warn('Request failed:', url, e.message);
        return { error: e.message };
    }
}

/**
 * Копирование текста в буфер обмена
 */
function copyTextToСlipboard(text) {
    const inputArea = document.createElement('textarea');
    inputArea.value = text;
    inputArea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
    document.body.appendChild(inputArea);
    inputArea.select();

    try {
        document.execCommand('copy');
    } catch (err) {
        console.error('Ошибка копирования:', err);
    }

    document.body.removeChild(inputArea);
}

/**
 * Основной класс просмотрщика панорам
 */
window.pannellum = (function(window, document) {
    'use strict';

    function Viewer(container, initialConfig) {
        const _this = this;

        // === СОСТОЯНИЕ ===
        let config,
            renderer,
            preview,
            isUserInteracting = false,
            latestInteraction = Date.now(),
            onPointerDownPointerX = 0,
            onPointerDownPointerY = 0,
            onPointerDownPointerDist = -1,
            onPointerDownYaw = 0,
            onPointerDownPitch = 0,
            keysDown = new Array(10).fill(false),
            fullscreenActive = false,
            loaded,
            error = false,
            listenersAdded = false,
            panoImage,
            prevTime,
            speed = { yaw: 0, pitch: 0, hfov: 0 },
            animating = false,
            orientation = false,
            orientationYawOffset = 0,
            autoRotateStart,
            autoRotateSpeed = 0,
            origHfov,
            origPitch,
            animatedMove = {},
            externalEventListeners = {},
            specifiedPhotoSphereExcludes = [],
            update = false,
            hotspotsCreated = false,
            destroyed = false,
            lastClick = null,
            lastSceneId = null;

        // === КОНСТАНТЫ ===
        const EPS = 1e-6;
        const DEG_TO_RAD = Math.PI / 180;
        const RAD_TO_DEG = 180 / Math.PI;

        // === КОНФИГУРАЦИЯ ПО УМОЛЧАНИЮ ===
        const defaultConfig = {
            hfov: 100,
            minHfov: 50,
            multiResMinHfov: false,
            maxHfov: 120,
            pitch: 0,
            minPitch: undefined,
            maxPitch: undefined,
            yaw: 0,
            minYaw: -180,
            maxYaw: 180,
            roll: 0,
            haov: 360,
            vaov: 180,
            vOffset: 0,
            autoRotate: false,
            autoRotateInactivityDelay: -1,
            autoRotateStopDelay: undefined,
            type: 'equirectangular',
            northOffset: 0,
            showFullscreenCtrl: true,
            dynamic: false,
            dynamicUpdate: false,
            doubleClickZoom: true,
            keyboardZoom: true,
            mouseZoom: true,
            showZoomCtrl: true,
            autoLoad: false,
            showControls: true,
            orientationOnByDefault: false,
            hotSpotDebug: false,
            hotPointDebug: false,
            backgroundColor: [0, 0, 0],
            avoidShowingBackground: false,
            animationTimingFunction: timingFunction,
            draggable: true,
            disableKeyboardCtrl: false,
            crossOrigin: 'anonymous',
            touchPanSpeedCoeffFactor: 1,
            capturedKeyNumbers: [16, 17, 27, 37, 38, 39, 40, 61, 65, 68, 83, 87, 107, 109, 173, 187, 189],
            friction: 0.15,
            camYaw: 0,
            strings: {
                loadButtonLabel: 'Click to<br>Load<br>Panorama',
                loadingLabel: 'Загрузка...',
                bylineLabel: 'от %s',
                noPanoramaError: 'Не указано панорамное изображение.',
                fileAccessError: 'Не удалось получить доступ к файлу %s.',
                malformedURLError: 'Что-то не так с URL-адресом панорамы.',
                iOS8WebGLError: "Из-за некорректной реализации WebGL в iOS 8 на вашем устройстве работают только файлы JPEG с прогрессивной кодировкой.",
                genericWebGLError: 'Ваш браузер не имеет необходимой поддержки WebGL.',
                textureSizeError: 'Эта панорама слишком велика для вашего устройства! Ширина %spx, поддерживается до %spx.',
                unknownError: 'Неизвестная ошибка. Проверьте консоль разработчика.'
            }
        };

        // === ИНИЦИАЛИЗАЦИЯ КОНТЕЙНЕРА ===
        container = typeof container === 'string' ? document.getElementById(container) : container;
        container.classList.add('pnlm-container');
        container.tabIndex = 0;

        // === СОЗДАНИЕ UI ===
        const uiContainer = document.createElement('div');
        uiContainer.className = 'pnlm-ui';
        container.appendChild(uiContainer);

        const renderContainer = document.createElement('div');
        renderContainer.className = 'pnlm-render-container';
        container.appendChild(renderContainer);

        const dragFix = document.createElement('div');
        dragFix.className = 'pnlm-dragfix';
        uiContainer.appendChild(dragFix);

        // Информация о Pannellum
        const aboutMsg = document.createElement('span');
        aboutMsg.className = 'pnlm-about-msg';
        aboutMsg.innerHTML = '<a href="https://pannellum.org/" target="_blank">Pannellum</a>';
        uiContainer.appendChild(aboutMsg);

        // Индикатор отладки
        const hotSpotDebugIndicator = document.createElement('div');
        hotSpotDebugIndicator.className = 'pnlm-sprite pnlm-hot-spot-debug-indicator';
        uiContainer.appendChild(hotSpotDebugIndicator);

        // Информация о панораме
        const infoDisplay = {};
        infoDisplay.container = document.createElement('div');
        infoDisplay.container.className = 'pnlm-panorama-info';
        infoDisplay.title = document.createElement('div');
        infoDisplay.title.className = 'pnlm-title-box';
        infoDisplay.container.appendChild(infoDisplay.title);
        infoDisplay.author = document.createElement('div');
        infoDisplay.author.className = 'pnlm-author-box';
        infoDisplay.container.appendChild(infoDisplay.author);
        uiContainer.appendChild(infoDisplay.container);

        // Загрузочный контейнер
        infoDisplay.load = {};
        const loadBox = document.createElement('div');
        loadBox.className = 'pnlm-load-box';
        const loadBoxp = document.createElement('p');
        loadBox.appendChild(loadBoxp);
        const loadLbox = document.createElement('div');
        loadLbox.className = 'pnlm-lbox';
        loadLbox.innerHTML = '<div class="pnlm-loading"></div>';
        loadBox.appendChild(loadLbox);
        const loadLbar = document.createElement('div');
        loadLbar.className = 'pnlm-lbar';
        const loadLbarFill = document.createElement('div');
        loadLbarFill.className = 'pnlm-lbar-fill';
        loadLbar.appendChild(loadLbarFill);
        loadBox.appendChild(loadLbar);
        const loadMsg = document.createElement('p');
        loadMsg.className = 'pnlm-lmsg';
        loadBox.appendChild(loadMsg);
        uiContainer.appendChild(loadBox);

        infoDisplay.load.box = loadBox;
        infoDisplay.load.boxp = loadBoxp;
        infoDisplay.load.lbox = loadLbox;
        infoDisplay.load.lbar = loadLbar;
        infoDisplay.load.lbarFill = loadLbarFill;
        infoDisplay.load.msg = loadMsg;

        // Сообщение об ошибке
        infoDisplay.errorMsg = document.createElement('div');
        infoDisplay.errorMsg.className = 'pnlm-error-msg pnlm-info-box';
        uiContainer.appendChild(infoDisplay.errorMsg);

        // === ЭЛЕМЕНТЫ УПРАВЛЕНИЯ ===
        const controls = {};
        controls.container = document.createElement('div');
        controls.container.className = 'pnlm-controls-container';
        uiContainer.appendChild(controls.container);

        // Кнопка загрузки
        controls.load = document.createElement('div');
        controls.load.className = 'pnlm-load-button';
        controls.load.addEventListener('click', function() {
            processOptions();
            load();
        });
        uiContainer.appendChild(controls.load);

        // Масштаб
        controls.zoom = document.createElement('div');
        controls.zoom.className = 'pnlm-zoom-controls pnlm-controls';
        controls.zoomIn = document.createElement('div');
        controls.zoomIn.className = 'pnlm-zoom-in pnlm-sprite pnlm-control';
        controls.zoomIn.addEventListener('click', zoomIn);
        controls.zoom.appendChild(controls.zoomIn);
        controls.zoomOut = document.createElement('div');
        controls.zoomOut.className = 'pnlm-zoom-out pnlm-sprite pnlm-control';
        controls.zoomOut.addEventListener('click', zoomOut);
        controls.zoom.appendChild(controls.zoomOut);
        controls.container.appendChild(controls.zoom);

        // Полноэкранный режим
        controls.fullscreen = document.createElement('div');
        controls.fullscreen.addEventListener('click', toggleFullscreen);
        controls.fullscreen.className = 'pnlm-fullscreen-toggle-button pnlm-sprite pnlm-fullscreen-toggle-button-inactive pnlm-controls pnlm-control';
        if (document.fullscreenEnabled || document.mozFullScreenEnabled ||
            document.webkitFullscreenEnabled || document.msFullscreenEnabled) {
            controls.container.appendChild(controls.fullscreen);
        }

        // Карта
        controls.maps = document.createElement('div');
        controls.maps.style.cssText = 'width:26px;height:26px;';
        controls.maps.className = 'pnlm-controls pnlm-control';
        if (document.fullscreenEnabled || document.mozFullScreenEnabled ||
            document.webkitFullscreenEnabled || document.msFullscreenEnabled) {
            controls.container.appendChild(controls.maps);
        }

        // Ориентация
        controls.orientation = document.createElement('div');
        controls.orientation.addEventListener('click', function(e) {
            orientation ? stopOrientation() : startOrientation();
        });
        controls.orientation.addEventListener('mousedown', e => e.stopPropagation());
        controls.orientation.addEventListener('touchstart', e => e.stopPropagation());
        controls.orientation.addEventListener('pointerdown', e => e.stopPropagation());
        controls.orientation.className = 'pnlm-orientation-button pnlm-orientation-button-inactive pnlm-sprite pnlm-controls pnlm-control';

        let orientationSupport = false;
        if (window.DeviceOrientationEvent && location.protocol === 'https:' &&
            navigator.userAgent.toLowerCase().indexOf('mobi') >= 0) {
            controls.container.appendChild(controls.orientation);
            orientationSupport = true;
        }

        // Компас
        const compass = document.createElement('div');
        compass.className = 'pnlm-compass pnlm-controls pnlm-control';
        uiContainer.appendChild(compass);

        // === ЗАГРУЗКА КОНФИГУРАЦИИ ===
        if (initialConfig.firstScene) {
            mergeConfig(initialConfig.firstScene);
        } else if (initialConfig.default && initialConfig.default.firstScene) {
            mergeConfig(initialConfig.default.firstScene);
        } else {
            mergeConfig(null);
        }
        processOptions(true);

        // === ОСНОВНЫЕ ФУНКЦИИ ===

        function mergeConfig(sceneId) {
            config = {};
            const photoSphereExcludes = ['haov', 'vaov', 'vOffset', 'northOffset', 'horizonPitch', 'horizonRoll'];
            specifiedPhotoSphereExcludes = [];

            // Копирование с обработкой вложенных объектов
            const deepMerge = (target, source) => {
                for (const key in source) {
                    if (source.hasOwnProperty(key)) {
                        if (key === 'strings' && typeof source[key] === 'object') {
                            target.strings = target.strings || {};
                            for (const s in source.strings) {
                                if (source.strings.hasOwnProperty(s)) {
                                    target.strings[s] = escapeHTML(source.strings[s]);
                                }
                            }
                        } else {
                            target[key] = source[key];
                            if (photoSphereExcludes.indexOf(key) >= 0) {
                                specifiedPhotoSphereExcludes.push(key);
                            }
                        }
                    }
                }
            };

            deepMerge(config, defaultConfig);
            if (initialConfig.default) deepMerge(config, initialConfig.default);
            if (sceneId && initialConfig.scenes && initialConfig.scenes[sceneId]) {
                const scene = initialConfig.scenes[sceneId];
                deepMerge(config, scene);
                config.scene = sceneId;
            }
            if (initialConfig) deepMerge(config, initialConfig);
        }

        function processOptions(isPreview = false) {
            // Предпросмотр
            if (isPreview && config.preview) {
                let p = config.preview;
                if (config.basePath && !absoluteURL(p)) p = config.basePath + p;
                preview = document.createElement('div');
                preview.className = 'pnlm-preview-img';
                preview.style.backgroundImage = `url('${sanitizeURLForCss(p)}')`;
                renderContainer.appendChild(preview);
            }

            // Заголовок и автор
            const title = config.title;
            const author = config.author;
            if (isPreview) {
                if (config.previewTitle) config.title = config.previewTitle;
                if (config.previewAuthor) config.author = config.previewAuthor;
            }

            infoDisplay.title.innerHTML = config.title ? escapeHTML(config.title) : '';
            infoDisplay.author.innerHTML = config.author ?
                config.strings.bylineLabel.replace('%s', escapeHTML(config.author)) : '';
            infoDisplay.container.style.display = (config.title || config.author) ? 'inline' : 'none';

            controls.load.innerHTML = `<p>${config.strings.loadButtonLabel}</p>`;
            infoDisplay.load.boxp.innerHTML = config.strings.loadingLabel;

            // Обработка опций
            for (const key in config) {
                if (config.hasOwnProperty(key)) {
                    switch(key) {
                        case 'hfov':
                            setHfov(Number(config[key]));
                            break;
                        case 'autoLoad':
                            if (config[key] === true && renderer === undefined) {
                                infoDisplay.load.box.style.display = 'inline';
                                controls.load.style.display = 'none';
                                init();
                            }
                            break;
                        case 'showZoomCtrl':
                            controls.zoom.style.display = (config[key] && config.showControls !== false) ? 'block' : 'none';
                            break;
                        case 'showFullscreenCtrl':
                            const hasFullscreen = 'fullscreen' in document || 'mozFullScreen' in document ||
                                'webkitIsFullScreen' in document || 'msFullscreenElement' in document;
                            controls.fullscreen.style.display = (config[key] && config.showControls !== false && hasFullscreen) ? 'block' : 'none';
                            break;
                        case 'hotSpotDebug':
                            hotSpotDebugIndicator.style.display = config[key] ? 'block' : 'none';
                            break;
                        case 'showControls':
                            if (!config[key]) {
                                controls.orientation.style.display = 'none';
                                controls.zoom.style.display = 'none';
                                controls.fullscreen.style.display = 'none';
                            }
                            break;
                        case 'orientationOnByDefault':
                            if (config[key]) startOrientation();
                            break;
                    }
                }
            }

            if (isPreview) {
                if (title) config.title = title;
                else delete config.title;
                if (author) config.author = author;
                else delete config.author;
            }
        }

        function init() {
            // Проверка IE 9
            const div = document.createElement('div');
            div.innerHTML = '<!--[if lte IE 9]><i></i><![endif]-->';
            if (div.getElementsByTagName('i').length === 1) {
                anError();
                return;
            }

            origHfov = config.hfov;
            origPitch = config.pitch;

            let i, p;

            if (config.type === 'cubemap') {
                panoImage = [];
                let itemsToLoad = 6;
                infoDisplay.load.lbox.style.display = 'block';
                infoDisplay.load.lbar.style.display = 'none';

                const onLoad = () => {
                    if (--itemsToLoad === 0) onImageLoad();
                };

                const onError = (e) => {
                    const a = document.createElement('a');
                    a.href = e.target.src;
                    a.textContent = a.href;
                    anError(config.strings.fileAccessError.replace('%s', a.outerHTML));
                };

                for (i = 0; i < 6; i++) {
                    p = config.cubeMap[i];
                    if (p === 'null') {
                        console.log('Will use background instead of missing cubemap face ' + i);
                        onLoad();
                        continue;
                    }
                    if (config.basePath && !absoluteURL(p)) p = config.basePath + p;
                    const img = new Image();
                    img.crossOrigin = config.crossOrigin;
                    img.onload = onLoad;
                    img.onerror = onError;
                    img.src = sanitizeURL(p);
                    panoImage[i] = img;
                }
            } else if (config.type === 'multires') {
                const c = JSON.parse(JSON.stringify(config.multiRes));
                if (config.basePath && config.multiRes.basePath &&
                    !/^(?:[a-z]+:)?\/\//i.test(config.multiRes.basePath)) {
                    c.basePath = config.basePath + config.multiRes.basePath;
                } else if (config.multiRes.basePath) {
                    c.basePath = config.multiRes.basePath;
                } else if (config.basePath) {
                    c.basePath = config.basePath;
                }
                panoImage = c;
                onImageLoad();
            } else {
                if (config.dynamic === true) {
                    panoImage = config.panorama;
                    if (config.dynamicUpdate === true) {
                        update = true;
                        onImageLoad();
                    }
                    return;
                }
                if (config.panorama === undefined) {
                    anError(config.strings.noPanoramaError);
                    return;
                }
                p = config.basePath ? config.basePath : '';
                p = absoluteURL(config.panorama) ? config.panorama : p + config.panorama;

                const img = new Image();
                panoImage = img;

                img.onload = function() {
                    window.URL.revokeObjectURL(this.src);
                    onImageLoad();
                };

                const xhr = new XMLHttpRequest();
                xhr.onloadend = function() {
                    if (xhr.status !== 200) {
                        const a = document.createElement('a');
                        a.href = p;
                        a.textContent = a.href;
                        anError(config.strings.fileAccessError.replace('%s', a.outerHTML));
                    }
                    const imgData = this.response;
                    parseGPanoXMP(imgData);
                    infoDisplay.load.msg.innerHTML = '';
                };

                xhr.onprogress = function(e) {
                    if (e.lengthComputable) {
                        const percent = (e.loaded / e.total * 100);
                        infoDisplay.load.lbarFill.style.width = percent + '%';
                        let unit, numerator, denominator;
                        if (e.total > 1e6) {
                            unit = 'MB';
                            numerator = (e.loaded / 1e6).toFixed(2);
                            denominator = (e.total / 1e6).toFixed(2);
                        } else if (e.total > 1e3) {
                            unit = 'kB';
                            numerator = (e.loaded / 1e3).toFixed(1);
                            denominator = (e.total / 1e3).toFixed(1);
                        } else {
                            unit = 'B';
                            numerator = e.loaded;
                            denominator = e.total;
                        }
                        infoDisplay.load.msg.innerHTML = `${numerator} / ${denominator} ${unit}`;
                    } else {
                        infoDisplay.load.lbox.style.display = 'block';
                        infoDisplay.load.lbar.style.display = 'none';
                    }
                };

                try {
                    xhr.open('GET', p, true);
                    xhr.responseType = 'blob';
                    xhr.setRequestHeader('Accept', 'image/*,*/*;q=0.9');
                    xhr.withCredentials = config.crossOrigin === 'use-credentials';
                    xhr.send();
                } catch (e) {
                    anError(config.strings.malformedURLError);
                }
            }

            if (config.draggable) uiContainer.classList.add('pnlm-grab');
            uiContainer.classList.remove('pnlm-grabbing');

            update = config.dynamicUpdate === true;
            if (config.dynamic && update) {
                panoImage = config.panorama;
                onImageLoad();
            }
        }

        function onImageLoad() {
            if (!renderer) {
                renderer = new window.libpannellum.renderer(renderContainer);
            }

            if (!listenersAdded) {
                listenersAdded = true;
                addEventListeners();
            }

            if (typeof config.onGetMapWindow !== 'undefined') {
                controls.maps.addEventListener('click', config.onGetMapWindow);
            } else {
                controls.maps.style.display = 'none';
            }

            renderInit();
            setHfov(config.hfov);
        }

        function addEventListeners() {
            dragFix.addEventListener('mousedown', onDocumentMouseDown, false);
            document.addEventListener('mousemove', onDocumentMouseMove, false);
            document.addEventListener('mouseup', onDocumentMouseUp, false);

            if (config.mouseZoom) {
                uiContainer.addEventListener('mousewheel', onDocumentMouseWheel, false);
                uiContainer.addEventListener('DOMMouseScroll', onDocumentMouseWheel, false);
            }

            if (config.doubleClickZoom) {
                dragFix.addEventListener('dblclick', onDocumentDoubleClick, false);
            }

            ['mozfullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange', 'fullscreenchange'].forEach(event => {
                container.addEventListener(event, onFullScreenChange, false);
            });

            window.addEventListener('resize', onDocumentResize, false);
            window.addEventListener('orientationchange', onDocumentResize, false);

            if (!config.disableKeyboardCtrl) {
                container.addEventListener('keydown', onDocumentKeyPress, false);
                container.addEventListener('keyup', onDocumentKeyUp, false);
                container.addEventListener('blur', clearKeys, false);
            }

            document.addEventListener('mouseleave', onDocumentMouseUp, false);

            const hasPointer = document.documentElement.style.pointerAction === '' &&
                document.documentElement.style.touchAction === '';

            if (hasPointer) {
                dragFix.addEventListener('pointerdown', onDocumentPointerDown, false);
                dragFix.addEventListener('pointermove', onDocumentPointerMove, false);
                dragFix.addEventListener('pointerup', onDocumentPointerUp, false);
                dragFix.addEventListener('pointerleave', onDocumentPointerUp, false);
            } else {
                dragFix.addEventListener('touchstart', onDocumentTouchStart, false);
                dragFix.addEventListener('touchmove', onDocumentTouchMove, false);
                dragFix.addEventListener('touchend', onDocumentTouchEnd, false);
            }

            // Контекстное меню - СОХРАНЯЕМ ВСЮ ЛОГИКУ
            dragFix.addEventListener('contextmenu', function(event) {
                event.preventDefault();
                if (!loaded) return;

                const coords = mouseEventToCoords(event);
                const pos = mousePosition(event);
                const clickedHotSpot = findHotSpotAtCoords(coords[1], coords[0]);

                if (clickedHotSpot && config.onContextMenuHotSpot) {
                    config.onContextMenuHotSpot(
                        { yaw: coords[1], pitch: coords[0] },
                        { x: pos.x, y: pos.y },
                        event, clickedHotSpot
                    );
                } else if (config.onContextMenu) {
                    config.onContextMenu(
                        { yaw: coords[1], pitch: coords[0] },
                        { x: pos.x, y: pos.y },
                        event
                    );
                }
                return false;
            }, false);

            if (window.navigator.pointerEnabled) {
                container.style.touchAction = 'none';
            }
        }

        /**
         * Test if URL is absolute or relative.
         * @private
         * @param {string} url - URL to test
         * @returns {boolean} True if absolute, else false
         */
        function absoluteURL(url) {
            if (!url) return false;
            // From http://stackoverflow.com/a/19709846
            return new RegExp('^(?:[a-z]+:)?//', 'i').test(url) || url[0] == '/' || url.slice(0, 5) == 'blob:';
        }

        function escapeHTML(s) {
            if (!initialConfig.escapeHTML) {
                return String(s).split('\n').join('<br>');
            }
            return String(s)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\//g, '&#x2f;')
                .split('\n').join('<br>');
        }

        function sanitizeURL(url, href) {
            try {
                const decoded = decodeURIComponent(unescape(url)).replace(/[^\w:]/g, '').toLowerCase();
                if (decoded.indexOf('javascript:') === 0 || decoded.indexOf('vbscript:') === 0) {
                    console.log('Script URL removed.');
                    return 'about:blank';
                }
                if (href && decoded.indexOf('data:') === 0) {
                    console.log('Data URI removed from link.');
                    return 'about:blank';
                }
                return url;
            } catch (e) {
                return 'about:blank';
            }
        }

        function sanitizeURLForCss(url) {
            return sanitizeURL(url).replace(/"/g, '%22').replace(/'/g, '%27');
        }

        function unescape(html) {
            return html.replace(/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig, function(_, n) {
                n = n.toLowerCase();
                if (n === 'colon') return ':';
                if (n.charAt(0) === '#') {
                    return n.charAt(1) === 'x'
                        ? String.fromCharCode(parseInt(n.substring(2), 16))
                        : String.fromCharCode(+n.substring(1));
                }
                return '';
            });
        }

        function timingFunction(t) {
            return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        }

        function mousePosition(event) {
            const bounds = container.getBoundingClientRect();
            return {
                x: (event.clientX || event.pageX) - bounds.left,
                y: (event.clientY || event.pageY) - bounds.top
            };
        }

        function mouseEventToCoords(event) {
            const pos = mousePosition(event);
            const canvas = renderer.getCanvas();
            const canvasWidth = canvas.clientWidth;
            const canvasHeight = canvas.clientHeight;

            const x = pos.x / canvasWidth * 2 - 1;
            const y = (1 - pos.y / canvasHeight * 2) * canvasHeight / canvasWidth;
            const focal = 1 / Math.tan(config.hfov * Math.PI / 360);
            const s = Math.sin(config.pitch * DEG_TO_RAD);
            const c = Math.cos(config.pitch * DEG_TO_RAD);
            const a = focal * c - y * s;
            const root = Math.sqrt(x * x + a * a);

            const pitch = Math.atan((y * c + focal * s) / root) * RAD_TO_DEG;
            let yaw = Math.atan2(x / root, a / root) * RAD_TO_DEG + config.yaw;

            if (yaw < -180) yaw += 360;
            if (yaw > 180) yaw -= 360;

            return [pitch, yaw];
        }

        function findHotSpotAtCoords(yaw, pitch) {
            if (!config.hotSpots || !loaded) return null;

            yaw = ((yaw + 180) % 360) - 180;
            const tolerance = 5;

            for (const hs of config.hotSpots) {
                let hsYaw = ((hs.yaw || 0) + 180) % 360 - 180;
                let yawDiff = Math.abs(yaw - hsYaw);
                if (yawDiff > 180) yawDiff = 360 - yawDiff;

                if (yawDiff <= tolerance && Math.abs(pitch - (hs.pitch || 0)) <= tolerance) {
                    return hs;
                }
            }
            return null;
        }

        function generateUniqueSceneId() {
            return `scene_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
        }

        function detectDevice() {
            const ua = navigator.userAgent.toLowerCase();
            return {
                isMobile: /iphone|ipod|android|blackberry|opera mini|opera mobi|skyfire|maemo|windows phone|palm|iemobile|symbian|fennec/i.test(ua),
                isTablet: /ipad|android(?!.*mobile)|tablet|playbook|silk/i.test(ua),
                isIOS: /iphone|ipad|ipod/.test(ua),
                isAndroid: /android/.test(ua),
                isTouchDevice: 'ontouchstart' in window || navigator.maxTouchPoints > 0
            };
        }

        // === УПРАВЛЕНИЕ КАМЕРОЙ ===

        function setHfov(hfov) {
            config.hfov = constrainHfov(hfov);
            fireEvent('zoomchange', config.hfov);
        }

        function constrainHfov(hfov) {
            let minHfov = config.minHfov;
            if (config.type === 'multires' && renderer && !config.multiResMinHfov) {
                minHfov = Math.min(minHfov, renderer.getCanvas().width / (config.multiRes.cubeResolution / 90 * 0.9));
            }
            if (minHfov > config.maxHfov) {
                console.log('HFOV bounds do not make sense (minHfov > maxHfov).');
                return config.hfov;
            }
            let newHfov = Math.min(Math.max(hfov, minHfov), config.maxHfov);
            if (config.avoidShowingBackground && renderer) {
                const canvas = renderer.getCanvas();
                newHfov = Math.min(newHfov,
                    Math.atan(Math.tan((config.maxPitch - config.minPitch) / 360 * Math.PI) /
                        canvas.height * canvas.width) * 360 / Math.PI
                );
            }
            return newHfov;
        }

        function zoomIn() {
            if (loaded) {
                setHfov(config.hfov - 5);
                animateInit();
            }
        }

        function zoomOut() {
            if (loaded) {
                setHfov(config.hfov + 5);
                animateInit();
            }
        }

        function stopAnimation() {
            animatedMove = {};
            autoRotateSpeed = config.autoRotate || autoRotateSpeed;
            config.autoRotate = false;
        }

        function animateInit() {
            if (animating) return;
            animating = true;
            animate();
        }

        function animateMove(axis) {
            const t = animatedMove[axis];
            const normTime = Math.min(1, Math.max((Date.now() - t.startTime) / 1000 / (t.duration / 1000), 0));
            const result = t.startPosition + config.animationTimingFunction(normTime) * (t.endPosition - t.startPosition);
            if ((t.endPosition > t.startPosition && result >= t.endPosition) ||
                (t.endPosition < t.startPosition && result <= t.endPosition) ||
                t.endPosition === t.startPosition) {
                config[axis] = t.endPosition;
                speed[axis] = 0;
                delete animatedMove[axis];
            } else {
                config[axis] = result;
            }
        }

        function animate() {
            if (destroyed) return;

            render();

            if (autoRotateStart) clearTimeout(autoRotateStart);

            const shouldAnimate = isUserInteracting || orientation === true ||
                keysDown.some(k => k) || config.autoRotate ||
                Object.keys(animatedMove).length > 0 ||
                Math.abs(speed.yaw) > 0.01 || Math.abs(speed.pitch) > 0.01 ||
                Math.abs(speed.hfov) > 0.01;

            if (shouldAnimate) {
                keyRepeat();
                if (config.autoRotateInactivityDelay >= 0 && autoRotateSpeed &&
                    Date.now() - latestInteraction > config.autoRotateInactivityDelay &&
                    !config.autoRotate) {
                    config.autoRotate = autoRotateSpeed;
                    _this.lookAt(origPitch, undefined, origHfov, 3000);
                }
                requestAnimationFrame(animate);
            } else if (renderer && (renderer.isLoading() || (config.dynamic === true && update))) {
                requestAnimationFrame(animate);
            } else {
                fireEvent('animatefinished', {
                    pitch: _this.getPitch(),
                    yaw: _this.getYaw(),
                    hfov: _this.getHfov()
                });
                animating = false;
                prevTime = undefined;

                const autoRotateStartTime = config.autoRotateInactivityDelay - (Date.now() - latestInteraction);
                if (autoRotateStartTime > 0) {
                    autoRotateStart = setTimeout(() => {
                        config.autoRotate = autoRotateSpeed;
                        _this.lookAt(origPitch, undefined, origHfov, 3000);
                        animateInit();
                    }, autoRotateStartTime);
                } else if (config.autoRotateInactivityDelay >= 0 && autoRotateSpeed) {
                    config.autoRotate = autoRotateSpeed;
                    _this.lookAt(origPitch, undefined, origHfov, 3000);
                    animateInit();
                }
            }
        }

        function keyRepeat() {
            if (!loaded) return;

            let isKeyDown = false;
            const prevPitch = config.pitch;
            const prevYaw = config.yaw;
            const prevZoom = config.hfov;

            const newTime = performance.now ? performance.now() : Date.now();
            if (prevTime === undefined) prevTime = newTime;

            let diff = (newTime - prevTime) * config.hfov / 1700;
            diff = Math.min(diff, 1.0);

            // Клавиши
            if (keysDown[0] && config.keyboardZoom) {
                setHfov(config.hfov + (speed.hfov * 0.8 + 0.5) * diff);
                isKeyDown = true;
            }
            if (keysDown[1] && config.keyboardZoom) {
                setHfov(config.hfov + (speed.hfov * 0.8 - 0.2) * diff);
                isKeyDown = true;
            }
            if (keysDown[2] || keysDown[6]) {
                config.pitch += (speed.pitch * 0.8 + 0.2) * diff;
                isKeyDown = true;
            }
            if (keysDown[3] || keysDown[7]) {
                config.pitch += (speed.pitch * 0.8 - 0.2) * diff;
                isKeyDown = true;
            }
            if (keysDown[4] || keysDown[8]) {
                config.yaw += (speed.yaw * 0.8 - 0.2) * diff;
                isKeyDown = true;
            }
            if (keysDown[5] || keysDown[9]) {
                config.yaw += (speed.yaw * 0.8 + 0.2) * diff;
                isKeyDown = true;
            }

            if (isKeyDown) latestInteraction = Date.now();

            // Автоповорот
            if (config.autoRotate && newTime - prevTime > 0.001) {
                const timeDiff = (newTime - prevTime) / 1000;
                const yawDiff = (speed.yaw / timeDiff * diff - config.autoRotate * 0.2) * timeDiff;
                config.yaw += (-config.autoRotate > 0 ? 1 : -1) *
                    Math.min(Math.abs(config.autoRotate * timeDiff), Math.abs(yawDiff));

                if (config.autoRotateStopDelay) {
                    config.autoRotateStopDelay -= newTime - prevTime;
                    if (config.autoRotateStopDelay <= 0) {
                        config.autoRotateStopDelay = false;
                        autoRotateSpeed = config.autoRotate;
                        config.autoRotate = 0;
                    }
                }
            }

            if (animatedMove.pitch) animateMove('pitch');
            if (animatedMove.yaw) animateMove('yaw');
            if (animatedMove.hfov) animateMove('hfov');

            // Инерция
            if (diff > 0 && !config.autoRotate) {
                const slowDownFactor = 1 - config.friction;

                if (!keysDown[4] && !keysDown[5] && !keysDown[8] && !keysDown[9] && !animatedMove.yaw) {
                    config.yaw += speed.yaw * diff * slowDownFactor;
                }
                if (!keysDown[2] && !keysDown[3] && !keysDown[6] && !keysDown[7] && !animatedMove.pitch) {
                    config.pitch += speed.pitch * diff * slowDownFactor;
                }
                if (!keysDown[0] && !keysDown[1] && !animatedMove.hfov) {
                    setHfov(config.hfov + speed.hfov * diff * slowDownFactor);
                }
            }

            prevTime = newTime;

            if (diff > 0) {
                speed.yaw = speed.yaw * 0.8 + (config.yaw - prevYaw) / diff * 0.2;
                speed.pitch = speed.pitch * 0.8 + (config.pitch - prevPitch) / diff * 0.2;
                speed.hfov = speed.hfov * 0.8 + (config.hfov - prevZoom) / diff * 0.2;

                const maxSpeed = config.autoRotate ? Math.abs(config.autoRotate) : 5;
                speed.yaw = Math.min(maxSpeed, Math.max(speed.yaw, -maxSpeed));
                speed.pitch = Math.min(maxSpeed, Math.max(speed.pitch, -maxSpeed));
                speed.hfov = Math.min(maxSpeed, Math.max(speed.hfov, -maxSpeed));
            }

            if (keysDown[0] && keysDown[1]) speed.hfov = 0;
            if ((keysDown[2] || keysDown[6]) && (keysDown[3] || keysDown[7])) speed.pitch = 0;
            if ((keysDown[4] || keysDown[8]) && (keysDown[5] || keysDown[9])) speed.yaw = 0;
        }

        function render() {
            if (!loaded) return;

            const canvas = renderer.getCanvas();
            let tmpyaw;

            if (config.autoRotate !== false) {
                if (config.yaw > 360) config.yaw -= 360;
                if (config.yaw < -360) config.yaw += 360;
            }
            tmpyaw = config.yaw;

            const yawRange = config.maxYaw - config.minYaw;
            if (yawRange < 360) {
                let minYaw = config.minYaw + config.hfov / 2;
                let maxYaw = config.maxYaw - config.hfov / 2;
                if (yawRange < config.hfov) {
                    minYaw = maxYaw = (minYaw + maxYaw) / 2;
                }
                config.yaw = Math.max(minYaw, Math.min(maxYaw, config.yaw));
            }

            if (config.autoRotate === false) {
                if (config.yaw > 360) config.yaw -= 360;
                if (config.yaw < -360) config.yaw += 360;
            }

            if (config.autoRotate !== false && tmpyaw !== config.yaw && prevTime !== undefined) {
                config.autoRotate *= -1;
            }

            const vfov = 2 * Math.atan(Math.tan(config.hfov / 180 * Math.PI * 0.5) /
                (canvas.width / canvas.height)) / Math.PI * 180;

            let minPitch = config.minPitch + vfov / 2;
            let maxPitch = config.maxPitch - vfov / 2;
            const pitchRange = config.maxPitch - config.minPitch;

            if (pitchRange < vfov) {
                minPitch = maxPitch = (minPitch + maxPitch) / 2;
            }
            if (isNaN(minPitch)) minPitch = -90;
            if (isNaN(maxPitch)) maxPitch = 90;

            config.pitch = Math.max(minPitch, Math.min(maxPitch, config.pitch));

            renderer.render(
                config.pitch * DEG_TO_RAD,
                config.yaw * DEG_TO_RAD,
                config.hfov * DEG_TO_RAD,
                { roll: config.roll * DEG_TO_RAD }
            );

            // Всегда перерисовываем хотспоты
            renderHotSpots();

            if (config.compass) {
                const angle = -config.yaw - config.northOffset;
                compass.style.transform = `rotate(${angle}deg)`;
                compass.style.webkitTransform = `rotate(${angle}deg)`;
            }
        }

        /**
         * Creates hot spot element for the current scene.
         * @private
         * @param {Object} hs - The configuration for the hotspot
         */
        function createHotSpot(hs) {
            // Make sure hot spot pitch and yaw are numbers
            hs.pitch = Number(hs.pitch) || 0;
            hs.yaw = Number(hs.yaw) || 0;

            hs.point_pitch = Number(hs.point_pitch) || 0;
            hs.point_yaw = Number(hs.point_yaw) || 0;

            var div = document.createElement('div');
            div.className = 'pnlm-hotspot-base';
            if (hs.cssClass)
                div.className += ' ' + hs.cssClass;
            else
                div.className += ' pnlm-hotspot pnlm-sprite pnlm-' + escapeHTML(hs.type);

            var span = document.createElement('span');
            if (hs.text)
                span.innerHTML = escapeHTML(hs.text);

            var a;
            if (hs.video) {
                var video = document.createElement('video'),
                    vidp = hs.video;
                if (config.basePath && !absoluteURL(vidp))
                    vidp = config.basePath + vidp;
                video.src = sanitizeURL(vidp);
                video.controls = true;
                video.style.width = hs.width + 'px';
                renderContainer.appendChild(div);
                span.appendChild(video);
            } else if (hs.image) {
                var imgp = hs.image;
                if (config.basePath && !absoluteURL(imgp))
                    imgp = config.basePath + imgp;
                a = document.createElement('a');
                a.href = sanitizeURL(hs.URL ? hs.URL : imgp, true);
                a.target = '_blank';
                span.appendChild(a);
                var image = document.createElement('img');
                image.src = sanitizeURL(imgp);
                image.style.width = hs.width + 'px';
                image.style.paddingTop = '5px';
                renderContainer.appendChild(div);
                a.appendChild(image);
                span.style.maxWidth = 'initial';
            } else if (hs.URL) {
                a = document.createElement('a');
                a.href = sanitizeURL(hs.URL, true);
                if (hs.attributes) {
                    for (var key in hs.attributes) {
                        a.setAttribute(key, hs.attributes[key]);
                    }
                } else {
                    a.target = '_blank';
                }
                renderContainer.appendChild(a);
                div.className += ' pnlm-pointer';
                span.className += ' pnlm-pointer';
                a.appendChild(div);
            } else {
                if (typeof hs.sceneId === 'undefined') {
                    hs['sceneId'] = generateUniqueSceneId();
                }

                // ===== ОСНОВНОЙ ОБРАБОТЧИК КЛИКА =====
                div.onclick = div.ontouchend = function() {
                    div.clicked = true;
                    var breakClickHotSpot = false;

                    if (config['onClickHotSpot']) {
                        if (config['onClickHotSpot'](hs)) return false;
                    }

                    // Если у точки указан URL для загрузки следующей сцены
                    // Если у точки указан URL для загрузки следующей сцены
                    if (hs.panorama_url && hs.panorama_url.length > 0) {
                        // Берем относительный путь из хотспота
                        var relativePath = hs.panorama_url;

                        // Определяем базовый путь (приоритет: hs.path -> config.basePath)
                        var basePath = hs.path || config.basePath || '';

                        // Если basePath не задан, пытаемся получить из URL параметра path
                        if (!basePath) {
                            var urlParams = new URLSearchParams(window.location.search);
                            var urlPath = urlParams.get('path');
                            if (urlPath) {
                                basePath = urlPath;
                            }
                        }

                        // Если все еще нет basePath, используем config.basePath
                        if (!basePath && config.basePath) {
                            basePath = config.basePath;
                        }

                        // Если relativePath уже содержит полный URL - извлекаем относительную часть
                        var cleanRelativePath = relativePath;
                        if (absoluteURL(relativePath)) {
                            if (basePath && relativePath.indexOf(basePath) === 0) {
                                cleanRelativePath = relativePath.substring(basePath.length);
                                cleanRelativePath = cleanRelativePath.replace(/^\/+/, '');
                            } else {
                                var lastSlash = relativePath.lastIndexOf('/');
                                if (lastSlash > 0) {
                                    cleanRelativePath = relativePath.substring(lastSlash + 1);
                                    var pathBefore = relativePath.substring(0, lastSlash);
                                    var lastPathSlash = pathBefore.lastIndexOf('/');
                                    if (lastPathSlash > 0) {
                                        var datePath = pathBefore.substring(lastPathSlash + 1);
                                        if (datePath.match(/\d{2}\.\d{2}\.\d{4}/)) {
                                            cleanRelativePath = datePath + '/' + cleanRelativePath;
                                        }
                                    }
                                }
                            }
                        }

                        // Формируем полный URL для загрузки панорамы
                        var fullImageUrl = cleanRelativePath;

                        if (absoluteURL(cleanRelativePath)) {
                            fullImageUrl = cleanRelativePath;
                        } else if (basePath) {
                            var cleanBase = basePath.replace(/\/+$/, '');
                            var cleanPath = cleanRelativePath.replace(/^\/+/, '');
                            fullImageUrl = cleanBase + '/' + cleanPath;
                            console.log('Combined path with separator:', fullImageUrl);
                        } else {
                            var currentUrl = window.location.href;
                            var lastSlashIndex = currentUrl.lastIndexOf('/');
                            var rootPath = currentUrl.substring(0, lastSlashIndex);
                            var cleanPath = cleanRelativePath.replace(/^\/+/, '');
                            fullImageUrl = rootPath + '/' + cleanPath;
                            console.log('Using root path:', fullImageUrl);
                        }

                        console.log('=== Hotspot Click ===');
                        console.log('Original relative path:', relativePath);
                        console.log('Cleaned relative path:', cleanRelativePath);
                        console.log('Base path:', basePath);
                        console.log('Full URL:', fullImageUrl);
                        console.log('Target pitch:', hs.point_pitch);
                        console.log('Target yaw:', hs.point_yaw);

                        // Уничтожаем старые хотспоты
                        destroyHotSpots();
                        config.hotSpots = [];
                        hotspotsCreated = false;

                        if (window.panoramaEditor && typeof window.panoramaEditor.clearHotspots === 'function') {
                            window.panoramaEditor.clearHotspots();
                        }

                        ['author', 'container', 'errorMsg', 'title'].forEach(function(key) {
                            if (infoDisplay[key]) {
                                infoDisplay[key].remove();
                                delete infoDisplay[key];
                            }
                        });

                        // Формируем JSON URL
                        var jsonUrl = fullImageUrl.replace(/\.[^/.]+$/, '') + '.json';
                        console.log('JSON URL:', jsonUrl);

                        // Проверяем, существует ли JSON файл с хотспотами
                        var jsonExists = false;
                        var jsonObj = null;
                        try {
                            jsonObj = getJsonUrlData(jsonUrl, null);
                            if (jsonObj && !jsonObj.error) {
                                if (jsonObj.hotSpots && Array.isArray(jsonObj.hotSpots) && jsonObj.hotSpots.length > 0) {
                                    jsonExists = true;
                                } else if (jsonObj.scenes && jsonObj.scenes.scene1 &&
                                    jsonObj.scenes.scene1.hotSpots &&
                                    Array.isArray(jsonObj.scenes.scene1.hotSpots) &&
                                    jsonObj.scenes.scene1.hotSpots.length > 0) {
                                    jsonExists = true;
                                }
                            }
                        } catch (e) {
                            console.log('JSON not found or error loading:', e);
                        }

                        // Если JSON существует и содержит хотспоты - загружаем через JSON
                        if (jsonExists && jsonObj) {
                            console.log('JSON loaded successfully with hotspots, using it');

                            // Преобразуем JSON в правильный формат для Pannellum
                            var pannellumConfig = {
                                hotSpotDebug: config.hotSpotDebug || false,
                                hotPointDebug: config.hotPointDebug || false,
                                sceneFadeDuration: config.sceneFadeDuration || 1000,
                                default: {
                                    firstScene: "scene1"
                                },
                                scenes: {
                                    scene1: {
                                        title: "",
                                        panorama: fullImageUrl,
                                        crossOrigin: config.crossOrigin || "anonymous",
                                        autoLoad: true,
                                        yaw: hs.point_yaw || 0,
                                        pitch: hs.point_pitch || 0,
                                        hotSpots: []
                                    }
                                }
                            };

                            // Если в JSON есть pitchCam и yawCam - используем их
                            if (jsonObj.pitchCam !== undefined) {
                                pannellumConfig.scenes.scene1.pitch = jsonObj.pitchCam;
                            }
                            if (jsonObj.yawCam !== undefined) {
                                pannellumConfig.scenes.scene1.yaw = jsonObj.yawCam;
                            }

                            // Преобразуем хотспоты из JSON в формат Pannellum
                            if (jsonObj.hotSpots && Array.isArray(jsonObj.hotSpots)) {
                                jsonObj.hotSpots.forEach(function(hsItem) {
                                    var hsFullUrl = hsItem.panorama_url || '';
                                    if (hsFullUrl && !absoluteURL(hsFullUrl) && basePath) {
                                        var cleanBase = basePath.replace(/\/+$/, '');
                                        var cleanPath = hsFullUrl.replace(/^\/+/, '');
                                        hsFullUrl = cleanBase + '/' + cleanPath;
                                    }
                                    pannellumConfig.scenes.scene1.hotSpots.push({
                                        pitch: hsItem.pitch || 0,
                                        yaw: hsItem.yaw || 0,
                                        type: hsItem.type || "scene",
                                        text: hsItem.text || "Точка перехода",
                                        sceneId: "scene1",
                                        panorama_url: hsFullUrl,
                                        point_pitch: hsItem.targetPitch || 0,
                                        point_yaw: hsItem.targetYaw || 0,
                                        targetHfov: hsItem.targetHfov || 100
                                    });
                                });
                            }

                            // Копируем обработчики
                            ['onDblClick', 'onClickHotSpot', 'onGetMapWindow', 'onContextMenu', 'onContextMenuHotSpot', 'onClick'].forEach(function(key) {
                                if (config[key]) {
                                    pannellumConfig[key] = config[key];
                                }
                            });

                            if (basePath && !pannellumConfig.basePath) {
                                pannellumConfig.basePath = basePath;
                            }

                            console.log('Creating new viewer with converted JSON config:', pannellumConfig);
                            var newViewer = window.pannellum.viewer('canvas', pannellumConfig);

                            if (window.panoramaEditor) {
                                window.panoramaEditor.sceneMain = newViewer;
                                window.panoramaEditor.currentScene = fullImageUrl;
                                window.panoramaEditor.currentHotspots = jsonObj.hotSpots || [];
                                window.panoramaEditor.loadHotspotsList();
                                console.log('Updated panoramaEditor.sceneMain reference with JSON hotspots');
                            }

                            return false;
                        }

                        // Если JSON не существует или не содержит хотспоты - загружаем панораму напрямую
                        console.log('JSON not found or no hotspots, creating new viewer with direct URL');

                        var newConfig = {
                            hotSpotDebug: config.hotSpotDebug || false,
                            hotPointDebug: config.hotPointDebug || false,
                            sceneFadeDuration: config.sceneFadeDuration || 1000,
                            default: {
                                firstScene: "scene1"
                            },
                            scenes: {
                                scene1: {
                                    title: "",
                                    panorama: fullImageUrl,
                                    crossOrigin: config.crossOrigin || "anonymous",
                                    autoLoad: true,
                                    yaw: hs.point_yaw || 0,
                                    pitch: hs.point_pitch || 0,
                                    hotSpots: []
                                }
                            }
                        };

                        if (config.onDblClick) newConfig.onDblClick = config.onDblClick;
                        if (config.onClick) newConfig.onClick = config.onClick;
                        if (config.onClickHotSpot) newConfig.onClickHotSpot = config.onClickHotSpot;
                        if (config.onContextMenu) newConfig.onContextMenu = config.onContextMenu;
                        if (config.onContextMenuHotSpot) newConfig.onContextMenuHotSpot = config.onContextMenuHotSpot;
                        if (config.onGetMapWindow) newConfig.onGetMapWindow = config.onGetMapWindow;

                        console.log('Creating new viewer with direct config:', newConfig);

                        if (window.panoramaEditor && window.panoramaEditor.sceneMain) {
                            window.panoramaEditor.sceneMain.destroy();
                            window.panoramaEditor.sceneMain = null;
                        }

                        var newViewer = window.pannellum.viewer('canvas', newConfig);

                        if (window.panoramaEditor) {
                            window.panoramaEditor.sceneMain = newViewer;
                            window.panoramaEditor.currentScene = fullImageUrl;
                            window.panoramaEditor.currentHotspots = [];
                            window.panoramaEditor.loadHotspotsList();
                            console.log('Updated panoramaEditor.sceneMain reference');
                        }

                        return false;
                    } else {
                        loadScene(hs.sceneId, hs.point_pitch, hs.point_yaw, hs.targetHfov);
                        lastSceneId = hs.sceneId;
                    }
                    return false;
                };
                div.className += ' pnlm-pointer';
                span.className += ' pnlm-pointer';
                renderContainer.appendChild(div);
            }

            if (hs.createTooltipFunc) {
                hs.createTooltipFunc(div, hs.createTooltipArgs);
            } else if (hs.text || hs.video || hs.image) {
                div.classList.add('pnlm-tooltip');
                div.appendChild(span);
                span.style.width = span.scrollWidth - 20 + 'px';
                span.style.marginLeft = -(span.scrollWidth - div.offsetWidth) / 2 + 'px';
                span.style.marginTop = -span.scrollHeight - 12 + 'px';
            }
            if (hs.clickHandlerFunc) {
                div.addEventListener('click', function(e) {
                    hs.clickHandlerFunc(e, hs.clickHandlerArgs);
                }, 'false');
                div.className += ' pnlm-pointer';
                span.className += ' pnlm-pointer';
            }
            hs.div = div;
        }

        function createHotSpots() {
            // Всегда пересоздаем хотспоты, если они есть в конфиге

            // Сначала удаляем старые DOM элементы
            if (config.hotSpots && config.hotSpots.length > 0) {
                config.hotSpots.forEach(function(hs) {
                    if (hs.div && hs.div.parentNode) {
                        // Удаляем элемент со всеми родительскими обертками
                        var el = hs.div;
                        while (el && el.parentNode && el.parentNode !== renderContainer) {
                            el = el.parentNode;
                        }
                        if (el && el.parentNode) {
                            el.parentNode.removeChild(el);
                        }
                        delete hs.div;
                    }
                });
            }

            if (!config.hotSpots) {
                config.hotSpots = [];
            }

            // Сортируем и создаем заново
            config.hotSpots.sort((a, b) => a.pitch - b.pitch);
            config.hotSpots.forEach(function(hs) {
                // Убеждаемся что у хотспота есть все необходимые поля
                hs.pitch = Number(hs.pitch) || 0;
                hs.yaw = Number(hs.yaw) || 0;
                hs.point_pitch = Number(hs.point_pitch) || 0;
                hs.point_yaw = Number(hs.point_yaw) || 0;
                createHotSpot(hs);
            });

            hotspotsCreated = true;
            renderHotSpots();
        }

        function destroyHotSpots() {
            var hs = config.hotSpots;
            hotspotsCreated = false;

            if (hs) {
                for (var i = 0; i < hs.length; i++) {
                    if (hs[i].div) {
                        var current = hs[i].div;
                        // Удаляем все DOM элементы хотспотов
                        while (current && current.parentNode && current.parentNode !== renderContainer) {
                            current = current.parentNode;
                        }
                        if (current && current.parentNode) {
                            renderContainer.removeChild(current);
                        }
                        delete hs[i].div;
                    }
                }
            }

            // Очищаем массив хотспотов
            config.hotSpots = [];
            hotspotsCreated = false;
        }

        function renderHotSpot(hs) {
            const hsPitchSin = Math.sin(hs.pitch * DEG_TO_RAD);
            const hsPitchCos = Math.cos(hs.pitch * DEG_TO_RAD);
            const configPitchSin = Math.sin(config.pitch * DEG_TO_RAD);
            const configPitchCos = Math.cos(config.pitch * DEG_TO_RAD);
            const yawCos = Math.cos((-hs.yaw + config.yaw) * DEG_TO_RAD);

            const z = hsPitchSin * configPitchSin + hsPitchCos * yawCos * configPitchCos;

            const isVisible = !((hs.yaw <= 90 && hs.yaw > -90 && z <= 0) ||
                ((hs.yaw > 90 || hs.yaw <= -90) && z <= 0));

            if (!isVisible) {
                hs.div.style.visibility = 'hidden';
                return;
            }

            hs.div.style.visibility = 'visible';

            const yawSin = Math.sin((-hs.yaw + config.yaw) * DEG_TO_RAD);
            const hfovTan = Math.tan(config.hfov * DEG_TO_RAD / 2);
            const canvas = renderer.getCanvas();
            const canvasWidth = canvas.clientWidth;
            const canvasHeight = canvas.clientHeight;

            let coord = [
                -canvasWidth / hfovTan * yawSin * hsPitchCos / z / 2,
                -canvasWidth / hfovTan * (hsPitchSin * configPitchCos - hsPitchCos * yawCos * configPitchSin) / z / 2
            ];

            const rollSin = Math.sin(config.roll * DEG_TO_RAD);
            const rollCos = Math.cos(config.roll * DEG_TO_RAD);
            coord = [
                coord[0] * rollCos - coord[1] * rollSin,
                coord[0] * rollSin + coord[1] * rollCos
            ];

            coord[0] += (canvasWidth - hs.div.offsetWidth) / 2;
            coord[1] += (canvasHeight - hs.div.offsetHeight) / 2;

            const device = detectDevice();
            let scale = 1;
            if (device.isMobile) scale = 1.5;
            else if (device.isTablet || device.isAndroid) scale = 1.2;
            else if (device.isIOS) scale = 1;

            if (hs.customScale !== undefined) scale = hs.customScale;

            let transform = `translate(${coord[0]}px, ${coord[1]}px) translateZ(9999px) rotate(${config.roll}deg)`;
            transform += ` scale(${scale})`;
            if (hs.scale) {
                transform += ` scale(${(origHfov / config.hfov) / z})`;
            }

            hs.div.style.transform = transform;
            hs.div.style.webkitTransform = transform;
            hs.div.style.MozTransform = transform;
        }

        function renderHotSpots() {
            if (config.hotSpots && config.hotSpots.length > 0) {
                // Сначала проверяем, что все хотспоты имеют DOM элементы
                config.hotSpots.forEach(function(hs) {
                    if (!hs.div) {
                        // Если DOM элемент отсутствует - создаем его
                        createHotSpot(hs);
                    }
                });
                // Затем рендерим все хотспоты
                config.hotSpots.forEach(renderHotSpot);
            }
        }

        // === ОБРАБОТКА ОШИБОК ===

        function anError(errorMsg = config.strings.genericWebGLError) {
            infoDisplay.errorMsg.innerHTML = `<p>${errorMsg}</p>`;
            controls.load.style.display = 'none';
            infoDisplay.load.box.style.display = 'none';
            infoDisplay.errorMsg.style.display = 'table';
            error = true;
            loaded = undefined;
            renderContainer.style.display = 'none';
            fireEvent('error', errorMsg);
        }

        function clearError() {
            if (error) {
                infoDisplay.load.box.style.display = 'none';
                infoDisplay.errorMsg.style.display = 'none';
                error = false;
                renderContainer.style.display = 'block';
                fireEvent('errorcleared');
            }
        }

        // === ПАРСИНГ МЕТАДАННЫХ ===

        function parseGPanoXMP(image) {
            const reader = new FileReader();
            reader.addEventListener('loadend', function() {
                const img = this.result;

                if (navigator.userAgent.toLowerCase().match(/(iphone|ipod|ipad).* os 8_/)) {
                    const flagIndex = img.indexOf('\xff\xc2');
                    if (flagIndex < 0 || flagIndex > 65536) {
                        anError(config.strings.iOS8WebGLError);
                    }
                }

                const start = img.indexOf('<x:xmpmeta');
                if (start > -1 && config.ignoreGPanoXMP !== true) {
                    const xmpData = img.substring(start, img.indexOf('</x:xmpmeta>') + 12);

                    const getTag = (tag) => {
                        let result;
                        if (xmpData.indexOf(`${tag}="`) >= 0) {
                            result = xmpData.substring(xmpData.indexOf(`${tag}="`) + tag.length + 2);
                            result = result.substring(0, result.indexOf('"'));
                        } else if (xmpData.indexOf(`${tag}>`) >= 0) {
                            result = xmpData.substring(xmpData.indexOf(`${tag}>`) + tag.length + 1);
                            result = result.substring(0, result.indexOf('<'));
                        }
                        return result !== undefined ? Number(result) : null;
                    };

                    const xmp = {
                        fullWidth: getTag('GPano:FullPanoWidthPixels'),
                        croppedWidth: getTag('GPano:CroppedAreaImageWidthPixels'),
                        fullHeight: getTag('GPano:FullPanoHeightPixels'),
                        croppedHeight: getTag('GPano:CroppedAreaImageHeightPixels'),
                        topPixels: getTag('GPano:CroppedAreaTopPixels'),
                        heading: getTag('GPano:PoseHeadingDegrees'),
                        horizonPitch: getTag('GPano:PosePitchDegrees'),
                        horizonRoll: getTag('GPano:PoseRollDegrees')
                    };

                    if (xmp.fullWidth !== null && xmp.croppedWidth !== null &&
                        xmp.fullHeight !== null && xmp.croppedHeight !== null &&
                        xmp.topPixels !== null) {

                        if (specifiedPhotoSphereExcludes.indexOf('haov') < 0) {
                            config.haov = xmp.croppedWidth / xmp.fullWidth * 360;
                        }
                        if (specifiedPhotoSphereExcludes.indexOf('vaov') < 0) {
                            config.vaov = xmp.croppedHeight / xmp.fullHeight * 180;
                        }
                        if (specifiedPhotoSphereExcludes.indexOf('vOffset') < 0) {
                            config.vOffset = ((xmp.topPixels + xmp.croppedHeight / 2) / xmp.fullHeight - 0.5) * -180;
                        }
                        if (xmp.heading !== null && specifiedPhotoSphereExcludes.indexOf('northOffset') < 0) {
                            config.northOffset = xmp.heading;
                            if (config.compass !== false) {
                                config.compass = true;
                            }
                        }
                        if (xmp.horizonPitch !== null && xmp.horizonRoll !== null) {
                            if (specifiedPhotoSphereExcludes.indexOf('horizonPitch') < 0) {
                                config.horizonPitch = xmp.horizonPitch;
                            }
                            if (specifiedPhotoSphereExcludes.indexOf('horizonRoll') < 0) {
                                config.horizonRoll = xmp.horizonRoll;
                            }
                        }
                    }
                }

                panoImage.src = window.URL.createObjectURL(image);
            });

            try {
                if (reader.readAsBinaryString !== undefined) {
                    reader.readAsBinaryString(image);
                } else {
                    reader.readAsText(image);
                }
            } catch (e) {
                console.warn('Failed to read XMP metadata:', e);
            }
        }

        // === ЗАГРУЗКА СЦЕН ===

        function load() {
            clearError();
            loaded = false;
            controls.load.style.display = 'none';
            infoDisplay.load.box.style.display = 'inline';
            init();
        }

        function loadScene(sceneId, targetPitch, targetYaw, targetHfov, fadeDone) {
            if (!loaded) fadeDone = true;
            loaded = false;
            animatedMove = {};

            let fadeImg;
            let workingPitch, workingYaw, workingHfov;

            if (config.sceneFadeDuration && !fadeDone) {
                const data = renderer.render(
                    config.pitch * DEG_TO_RAD,
                    config.yaw * DEG_TO_RAD,
                    config.hfov * DEG_TO_RAD,
                    { returnImage: true }
                );

                if (data !== undefined) {
                    fadeImg = new Image();
                    fadeImg.className = 'pnlm-fade-img';
                    fadeImg.style.transition = `opacity ${config.sceneFadeDuration / 1000}s`;
                    fadeImg.style.width = '100%';
                    fadeImg.style.height = '100%';
                    fadeImg.onload = function() {
                        loadScene(sceneId, targetPitch, targetYaw, targetHfov, true);
                    };
                    fadeImg.src = data;
                    renderContainer.appendChild(fadeImg);
                    renderer.fadeImg = fadeImg;
                    return;
                }
            }

            workingPitch = targetPitch === 'same' ? config.pitch : targetPitch;
            if (targetYaw === 'same') {
                workingYaw = config.yaw;
            } else if (targetYaw === 'sameAzimuth') {
                workingYaw = config.yaw + (config.northOffset || 0) - (initialConfig.scenes[sceneId].northOffset || 0);
            } else {
                workingYaw = targetYaw;
            }
            workingHfov = targetHfov === 'same' ? config.hfov : targetHfov;

            destroyHotSpots();
            mergeConfig(sceneId);
            speed.yaw = speed.pitch = speed.hfov = 0;

            processOptions();
            if (workingPitch !== undefined) config.pitch = workingPitch;
            if (workingYaw !== undefined) config.yaw = workingYaw;
            if (workingHfov !== undefined) config.hfov = workingHfov;

            fireEvent('scenechange', sceneId);
            load();
        }

        // === ИНИЦИАЛИЗАЦИЯ РЕНДЕРЕРА ===

        function renderInit() {
            try {
                const params = {};
                if (config.horizonPitch !== undefined) {
                    params.horizonPitch = config.horizonPitch * DEG_TO_RAD;
                }
                if (config.horizonRoll !== undefined) {
                    params.horizonRoll = config.horizonRoll * DEG_TO_RAD;
                }
                if (config.backgroundColor !== undefined) {
                    params.backgroundColor = config.backgroundColor;
                }

                renderer.init(
                    panoImage,
                    config.type,
                    config.dynamic,
                    config.haov * DEG_TO_RAD,
                    config.vaov * DEG_TO_RAD,
                    config.vOffset * DEG_TO_RAD,
                    renderInitCallback,
                    params
                );

                if (config.dynamic !== true) {
                    panoImage = undefined;
                }
            } catch (event) {
                if (event.type === 'webgl error' || event.type === 'no webgl') {
                    anError();
                } else if (event.type === 'webgl size error') {
                    anError(config.strings.textureSizeError.replace('%s', event.width).replace('%s', event.maxWidth));
                } else {
                    anError(config.strings.unknownError);
                    throw event;
                }
            }
        }

        function renderInitCallback() {
            if (config.sceneFadeDuration && renderer.fadeImg !== undefined) {
                renderer.fadeImg.style.opacity = 0;
                const fadeImg = renderer.fadeImg;
                delete renderer.fadeImg;
                setTimeout(() => {
                    renderContainer.removeChild(fadeImg);
                    fireEvent('scenechangefadedone');
                }, config.sceneFadeDuration);
            }

            compass.style.display = config.compass ? 'inline' : 'none';
            createHotSpots();

            infoDisplay.load.box.style.display = 'none';
            if (preview !== undefined) {
                renderContainer.removeChild(preview);
                preview = undefined;
            }

            loaded = true;
            fireEvent('load');
            animateInit();
        }

        // === ОБРАБОТЧИКИ СОБЫТИЙ ===

        function onDocumentMouseDown(event) {
            event.preventDefault();
            container.focus();

            // ОБРАБОТКА ПРАВОЙ КНОПКИ - СОХРАНЯЕМ
            if (event.button === 2) {
                const coords = mouseEventToCoords(event);
                const pos = mousePosition(event);
                const clickedHotSpot = findHotSpotAtCoords(coords[1], coords[0]);

                if (clickedHotSpot && config.onContextMenuHotSpot) {
                    event.stopPropagation();
                    config.onContextMenuHotSpot(
                        { yaw: coords[1], pitch: coords[0] },
                        { x: pos.x, y: pos.y },
                        event, clickedHotSpot
                    );
                    return;
                } else if (config.onContextMenu) {
                    event.stopPropagation();
                    config.onContextMenu(
                        { yaw: coords[1], pitch: coords[0] },
                        { x: pos.x, y: pos.y },
                        event
                    );
                    return;
                }
            }

            if (!loaded || !config.draggable) return;

            const pos = mousePosition(event);

            if (config.hotSpotDebug) {
                const coords = mouseEventToCoords(event);
                console.log(`Pitch: ${coords[0]}, Yaw: ${coords[1]}, Center Pitch: ${config.pitch}, Center Yaw: ${config.yaw}, HFOV: ${config.hfov}`);
            }

            lastClick = mouseEventToCoords(event);

            stopAnimation();
            stopOrientation();
            config.roll = 0;
            speed.hfov = 0;

            isUserInteracting = true;
            latestInteraction = Date.now();

            onPointerDownPointerX = pos.x;
            onPointerDownPointerY = pos.y;
            onPointerDownYaw = config.yaw;
            onPointerDownPitch = config.pitch;

            uiContainer.classList.add('pnlm-grabbing');
            uiContainer.classList.remove('pnlm-grab');

            fireEvent('mousedown', event);
            animateInit();
        }

        function onDocumentMouseMove(event) {
            if (!isUserInteracting || !loaded) return;

            latestInteraction = Date.now();
            const canvas = renderer.getCanvas();
            const canvasWidth = canvas.clientWidth;
            const canvasHeight = canvas.clientHeight;
            const pos = mousePosition(event);

            const yaw = ((Math.atan(onPointerDownPointerX / canvasWidth * 2 - 1) -
                Math.atan(pos.x / canvasWidth * 2 - 1)) * 180 / Math.PI * config.hfov / 90) + onPointerDownYaw;

            speed.yaw = (yaw - config.yaw) % 360 * 0.2;
            config.yaw = yaw;

            const vfov = 2 * Math.atan(Math.tan(config.hfov / 360 * Math.PI) * canvasHeight / canvasWidth) * 180 / Math.PI;
            const pitch = ((Math.atan(pos.y / canvasHeight * 2 - 1) -
                Math.atan(onPointerDownPointerY / canvasHeight * 2 - 1)) * 180 / Math.PI * vfov / 90) + onPointerDownPitch;

            speed.pitch = (pitch - config.pitch) * 0.2;
            config.pitch = pitch;
        }

        function onDocumentMouseUp(event) {
            if (!isUserInteracting) return;
            isUserInteracting = false;

            if (Date.now() - latestInteraction > 15) {
                speed.pitch = speed.yaw = 0;
            }

            uiContainer.classList.add('pnlm-grab');
            uiContainer.classList.remove('pnlm-grabbing');
            latestInteraction = Date.now();

            fireEvent('mouseup', event);
        }

        function onDocumentDoubleClick(event) {
            const coords = mouseEventToCoords(event);
            if (config.onDblClick) {
                config.onDblClick({ yaw: coords[1], pitch: coords[0] });
            }
        }

        function onDocumentMouseWheel(event) {
            if (!loaded || (config.mouseZoom === 'fullscreenonly' && !fullscreenActive)) return;

            event.preventDefault();
            stopAnimation();
            latestInteraction = Date.now();

            let delta = 0;
            if (event.wheelDeltaY) {
                delta = -event.wheelDeltaY * 0.05;
                speed.hfov = event.wheelDelta < 0 ? 1 : -1;
            } else if (event.wheelDelta) {
                delta = -event.wheelDelta * 0.05;
                speed.hfov = event.wheelDelta < 0 ? 1 : -1;
            } else if (event.detail) {
                delta = event.detail * 1.5;
                speed.hfov = event.detail > 0 ? 1 : -1;
            }

            setHfov(config.hfov + delta);
            animateInit();
        }

        function onDocumentTouchStart(event) {
            if (!loaded || !config.draggable) return;

            stopAnimation();
            stopOrientation();
            config.roll = 0;
            speed.hfov = 0;

            const pos0 = mousePosition(event.targetTouches[0]);
            onPointerDownPointerX = pos0.x;
            onPointerDownPointerY = pos0.y;

            if (event.targetTouches.length === 2) {
                const pos1 = mousePosition(event.targetTouches[1]);
                onPointerDownPointerX += (pos1.x - pos0.x) * 0.5;
                onPointerDownPointerY += (pos1.y - pos0.y) * 0.5;
                onPointerDownPointerDist = Math.sqrt(
                    (pos0.x - pos1.x) ** 2 + (pos0.y - pos1.y) ** 2
                );
            }

            isUserInteracting = true;
            latestInteraction = Date.now();
            onPointerDownYaw = config.yaw;
            onPointerDownPitch = config.pitch;

            fireEvent('touchstart', event);
            animateInit();
        }

        function onDocumentTouchMove(event) {
            if (!config.draggable) return;

            event.preventDefault();
            if (loaded) latestInteraction = Date.now();

            if (!isUserInteracting || !loaded) return;

            const pos0 = mousePosition(event.targetTouches[0]);
            let clientX = pos0.x;
            let clientY = pos0.y;

            if (event.targetTouches.length === 2 && onPointerDownPointerDist !== -1) {
                const pos1 = mousePosition(event.targetTouches[1]);
                clientX += (pos1.x - pos0.x) * 0.5;
                clientY += (pos1.y - pos0.y) * 0.5;
                const clientDist = Math.sqrt(
                    (pos0.x - pos1.x) ** 2 + (pos0.y - pos1.y) ** 2
                );
                setHfov(config.hfov + (onPointerDownPointerDist - clientDist) * 0.1);
                onPointerDownPointerDist = clientDist;
            }

            const touchmovePanSpeedCoeff = (config.hfov / 360) * config.touchPanSpeedCoeffFactor;
            const yaw = (onPointerDownPointerX - clientX) * touchmovePanSpeedCoeff + onPointerDownYaw;
            speed.yaw = (yaw - config.yaw) % 360 * 0.2;
            config.yaw = yaw;

            const pitch = (clientY - onPointerDownPointerY) * touchmovePanSpeedCoeff + onPointerDownPitch;
            speed.pitch = (pitch - config.pitch) * 0.2;
            config.pitch = pitch;
        }

        function onDocumentTouchEnd() {
            isUserInteracting = false;
            if (Date.now() - latestInteraction > 150) {
                speed.pitch = speed.yaw = 0;
            }
            onPointerDownPointerDist = -1;
            latestInteraction = Date.now();
            fireEvent('touchend');
        }

        let pointerIDs = [];
        let pointerCoordinates = [];

        function onDocumentPointerDown(event) {
            if (event.pointerType === 'touch') {
                if (!loaded || !config.draggable) return;
                pointerIDs.push(event.pointerId);
                pointerCoordinates.push({ clientX: event.clientX, clientY: event.clientY });
                event.targetTouches = pointerCoordinates;
                onDocumentTouchStart(event);
                event.preventDefault();
            }
        }

        function onDocumentPointerMove(event) {
            if (event.pointerType === 'touch') {
                if (!config.draggable) return;
                for (let i = 0; i < pointerIDs.length; i++) {
                    if (event.pointerId === pointerIDs[i]) {
                        pointerCoordinates[i].clientX = event.clientX;
                        pointerCoordinates[i].clientY = event.clientY;
                        event.targetTouches = pointerCoordinates;
                        onDocumentTouchMove(event);
                        event.preventDefault();
                        return;
                    }
                }
            }
        }

        function onDocumentPointerUp(event) {
            if (event.pointerType === 'touch') {
                let defined = false;
                for (let i = 0; i < pointerIDs.length; i++) {
                    if (event.pointerId === pointerIDs[i]) pointerIDs[i] = undefined;
                    if (pointerIDs[i]) defined = true;
                }
                if (!defined) {
                    pointerIDs = [];
                    pointerCoordinates = [];
                    onDocumentTouchEnd();
                }
                event.preventDefault();
            }
        }

        function onDocumentKeyPress(event) {
            stopAnimation();
            latestInteraction = Date.now();
            stopOrientation();
            config.roll = 0;

            const keynumber = event.which || event.keycode;
            if (config.capturedKeyNumbers.indexOf(keynumber) < 0) return;
            event.preventDefault();

            if (keynumber === 27) {
                if (fullscreenActive) toggleFullscreen();
            } else {
                changeKey(keynumber, true);
            }
        }

        function onDocumentKeyUp(event) {
            const keynumber = event.which || event.keycode;
            if (config.capturedKeyNumbers.indexOf(keynumber) < 0) return;
            event.preventDefault();
            changeKey(keynumber, false);
        }

        function clearKeys() {
            keysDown.fill(false);
        }

        function changeKey(keynumber, value) {
            const keyMap = {
                109: 0, 189: 0, 17: 0, 173: 0,
                107: 1, 187: 1, 16: 1, 61: 1,
                38: 2, 87: 6,
                40: 3, 83: 7,
                37: 4, 65: 8,
                39: 5, 68: 9
            };

            const idx = keyMap[keynumber];
            if (idx !== undefined && keysDown[idx] !== value) {
                keysDown[idx] = value;
                if (value) {
                    prevTime = performance.now ? performance.now() : Date.now();
                    animateInit();
                }
            }
        }

        function onDocumentResize() {
            if (renderer) {
                renderer.resize();
            }
            onFullScreenChange('resize');
            animateInit();
        }

        function toggleFullscreen() {
            if (!loaded || error) return;

            try {
                if (!fullscreenActive) {
                    if (container.requestFullscreen) container.requestFullscreen();
                    else if (container.mozRequestFullScreen) container.mozRequestFullScreen();
                    else if (container.msRequestFullscreen) container.msRequestFullscreen();
                    else if (container.webkitRequestFullScreen) container.webkitRequestFullScreen();
                } else {
                    if (document.exitFullscreen) document.exitFullscreen();
                    else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
                    else if (document.webkitCancelFullScreen) document.webkitCancelFullScreen();
                    else if (document.msExitFullscreen) document.msExitFullscreen();
                }
            } catch (e) {}
        }

        function onFullScreenChange(resize) {
            const isFullscreen = !!(document.fullscreenElement || document.fullscreen ||
                document.mozFullScreen || document.webkitIsFullScreen || document.msFullscreenElement);

            fullscreenActive = isFullscreen;
            controls.fullscreen.classList.toggle('pnlm-fullscreen-toggle-button-active', isFullscreen);

            if (resize !== 'resize') {
                fireEvent('fullscreenchange', isFullscreen);
            }

            if (renderer) {
                renderer.resize();
                setHfov(config.hfov);
                animateInit();
            }
        }

        // === ОРИЕНТАЦИЯ УСТРОЙСТВА ===

        function startOrientation() {
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission().then(response => {
                    if (response === 'granted') {
                        orientation = 1;
                        window.addEventListener('deviceorientation', orientationListener);
                        controls.orientation.classList.add('pnlm-orientation-button-active');
                    }
                });
            } else {
                orientation = 1;
                window.addEventListener('deviceorientation', orientationListener);
                controls.orientation.classList.add('pnlm-orientation-button-active');
            }
        }

        function stopOrientation() {
            window.removeEventListener('deviceorientation', orientationListener);
            controls.orientation.classList.remove('pnlm-orientation-button-active');
            orientation = false;
        }

        function orientationListener(e) {
            const q = computeQuaternion(e.alpha, e.beta, e.gamma).toEulerAngles();

            if (typeof orientation === 'number' && orientation < 10) {
                orientation += 1;
            } else if (orientation === 10) {
                orientationYawOffset = q[2] / Math.PI * 180 + config.yaw;
                orientation = true;
                requestAnimationFrame(animate);
            } else {
                config.pitch = q[0] / Math.PI * 180;
                config.roll = -q[1] / Math.PI * 180;
                config.yaw = -q[2] / Math.PI * 180 + orientationYawOffset;
            }
        }

        function Quaternion(w, x, y, z) {
            this.w = w;
            this.x = x;
            this.y = y;
            this.z = z;
        }

        Quaternion.prototype.multiply = function(q) {
            return new Quaternion(
                this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z,
                this.x * q.w + this.w * q.x + this.y * q.z - this.z * q.y,
                this.y * q.w + this.w * q.y + this.z * q.x - this.x * q.z,
                this.z * q.w + this.w * q.z + this.x * q.y - this.y * q.x
            );
        };

        Quaternion.prototype.toEulerAngles = function() {
            return [
                Math.atan2(2 * (this.w * this.x + this.y * this.z), 1 - 2 * (this.x * this.x + this.y * this.y)),
                Math.asin(2 * (this.w * this.y - this.z * this.x)),
                Math.atan2(2 * (this.w * this.z + this.x * this.y), 1 - 2 * (this.y * this.y + this.z * this.z))
            ];
        };

        function taitBryanToQuaternion(alpha, beta, gamma) {
            const r = [
                beta * DEG_TO_RAD / 2 || 0,
                gamma * DEG_TO_RAD / 2 || 0,
                alpha * DEG_TO_RAD / 2 || 0
            ];
            const c = r.map(Math.cos);
            const s = r.map(Math.sin);

            return new Quaternion(
                c[0] * c[1] * c[2] - s[0] * s[1] * s[2],
                s[0] * c[1] * c[2] - c[0] * s[1] * s[2],
                c[0] * s[1] * c[2] + s[0] * c[1] * s[2],
                c[0] * c[1] * s[2] + s[0] * s[1] * c[2]
            );
        }

        function computeQuaternion(alpha, beta, gamma) {
            let q = taitBryanToQuaternion(alpha, beta, gamma);
            q = q.multiply(new Quaternion(Math.sqrt(0.5), -Math.sqrt(0.5), 0, 0));
            const angle = window.orientation ? -window.orientation * DEG_TO_RAD / 2 : 0;
            return q.multiply(new Quaternion(Math.cos(angle), 0, -Math.sin(angle), 0));
        }

        // === СОБЫТИЯ ===

        function fireEvent(type) {
            if (externalEventListeners[type]) {
                const args = Array.from(arguments).slice(1);
                const listeners = externalEventListeners[type];
                for (let i = listeners.length - 1; i >= 0; i--) {
                    try {
                        listeners[i].apply(null, args);
                    } catch (e) {
                        console.error('Event listener error:', e);
                    }
                }
            }
        }

        // === ПУБЛИЧНЫЕ МЕТОДЫ ===

        this.isLoaded = function() {
            return Boolean(loaded);
        };

        this.getPitch = function() {
            return config.pitch;
        };

        this.setPitch = function(pitch, animated = 1000, callback, callbackArgs) {
            latestInteraction = Date.now();
            if (Math.abs(pitch - config.pitch) <= EPS) {
                if (callback) callback(callbackArgs);
                return this;
            }

            if (animated) {
                animatedMove.pitch = {
                    startTime: Date.now(),
                    startPosition: config.pitch,
                    endPosition: pitch,
                    duration: animated
                };
                if (callback) setTimeout(() => callback(callbackArgs), animated);
            } else {
                config.pitch = pitch;
            }
            animateInit();
            return this;
        };

        this.getPitchBounds = function() {
            return [config.minPitch, config.maxPitch];
        };

        this.setPitchBounds = function(bounds) {
            config.minPitch = Math.max(-90, Math.min(bounds[0], 90));
            config.maxPitch = Math.max(-90, Math.min(bounds[1], 90));
            return this;
        };

        this.getYaw = function() {
            return (config.yaw + 540) % 360 - 180;
        };

        this.setYaw = function(yaw, animated = 1000, callback, callbackArgs) {
            latestInteraction = Date.now();
            if (Math.abs(yaw - config.yaw) <= EPS) {
                if (callback) callback(callbackArgs);
                return this;
            }

            yaw = ((yaw + 180) % 360) - 180;

            if (animated) {
                if (config.yaw - yaw > 180) yaw += 360;
                else if (yaw - config.yaw > 180) yaw -= 360;

                animatedMove.yaw = {
                    startTime: Date.now(),
                    startPosition: config.yaw,
                    endPosition: yaw,
                    duration: animated
                };
                if (callback) setTimeout(() => callback(callbackArgs), animated);
            } else {
                config.yaw = yaw;
            }
            animateInit();
            return this;
        };

        this.getYawBounds = function() {
            return [config.minYaw, config.maxYaw];
        };

        this.setYawBounds = function(bounds) {
            config.minYaw = Math.max(-360, Math.min(bounds[0], 360));
            config.maxYaw = Math.max(-360, Math.min(bounds[1], 360));
            return this;
        };

        this.getHfov = function() {
            return config.hfov;
        };

        this.setHfov = function(hfov, animated = 1000, callback, callbackArgs) {
            latestInteraction = Date.now();
            if (Math.abs(hfov - config.hfov) <= EPS) {
                if (callback) callback(callbackArgs);
                return this;
            }

            if (animated) {
                animatedMove.hfov = {
                    startTime: Date.now(),
                    startPosition: config.hfov,
                    endPosition: constrainHfov(hfov),
                    duration: animated
                };
                if (callback) setTimeout(() => callback(callbackArgs), animated);
            } else {
                setHfov(hfov);
            }
            animateInit();
            return this;
        };

        this.getHfovBounds = function() {
            return [config.minHfov, config.maxHfov];
        };

        this.setHfovBounds = function(bounds) {
            config.minHfov = Math.max(0, bounds[0]);
            config.maxHfov = Math.max(0, bounds[1]);
            return this;
        };

        this.lookAt = function(pitch, yaw, hfov, animated = 1000, callback, callbackArgs) {
            if (pitch !== undefined && Math.abs(pitch - config.pitch) > EPS) {
                this.setPitch(pitch, animated, callback, callbackArgs);
                callback = undefined;
            }
            if (yaw !== undefined && Math.abs(yaw - config.yaw) > EPS) {
                this.setYaw(yaw, animated, callback, callbackArgs);
                callback = undefined;
            }
            if (hfov !== undefined && Math.abs(hfov - config.hfov) > EPS) {
                this.setHfov(hfov, animated, callback, callbackArgs);
                callback = undefined;
            }
            if (callback) callback(callbackArgs);
            return this;
        };

        this.getNorthOffset = function() {
            return config.northOffset;
        };

        this.setNorthOffset = function(heading) {
            config.northOffset = Math.min(360, Math.max(0, heading));
            animateInit();
            return this;
        };

        this.getHorizonRoll = function() {
            return config.horizonRoll;
        };

        this.setHorizonRoll = function(roll) {
            config.horizonRoll = Math.min(90, Math.max(-90, roll));
            renderer.setPose(config.horizonPitch * DEG_TO_RAD, config.horizonRoll * DEG_TO_RAD);
            animateInit();
            return this;
        };

        this.getHorizonPitch = function() {
            return config.horizonPitch;
        };

        this.setHorizonPitch = function(pitch) {
            config.horizonPitch = Math.min(90, Math.max(-90, pitch));
            renderer.setPose(config.horizonPitch * DEG_TO_RAD, config.horizonRoll * DEG_TO_RAD);
            animateInit();
            return this;
        };

        this.startAutoRotate = function(speed, pitch) {
            speed = speed || autoRotateSpeed || 1;
            pitch = pitch === undefined ? origPitch : pitch;
            config.autoRotate = speed;
            _this.lookAt(pitch, undefined, origHfov, 3000);
            animateInit();
            return this;
        };

        this.stopAutoRotate = function() {
            autoRotateSpeed = config.autoRotate || autoRotateSpeed;
            config.autoRotate = false;
            config.autoRotateInactivityDelay = -1;
            return this;
        };

        this.stopMovement = function() {
            stopAnimation();
            speed = { yaw: 0, pitch: 0, hfov: 0 };
        };

        this.getRenderer = function() {
            return renderer;
        };

        this.setUpdate = function(bool) {
            update = bool === true;
            if (renderer === undefined) {
                onImageLoad();
            } else {
                animateInit();
            }
            return this;
        };

        this.mouseEventToCoords = function(event) {
            return mouseEventToCoords(event);
        };

        this.loadScene = function(sceneId, pitch, yaw, hfov) {
            if (loaded !== false) {
                loadScene(sceneId, pitch, yaw, hfov);
            }
            return this;
        };

        this.getScene = function(sceneId) {
            if (sceneId) {
                return initialConfig.scenes[sceneId];
            }
            return initialConfig.scenes;
        };

        this.addScene = function(sceneId, config) {
            initialConfig.scenes[sceneId] = config;
            return this;
        };

        this.removeScene = function(sceneId) {
            if (config.scene === sceneId || !initialConfig.scenes.hasOwnProperty(sceneId)) {
                return false;
            }
            delete initialConfig.scenes[sceneId];
            return true;
        };
        this.renderHotSpots = function() {
            renderHotSpots();
            return this;
        };

        this.toggleFullscreen = function() {
            toggleFullscreen();
            return this;
        };

        this.getConfig = function() {
            return config;
        };

        this.getContainer = function() {
            return container;
        };

        this.addHotSpot = function(hs, sceneId) {
            // Убеждаемся, что config.hotSpots существует
            if (!config.hotSpots) {
                config.hotSpots = [];
            }

            if (sceneId === undefined && config.scene === undefined) {
                config.hotSpots.push(hs);
            } else {
                var id = sceneId !== undefined ? sceneId : config.scene;
                // Проверяем наличие сцены в initialConfig
                if (initialConfig && initialConfig.scenes && initialConfig.scenes.hasOwnProperty(id)) {
                    if (!initialConfig.scenes[id].hasOwnProperty('hotSpots')) {
                        initialConfig.scenes[id].hotSpots = [];
                        if (id == config.scene) {
                            config.hotSpots = initialConfig.scenes[id].hotSpots;
                        }
                    }
                    initialConfig.scenes[id].hotSpots.push(hs);
                    if (id == config.scene) {
                        config.hotSpots = initialConfig.scenes[id].hotSpots;
                    }
                } else {
                    // Если сцена не найдена в initialConfig, просто добавляем в config.hotSpots
                    console.warn('Scene ID not found in initialConfig, adding to config.hotSpots directly:', id);
                    config.hotSpots.push(hs);
                }
            }

            if (sceneId === undefined || config.scene == sceneId) {
                // Создаем DOM элемент для хотспота
                createHotSpot(hs);
                if (loaded) {
                    // Сбрасываем флаг, чтобы createHotSpots пересоздал все
                    hotspotsCreated = false;
                    // Пересоздаем все хотспоты
                    createHotSpots();
                    // Принудительно перерисовываем
                    renderHotSpots();
                    if (renderer) {
                        renderer.resize();
                    }
                }
            }
            return this;
        };

        this.removeHotSpot = function(hotSpotId, sceneId) {
            if (sceneId === undefined || config.scene == sceneId) {
                if (!config.hotSpots) return false;
                for (var i = 0; i < config.hotSpots.length; i++) {
                    if (config.hotSpots[i].hasOwnProperty('id') &&
                        config.hotSpots[i].id === hotSpotId) {
                        var current = config.hotSpots[i].div;
                        while (current.parentNode != renderContainer)
                            current = current.parentNode;
                        renderContainer.removeChild(current);
                        delete config.hotSpots[i].div;
                        config.hotSpots.splice(i, 1);
                        // ПРИНУДИТЕЛЬНО ОБНОВЛЯЕМ ОТОБРАЖЕНИЕ
                        renderHotSpots();
                        return true;
                    }
                }
                // Если удаляем все хотспоты
                if (hotSpotId === 'all') {
                    destroyHotSpots();
                    config.hotSpots = [];
                    hotspotsCreated = false;
                    renderHotSpots();
                    return true;
                }
            } else {
                if (initialConfig.scenes.hasOwnProperty(sceneId)) {
                    if (!initialConfig.scenes[sceneId].hasOwnProperty('hotSpots'))
                        return false;
                    for (var j = 0; j < initialConfig.scenes[sceneId].hotSpots.length; j++) {
                        if (initialConfig.scenes[sceneId].hotSpots[j].hasOwnProperty('id') &&
                            initialConfig.scenes[sceneId].hotSpots[j].id === hotSpotId) {
                            initialConfig.scenes[sceneId].hotSpots.splice(j, 1);
                            if (sceneId === config.scene) {
                                renderHotSpots();
                            }
                            return true;
                        }
                    }
                } else {
                    return false;
                }
            }
            return false;
        };

        this.resize = function() {
            if (renderer) onDocumentResize();
        };

        this.isOrientationSupported = function() {
            return orientationSupport || false;
        };

        this.stopOrientation = function() {
            stopOrientation();
        };

        this.startOrientation = function() {
            if (orientationSupport) startOrientation();
        };

        this.isOrientationActive = function() {
            return Boolean(orientation);
        };

        this.on = function(type, listener) {
            externalEventListeners[type] = externalEventListeners[type] || [];
            externalEventListeners[type].push(listener);
            return this;
        };

        this.off = function(type, listener) {
            if (!type) {
                externalEventListeners = {};
                return this;
            }
            if (listener) {
                const i = externalEventListeners[type].indexOf(listener);
                if (i >= 0) externalEventListeners[type].splice(i, 1);
                if (externalEventListeners[type].length === 0) {
                    delete externalEventListeners[type];
                }
            } else {
                delete externalEventListeners[type];
            }
            return this;
        };

        this.viewScene = function(sceneId) {
            const configLocal = initialConfig.scenes[sceneId];
            if (!configLocal) return;
            this.loadScene(sceneId, configLocal.pitch || 0, configLocal.yaw || 0, configLocal.hfov || 0);
        };

        this.zoomOut = function() {
            setHfov(config.hfov + 5);
            animateInit();
        };

        this.getLastClick = function() {
            return lastClick;
        };

        this.getLastSceneId = function() {
            return lastSceneId;
        };

        this.destroy = function() {
            destroyed = true;
            if (autoRotateStart) clearTimeout(autoRotateStart);

            if (renderer) renderer.destroy();

            if (listenersAdded) {
                document.removeEventListener('mousemove', onDocumentMouseMove);
                document.removeEventListener('mouseup', onDocumentMouseUp);
                ['mozfullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange', 'fullscreenchange'].forEach(event => {
                    container.removeEventListener(event, onFullScreenChange);
                });
                window.removeEventListener('resize', onDocumentResize);
                window.removeEventListener('orientationchange', onDocumentResize);
                container.removeEventListener('keydown', onDocumentKeyPress);
                container.removeEventListener('keyup', onDocumentKeyUp);
                container.removeEventListener('blur', clearKeys);
                document.removeEventListener('mouseleave', onDocumentMouseUp);
            }

            container.innerHTML = '';
            container.classList.remove('pnlm-container');
        };
    }

    return {
        viewer: function(container, config) {
            return new Viewer(container, config);
        }
    };

})(window, document);