/**
 * Panorama Editor - Create and edit tours with hotspots
 * @module PanoramaEditor
 * @extends PanoramaBase
 */
class PanoramaEditor extends PanoramaBase {
    constructor() {
        console.log('=== PanoramaEditor Constructor ===');
        super('canvas');
        console.log('After super call');

        this.currentHotspots = [];
        this.currentCoords = null;
        this.selectedPreviewCoords = null;
        this.previewIframe = null;
        this.messageHandlerBound = false;
        this.isInIframe = window.self !== window.top;
        console.log('isInIframe:', this.isInIframe);

        // Сохраняем последний скопированный путь
        this.lastCopiedPath = null;
        this.lastCopiedPhoto = null;

        // Определяем метод перед использованием
        this.handleHotspotClick = this.handleHotspotClick.bind(this);
        this.setHotspotClickHandler(this.handleHotspotClick);

        console.log('Setting up event listeners...');
        this.setupEventListeners();
        console.log('Loading initial scene...');
        this.loadInitialScene();
        console.log('Initializing modal handlers...');
        this.initModalHandlers();
        console.log('PanoramaEditor initialization complete');
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        console.log('=== setupEventListeners ===');
        var self = this;

        document.addEventListener('DOMContentLoaded', function() {
            console.log('DOMContentLoaded event fired');
            if (!self.isInIframe) {
                document.addEventListener('contextmenu', function(e) {
                    e.preventDefault();
                });
            }
        });

        window.addEventListener('popstate', function() {
            console.log('popstate event fired');
            self.loadInitialScene();
        });

        window.addEventListener('message', function(event) {
            console.log('message event received:', event.data);
            self.handleParentMessage(event);
        });
        console.log('Event listeners set up');
    }

    /**
     * Load initial scene
     */
    loadInitialScene() {
        console.log('=== loadInitialScene ===');
        this.setSelectPanorama();
    }

    /**
     * Set and display panorama based on URL parameters
     */
    async setSelectPanorama(hotSpot) {
        if (hotSpot === undefined) hotSpot = null;
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            console.log('=== setSelectPanorama ===');

            // ОЧИЩАЕМ ВСЕ СТАРЫЕ ДАННЫЕ ПЕРЕД ЗАГРУЗКОЙ
            this.currentHotspots = [];
            this.currentCoords = null;
            this.selectedPreviewCoords = null;
            if (this.previewIframe) {
                this.previewIframe.remove();
                this.previewIframe = null;
            }
            this.messageHandlerBound = false;

            // Очищаем список в UI
            var container = document.getElementById('hotspotsContainer');
            if (container) {
                container.innerHTML = '<p style="color:#666;font-style:italic;">Нет созданных точек</p>';
            }

            var params = new URLSearchParams(window.location.search);
            var infoValue = params.get('info');
            var photoValue = params.get('photo');

            // Получаем параметры направления из URL
            var yawParam = params.get('yaw');
            var pitchParam = params.get('pitch');

            console.log('photoValue (raw from URL):', photoValue);
            console.log('infoValue:', infoValue);
            console.log('yawParam:', yawParam);
            console.log('pitchParam:', pitchParam);

            if (photoValue) {
                photoValue = this.normalizePath(photoValue);
                console.log('photoValue (normalized):', photoValue);
            }

            var hotSpotsValue = params.get('hotSpots');
            console.log('hotSpotsValue:', hotSpotsValue);

            var canvas = document.getElementById(this.canvasId);
            if (canvas) {
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                console.log('Canvas found and styled');
            } else {
                console.error('Canvas not found!');
            }

            var config = this.createBaseJsonConfig();
            console.log('Base config created');

            config.hotPointDebug = !this.isInIframe;
            config.sceneFadeDuration = this.isInIframe ? 500 : 1000;
            console.log('Config after modifications:', config);

            if (photoValue) {
                console.log('Loading photo panorama...');
                await this.loadPhotoPanorama(photoValue, hotSpot, hotSpotsValue, config, pitchParam, yawParam);
            } else if (infoValue) {
                console.log('Loading info panorama...');
                this.loadInfoPanorama(infoValue, hotSpot, config);
            } else {
                console.log('Loading default panorama...');
                await this.loadDefaultPanorama(config);
            }

            console.log('setSelectPanorama completed successfully');

        } catch (error) {
            console.error('Error in setSelectPanorama:', error);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Load panorama from photo parameter
     */
    async loadPhotoPanorama(photoValue, hotSpot, hotSpotsValue, config, pitchParam, yawParam) {
        if (pitchParam === undefined) pitchParam = null;
        if (yawParam === undefined) yawParam = null;

        console.log('=== loadPhotoPanorama ===');
        console.log('photoValue (from URL, already decoded):', photoValue);
        console.log('basePath:', this.basePath);
        console.log('pitchParam:', pitchParam);
        console.log('yawParam:', yawParam);

        // Определяем, является ли photoValue абсолютным URL
        var isAbsoluteUrl = this.isExternalUrl(photoValue);
        var resolvedImageUrl = photoValue;

        // Если photoValue НЕ абсолютный URL - разрешаем путь
        if (!isAbsoluteUrl) {
            resolvedImageUrl = this.resolveImagePath(photoValue);
        }
        console.log('resolvedImageUrl:', resolvedImageUrl);

        var isExternal = this.isExternalUrl(photoValue) || this.isExternalUrl(resolvedImageUrl);
        console.log('isExternal:', isExternal);

        // ===== ФОРМИРУЕМ JSON URL ПРАВИЛЬНО =====
        var jsonUrl = '';
        // Берем resolvedImageUrl и заменяем расширение на .json
        // Но важно: resolvedImageUrl уже содержит полный путь без параметров
        jsonUrl = resolvedImageUrl.replace(/\.[^/.]+$/, '') + '.json';
        // Убираем возможные параметры запроса
        jsonUrl = jsonUrl.split('?')[0];
        console.log('jsonUrl:', jsonUrl);

        var cameraDirection = {};

        // Извлекаем относительный путь для сохранения в сцене
        var relativePath = photoValue;
        if (this.isExternalUrl(photoValue)) {
            var parts = photoValue.split('/');
            relativePath = parts[parts.length - 1];
            var urlParams = new URLSearchParams(window.location.search);
            var urlPath = urlParams.get('path');
            if (urlPath && photoValue.indexOf(urlPath) === 0) {
                relativePath = photoValue.substring(urlPath.length + 1);
            }
        } else {
            relativePath = photoValue.replace(/^\/+/, '');
        }

        console.log('Relative path for scene:', relativePath);

        try {
            var jsonData = await this.loadHotSpotsFromJson(jsonUrl);
            console.log('jsonData loaded:', jsonData);

            var hotspotsFromJson = jsonData.hotSpots || [];

            if (jsonData.pitchCam !== undefined && jsonData.yawCam !== undefined) {
                cameraDirection = {
                    pitchCam: jsonData.pitchCam,
                    yawCam: jsonData.yawCam
                };
                console.log('Loaded camera direction from JSON:', cameraDirection);
            }

            if (pitchParam !== null && !isNaN(parseFloat(pitchParam))) {
                cameraDirection.pitchCam = parseFloat(pitchParam);
                console.log('Using pitch from URL param:', cameraDirection.pitchCam);
            }
            if (yawParam !== null && !isNaN(parseFloat(yawParam))) {
                cameraDirection.yawCam = parseFloat(yawParam);
                console.log('Using yaw from URL param:', cameraDirection.yawCam);
            }

            if (hotSpot) {
                if (hotSpot.point_pitch !== undefined) {
                    cameraDirection.pitchCam = hotSpot.point_pitch;
                    console.log('Using pitch from hotspot:', cameraDirection.pitchCam);
                }
                if (hotSpot.point_yaw !== undefined) {
                    cameraDirection.yawCam = hotSpot.point_yaw;
                    console.log('Using yaw from hotspot:', cameraDirection.yawCam);
                }
            }

            await this.finalizeScene(
                resolvedImageUrl, isExternal, hotspotsFromJson,
                cameraDirection, hotSpot, hotSpotsValue, config,
                relativePath
            );

        } catch (error) {
            console.log('No JSON file found or error loading:', jsonUrl, error);
            await this.finalizeScene(
                resolvedImageUrl, isExternal, [], {},
                hotSpot, hotSpotsValue, config,
                relativePath || ''
            );
        }
    }

    /**
     * Load panorama from info parameter (legacy format)
     */
    loadInfoPanorama(infoValue, hotSpot, config) {
        console.log('=== loadInfoPanorama ===');
        var oldJsonData = this.getJsonUrlData('/Example/pano360/point_info/' + infoValue);

        for (var key in oldJsonData) {
            if (oldJsonData.hasOwnProperty(key)) {
                config[key] = oldJsonData[key];
            }
        }

        if (hotSpot) {
            var scene = config.scenes && config.scenes.scene1 ? config.scenes.scene1 : null;
            if (scene) {
                if (hotSpot.point_pitch !== undefined) scene.pitch = hotSpot.point_pitch;
                if (hotSpot.point_yaw !== undefined) scene.yaw = hotSpot.point_yaw;
            }
        }

        this.addEventHandlersToConfig(config);
        this.createPannellumViewer(config, infoValue);

        if (this.sceneMain) {
            var self = this;
            this.sceneMain.on('load', function() {
                self.loadHotspotsList();
            });
        }
    }

    /**
     * Load default panorama
     */
    async loadDefaultPanorama(config) {
        console.log('=== loadDefaultPanorama ===');
        var defaultImage = 'img/04.01.2026/DSCN0021.JPG';
        var resolvedImage = this.resolveImagePath(defaultImage);
        var isExternal = this.isExternalUrl(defaultImage);
        var jsonUrl = this.getJsonUrlFromImageUrl(resolvedImage);

        try {
            var jsonData = await this.loadHotSpotsFromJson(jsonUrl);
            var hotspots = jsonData.hotSpots || [];
            var cameraDir = this.getCameraDirection(null, jsonData);

            var scene = config.scenes.scene1;
            scene.title = 'Default Panorama';
            scene.panorama = resolvedImage;
            scene.crossOrigin = isExternal ? undefined : 'use-credentials';
            scene.hotSpots = this.formatHotSpots(hotspots);

            if (cameraDir.pitchCam !== undefined) scene.pitch = cameraDir.pitchCam;
            else scene.pitch = -24.41;

            if (cameraDir.yawCam !== undefined) scene.yaw = cameraDir.yawCam;
            else scene.yaw = -6.77;

            this.currentHotspots = hotspots;
            this.createPannellumViewer(config, 'default');

            var self = this;
            if (this.sceneMain) {
                this.sceneMain.on('load', function() {
                    self.loadHotspotsList();
                });
            }

        } catch (error) {
            console.log('No JSON for default image:', jsonUrl, error);

            var scene = config.scenes.scene1;
            scene.title = 'Default Panorama';
            scene.panorama = resolvedImage;
            scene.crossOrigin = isExternal ? undefined : 'use-credentials';
            scene.yaw = -6.77;
            scene.pitch = -24.41;

            this.createPannellumViewer(config, 'default');

            var self = this;
            if (this.sceneMain) {
                this.sceneMain.on('load', function() {
                    self.currentHotspots = [];
                    self.loadHotspotsList();
                });
            }
        }
    }

    async finalizeScene(imageUrl, isExternal, hotspotsData, cameraDirection, hotSpot, hotSpotsValue, config, relativePath) {
        console.log('=== finalizeScene ===');
        console.log('imageUrl:', imageUrl);
        console.log('isExternal:', isExternal);
        console.log('cameraDirection:', cameraDirection);
        console.log('relativePath:', relativePath);

        var scene = config.scenes.scene1;

        scene.panorama = imageUrl;
        scene.crossOrigin = isExternal ? undefined : 'use-credentials';

        if (hotSpot && hotSpot.point_pitch !== undefined) {
            scene.pitch = hotSpot.point_pitch;
            console.log('Set pitch from hotspot:', scene.pitch);
        } else if (cameraDirection && cameraDirection.pitchCam !== undefined) {
            scene.pitch = cameraDirection.pitchCam;
            console.log('Set pitch from cameraDirection:', scene.pitch);
        }

        if (hotSpot && hotSpot.point_yaw !== undefined) {
            scene.yaw = hotSpot.point_yaw;
            console.log('Set yaw from hotspot:', scene.yaw);
        } else if (cameraDirection && cameraDirection.yawCam !== undefined) {
            scene.yaw = cameraDirection.yawCam;
            console.log('Set yaw from cameraDirection:', scene.yaw);
        }

        var hotspotsArray = [];
        if (hotSpotsValue) {
            try {
                hotspotsArray = JSON.parse(decodeURIComponent(hotSpotsValue));
            } catch (e) {
                console.error('Error parsing hotSpots URL parameter:', e);
            }
        }

        var allHotSpots = [];
        if (Array.isArray(hotspotsData)) {
            allHotSpots = allHotSpots.concat(hotspotsData);
        }
        if (Array.isArray(hotspotsArray)) {
            allHotSpots = allHotSpots.concat(hotspotsArray);
        }

        var uniqueHotspots = this.removeDuplicateHotspots(allHotSpots);

        // Форматируем хотспоты с ПОЛНЫМИ URL
        var formattedHotspots = uniqueHotspots.map(function(hs) {
            var fullUrl = hs.panorama_url || '';
            var path = hs.path || '';

            // Если panorama_url относительный и есть path - склеиваем
            if (fullUrl && !this.isExternalUrl(fullUrl) && path) {
                var cleanPath = path.replace(/\/+$/, '');
                var cleanPhoto = fullUrl.replace(/^\/+/, '');
                fullUrl = cleanPath + '/' + cleanPhoto;
            } else if (fullUrl && !this.isExternalUrl(fullUrl)) {
                // Если нет path, используем корень из imageUrl
                var parts = imageUrl.split('/');
                parts.pop();
                var basePathFromImage = parts.join('/');
                var cleanPhoto = fullUrl.replace(/^\/+/, '');
                fullUrl = basePathFromImage + '/' + cleanPhoto;
            }

            return {
                pitch: hs.pitch || 0,
                yaw: hs.yaw || 0,
                type: hs.type || "scene",
                text: hs.text || "Переход",
                sceneId: hs.sceneId || "scene1",
                panorama_url: fullUrl,
                point_pitch: hs.targetPitch || 0,
                point_yaw: hs.targetYaw || 0,
                customScale: hs.customScale || undefined
            };
        }.bind(this));

        scene.hotSpots = formattedHotspots;
        this.currentHotspots = uniqueHotspots;

        this.addEventHandlersToConfig(config);

        console.log('Creating Pannellum viewer with config:', JSON.stringify(config, null, 2));
        this.createPannellumViewer(config, imageUrl);

        var self = this;
        if (scene.pitch !== undefined || scene.yaw !== undefined) {
            var targetPitch = scene.pitch || 0;
            var targetYaw = scene.yaw || 0;

            if (this.sceneMain) {
                this.sceneMain.on('load', function() {
                    console.log('Applying camera direction on load:', { pitch: targetPitch, yaw: targetYaw });
                    self.sceneMain.lookAt(targetPitch, targetYaw, self.sceneMain.getHfov(), 500);
                    self.loadHotspotsList();
                });
            }
        } else {
            if (this.sceneMain) {
                this.sceneMain.on('load', function() {
                    setTimeout(function() {
                        self.loadHotspotsList();
                    }, 100);
                });
            }
        }

        if (this.sceneMain && this.sceneMain.isLoaded()) {
            if (scene.pitch !== undefined || scene.yaw !== undefined) {
                var targetPitch = scene.pitch || 0;
                var targetYaw = scene.yaw || 0;
                console.log('Applying camera direction (already loaded):', { pitch: targetPitch, yaw: targetYaw });
                this.sceneMain.lookAt(targetPitch, targetYaw, this.sceneMain.getHfov(), 500);
            }
            var self2 = this;
            setTimeout(function() {
                self2.loadHotspotsList();
            }, 100);
        }
    }

    /**
     * Add event handlers to configuration
     */
    addEventHandlersToConfig(config) {
        console.log('=== addEventHandlersToConfig ===');
        var self = this;

        config.onClickHotSpot = function(hs) {
            return self.onClickHotSpot(hs);
        };
        config.onClick = function(hs) {
            return self.onClick(hs);
        };

        if (!this.isInIframe) {
            config.onDblClick = function(coords) {
                return self.onDblClick(coords);
            };
            config.onContextMenuHotSpot = function(coords, screenCoords, event, hotSpot) {
                return self.onContextMenuHotSpot(coords, screenCoords, event, hotSpot);
            };
            config.onContextMenu = function(coords, screenCoords, event) {
                return self.onContextMenu(coords, screenCoords, event);
            };
        }
    }

    /**
     * Event handlers
     */
    onDblClick(coords) {
        if (this.isInIframe) return;
        console.log('Double click:', coords);
        if (coords) this.openHotSpotModal(coords);
    }

    onClick(hs) {
        console.log('onClick:', hs);
    }

    /**
     * Handle hotspot click
     */
    handleHotspotClick(hs) {
        console.log('Hotspot clicked:', hs);

        // Копируем текущий путь с разделением
        var currentConfig = this.sceneMain ? this.sceneMain.getConfig() : null;
        var fullUrl = '';
        if (currentConfig) {
            fullUrl = (currentConfig.scenes && currentConfig.scenes.scene1 && currentConfig.scenes.scene1.panorama) ||
                      currentConfig.panorama || '';
        }

        if (fullUrl) {
            var result = this.splitUrlIntoPathAndPhoto(fullUrl);
            var copyText = 'path=' + result.path + '\nphoto=' + result.photo;
            this.copyToClipboardLegacy(copyText, null);
            console.log('Copied with separation:', { path: result.path, photo: result.photo });
        }

        return false;
    }

    onContextMenuHotSpot(coords, screenCoords, event, hotSpot) {
        if (this.isInIframe) return;
        console.log('Right click on HotSpot:', { coords: coords, screenCoords: screenCoords, hotSpot: hotSpot });
        this.showCustomContextMenu(screenCoords.x, screenCoords.y, {
            type: 'hotspot',
            data: hotSpot,
            coords: coords
        });
    }

    onContextMenu(coords, screenCoords, event) {
        if (this.isInIframe) return;
        console.log('Right click on scene:', { coords: coords, screenCoords: screenCoords });
        this.showCustomContextMenu(screenCoords.x, screenCoords.y, {
            type: 'scene',
            data: coords,
            screenCoords: screenCoords
        });
    }

    /**
     * Разделяет полный URL на path и photo
     */
    splitUrlIntoPathAndPhoto(fullUrl) {
        if (!fullUrl) return { path: '', photo: '' };

        // Если это внешний URL
        if (this.isExternalUrl(fullUrl)) {
            var basePath = this.basePath || '';
            // Проверяем, начинается ли URL с basePath
            if (basePath && fullUrl.indexOf(basePath) === 0) {
                var photo = fullUrl.substring(basePath.length);
                // Убираем лишний слеш в начале photo
                photo = photo.replace(/^\/+/, '');
                return { path: basePath, photo: photo };
            }
            // Если не нашли basePath, ищем последний слеш
            var lastSlash = fullUrl.lastIndexOf('/');
            if (lastSlash > 0) {
                var path = fullUrl.substring(0, lastSlash);
                var photo = fullUrl.substring(lastSlash + 1);
                return { path: path, photo: photo };
            }
            return { path: '', photo: fullUrl };
        }

        // Относительный путь
        return { path: this.basePath || '', photo: fullUrl };
    }

    /**
     * Копирует путь с разделением на path и photo в буфер обмена
     */
    copyPathWithSeparation() {
        if (this.isInIframe) return;

        var currentConfig = this.sceneMain ? this.sceneMain.getConfig() : null;
        var fullUrl = '';
        if (currentConfig) {
            fullUrl = (currentConfig.scenes && currentConfig.scenes.scene1 && currentConfig.scenes.scene1.panorama) ||
                      currentConfig.panorama || '';
        }

        if (!fullUrl) {
            alert('Нет текущей панорамы для копирования');
            return;
        }

        var result = this.splitUrlIntoPathAndPhoto(fullUrl);
        this.lastCopiedPath = result.path;
        this.lastCopiedPhoto = result.photo;

        var copyText = 'path=' + result.path + '\nphoto=' + result.photo;
        this.copyToClipboardLegacy(copyText, null);

        alert('Скопировано в буфер обмена:\n' + copyText);
        console.log('Copied with separation:', { path: result.path, photo: result.photo });
    }

    /**
     * Вставляет path и photo из буфера обмена
     */
    async pastePathAndPhoto() {
        if (this.isInIframe) return;

        try {
            var text = await navigator.clipboard.readText();
            console.log('Clipboard text:', text);

            var lines = text.split('\n');
            var path = '';
            var photo = '';

            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (line.indexOf('path=') === 0) {
                    path = line.substring(5).trim();
                } else if (line.indexOf('photo=') === 0) {
                    photo = line.substring(6).trim();
                }
            }

            if (path && photo) {
                document.getElementById('pathInput').value = path;
                document.getElementById('photoInput').value = photo;
                this.updatePreviewUrl();
                console.log('Pasted:', { path: path, photo: photo });
            } else {
                if (text) {
                    document.getElementById('photoInput').value = text;
                    this.updatePreviewUrl();
                }
            }
        } catch (error) {
            console.error('Error reading clipboard:', error);
            alert('Не удалось прочитать буфер обмена. Попробуйте вставить вручную.');
        }
    }

    /**
     * Обновляет URL предпросмотра из полей path и photo
     */
    updatePreviewUrl() {
        var path = document.getElementById('pathInput').value.trim();
        var photo = document.getElementById('photoInput').value.trim();

        var fullUrl = '';
        if (path && photo) {
            var cleanPath = path.replace(/\/+$/, '');
            var cleanPhoto = photo.replace(/^\/+/, '');
            fullUrl = cleanPath + '/' + cleanPhoto;
        } else if (photo) {
            fullUrl = this.resolveImagePath(photo);
        }

        document.getElementById('fullUrlDisplay').value = fullUrl;
        return fullUrl;
    }

    /**
     * Hotspot management
     */
    openHotSpotModal(coords) {
        if (this.isInIframe) return;

        this.currentCoords = coords;
        this.selectedPreviewCoords = null;

        var modal = document.getElementById('hotspotModal');
        if (!modal) {
            console.error('Modal element not found!');
            return;
        }
        modal.style.display = 'flex';

        var currentConfig = this.sceneMain ? this.sceneMain.getConfig() : null;
        var fullUrl = '';
        if (currentConfig) {
            fullUrl = (currentConfig.scenes && currentConfig.scenes.scene1 && currentConfig.scenes.scene1.panorama) ||
                      currentConfig.panorama || '';
        }

        // Разделяем URL на path и photo
        var result = this.splitUrlIntoPathAndPhoto(fullUrl);

        // Если photo содержит абсолютный URL - извлекаем относительный путь
        var photoValue = result.photo;
        if (this.isExternalUrl(photoValue)) {
            var lastSlash = photoValue.lastIndexOf('/');
            if (lastSlash > 0) {
                photoValue = photoValue.substring(lastSlash + 1);
            }
        }

        var hotspotName = document.getElementById('hotspotName');
        if (hotspotName) hotspotName.value = '';

        var pathInput = document.getElementById('pathInput');
        if (pathInput) pathInput.value = result.path || this.basePath || '';

        var photoInput = document.getElementById('photoInput');
        if (photoInput) photoInput.value = photoValue || '';

        var fullUrlDisplay = document.getElementById('fullUrlDisplay');
        if (fullUrlDisplay) fullUrlDisplay.value = fullUrl || '';

        var hotspotType = document.getElementById('hotspotType');
        if (hotspotType) hotspotType.value = 'scene';

        var hotspotText = document.getElementById('hotspotText');
        if (hotspotText) hotspotText.value = '';

        var selectedCoordinates = document.getElementById('selectedCoordinates');
        if (selectedCoordinates) selectedCoordinates.textContent = 'Не выбрано';

        var previewContainer = document.getElementById('previewContainer');
        if (previewContainer) previewContainer.style.display = 'none';

        var importSuccess = document.getElementById('importSuccess');
        if (importSuccess) importSuccess.style.display = 'none';

        var previewIframeContainer = document.getElementById('previewIframeContainer');
        if (previewIframeContainer) previewIframeContainer.innerHTML = '';

        this.loadHotspotsList();
    }

    closeModal() {
        var modal = document.getElementById('hotspotModal');
        modal.style.display = 'none';

        if (this.previewIframe) {
            this.previewIframe.remove();
            this.previewIframe = null;
        }

        if (this.messageHandlerBound) {
            window.removeEventListener('message', this.handlePreviewMessage.bind(this));
            this.messageHandlerBound = false;
        }
    }

    loadPreview() {
        if (this.isInIframe) return;

        var photoInput = document.getElementById('photoInput');
        var pathInput = document.getElementById('pathInput');

        if (!photoInput) {
            console.error('Element #photoInput not found');
            return;
        }

        var photo = photoInput.value.trim();
        var path = pathInput ? pathInput.value.trim() : '';

        if (!photo) {
            alert('Введите относительный путь к фото');
            return;
        }

        var fullUrl;
        if (path) {
            fullUrl = path + '/' + photo;
        } else {
            fullUrl = this.resolveImagePath(photo);
        }

        var fullUrlDisplay = document.getElementById('fullUrlDisplay');
        if (fullUrlDisplay) fullUrlDisplay.value = fullUrl;

        var previewContainer = document.getElementById('previewContainer');
        if (previewContainer) previewContainer.style.display = 'block';

        var selectedCoordinates = document.getElementById('selectedCoordinates');
        if (selectedCoordinates) selectedCoordinates.innerHTML = '<em>Загрузка...</em>';

        var container = document.getElementById('previewIframeContainer');
        if (!container) {
            console.error('Element #previewIframeContainer not found');
            return;
        }
        container.innerHTML = '';

        this.previewIframe = document.createElement('iframe');
        this.previewIframe.id = 'previewIframe';
        this.previewIframe.src = 'viewer_preview.html?photo=' + encodeURIComponent(fullUrl);
        this.previewIframe.style.cssText = 'width:100%;height:100%;border:none;';
        container.appendChild(this.previewIframe);

        if (!this.messageHandlerBound) {
            window.addEventListener('message', this.handlePreviewMessage.bind(this));
            this.messageHandlerBound = true;
        }
    }

    handlePreviewMessage(event) {
        var iframe = document.getElementById('previewIframe');
        if (!iframe || event.source !== iframe.contentWindow) return;

        if (event.data && event.data.type === 'hotspot_preview_coords') {
            this.selectedPreviewCoords = {
                click: event.data.clickCoords,
                view: event.data.viewCoords
            };

            var coordsHtml =
                '<div style="margin-bottom:8px;">' +
                    '<strong>Координаты клика:</strong><br>' +
                    'Yaw: <code>' + this.selectedPreviewCoords.click.yaw.toFixed(2) + '°</code>, ' +
                    'Pitch: <code>' + this.selectedPreviewCoords.click.pitch.toFixed(2) + '°</code>' +
                '</div>' +
                '<div>' +
                    '<strong>Направление камеры:</strong><br>' +
                    'Yaw: <code>' + this.selectedPreviewCoords.view.yaw.toFixed(2) + '°</code>, ' +
                    'Pitch: <code>' + this.selectedPreviewCoords.view.pitch.toFixed(2) + '°</code>' +
                '</div>' +
                '<div style="margin-top:8px;color:#4CAF50;">' +
                    '<strong>✓ Координаты выбраны!</strong>' +
                '</div>';

            document.getElementById('selectedCoordinates').innerHTML = coordsHtml;
        }
    }

    saveHotspot() {
        if (this.isInIframe) return;

        var name = document.getElementById('hotspotName').value.trim();
        var photo = document.getElementById('photoInput').value.trim();
        var path = document.getElementById('pathInput').value.trim();
        var type = document.getElementById('hotspotType').value;
        var text = document.getElementById('hotspotText').value.trim();

        if (!photo) {
            alert('Относительный путь к фото обязателен');
            return;
        }

        // Определяем корневой путь
        var savedPath = path || this.basePath || '';

        // Получаем относительный путь к фото
        var savedPhoto = photo.replace(/^\/+/, '').replace(/\/+$/, '');

        // Если photo содержит полный URL - извлекаем только относительную часть
        if (this.isExternalUrl(savedPhoto)) {
            // Если photo начинается с savedPath - убираем его
            if (savedPath && savedPhoto.indexOf(savedPath) === 0) {
                savedPhoto = savedPhoto.substring(savedPath.length);
            } else {
                // Ищем последний слеш и берем все после него
                var lastSlash = savedPhoto.lastIndexOf('/');
                if (lastSlash > 0) {
                    // Проверяем, может это путь с датой
                    var pathPart = savedPhoto.substring(0, lastSlash);
                    var fileName = savedPhoto.substring(lastSlash + 1);
                    // Если есть папка с датой - сохраняем полный относительный путь
                    if (pathPart.includes('/')) {
                        var parts = pathPart.split('/');
                        // Берем последние 2 части пути (например: img/13.08.2026)
                        var relativePath = parts.slice(-2).join('/');
                        savedPhoto = relativePath + '/' + fileName;
                    } else {
                        savedPhoto = fileName;
                    }
                }
            }
        }

        // Если photo начинается с basePath - убираем его
        if (savedPath && savedPhoto.indexOf(savedPath) === 0) {
            savedPhoto = savedPhoto.substring(savedPath.length);
        }

        savedPhoto = savedPhoto.replace(/^\/+/, '').replace(/\/+$/, '');
        savedPath = savedPath.replace(/\/+$/, '');

        if (!this.selectedPreviewCoords) {
            if (!confirm('Координаты не выбраны. Использовать (0,0)?')) return;
            this.selectedPreviewCoords = { view: { pitch: 0, yaw: 0 } };
        }

        var hotspot = {
            id: Date.now(),
            name: name || 'Без имени',
            type: type,
            text: text || 'Точка перехода',
            pitch: this.currentCoords.pitch,
            yaw: this.currentCoords.yaw,
            targetPitch: this.selectedPreviewCoords.view.pitch,
            targetYaw: this.selectedPreviewCoords.view.yaw,
            panorama_url: savedPhoto, // ТОЛЬКО относительный путь
            path: savedPath, // Корневой путь
            createdAt: new Date().toISOString()
        };

        console.log('Saving hotspot:', hotspot);

        this.currentHotspots.push(hotspot);
        this.loadHotspotsList();

        if (!this.sceneMain) {
            console.warn('sceneMain is null, trying to reinitialize');
            var canvas = document.getElementById('canvas');
            if (canvas && canvas._pannellumViewer) {
                this.sceneMain = canvas._pannellumViewer;
                console.log('Restored sceneMain from canvas');
            }
        }

        this.updateSceneWithHotspots();
        this.closeModal();

        console.log('Hotspot saved, total:', this.currentHotspots.length);
    }


    updateSceneWithHotspots() {
        if (!this.sceneMain) {
            console.log('No sceneMain, cannot update hotspots');
            return;
        }

        var self = this;

        // Удаляем все старые хотспоты со сцены
        try {
            this.sceneMain.removeHotSpot('all');
            console.log('Removed all old hotspots via API');
        } catch (e) {
            console.warn('Error removing hotspots:', e);
        }

        // Если нет хотспотов - выходим
        if (this.currentHotspots.length === 0) {
            console.log('No hotspots to display');
            setTimeout(function() {
                if (self.sceneMain && typeof self.sceneMain.resize === 'function') {
                    self.sceneMain.resize();
                }
            }, 50);
            return;
        }

        console.log('Adding ' + this.currentHotspots.length + ' hotspots to scene');

        // Добавляем каждый хотспот заново
        this.currentHotspots.forEach(function(hs, index) {
            // Формируем полный URL для panorama_url
            var fullUrl = hs.panorama_url;
            var path = hs.path || self.basePath || '';

            // Если panorama_url относительный и есть path - склеиваем
            if (fullUrl && !self.isExternalUrl(fullUrl) && path) {
                var cleanPath = path.replace(/\/+$/, '');
                var cleanPhoto = fullUrl.replace(/^\/+/, '');
                fullUrl = cleanPath + '/' + cleanPhoto;
            }
            // Если panorama_url относительный и нет path - используем корень из текущего URL
            else if (fullUrl && !self.isExternalUrl(fullUrl)) {
                var currentUrl = window.location.href;
                var lastSlashIndex = currentUrl.lastIndexOf('/');
                var rootPath = currentUrl.substring(0, lastSlashIndex);
                var cleanPhoto = fullUrl.replace(/^\/+/, '');
                fullUrl = rootPath + '/' + cleanPhoto;
            }
            // Если panorama_url уже абсолютный - используем как есть

            var hotspotForPannellum = {
                pitch: hs.pitch,
                yaw: hs.yaw,
                type: hs.type || "scene",
                text: hs.text || "Переход",
                sceneId: "scene1",
                panorama_url: fullUrl,
                point_pitch: hs.targetPitch || 0,
                point_yaw: hs.targetYaw || 0,
                targetHfov: hs.targetHfov || 100,
                path: path
            };

            console.log('Adding hotspot #' + index + ':', hotspotForPannellum);

            try {
                if (self.sceneMain && typeof self.sceneMain.addHotSpot === 'function') {
                    self.sceneMain.addHotSpot(hotspotForPannellum, 'scene1');
                } else {
                    console.warn('sceneMain.addHotSpot is not a function');
                }
            } catch (e) {
                console.error('Error adding hotspot:', e);
            }
        });

        // Принудительно перерисовываем
        setTimeout(function() {
            try {
                if (self.sceneMain && typeof self.sceneMain.renderHotSpots === 'function') {
                    self.sceneMain.renderHotSpots();
                }
                if (self.sceneMain && typeof self.sceneMain.resize === 'function') {
                    self.sceneMain.resize();
                }
                if (self.sceneMain) {
                    var pitch = self.sceneMain.getPitch ? self.sceneMain.getPitch() : 0;
                    var yaw = self.sceneMain.getYaw ? self.sceneMain.getYaw() : 0;
                    var hfov = self.sceneMain.getHfov ? self.sceneMain.getHfov() : 100;
                    self.sceneMain.lookAt(pitch, yaw, hfov, 0);
                }
            } catch (e) {
                console.warn('Error during refresh:', e);
            }
        }, 300);

        console.log('Scene updated with ' + this.currentHotspots.length + ' hotspots.');
    }

    /**
     * Принудительно перерисовывает хотспоты на сцене
     */
    renderHotSpot() {
        if (this.sceneMain && typeof this.sceneMain.renderHotSpot === 'function') {
            this.sceneMain.renderHotSpot();
        }
    }

    loadHotspotsList() {
        var container = document.getElementById('hotspotsContainer');
        if (!container) {
            console.error('Container #hotspotsContainer not found');
            return;
        }
        container.innerHTML = '';

        if (this.currentHotspots.length === 0) {
            container.innerHTML = '<p style="color:#666;font-style:italic;">Нет созданных точек</p>';
            return;
        }

        var self = this;
        this.currentHotspots.forEach(function(hotspot, index) {
            var item = document.createElement('div');
            item.className = 'hotspot-item';

            var displayPath = hotspot.path || '';
            var displayPhoto = hotspot.panorama_url || '';

            item.innerHTML =
                '<div style="flex-grow:1;">' +
                '<div style="font-weight:bold;margin-bottom:4px;">' + self.escapeHtml(hotspot.name) + '</div>' +
                '<div style="font-size:12px;color:#555;margin-bottom:2px;">' +
                '<strong>Координаты:</strong> Yaw ' + hotspot.yaw.toFixed(2) + ', Pitch ' + hotspot.pitch.toFixed(2) +
                '</div>' +
                '<div style="font-size:12px;color:#555;margin-bottom:2px;">' +
                '<strong>Направление:</strong> Yaw ' + hotspot.targetYaw.toFixed(2) + ', Pitch ' + hotspot.targetPitch.toFixed(2) +
                '</div>' +
                '<div style="font-size:11px;color:#777;margin-top:4px;word-break:break-all;">' +
                '<span style="color:#999;">path:</span> ' + self.truncateUrl(displayPath, 30) + '<br>' +
                '<span style="color:#999;">photo:</span> ' + self.truncateUrl(displayPhoto, 40) +
                '</div>' +
                '</div>' +
                '<div class="hotspot-actions">' +
                '<button onclick="window.panoramaEditor.editHotspot(' + index + ')" class="btn" style="background:#ffc107;color:black;">✏️</button>' +
                '<button onclick="window.panoramaEditor.deleteHotspot(' + index + ')" class="btn" style="background:#dc3545;color:white;">🗑️</button>' +
                '</div>';

            container.appendChild(item);
        });

        // ПРИНУДИТЕЛЬНО ОБНОВЛЯЕМ ОТОБРАЖЕНИЕ ХОТСПОТОВ НА СЦЕНЕ
        if (this.sceneMain && this.currentHotspots.length > 0) {
            // Добавляем хотспоты на сцену, если их там нет
            this.updateSceneWithHotspots();
        }
    }

    editHotspot(index) {
        if (this.isInIframe) return;

        var hotspot = this.currentHotspots[index];

        document.getElementById('hotspotName').value = hotspot.name;
        document.getElementById('pathInput').value = hotspot.path || this.basePath || '';
        document.getElementById('photoInput').value = hotspot.panorama_url;
        document.getElementById('hotspotText').value = hotspot.text;
        document.getElementById('hotspotType').value = hotspot.type || 'scene';

        var fullUrl = hotspot.path ? hotspot.path + '/' + hotspot.panorama_url : this.resolveImagePath(hotspot.panorama_url);
        document.getElementById('fullUrlDisplay').value = fullUrl;

        this.currentCoords = { pitch: hotspot.pitch, yaw: hotspot.yaw };

        if (hotspot.targetPitch !== undefined && hotspot.targetYaw !== undefined) {
            this.selectedPreviewCoords = {
                view: { pitch: hotspot.targetPitch, yaw: hotspot.targetYaw }
            };
            document.getElementById('selectedCoordinates').innerHTML =
                '<div style="margin-bottom:8px;">' +
                '<strong>Направление камеры:</strong><br>' +
                'Yaw: <code>' + this.selectedPreviewCoords.view.yaw.toFixed(2) + '°</code>, ' +
                'Pitch: <code>' + this.selectedPreviewCoords.view.pitch.toFixed(2) + '°</code>' +
                '</div>' +
                '<div style="color:#666;font-size:12px;">(загружено из сохранённой точки)</div>';
        }

        // Удаляем старую точку и открываем модалку для редактирования
        this.currentHotspots.splice(index, 1);
        this.loadHotspotsList();

        // Открываем модалку
        var modal = document.getElementById('hotspotModal');
        if (modal) {
            modal.style.display = 'flex';
        }

        // Обновляем сцену без этой точки
        this.updateSceneWithHotspots();
    }

    deleteHotspot(index) {
        if (this.isInIframe) return;

        if (confirm('Удалить эту точку?')) {
            // Удаляем точку из массива
            this.currentHotspots.splice(index, 1);

            // Обновляем список в UI
            this.loadHotspotsList();

            // Обновляем сцену (удаляем точку со сцены)
            this.updateSceneWithHotspots();

            console.log('Hotspot deleted, remaining:', this.currentHotspots.length);
        }
    }

    /**
     * Export/Import
     */
    exportToJson() {
        if (this.isInIframe) return;

        if (this.currentHotspots.length === 0) {
            alert('Нет точек для экспорта');
            return;
        }

        var cameraPitch = 0;
        var cameraYaw = 0;

        try {
            if (this.sceneMain && typeof this.sceneMain.getPitch === 'function' && typeof this.sceneMain.getYaw === 'function') {
                cameraPitch = this.sceneMain.getPitch();
                cameraYaw = this.sceneMain.getYaw();
            }
        } catch (e) {
            console.error('Error getting camera direction:', e);
        }

        var self = this;
        var jsonData = {
            pitchCam: parseFloat(cameraPitch.toFixed(12)),
            yawCam: parseFloat(cameraYaw.toFixed(12)),
            hotSpots: this.currentHotspots.map(function(h) {
                return {
                    id: h.id || Date.now(),
                    name: h.name || 'Без имени',
                    type: h.type || 'scene',
                    text: h.text || 'Переход',
                    pitch: parseFloat(h.pitch.toFixed(12)),
                    yaw: parseFloat(h.yaw.toFixed(12)),
                    targetPitch: parseFloat((h.targetPitch || 0).toFixed(12)),
                    targetYaw: parseFloat((h.targetYaw || 0).toFixed(12)),
                    panorama_url: h.panorama_url,
                    path: h.path || '',
                    createdAt: h.createdAt || new Date().toISOString()
                };
            })
        };

        var jsonString = JSON.stringify(jsonData, null, 2);
        var fileName = this.getExportFileName();
        this.downloadJsonFile(jsonString, fileName);
    }

    importJson() {
        if (this.isInIframe) return;
        document.getElementById('jsonFileInput').click();
    }

    handleJsonFileSelect(event) {
        if (this.isInIframe) return;

        var file = event.target.files[0];
        if (!file) return;

        var reader = new FileReader();
        var self = this;

        reader.onload = function(e) {
            try {
                var importedData = JSON.parse(e.target.result);
                var hotspotsArray = [];
                var cameraPitch = 0;
                var cameraYaw = 0;

                if (importedData && importedData.hotSpots && Array.isArray(importedData.hotSpots)) {
                    hotspotsArray = importedData.hotSpots;
                    cameraPitch = importedData.pitchCam || 0;
                    cameraYaw = importedData.yawCam || 0;
                } else if (Array.isArray(importedData)) {
                    hotspotsArray = importedData;
                } else if (importedData && importedData.hotspots && Array.isArray(importedData.hotspots)) {
                    hotspotsArray = importedData.hotspots;
                } else {
                    throw new Error('Некорректный формат JSON. Ожидается поле hotSpots');
                }

                if (hotspotsArray.length > 0) {
                    var first = hotspotsArray[0];
                    if (first.pitch === undefined || first.yaw === undefined || !first.panorama_url) {
                        throw new Error('Некорректная структура точек в JSON');
                    }
                }

                var existingIds = new Set(self.currentHotspots.map(function(h) { return h.id; }));
                var newHotspots = hotspotsArray.filter(function(h) {
                    return !existingIds.has(h.id);
                });

                newHotspots.forEach(function(h) {
                    if (!h.id) h.id = Date.now() + Math.floor(Math.random() * 1000);
                    if (!h.createdAt) h.createdAt = new Date().toISOString();
                    if (!h.path) h.path = '';
                });

                self.currentHotspots = self.currentHotspots.concat(newHotspots);
                self.loadHotspotsList();
                self.updateSceneWithHotspots();

                if (cameraPitch !== 0 || cameraYaw !== 0) {
                    if (self.sceneMain) {
                        self.sceneMain.lookAt(cameraPitch, cameraYaw, self.sceneMain.getHfov(), 1000);
                    }
                }

                var successDiv = document.getElementById('importSuccess');
                successDiv.innerHTML =
                    '<strong>✓ Импорт успешно завершен!</strong><br>' +
                    'Загружено ' + newHotspots.length + ' точек (всего: ' + self.currentHotspots.length + ')' +
                    (cameraPitch !== 0 || cameraYaw !== 0 ?
                        '<br>Направление: Pitch=' + cameraPitch.toFixed(2) + '°, Yaw=' + cameraYaw.toFixed(2) + '°' : '');
                successDiv.style.display = 'block';
                setTimeout(function() {
                    successDiv.style.display = 'none';
                }, 5000);

                console.log('Imported ' + newHotspots.length + ' hotspots');

            } catch (error) {
                alert('Ошибка чтения JSON: ' + error.message);
                console.error('Import error:', error);
            }
        };

        reader.onerror = function() {
            alert('Ошибка чтения файла');
        };

        reader.readAsText(file);
        event.target.value = '';
    }

    /**
     * Utility methods
     */
    escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    truncateUrl(url, maxLen) {
        if (maxLen === undefined) maxLen = 40;
        if (!url) return '';
        return url.length > maxLen ? url.substring(0, maxLen) + '...' : url;
    }

    getExportFileName() {
        try {
            var config = this.sceneMain ? this.sceneMain.getConfig() : null;
            var panorama = '';
            if (config) {
                panorama = (config.scenes && config.scenes.scene1 && config.scenes.scene1.panorama) ||
                           config.panorama || '';
            }
            var parts = panorama.split('/');
            var fileName = parts[parts.length - 1];
            if (fileName) {
                fileName = fileName.split('?')[0];
                return fileName.replace(/\.[^/.]+$/, '') + '.json';
            }
        } catch (e) {
            console.error('Error getting export filename:', e);
        }
        return 'hotspots_export.json';
    }

    downloadJsonFile(jsonData, fileName) {
        var blob = new Blob([jsonData], { type: 'application/json' });
        var url = URL.createObjectURL(blob);

        var a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(function() {
            URL.revokeObjectURL(url);
        }, 1000);
    }

    copyToClipboardLegacy(text, callback) {
        var textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.cssText = 'position:fixed;left:-999999px;top:-999999px;';
        document.body.appendChild(textArea);

        textArea.focus();
        textArea.select();

        try {
            var success = document.execCommand('copy');
            console.log('Copy ' + (success ? 'successful' : 'failed'));
            if (callback) callback(success ? null : new Error('Copy failed'));
        } catch (err) {
            console.error('Copy error:', err);
            if (callback) callback(err);
        } finally {
            document.body.removeChild(textArea);
        }
    }

    showCustomContextMenu(x, y, data) {
        if (this.isInIframe) return;

        var oldMenu = document.getElementById('custom-context-menu');
        if (oldMenu) oldMenu.remove();

        var menu = document.createElement('div');
        menu.id = 'custom-context-menu';
        menu.style.cssText =
            'position:absolute; left:' + x + 'px; top:' + y + 'px;' +
            'background:white; border:1px solid #ccc;' +
            'box-shadow:2px 2px 5px rgba(0,0,0,0.2);' +
            'z-index:10000; padding:5px 0; min-width:150px;';

        if (data.type === 'hotspot') {
            menu.innerHTML =
                '<div class="menu-item" onclick="window.panoramaEditor.handleHotSpotAction(\'edit\', ' + JSON.stringify(data.data).replace(/"/g, '&quot;') + ')" style="padding:5px 10px;cursor:pointer;">✏️ Edit HotSpot</div>' +
                '<div class="menu-item" onclick="window.panoramaEditor.handleHotSpotAction(\'delete\', ' + JSON.stringify(data.data).replace(/"/g, '&quot;') + ')" style="padding:5px 10px;cursor:pointer;">🗑️ Delete HotSpot</div>' +
                '<hr style="margin:5px 0;">' +
                '<div class="menu-item" onclick="window.panoramaEditor.copyCoords(' + JSON.stringify(data.coords) + ')" style="padding:5px 10px;cursor:pointer;">📋 Copy Coordinates</div>';
        } else {
            menu.innerHTML =
                '<div class="menu-item" onclick="window.panoramaEditor.addHotSpotAt(' + JSON.stringify(data.data) + ')" style="padding:5px 10px;cursor:pointer;">➕ Add HotSpot Here</div>' +
                '<div class="menu-item" onclick="window.panoramaEditor.copyCoords(' + JSON.stringify(data.data) + ')" style="padding:5px 10px;cursor:pointer;">📋 Copy Coordinates</div>' +
                '<hr style="margin:5px 0;">' +
                '<div class="menu-item" onclick="window.panoramaEditor.centerView(' + JSON.stringify(data.data) + ')" style="padding:5px 10px;cursor:pointer;">🎯 Center View Here</div>';
        }

        document.body.appendChild(menu);

        var closeMenu = function(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        document.addEventListener('click', closeMenu);
    }

    handleHotSpotAction(action, hotSpot) {
        if (this.isInIframe) return;
        console.log(action + ' HotSpot:', hotSpot);
        alert(action + ' HotSpot: ' + (hotSpot.text || hotSpot.type));
    }

    copyCoords(coords) {
        if (this.isInIframe) return;
        var text = 'Yaw: ' + coords.yaw.toFixed(2) + ', Pitch: ' + coords.pitch.toFixed(2);
        navigator.clipboard.writeText(text)
            .then(function() {
                console.log('Copied:', text);
            })
            .catch(function() {
                alert('Не удалось скопировать координаты');
            });
    }

    forceClearAndReload(imageUrl, pitch, yaw) {
        console.log('=== forceClearAndReload ===');
        // Полная очистка
        this.currentHotspots = [];
        this.loadHotspotsList();

        if (this.sceneMain) {
            // Удаляем все хотспоты
            this.sceneMain.removeHotSpot('all');
            // Создаем новую конфигурацию с пустым массивом хотспотов
            var newConfig = this.createBaseJsonConfig();
            var scene = newConfig.scenes.scene1;
            scene.panorama = imageUrl;
            scene.pitch = pitch || 0;
            scene.yaw = yaw || 0;
            scene.hotSpots = [];

            // Уничтожаем старый просмотрщик
            this.sceneMain.destroy();
            this.sceneMain = null;

            // Создаем новый с пустыми хотспотами
            this.sceneMain = window.pannellum.viewer(this.canvasId, newConfig);
            this.currentScene = imageUrl;
        }
        console.log('Force clear and reload complete');
    };

    /**
     * Очищает все хотспоты в редакторе
     * Вызывается из Pannellum при переходе на новую сцену
     */
    clearHotspots() {
        console.log('=== clearHotspots ===');
        // Очищаем массив хотспотов
        this.currentHotspots = [];
        // Обновляем список в UI
        this.loadHotspotsList();
        // Если есть сцена - удаляем хотспоты из нее
        if (this.sceneMain) {
            this.sceneMain.removeHotSpot('all');
        }
        console.log('Hotspots cleared');
    }

    addHotSpotAt(coords) {
        if (this.isInIframe) return;
        console.log('Add HotSpot at:', coords);
        alert('Add HotSpot at: Yaw=' + coords.yaw.toFixed(2) + ', Pitch=' + coords.pitch.toFixed(2));
    }

    centerView(coords) {
        if (this.sceneMain) {
            this.sceneMain.lookAt(coords.pitch, coords.yaw, this.sceneMain.getHfov(), 500);
        }
    }

    handleParentMessage(event) {
        if (event.data && event.data.type === 'pannellum_control') {
            switch (event.data.action) {
                case 'loadScene':
                    if (event.data.photo) {
                        var url = new URL(window.location.href);
                        url.searchParams.set('photo', event.data.photo);
                        if (event.data.hotSpots) {
                            url.searchParams.set('hotSpots', encodeURIComponent(JSON.stringify(event.data.hotSpots)));
                        }
                        window.history.pushState({}, '', url);
                        this.setSelectPanorama(event.data.hotSpot || null);
                    }
                    break;

                case 'getState':
                    try {
                        window.parent.postMessage({
                            type: 'pannellum_state',
                            currentScene: this.currentScene,
                            isLoaded: this.sceneMain ? this.sceneMain.isLoaded() : false,
                            hotspotsCount: this.currentHotspots.length
                        }, '*');
                    } catch (e) {
                        console.log('Cannot post message to parent');
                    }
                    break;

                // ДОБАВЛЯЕМ: обработка обновления хотспотов из Pannellum
                case 'updateHotspots':
                    if (event.data.hotspots) {
                        // Очищаем старые хотспоты
                        this.currentHotspots = [];
                        // Загружаем новые
                        this.currentHotspots = event.data.hotspots;
                        this.loadHotspotsList();
                        this.updateSceneWithHotspots();
                        console.log('Hotspots updated from Pannellum:', this.currentHotspots.length);
                    }
                    break;
            }
        }
    }

    initModalHandlers() {
        console.log('=== initModalHandlers ===');
        var self = this;

        // Проверяем существование элементов перед добавлением обработчиков
        var previewButton = document.getElementById('previewButton');
        if (previewButton) {
            previewButton.addEventListener('click', function() {
                self.loadPreview();
            });
        } else {
            console.warn('Element #previewButton not found');
        }

        var pathInput = document.getElementById('pathInput');
        if (pathInput) {
            pathInput.addEventListener('input', function() {
                self.updatePreviewUrl();
            });
        } else {
            console.warn('Element #pathInput not found');
        }

        var photoInput = document.getElementById('photoInput');
        if (photoInput) {
            photoInput.addEventListener('input', function() {
                self.updatePreviewUrl();
            });
        } else {
            console.warn('Element #photoInput not found');
        }

        var copyPathButton = document.getElementById('copyPathButton');
        if (copyPathButton) {
            copyPathButton.addEventListener('click', function() {
                self.copyPathWithSeparation();
            });
        } else {
            console.warn('Element #copyPathButton not found');
        }

        var pastePathButton = document.getElementById('pastePathButton');
        if (pastePathButton) {
            pastePathButton.addEventListener('click', function() {
                self.pastePathAndPhoto();
            });
        } else {
            console.warn('Element #pastePathButton not found');
        }

        var previewClsUrl = document.getElementById('previewClsUrl');
        if (previewClsUrl) {
            previewClsUrl.addEventListener('click', function() {
                document.getElementById('photoInput').value = '';
                document.getElementById('pathInput').value = '';
                document.getElementById('fullUrlDisplay').value = '';
            });
        } else {
            console.warn('Element #previewClsUrl not found');
        }

        var saveHotspotButton = document.getElementById('saveHotspotButton');
        if (saveHotspotButton) {
            saveHotspotButton.addEventListener('click', function() {
                self.saveHotspot();
            });
        } else {
            console.warn('Element #saveHotspotButton not found');
        }

        var exportJsonButton = document.getElementById('exportJsonButton');
        if (exportJsonButton) {
            exportJsonButton.addEventListener('click', function() {
                self.exportToJson();
            });
        } else {
            console.warn('Element #exportJsonButton not found');
        }

        var importJsonButton = document.getElementById('importJsonButton');
        if (importJsonButton) {
            importJsonButton.addEventListener('click', function() {
                self.importJson();
            });
        } else {
            console.warn('Element #importJsonButton not found');
        }

        var cancelButton = document.getElementById('cancelButton');
        if (cancelButton) {
            cancelButton.addEventListener('click', function() {
                self.closeModal();
            });
        } else {
            console.warn('Element #cancelButton not found');
        }

        var closeButton = document.querySelector('.close');
        if (closeButton) {
            closeButton.addEventListener('click', function() {
                self.closeModal();
            });
        } else {
            console.warn('Element .close not found');
        }

        var jsonFileInput = document.getElementById('jsonFileInput');
        if (jsonFileInput) {
            jsonFileInput.addEventListener('change', function(e) {
                self.handleJsonFileSelect(e);
            });
        } else {
            console.warn('Element #jsonFileInput not found');
        }

        var hotspotModal = document.getElementById('hotspotModal');
        if (hotspotModal) {
            hotspotModal.addEventListener('click', function(e) {
                if (e.target === e.currentTarget) {
                    self.closeModal();
                }
            });
        } else {
            console.warn('Element #hotspotModal not found');
        }

        console.log('Modal handlers initialized');
    }
}

// Создаем экземпляр редактора
console.log('Creating PanoramaEditor instance...');
window.panoramaEditor = new PanoramaEditor();
console.log('PanoramaEditor instance created');

