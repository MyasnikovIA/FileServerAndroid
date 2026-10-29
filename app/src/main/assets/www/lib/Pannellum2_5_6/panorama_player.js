/**
 * Panorama Player - Simplified viewer for ready tours
 * @module PanoramaPlayer
 * @extends PanoramaBase
 */
class PanoramaPlayer extends PanoramaBase {
    constructor(canvasId = null, initialImage = null) {
        super(canvasId || 'canvas');

        this.initialImage = initialImage;
        this.setHotspotClickHandler(this.navigateToScene.bind(this));

        this.setupEventListeners();
        this.loadInitialScene();
    }

    /**
     * Setup global event listeners
     * @private
     */
    setupEventListeners() {
        document.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('popstate', () => this.loadInitialScene());
    }

    /**
     * Load initial scene based on URL parameters or constructor value
     * @returns {Promise<void>}
     */
    async loadInitialScene() {
        await this.setSelectPanorama();
    }

    /**
     * Set and display panorama based on URL parameters
     * @param {Object|null} hotSpot - Hotspot object from click
     * @returns {Promise<void>}
     */
    async setSelectPanorama(hotSpot = null) {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            const params = new URLSearchParams(window.location.search);
            let photoValue = params.get('photo') || this.initialImage;

            if (!photoValue) {
                await this.loadDefaultPanorama();
                return;
            }

            photoValue = this.normalizePath(photoValue);

            // РЕЗОЛЬВИМ ПУТЬ к изображению
            const resolvedPhotoUrl = this.resolveImagePath(photoValue);

            const isExternal = this.isExternalUrl(photoValue);
            const jsonUrl = this.getJsonUrlFromImageUrl(resolvedPhotoUrl);

            try {
                const jsonData = await this.loadHotSpotsFromJson(jsonUrl);
                const hotspots = jsonData.hotSpots || [];
                const cameraDirection = this.getCameraDirection(hotSpot, jsonData);

                // Передаем РЕЗОЛЬВИРОВАННЫЙ URL в сцену
                await this.finalizeScene(resolvedPhotoUrl, isExternal, hotspots, cameraDirection, hotSpot);
            } catch {
                await this.finalizeScene(resolvedPhotoUrl, isExternal, [], {}, hotSpot);
            }

        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Finalize and display panorama scene
     * @param {string} imageUrl - Panorama image URL (уже разрешенный)
     * @param {boolean} isExternal - Whether URL is external
     * @param {Array} hotspots - Hotspot data
     * @param {Object} cameraDirection - Camera direction { pitchCam, yawCam }
     * @param {Object|null} hotSpot - Hotspot object
     * @returns {Promise<void>}
     */
    async finalizeScene(imageUrl, isExternal, hotspots, cameraDirection, hotSpot) {
        const config = this.createBaseJsonConfig();
        const scene = config.scenes.scene1;

        scene.panorama = imageUrl;
        scene.crossOrigin = isExternal ? 'anonymous' : 'use-credentials';

        if (hotSpot?.point_pitch !== undefined) {
            scene.pitch = hotSpot.point_pitch;
        } else if (cameraDirection.pitchCam !== undefined) {
            scene.pitch = cameraDirection.pitchCam;
        }

        if (hotSpot?.point_yaw !== undefined) {
            scene.yaw = hotSpot.point_yaw;
        } else if (cameraDirection.yawCam !== undefined) {
            scene.yaw = cameraDirection.yawCam;
        }

        scene.hotSpots = this.formatHotSpots(hotspots);

        if (cameraDirection.pitchCam !== undefined || cameraDirection.yawCam !== undefined) {
            this.pendingCameraMove = {
                pitch: cameraDirection.pitchCam || scene.pitch,
                yaw: cameraDirection.yawCam || scene.yaw
            };
        }

        this.createPannellumViewer(config, imageUrl);
    }

    /**
     * Load default panorama when no image is specified
     * @returns {Promise<void>}
     */
    async loadDefaultPanorama() {
        const defaultImage = 'img/04.01.2026/DSCN0021.JPG';
        const resolvedImage = this.resolveImagePath(defaultImage);
        const isExternal = this.isExternalUrl(defaultImage);

        try {
            const jsonData = await this.loadHotSpotsFromJson(
                this.getJsonUrlFromImageUrl(resolvedImage)
            );

            await this.finalizeScene(
                resolvedImage,
                isExternal,
                jsonData.hotSpots || [],
                this.getCameraDirection(null, jsonData)
            );
        } catch {
            const config = this.createBaseJsonConfig();
            const scene = config.scenes.scene1;

            scene.panorama = resolvedImage;
            scene.crossOrigin = isExternal ? undefined : "use-credentials";
            scene.yaw = -6.77;
            scene.pitch = -24.41;

            this.createPannellumViewer(config, 'default');
        }
    }

    /**
     * Navigate to another scene when hotspot is clicked
     * @param {Object} hs - Hotspot object
     * @returns {boolean} True if navigation was handled
     */
    navigateToScene(hs) {
        console.log('Navigating to scene:', hs);

        if (hs.panorama_url) {
            // РЕЗОЛЬВИМ путь к панораме при переходе
            const resolvedUrl = this.resolveImagePath(hs.panorama_url);

            const url = new URL(window.location.href);
            url.searchParams.set('photo', resolvedUrl);
            window.history.pushState({}, '', url);

            this.setSelectPanorama(hs);
            return true;
        }

        const jsonName = hs.panorama_url?.split('/')[4];
        if (jsonName) {
            const name = jsonName.split('.')[0];
            const url = new URL(window.location.href);
            url.searchParams.set('info', jsonName);
            window.history.pushState({}, '', url);

            const jsonObj = this.getJsonUrlData(hs.panorama_url);
            jsonObj.pitch = hs.point_pitch;
            jsonObj.yaw = hs.point_yaw;

            this.createPannellumViewer(jsonObj, name);
            return true;
        }

        return false;
    }
}