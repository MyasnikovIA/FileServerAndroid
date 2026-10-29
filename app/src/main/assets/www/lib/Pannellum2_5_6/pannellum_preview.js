var sceneMain = null;
var currentScene = null;
var selectedCoords = null;
var isInitialized = false;

/**
 * Получает basePath из URL (браузер уже декодировал параметры)
 */
function getBasePathFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var pathParam = params.get('path');
    if (pathParam) {
        return pathParam.replace(/\/+$/, '');
    }
    return null;
}

/**
 * Получает корневой путь из URL
 */
function getRootPathFromUrl() {
    var currentUrl = window.location.href;
    var lastSlashIndex = currentUrl.lastIndexOf('/');
    return currentUrl.substring(0, lastSlashIndex);
}

/**
 * Разрешает путь к изображению (путь уже декодирован браузером)
 */
function resolveImagePath(imagePath) {
    if (!imagePath) return '';

    console.log('=== resolveImagePath (preview) ===');
    console.log('imagePath (input):', imagePath);

    var cleanPath = imagePath.replace(/\\/g, '/');
    console.log('cleanPath:', cleanPath);

    if (/^https?:\/\//i.test(cleanPath)) {
        console.log('External URL detected');
        return cleanPath;
    }

    if (cleanPath.startsWith('/')) {
        console.log('Absolute path detected');
        return cleanPath;
    }

    cleanPath = cleanPath.replace(/^\/+/, '');

    var basePath = getBasePathFromUrl();
    if (basePath) {
        var cleanBase = basePath.replace(/\/+$/, '');
        var result = cleanBase + '/' + cleanPath;
        console.log('Using basePath from URL:', result);
        return result;
    } else {
        var rootPath = getRootPathFromUrl();
        var result = rootPath + '/' + cleanPath;
        console.log('Using root path from URL:', result);
        return result;
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing preview');
    requestAnimationFrame(function() {
        loadInitialScene();
    });
});

function loadInitialScene() {
    setSelectPanorama();
    isInitialized = true;
}

function setSelectPanorama() {
    var params = new URLSearchParams(document.location.search);
    var photoValue = params.get('photo');
    var pathValue = params.get('path');
    var canvas = document.getElementById('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    console.log('=== setSelectPanorama ===');
    console.log('photoValue (from URL, already decoded):', photoValue);
    console.log('pathValue:', pathValue);

    if (photoValue) {
        // Если photoValue абсолютный - оставляем как есть
        // Если относительный - склеиваем с path
        var resolvedImageUrl = photoValue;
        if (!/^https?:\/\//i.test(photoValue) && pathValue) {
            var cleanPath = pathValue.replace(/\/+$/, '');
            var cleanPhoto = photoValue.replace(/^\/+/, '');
            resolvedImageUrl = cleanPath + '/' + cleanPhoto;
        } else if (!/^https?:\/\//i.test(photoValue)) {
            // Если относительный и нет path - используем корень URL
            var currentUrl = window.location.href;
            var lastSlashIndex = currentUrl.lastIndexOf('/');
            var rootPath = currentUrl.substring(0, lastSlashIndex);
            resolvedImageUrl = rootPath + '/' + photoValue;
        }

        var isExternal = /^https?:\/\//i.test(photoValue);

        console.log('resolvedImageUrl:', resolvedImageUrl);

        var jsonObj = {
            "hotSpotDebug": false,
            "hotPointDebug": false,
            "sceneFadeDuration": 500,
            "default": {
                "firstScene": "scene1"
            },
            "scenes": {
                "scene1": {
                    "title": "Предпросмотр",
                    "panorama": resolvedImageUrl,
                    "crossOrigin": isExternal ? undefined : "use-credentials",
                    "autoLoad": true,
                    "yaw": 0,
                    "pitch": 0,
                    "hotSpots": []
                }
            }
        };

        jsonObj.onDblClick = function(coords, screenCoords, event) {
            console.log("Double click on preview scene:", {
                coords: coords,
                screenCoords: screenCoords,
                event: event
            });

            if (sceneMain && coords) {
                var viewCoords = {
                    yaw: sceneMain.getYaw(),
                    pitch: sceneMain.getPitch()
                };

                selectedCoords = {
                    click: {
                        yaw: coords.yaw,
                        pitch: coords.pitch
                    },
                    view: viewCoords
                };

                showSelectedCoords();
                sendCoordsToParent();

                var infoDiv = document.getElementById('coordsInfo');
                infoDiv.classList.add('highlight');

                var startTime = null;
                function animateHighlight(timestamp) {
                    if (!startTime) startTime = timestamp;
                    var elapsed = timestamp - startTime;

                    if (elapsed < 2000) {
                        requestAnimationFrame(animateHighlight);
                    } else {
                        infoDiv.classList.remove('highlight');
                    }
                }

                requestAnimationFrame(animateHighlight);
            }
        };

        jsonObj.onClick = function(coords, screenCoords, event) {
            if (sceneMain && coords) {
                var viewCoords = {
                    yaw: sceneMain.getYaw(),
                    pitch: sceneMain.getPitch()
                };

                var coordsText = `
                        <strong>Текущий клик:</strong><br>
                        Yaw: ${coords.yaw.toFixed(2)}°,
                        Pitch: ${coords.pitch.toFixed(2)}°<br><br>
                        <strong>Направление камеры:</strong><br>
                        Yaw: ${viewCoords.yaw.toFixed(2)}°,
                        Pitch: ${viewCoords.pitch.toFixed(2)}°
                    `;

                document.getElementById('coordsText').innerHTML = coordsText;
                document.getElementById('coordsInfo').style.display = 'block';
            }
        };

        jsonObj.onContextMenuHotSpot = null;
        jsonObj.onContextMenu = null;

        if (sceneMain && typeof sceneMain['destroy'] !== 'undefined') {
            sceneMain.destroy();
        }

        sceneMain = window.pannellum.viewer('canvas', jsonObj);
        currentScene = photoValue;

        if (sceneMain) {
            sceneMain.on('load', function() {
                requestAnimationFrame(function() {
                    document.getElementById('coordsInfo').style.display = 'block';
                });
            });
        }
    } else {
        var defaultImage = 'img/04.01.2026/DSCN0021.JPG';
        var resolvedDefaultImage = defaultImage;
        if (pathValue) {
            var cleanPath = pathValue.replace(/\/+$/, '');
            resolvedDefaultImage = cleanPath + '/' + defaultImage;
        } else {
            var currentUrl = window.location.href;
            var lastSlashIndex = currentUrl.lastIndexOf('/');
            var rootPath = currentUrl.substring(0, lastSlashIndex);
            resolvedDefaultImage = rootPath + '/' + defaultImage;
        }
        var isExternalDefault = /^https?:\/\//i.test(defaultImage);

        console.log('Loading default image:', resolvedDefaultImage);

        var jsonObj = {
            "hotSpotDebug": false,
            "hotPointDebug": false,
            "sceneFadeDuration": 500,
            "default": {
                "firstScene": "scene1"
            },
            "scenes": {
                "scene1": {
                    "title": "Default Panorama",
                    "panorama": resolvedDefaultImage,
                    "crossOrigin": isExternalDefault ? undefined : "use-credentials",
                    "autoLoad": true,
                    "yaw": 0,
                    "pitch": 0,
                    "hotSpots": []
                }
            }
        };

        jsonObj.onDblClick = function(coords, screenCoords, event) {
            console.log("Double click on default scene:", coords);
            if (sceneMain && coords) {
                var viewCoords = {
                    yaw: sceneMain.getYaw(),
                    pitch: sceneMain.getPitch()
                };

                selectedCoords = {
                    click: {
                        yaw: coords.yaw,
                        pitch: coords.pitch
                    },
                    view: viewCoords
                };

                showSelectedCoords();
                sendCoordsToParent();

                var infoDiv = document.getElementById('coordsInfo');
                infoDiv.classList.add('highlight');

                var startTime = null;
                function animateHighlight(timestamp) {
                    if (!startTime) startTime = timestamp;
                    var elapsed = timestamp - startTime;

                    if (elapsed < 2000) {
                        requestAnimationFrame(animateHighlight);
                    } else {
                        infoDiv.classList.remove('highlight');
                    }
                }

                requestAnimationFrame(animateHighlight);
            }
        };

        jsonObj.onClick = function(coords, screenCoords, event) {
            if (sceneMain && coords) {
                var viewCoords = {
                    yaw: sceneMain.getYaw(),
                    pitch: sceneMain.getPitch()
                };

                var coordsText = `
                        <strong>Текущий клик:</strong><br>
                        Yaw: ${coords.yaw.toFixed(2)}°,
                        Pitch: ${coords.pitch.toFixed(2)}°<br><br>
                        <strong>Направление камеры:</strong><br>
                        Yaw: ${viewCoords.yaw.toFixed(2)}°,
                        Pitch: ${viewCoords.pitch.toFixed(2)}°
                    `;

                document.getElementById('coordsText').innerHTML = coordsText;
                document.getElementById('coordsInfo').style.display = 'block';
            }
        };

        if (sceneMain && typeof sceneMain['destroy'] !== 'undefined') {
            sceneMain.destroy();
        }

        sceneMain = window.pannellum.viewer('canvas', jsonObj);
        currentScene = 'default';

        if (sceneMain) {
            sceneMain.on('load', function() {
                requestAnimationFrame(function() {
                    document.getElementById('coordsInfo').style.display = 'block';
                });
            });
        }
    }
}

function showSelectedCoords() {
    if (!selectedCoords) return;

    var coordsText = `
            <strong>Координаты клика:</strong><br>
            Yaw: ${selectedCoords.click.yaw.toFixed(2)}°,
            Pitch: ${selectedCoords.click.pitch.toFixed(2)}°<br><br>
            <strong>Направление камеры:</strong><br>
            Yaw: ${selectedCoords.view.yaw.toFixed(2)}°,
            Pitch: ${selectedCoords.view.pitch.toFixed(2)}°<br><br>
            <em style="color: #4CAF50;">✓ Точка выбрана</em>
        `;

    document.getElementById('coordsText').innerHTML = coordsText;
    document.getElementById('coordsInfo').style.display = 'block';
}

function sendCoordsToParent() {
    if (!selectedCoords) return;

    try {
        if (window.parent && window !== window.parent) {
            requestAnimationFrame(function() {
                window.parent.postMessage({
                    type: 'hotspot_preview_coords',
                    clickCoords: selectedCoords.click,
                    viewCoords: selectedCoords.view,
                    timestamp: new Date().toISOString()
                }, '*');

                console.log('Координаты отправлены в родительское окно:', selectedCoords);
            });
        }
    } catch(e) {
        console.error('Ошибка отправки координат:', e);
    }
}

window.getSelectedCoords = function() {
    return selectedCoords;
};

window.addEventListener('message', function(event) {
    console.log('Message from parent:', event.data);
});

function onClickHotSpot(hs) {
    return false;
}

function getJsonUrlData(url, data) {
    return {'error': 'Not implemented in preview'};
}

function onContextMenuHotSpot() {}

function onContextMenu() {}