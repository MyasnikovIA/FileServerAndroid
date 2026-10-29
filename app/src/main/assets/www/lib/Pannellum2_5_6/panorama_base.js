/**
 * Panorama Base - Core functionality for panorama applications
 * @module PanoramaBase
 */
class PanoramaBase {
    constructor(canvasId = 'canvas', options = {}) {
        this.canvasId = canvasId;
        this.sceneMain = null;
        this.currentScene = null;
        this.isLoading = false;
        this.pendingCameraMove = null;
        this.hotspotClickHandler = null;
        this.basePath = null;
        this.originalPhotoPath = null;

        // Получаем параметры из URL (уже декодированные браузером)
        this.basePath = this.getBasePathFromUrl();
        this.originalPhotoPath = this.getPhotoPathFromUrl();

        console.log('=== PanoramaBase Constructor ===');
        console.log('basePath:', this.basePath);
        console.log('originalPhotoPath:', this.originalPhotoPath);

        this.defaultConfig = {
            hotSpotDebug: false,
            hotPointDebug: false,
            sceneFadeDuration: 1000,
            default: { firstScene: "scene1" },
            scenes: {
                scene1: {
                    title: "",
                    crossOrigin: "use-credentials",
                    autoLoad: true,
                    yaw: 0,
                    pitch: 0,
                    hotSpots: []
                }
            }
        };
    }

    /**
     * Получает photo из URL параметров (браузер уже декодировал)
     * @returns {string|null} Путь к фото или null
     */
    getPhotoPathFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const photoParam = params.get('photo');
        if (photoParam) {
            // Браузер уже декодировал параметр, просто нормализуем путь
            return this.normalizePath(photoParam);
        }
        return null;
    }

    /**
     * Получает basePath из URL параметров (браузер уже декодировал)
     * @returns {string|null} Базовый путь или null
     */
    getBasePathFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const pathParam = params.get('path');

        if (pathParam) {
            // Браузер уже декодировал параметр, убираем trailing slash
            return pathParam.replace(/\/+$/, '');
        }

        return null;
    }

    /**
     * Получает корневой путь из текущего URL (без имени страницы и параметров)
     * @returns {string} Корневой путь
     */
    getRootPathFromUrl() {
        const currentUrl = window.location.href;
        // Убираем параметры запроса
        const urlWithoutParams = currentUrl.split('?')[0];
        const lastSlashIndex = urlWithoutParams.lastIndexOf('/');
        return urlWithoutParams.substring(0, lastSlashIndex);
    }

    /**
     * Формирует полный путь к изображению
     * @param {string} imagePath - Путь к изображению
     * @param {string|null} overridePath - Переопределение базового пути
     * @returns {string} Полный URL
     */
    resolveImagePath(imagePath, overridePath = null) {
        if (!imagePath) return '';

        console.log('=== resolveImagePath ===');
        console.log('imagePath (input):', imagePath);
        console.log('overridePath:', overridePath);
        console.log('this.basePath:', this.basePath);

        // Если это уже абсолютный URL - возвращаем как есть
        if (this.isExternalUrl(imagePath)) {
            console.log('External URL detected, returning as-is');
            return imagePath;
        }

        // Нормализуем путь (заменяем обратные слеши)
        var cleanPath = this.normalizePath(imagePath);
        console.log('cleanPath (normalized):', cleanPath);

        // Убираем лишние слеши в начале
        cleanPath = cleanPath.replace(/^\/+/, '');
        console.log('cleanPath (without leading slash):', cleanPath);

        // Определяем базовый путь
        var basePath = overridePath || this.basePath;

        // Если basePath не указан, используем корень из текущего URL (без параметров)
        if (!basePath) {
            var currentUrl = window.location.href;
            // Убираем параметры запроса и имя файла
            var urlWithoutParams = currentUrl.split('?')[0];
            var lastSlashIndex = urlWithoutParams.lastIndexOf('/');
            basePath = urlWithoutParams.substring(0, lastSlashIndex);
            console.log('Using root path from current URL (without params):', basePath);
        }

        // Убираем лишние слеши в конце basePath
        var cleanBase = basePath.replace(/\/+$/, '');
        console.log('cleanBase (without trailing slash):', cleanBase);

        // Формируем результат с разделителем
        var result = cleanBase + '/' + cleanPath;
        console.log('Final resolved path:', result);
        return result;
    }

    /**
     * Проверяет, является ли URL внешним
     * @param {string} url - URL для проверки
     * @returns {boolean} true если внешний
     */
    isExternalUrl(url) {
        return /^https?:\/\//i.test(url);
    }

    /**
     * Нормализует путь (заменяет обратные слеши на прямые)
     * @param {string} path - Путь для нормализации
     * @returns {string} Нормализованный путь
     */
    normalizePath(path) {
        if (!path) return '';
        // Просто заменяем обратные слеши на прямые
        return path.replace(/\\/g, '/');
    }

    /**
     * Генерирует JSON URL из URL изображения
     * @param {string} imageUrl - URL изображения
     * @returns {string} JSON URL
     */
    getJsonUrlFromImageUrl(imageUrl) {
        if (!imageUrl) return '';
        // Убираем параметры запроса
        const cleanUrl = imageUrl.split('?')[0];
        let jsonUrl = cleanUrl.replace(/\.[^/.]+$/, '') + '.json';
        return jsonUrl;
    }

    /**
     * Создает базовую JSON конфигурацию для Pannellum
     * @param {Object} overrides - Переопределения конфигурации
     * @returns {Object} Объект конфигурации
     */
    createBaseJsonConfig(overrides = {}) {
        // Определяем, нужно ли использовать credentials
        // Если это внешний URL (raw.githack.com, github.com и т.д.) - используем 'anonymous'
        var isExternal = false;
        var currentUrl = window.location.href;
        var photoParam = this.getPhotoPathFromUrl();

        if (photoParam && this.isExternalUrl(photoParam)) {
            isExternal = true;
        }

        // Для внешних URL используем 'anonymous', для локальных - 'use-credentials'
        var crossOrigin = isExternal ? 'anonymous' : 'use-credentials';

        return {
            ...this.defaultConfig,
            ...overrides,
            crossOrigin: crossOrigin,
            onClickHotSpot: this.onClickHotSpot.bind(this)
        };
    }

    /**
     * Выполняет ожидаемое движение камеры
     * @returns {void}
     */
    executePendingCameraMove() {
        if (!this.pendingCameraMove || !this.sceneMain) return;

        const { pitch, yaw } = this.pendingCameraMove;

        this.sceneMain.lookAt(pitch, yaw, this.sceneMain.getHfov(), 1000, () => {
            console.log(`Camera positioned: Pitch=${pitch}, Yaw=${yaw}`);
            this.pendingCameraMove = null;
        });
    }

    /**
     * Получает направление камеры из хотспота или JSON данных
     * @param {Object|null} hotSpot - Объект хотспота
     * @param {Object} jsonData - JSON конфигурация
     * @returns {Object} { pitchCam, yawCam }
     */
    getCameraDirection(hotSpot, jsonData) {
        if (hotSpot?.point_pitch !== undefined && hotSpot?.point_yaw !== undefined) {
            return {
                pitchCam: hotSpot.point_pitch,
                yawCam: hotSpot.point_yaw
            };
        }

        if (jsonData?.pitchCam !== undefined && jsonData?.yawCam !== undefined) {
            return {
                pitchCam: jsonData.pitchCam,
                yawCam: jsonData.yawCam
            };
        }

        return {};
    }

    /**
     * Форматирует хотспоты для Pannellum
     * @param {Array} hotspots - Массив объектов хотспотов
     * @returns {Array} Отформатированные хотспоты
     */
    formatHotSpots(hotspots) {
        if (!Array.isArray(hotspots)) return [];

        var self = this;
        return hotspots.map(function(hotspot) {
            // Если есть path, используем его для формирования полного URL
            var fullUrl = hotspot.panorama_url || '';
            var path = hotspot.path || self.basePath || '';

            // Если panorama_url относительный и есть path - склеиваем с разделителем
            if (fullUrl && !self.isExternalUrl(fullUrl) && path) {
                var cleanPath = path.replace(/\/+$/, '');
                var cleanPhoto = fullUrl.replace(/^\/+/, '');
                fullUrl = cleanPath + '/' + cleanPhoto;
            }

            return {
                pitch: hotspot.pitch || 0,
                yaw: hotspot.yaw || 0,
                type: hotspot.type || "scene",
                text: hotspot.text || "Переход",
                sceneId: hotspot.sceneId || "scene1",
                panorama_url: fullUrl, // Полный URL для отображения
                point_pitch: hotspot.targetPitch || 0,
                point_yaw: hotspot.targetYaw || 0,
                customScale: hotspot.customScale || undefined,
                // Сохраняем относительный путь отдельно
                relative_path: hotspot.panorama_url || '',
                path: path
            };
        });
    }

    /**
     * Удаляет дубликаты хотспотов
     * @param {Array} hotspots - Массив хотспотов
     * @returns {Array} Уникальные хотспоты
     */
    removeDuplicateHotspots(hotspots) {
        if (!Array.isArray(hotspots)) return [];

        const seen = new Set();
        const unique = [];

        for (const item of hotspots) {
            const key = `${item.pitch}|${item.yaw}|${item.panorama_url || ''}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(item);
            }
        }

        return unique;
    }

    /**
     * Загружает хотспоты из JSON файла
     * @param {string} jsonUrl - URL JSON файла
     * @returns {Promise<Object>} JSON данные с массивом hotSpots
     */
    async loadHotSpotsFromJson(jsonUrl) {
        if (!jsonUrl) {
            return { hotSpots: [], pitchCam: 0, yawCam: 0 };
        }

        try {
            console.log('Loading JSON from:', jsonUrl);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(jsonUrl, {
                method: 'GET',
                mode: 'cors',
                headers: { 'Accept': 'application/json' },
                cache: 'force-cache',
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log(`Loaded JSON data from: ${jsonUrl}`);

            // Нормализация различных форматов JSON
            if (data?.hotSpots && Array.isArray(data.hotSpots)) {
                return data;
            }

            if (Array.isArray(data)) {
                return { hotSpots: data, pitchCam: 0, yawCam: 0 };
            }

            if (data?.hotspots && Array.isArray(data.hotspots)) {
                return { hotSpots: data.hotspots, pitchCam: 0, yawCam: 0 };
            }

            if (data?.scenes?.scene1?.hotSpots) {
                return {
                    hotSpots: data.scenes.scene1.hotSpots,
                    pitchCam: 0,
                    yawCam: 0
                };
            }

            return { hotSpots: [], pitchCam: 0, yawCam: 0 };

        } catch (error) {
            console.log(`Error loading JSON from ${jsonUrl}:`, error.message);
            return { hotSpots: [], pitchCam: 0, yawCam: 0 };
        }
    }

    /**
     * Получает JSON данные через XHR (синхронно)
     * @param {string} url - URL для запроса
     * @param {*} data - Данные для отправки
     * @returns {Object} Распарсенный JSON ответ
     */
    getJsonUrlData(url, data = null) {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, false);
        xhr.send(data);

        if (xhr.status !== 200) {
            console.error(`${xhr.status}: ${xhr.statusText} (${url})`);
            return { error: `${xhr.status} : ${xhr.statusText}` };
        }

        try {
            return JSON.parse(xhr.response);
        } catch {
            return { error: 'Invalid JSON response' };
        }
    }

    /**
     * Создает экземпляр Pannellum просмотрщика
     * @param {Object} config - Pannellum конфигурация
     * @param {string} sceneName - Идентификатор сцены
     * @returns {void}
     */
    createPannellumViewer(config, sceneName) {
        // Очищаем предыдущий просмотрщик
        if (this.sceneMain && typeof this.sceneMain.destroy === 'function') {
            this.sceneMain.destroy();
        }

        this.sceneMain = window.pannellum.viewer(this.canvasId, config);
        this.currentScene = sceneName;

        // ===== ВАЖНО: сохраняем ссылку в canvas =====
        var canvas = document.getElementById(this.canvasId);
        if (canvas) {
            canvas._pannellumViewer = this.sceneMain;
        }

        // Настраиваем ожидаемое движение камеры
        if (this.pendingCameraMove) {
            this.sceneMain.on('load', () => this.executePendingCameraMove());
        }
    }

    /**
     * Обработчик клика по хотспоту (переопределяется в наследниках)
     * @param {Object} hs - Объект хотспота
     * @returns {boolean} true если обработано
     */
    onClickHotSpot(hs) {
        if (this.hotspotClickHandler) {
            return this.hotspotClickHandler(hs);
        }
        return false;
    }

    /**
     * Устанавливает обработчик клика по хотспоту
     * @param {Function} handler - Функция-обработчик
     * @returns {PanoramaBase} this для цепочки вызовов
     */
    setHotspotClickHandler(handler) {
        this.hotspotClickHandler = handler;
        return this;
    }

    /**
     * Уничтожает экземпляр просмотрщика
     * @returns {void}
     */
    destroy() {
        if (this.sceneMain && typeof this.sceneMain.destroy === 'function') {
            this.sceneMain.destroy();
            this.sceneMain = null;
        }
        this.currentScene = null;
        this.pendingCameraMove = null;
    }
}