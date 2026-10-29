/*
 * libpannellum — средство панорамного рендеринга на основе WebGL и CSS 3D-преобразований.
 * Авторские права (c) Мэтью Петрофф, 2012–2019 гг.
 *
 * Разрешение настоящим предоставляется бесплатно любому лицу, получившему копию.
 * данного программного обеспечения и связанных сним файлов документации («Программное обеспечение») для решения
 * в Программном обеспечении без ограничений, включая, помимо прочего, права
 * использовать, копировать, изменять, объединять, публиковать, распространять, сублицензировать и/или продавать
 * копии Программного обеспечения и разрешать лицам, которым Программное обеспечение
 * предоставлено для этого при соблюдении следующих условий:
 *
 * Вышеупомянутое уведомление об авторских правах и настоящее уведомление о разрешении должны быть включены в
 * все копии или существенные части Программного обеспечения.
 *
 * ПРОГРАММНОЕ ОБЕСПЕЧЕНИЕ ПРЕДОСТАВЛЯЕТСЯ «КАК ЕСТЬ», БЕЗ КАКИХ-ЛИБО ГАРАНТИЙ, ЯВНЫХ ИЛИ
 * ПОДРАЗУМЕВАЕМЫЕ, ВКЛЮЧАЯ, НО НЕ ОГРАНИЧИВАЯСЬ, ГАРАНТИЯМИ ТОВАРНОЙ ПРИГОДНОСТИ,
 * ПРИГОДНОСТЬ ДЛЯ ОПРЕДЕЛЕННОЙ ЦЕЛИ И НЕНАРУШЕНИЕ ПРАВ. НИ В КОЕМ СЛУЧАЕ
 * АВТОРЫ ИЛИ ОБЛАДАТЕЛИ АВТОРСКИХ ПРАВ НЕСУТ ОТВЕТСТВЕННОСТЬ ЗА ЛЮБЫЕ ПРЕТЕНЗИИ, УБЫТКИ ИЛИ ДРУГИЕ
 * ОТВЕТСТВЕННОСТЬ ПО ДОГОВОРУ, ПРАВИЛАМ ИЛИ ДРУГИМ ОБРАЗУ, ВЫТЕКАЮЩАЯ ИЗ:
 * ВНЕ ИЛИ В СВЯЗИ С ПРОГРАММНЫМ ОБЕСПЕЧЕНИЕМ ИЛИ ИСПОЛЬЗОВАНИЕМ ИЛИ ДРУГИМИ СДЕЛКАМИ.
 * ПРОГРАММНОЕ ОБЕСПЕЧЕНИЕ.
 */

window.libpannellum = (function(window, document) {
'use strict';

// Константы
const IMAGE_TYPES = ['equirectangular', 'cubemap', 'multires'];
const CUBE_FACES = 6;
const DEFAULT_BACKGROUND_COLOR = [0, 0, 0];
const PI = Math.PI;
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const SIDES = ['f', 'r', 'b', 'l', 'u', 'd'];

// Вспомогательные функции
const createShader = (gl, type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }

    return shader;
};

const createProgram = (gl, vertexShader, fragmentShader) => {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program linking error:', gl.getProgramInfoLog(program));
        return null;
    }

    return program;
};

const isPowerOfTwo = (n) => (n & (n - 1)) === 0;

const createCubeVertices = () => [
    -1,  1, -1,  1,  1, -1,  1, -1, -1, -1, -1, -1,
     1,  1,  1, -1,  1,  1, -1, -1,  1,  1, -1,  1,
    -1,  1,  1,  1,  1,  1,  1,  1, -1, -1,  1, -1,
    -1, -1, -1,  1, -1, -1,  1, -1,  1, -1, -1,  1,
    -1,  1,  1, -1,  1, -1, -1, -1, -1, -1, -1,  1,
     1,  1, -1,  1,  1,  1,  1, -1,  1,  1, -1, -1
];

// Vertex Shaders
const VERTEX_SHADER_SOURCE = `attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_texCoord, 0.0, 1.0);
    v_texCoord = a_texCoord;
}`;

const VERTEX_SHADER_MULTIRES_SOURCE = `attribute vec3 a_vertCoord;
attribute vec2 a_texCoord;
uniform mat4 u_cubeMatrix;
uniform mat4 u_perspMatrix;
varying mediump vec2 v_texCoord;

void main(void) {
    gl_Position = u_perspMatrix * u_cubeMatrix * vec4(a_vertCoord, 1.0);
    v_texCoord = a_texCoord;
}`;

// Fragment Shaders
const FRAGMENT_SHADER_CUBE = `precision highp float;
uniform float u_aspectRatio;
uniform float u_psi;
uniform float u_theta;
uniform float u_f;
uniform float u_h;
uniform float u_v;
uniform float u_vo;
uniform float u_rot;
const float PI = 3.14159265358979323846264;
uniform sampler2D u_image0;
uniform sampler2D u_image1;
uniform bool u_splitImage;
uniform samplerCube u_imageCube;
uniform vec4 u_backgroundColor;
varying vec2 v_texCoord;

void main() {
    float x = v_texCoord.x * u_aspectRatio;
    float y = v_texCoord.y;
    float sinrot = sin(u_rot);
    float cosrot = cos(u_rot);
    float rot_x = x * cosrot - y * sinrot;
    float rot_y = x * sinrot + y * cosrot;
    float sintheta = sin(u_theta);
    float costheta = cos(u_theta);
    float a = u_f * costheta - rot_y * sintheta;
    float root = sqrt(rot_x * rot_x + a * a);
    float lambda = atan(rot_x / root, a / root) + u_psi;
    float phi = atan((rot_y * costheta + u_f * sintheta) / root);
    float cosphi = cos(phi);
    gl_FragColor = textureCube(u_imageCube, vec3(cosphi*sin(lambda), sin(phi), cosphi*cos(lambda)));
}`;

const FRAGMENT_SHADER_EQUIRECT = `precision highp float;
uniform float u_aspectRatio;
uniform float u_psi;
uniform float u_theta;
uniform float u_f;
uniform float u_h;
uniform float u_v;
uniform float u_vo;
uniform float u_rot;
const float PI = 3.14159265358979323846264;
uniform sampler2D u_image0;
uniform sampler2D u_image1;
uniform bool u_splitImage;
uniform samplerCube u_imageCube;
uniform vec4 u_backgroundColor;
varying vec2 v_texCoord;

void main() {
    float x = v_texCoord.x * u_aspectRatio;
    float y = v_texCoord.y;
    float sinrot = sin(u_rot);
    float cosrot = cos(u_rot);
    float rot_x = x * cosrot - y * sinrot;
    float rot_y = x * sinrot + y * cosrot;
    float sintheta = sin(u_theta);
    float costheta = cos(u_theta);
    float a = u_f * costheta - rot_y * sintheta;
    float root = sqrt(rot_x * rot_x + a * a);
    float lambda = atan(rot_x / root, a / root) + u_psi;
    float phi = atan((rot_y * costheta + u_f * sintheta) / root);
    lambda = mod(lambda + PI, PI * 2.0) - PI;
    vec2 coord = vec2(lambda / PI, phi / (PI / 2.0));

    if(coord.x < -u_h || coord.x > u_h || coord.y < -u_v + u_vo || coord.y > u_v + u_vo) {
        gl_FragColor = u_backgroundColor;
    } else {
        if(u_splitImage) {
            if(coord.x < 0.0) {
                gl_FragColor = texture2D(u_image0, vec2((coord.x + u_h) / u_h, (-coord.y + u_v + u_vo) / (u_v * 2.0)));
            } else {
                gl_FragColor = texture2D(u_image1, vec2((coord.x + u_h) / u_h - 1.0, (-coord.y + u_v + u_vo) / (u_v * 2.0)));
            }
        } else {
            gl_FragColor = texture2D(u_image0, vec2((coord.x + u_h) / (u_h * 2.0), (-coord.y + u_v + u_vo) / (u_v * 2.0)));
        }
    }
}`;

const FRAGMENT_SHADER_MULTIRES = `varying mediump vec2 v_texCoord;
uniform sampler2D u_sampler;

void main(void) {
    gl_FragColor = texture2D(u_sampler, v_texCoord);
}`;

/**
 * Создает новый модуль визуализации панорамы.
 * @constructor
 * @param {HTMLElement} container - Элемент контейнера для средства визуализации.
 */
function Renderer(container) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width: 100%; height: 100%;';
    container.appendChild(canvas);

    let gl, program, vertexShader, fragmentShader;
    let fallbackImgSize;
    let world;
    let vtmps = [];
    let pose;
    let image, imageType, dynamic;
    let texCoordBuffer, cubeVertBuf, cubeVertTexCoordBuf, cubeVertIndBuf;
    let globalParams;
    let pendingTextureRequests = [];
    let nodeCacheTimestamp = 0;

    /**
     * Initialize WebGL context
     * @private
     */
    const initWebGL = () => {
        try {
            gl = canvas.getContext('webgl', { alpha: false, depth: false }) ||
                 canvas.getContext('experimental-webgl', { alpha: false, depth: false });
        } catch (e) {
            console.error('WebGL initialization failed:', e);
        }
        return gl;
    };

    /**
     * Handle WebGL error 1286 (specific to iOS)
     * @private
     */
    const handleWebGLError1286 = () => {
        console.warn('Reducing canvas size due to error 1286!');
        canvas.width = Math.round(canvas.width / 2);
        canvas.height = Math.round(canvas.height / 2);
    };

    /**
     * Check browser compatibility for fallback renderer
     * @private
     */
    const shouldUseFallback = () => {
        const ua = navigator.userAgent.toLowerCase();
        const isIOS8_10 = ua.match(/(iphone|ipod|ipad).* os [8-9]_/) ||
                         ua.match(/(iphone|ipod|ipad).* os 10_/);
        const isIE11 = ua.match(/trident.*rv[ :]*11\./);

        return (isIOS8_10 || isIE11) &&
               (imageType === 'cubemap' || imageType === 'multires') &&
               ('WebkitAppearance' in document.documentElement.style ||
                isIE11 ||
                navigator.appVersion.indexOf('MSIE 10') !== -1);
    };

    /**
     * Fill missing cube faces with background color
     * @private
     */
    const fillMissingFaces = (imgSize) => {
        if (!imgSize) return;

        const rgb = (globalParams.backgroundColor || DEFAULT_BACKGROUND_COLOR).map(v => v * 255);
        const nbytes = imgSize * imgSize * 4;
        const imageArray = new Uint8ClampedArray(nbytes);

        for (let i = 0; i < nbytes; i += 4) {
            imageArray[i] = rgb[0];
            imageArray[i + 1] = rgb[1];
            imageArray[i + 2] = rgb[2];
            imageArray[i + 3] = 255;
        }

        const backgroundSquare = new ImageData(imageArray, imgSize, imgSize);

        for (let s = 0; s < CUBE_FACES; s++) {
            if (image[s].width === 0) {
                image[s] = backgroundSquare;
            }
        }
    };

    /**
     * Create fallback CSS 3D renderer
     * @private
     */
    const createFallbackRenderer = (callback) => {
        if (world && container.contains(world)) {
            container.removeChild(world);
        }

        world = document.createElement('div');
        world.className = 'pnlm-world';

        const transforms = {
            f: 'translate3d(-${s}px, -${s}px, -${s}px)',
            b: 'translate3d(${s}px, -${s}px, ${s}px) rotateX(180deg) rotateZ(180deg)',
            u: 'translate3d(-${s}px, -${s}px, ${s}px) rotateX(270deg)',
            d: 'translate3d(-${s}px, ${s}px, -${s}px) rotateX(90deg)',
            l: 'translate3d(-${s}px, -${s}px, ${s}px) rotateX(180deg) rotateY(90deg) rotateZ(180deg)',
            r: 'translate3d(${s}px, -${s}px, -${s}px) rotateY(270deg)'
        };

        const path = image.basePath ? image.basePath + image.fallbackPath : image.fallbackPath;
        let loaded = 0;
        let faceMissing = false;

        const onFaceLoad = function() {
            if (this.width > 0) {
                fallbackImgSize = fallbackImgSize || this.width;
                if (fallbackImgSize !== this.width) {
                    console.warn(`Fallback faces have inconsistent widths: ${fallbackImgSize} vs. ${this.width}`);
                }
            } else {
                faceMissing = true;
            }

            const sideIndex = this.side;
            const side = SIDES[sideIndex];
            const faceCanvas = document.createElement('canvas');
            faceCanvas.className = `pnlm-face pnlm-${side}face`;
            world.appendChild(faceCanvas);

            const ctx = faceCanvas.getContext('2d');
            const border = 2;
            faceCanvas.style.cssText = `width: ${this.width + border * 2}px; height: ${this.height + border * 2}px`;
            faceCanvas.width = this.width + border * 2;
            faceCanvas.height = this.height + border * 2;

            ctx.drawImage(this, border, border);

            // Duplicate edge pixels for seamless rendering
            const imgData = ctx.getImageData(0, 0, faceCanvas.width, faceCanvas.height);
            const data = imgData.data;
            const width = faceCanvas.width;
            const height = faceCanvas.height;

            // Helper to copy pixel
            const copyPixel = (srcIdx, dstIdx) => {
                data[dstIdx] = data[srcIdx];
                data[dstIdx + 1] = data[srcIdx + 1];
                data[dstIdx + 2] = data[srcIdx + 2];
                data[dstIdx + 3] = data[srcIdx + 3];
            };

            // Duplicate edges
            for (let i = border; i < width - border; i++) {
                copyPixel((i + width * border) * 4, (i + width * 0) * 4);
                copyPixel((i + width * (height - border - 1)) * 4, (i + width * (height - 1)) * 4);
            }

            for (let i = border; i < height - border; i++) {
                copyPixel((i * width + border) * 4, (i * width + 0) * 4);
                copyPixel((i * width + (width - border - 1)) * 4, (i * width + (width - 1)) * 4);
            }

            ctx.putImageData(imgData, 0, 0);

            if (++loaded === CUBE_FACES) {
                fillMissingFaces(fallbackImgSize);
                container.appendChild(world);
                callback();
            }
        };

        for (let s = 0; s < CUBE_FACES; s++) {
            const faceImg = new Image();
            faceImg.crossOrigin = globalParams.crossOrigin || 'anonymous';
            faceImg.side = s;
            faceImg.onload = onFaceLoad;
            faceImg.onerror = onFaceLoad;

            if (imageType === 'multires') {
                faceImg.src = path.replace('%s', SIDES[s]) + '.' + image.extension;
            } else {
                faceImg.src = image[s].src;
            }
        }
    };

    /**
     * Initialize WebGL program
     * @private
     */
    const initWebGLProgram = () => {
        // Clean up previous program if exists
        if (program) {
            if (vertexShader) {
                gl.detachShader(program, vertexShader);
                gl.deleteShader(vertexShader);
            }
            if (fragmentShader) {
                gl.detachShader(program, fragmentShader);
                gl.deleteShader(fragmentShader);
            }
            if (program.texture) gl.deleteTexture(program.texture);
            if (program.nodeCache) {
                program.nodeCache.forEach(node => {
                    if (node.texture) gl.deleteTexture(node.texture);
                });
            }
            gl.deleteProgram(program);
            program = null;
        }

        // Set viewport
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

        // Check precision support
        if (gl.getShaderPrecisionFormat) {
            const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
            if (precision && precision.precision < 1) {
                console.warn('highp precision not supported, falling back to mediump');
            }
        }

        // Create shaders based on image type
        const vertexSource = imageType === 'multires' ? VERTEX_SHADER_MULTIRES_SOURCE : VERTEX_SHADER_SOURCE;
        vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);

        let fragmentSource;
        switch(imageType) {
            case 'cubemap':
                fragmentSource = FRAGMENT_SHADER_CUBE;
                break;
            case 'multires':
                fragmentSource = FRAGMENT_SHADER_MULTIRES;
                break;
            default:
                fragmentSource = FRAGMENT_SHADER_EQUIRECT;
        }

        fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

        if (!vertexShader || !fragmentShader) {
            throw new Error('Shader compilation failed');
        }

        program = createProgram(gl, vertexShader, fragmentShader);
        if (!program) {
            throw new Error('Program linking failed');
        }

        gl.useProgram(program);
        program.drawInProgress = false;

        return program;
    };

    /**
     * Setup texture for rendering
     * @private
     */
    const setupTexture = () => {
        const isCubemap = imageType === 'cubemap';
        const isMultires = imageType === 'multires';
        const bindType = isCubemap ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D;

        // Set background color
        const color = globalParams.backgroundColor || DEFAULT_BACKGROUND_COLOR;
        gl.clearColor(color[0], color[1], color[2], 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (!isMultires) {
            // Setup texture coordinates
            program.texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
            gl.enableVertexAttribArray(program.texCoordLocation);

            if (!texCoordBuffer) texCoordBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,1,1,1,1,-1,-1,1,1,-1,-1,-1]), gl.STATIC_DRAW);
            gl.vertexAttribPointer(program.texCoordLocation, 2, gl.FLOAT, false, 0, 0);

            // Set uniforms
            program.aspectRatio = gl.getUniformLocation(program, 'u_aspectRatio');
            program.psi = gl.getUniformLocation(program, 'u_psi');
            program.theta = gl.getUniformLocation(program, 'u_theta');
            program.f = gl.getUniformLocation(program, 'u_f');
            program.h = gl.getUniformLocation(program, 'u_h');
            program.v = gl.getUniformLocation(program, 'u_v');
            program.vo = gl.getUniformLocation(program, 'u_vo');
            program.rot = gl.getUniformLocation(program, 'u_rot');

            gl.uniform1f(program.aspectRatio, gl.drawingBufferWidth / gl.drawingBufferHeight);

            // Set background color for equirectangular
            if (imageType === 'equirectangular') {
                program.backgroundColor = gl.getUniformLocation(program, 'u_backgroundColor');
                gl.uniform4fv(program.backgroundColor, color.concat([1]));
            }

            // Create and setup texture
            program.texture = gl.createTexture();
            gl.bindTexture(bindType, program.texture);

            if (isCubemap) {
                // Load cube faces
                const faceOrder = [gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                                 gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                                 gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y];

                faceOrder.forEach((face, idx) => {
                    gl.texImage2D(face, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image[idx]);
                });
            } else {
                // Equirectangular texture
                const maxWidth = gl.getParameter(gl.MAX_TEXTURE_SIZE);

                if (image.width <= maxWidth) {
                    gl.uniform1i(gl.getUniformLocation(program, 'u_splitImage'), 0);
                    gl.texImage2D(bindType, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
                } else {
                    // Split large image into two textures
                    gl.uniform1i(gl.getUniformLocation(program, 'u_splitImage'), 1);

                    const cropCanvas = document.createElement('canvas');
                    cropCanvas.width = image.width / 2;
                    cropCanvas.height = image.height;
                    const ctx = cropCanvas.getContext('2d');

                    // First half
                    ctx.drawImage(image, 0, 0);
                    gl.texImage2D(bindType, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE,
                                 ctx.getImageData(0, 0, cropCanvas.width, cropCanvas.height));

                    // Second half
                    program.texture2 = gl.createTexture();
                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(bindType, program.texture2);
                    gl.uniform1i(gl.getUniformLocation(program, 'u_image1'), 1);

                    ctx.drawImage(image, -image.width / 2, 0);
                    gl.texImage2D(bindType, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE,
                                 ctx.getImageData(0, 0, cropCanvas.width, cropCanvas.height));

                    gl.activeTexture(gl.TEXTURE0);
                }
            }

            // Set texture parameters
            gl.texParameteri(bindType, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(bindType, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(bindType, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(bindType, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        } else {
            // Multires setup
            program.vertPosLocation = gl.getAttribLocation(program, 'a_vertCoord');
            gl.enableVertexAttribArray(program.vertPosLocation);

            if (!cubeVertBuf) cubeVertBuf = gl.createBuffer();
            if (!cubeVertTexCoordBuf) cubeVertTexCoordBuf = gl.createBuffer();
            if (!cubeVertIndBuf) cubeVertIndBuf = gl.createBuffer();

            gl.bindBuffer(gl.ARRAY_BUFFER, cubeVertTexCoordBuf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0,1,0,1,1,0,1]), gl.STATIC_DRAW);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeVertIndBuf);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2,0,2,3]), gl.STATIC_DRAW);

            program.perspUniform = gl.getUniformLocation(program, 'u_perspMatrix');
            program.cubeUniform = gl.getUniformLocation(program, 'u_cubeMatrix');
            program.level = -1;
            program.currentNodes = [];
            program.nodeCache = [];
        }

        // Check for WebGL errors
        const error = gl.getError();
        if (error !== gl.NO_ERROR) {
            console.error('WebGL error:', error);
            throw new Error('WebGL error: ' + error);
        }
    };

    /**
     * Multires node constructor
     * @private
     */
    function MultiresNode(vertices, side, level, x, y, path) {
        this.vertices = vertices;
        this.side = side;
        this.level = level;
        this.x = x;
        this.y = y;
        this.path = path.replace('%s', side).replace('%l', level).replace('%x', x).replace('%y', y);
        this.texture = null;
        this.textureLoaded = false;
        this.textureLoad = false;
        this.timestamp = 0;
        this.diff = 0;
    }

    /**
     * Initialize renderer.
     * @memberof Renderer
     * @instance
     */
    this.init = function(_image, _imageType, _dynamic, haov, vaov, voffset, callback, params) {
        // Set defaults
        imageType = _imageType || 'equirectangular';
        image = _image;
        dynamic = _dynamic;
        globalParams = params || {};

        // Validate image type
        if (!IMAGE_TYPES.includes(imageType)) {
            console.error('Error: invalid image type specified!');
            throw { type: 'config error' };
        }

        // Clear old data
        pose = undefined;

        // Check cube map consistency
        let cubeImgWidth;
        let faceMissing = false;

        if (imageType === 'cubemap') {
            for (let s = 0; s < CUBE_FACES; s++) {
                if (image[s].width > 0) {
                    cubeImgWidth = cubeImgWidth || image[s].width;
                    if (cubeImgWidth !== image[s].width) {
                        console.warn(`Cube faces have inconsistent widths: ${cubeImgWidth} vs. ${image[s].width}`);
                    }
                } else {
                    faceMissing = true;
                }
            }
        }

        // Initialize WebGL or fallback
        const useFallback = shouldUseFallback() &&
                          ((imageType === 'multires' && image.fallbackPath) || imageType === 'cubemap');

        if (useFallback) {
            createFallbackRenderer(callback);
            return;
        }

        // Initialize WebGL
        if (!gl) {
            if (!initWebGL()) {
                console.error('Error: no WebGL support detected!');
                throw { type: 'no webgl' };
            }
        }

        // Handle WebGL error 1286
        if (gl.getError() === 1286) {
            handleWebGLError1286();
        }

        // Fill missing faces for cubemap
        if (imageType === 'cubemap') {
            fillMissingFaces(cubeImgWidth);
        }

        // Setup paths for multires
        if (imageType === 'multires') {
            image.fullpath = (image.basePath || '') + image.path;
            image.invTileResolution = 1 / image.tileResolution;
        }

        // Check image size limits
        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        const maxCubeSize = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE);

        if (imageType === 'equirectangular' && Math.max(image.width / 2, image.height) > maxTextureSize) {
            console.error(`Error: The image is too big; it's ${image.width}px wide, but maximum supported size is ${maxTextureSize * 2}px.`);
            throw {
                type: 'webgl size error',
                width: image.width,
                maxWidth: maxTextureSize * 2
            };
        }

        if (imageType === 'cubemap' && cubeImgWidth > maxCubeSize) {
            console.error(`Error: The image is too big; it's ${cubeImgWidth}px wide, but maximum supported size is ${maxCubeSize}px.`);
            throw {
                type: 'webgl size error',
                width: cubeImgWidth,
                maxWidth: maxCubeSize
            };
        }

        // Store horizon pitch and roll
        if (params && (params.horizonPitch !== undefined || params.horizonRoll !== undefined)) {
            pose = [
                params.horizonPitch || 0,
                params.horizonRoll || 0
            ];
        }

        // Initialize vertices for multires
        if (imageType === 'multires') {
            const baseVertices = createCubeVertices();
            for (let s = 0; s < CUBE_FACES; s++) {
                vtmps[s] = baseVertices.slice(s * 12, (s + 1) * 12);
            }
        }

        try {
            // Initialize WebGL program
            initWebGLProgram();

            // Setup texture
            setupTexture();

            // Set initial uniforms
            if (imageType !== 'multires') {
                gl.uniform1f(program.h, haov / TWO_PI);
                gl.uniform1f(program.v, vaov / PI);
                gl.uniform1f(program.vo, voffset / PI * 2);
            }

            callback();
        } catch (error) {
            console.error('Renderer initialization failed:', error);
            throw error;
        }
    };

    /**
     * Destroy renderer.
     * @memberof Renderer
     * @instance
     */
    this.destroy = function() {
        if (container) {
            if (canvas && container.contains(canvas)) {
                container.removeChild(canvas);
            }
            if (world && container.contains(world)) {
                container.removeChild(world);
            }
        }

        if (gl) {
            // Free WebGL resources
            const extension = gl.getExtension('WEBGL_lose_context');
            if (extension) {
                extension.loseContext();
            }
        }
    };

    /**
     * Resize renderer.
     * @memberof Renderer
     * @instance
     */
    this.resize = function() {
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = canvas.clientWidth * pixelRatio;
        canvas.height = canvas.clientHeight * pixelRatio;

        if (gl) {
            if (gl.getError() === 1286) {
                handleWebGLError1286();
            }

            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

            if (program && imageType !== 'multires' && program.aspectRatio) {
                gl.uniform1f(program.aspectRatio, canvas.clientWidth / canvas.clientHeight);
            }
        }
    };

    // Initial resize
    this.resize();

    /**
     * Set renderer horizon pitch and roll.
     * @memberof Renderer
     * @instance
     */
    this.setPose = function(horizonPitch, horizonRoll) {
        pose = [horizonPitch, horizonRoll];
    };

    /**
     * Render new view of panorama.
     * @memberof Renderer
     * @instance
     * @param {number} pitch - Pitch to render at (in radians).
     * @param {number} yaw - Yaw to render at (in radians).
     * @param {number} hfov - Horizontal field of view to render with (in radians).
     * @param {Object} [params] - Extra configuration parameters.
     * @param {number} [params.roll] - Camera roll (in radians).
     * @param {boolean} [params.returnImage] - Return rendered image?
     */
    this.render = function(pitch, yaw, hfov, params) {
        let focal, i, s, roll = 0;
        if (params === undefined) params = {};
        if (params.roll) roll = params.roll;

        // Apply pitch and roll transformation if applicable
        if (pose !== undefined) {
            const horizonPitch = pose[0];
            const horizonRoll = pose[1];

            // Calculate new pitch and yaw
            const orig_pitch = pitch;
            const orig_yaw = yaw;
            const x = Math.cos(horizonRoll) * Math.sin(pitch) * Math.sin(horizonPitch) +
                    Math.cos(pitch) * (Math.cos(horizonPitch) * Math.cos(yaw) +
                    Math.sin(horizonRoll) * Math.sin(horizonPitch) * Math.sin(yaw));
            const y = -Math.sin(pitch) * Math.sin(horizonRoll) +
                    Math.cos(pitch) * Math.cos(horizonRoll) * Math.sin(yaw);
            const z = Math.cos(horizonRoll) * Math.cos(horizonPitch) * Math.sin(pitch) +
                    Math.cos(pitch) * (-Math.cos(yaw) * Math.sin(horizonPitch) +
                    Math.cos(horizonPitch) * Math.sin(horizonRoll) * Math.sin(yaw));
            pitch = Math.asin(Math.max(Math.min(z, 1), -1));
            yaw = Math.atan2(y, x);

            // Calculate roll
            const v = [Math.cos(orig_pitch) * (Math.sin(horizonRoll) * Math.sin(horizonPitch) * Math.cos(orig_yaw) -
                    Math.cos(horizonPitch) * Math.sin(orig_yaw)),
                    Math.cos(orig_pitch) * Math.cos(horizonRoll) * Math.cos(orig_yaw),
                    Math.cos(orig_pitch) * (Math.cos(horizonPitch) * Math.sin(horizonRoll) * Math.cos(orig_yaw) +
                    Math.sin(orig_yaw) * Math.sin(horizonPitch))];
            const w = [-Math.cos(pitch) * Math.sin(yaw), Math.cos(pitch) * Math.cos(yaw)];
            let roll_adj = Math.acos(Math.max(Math.min((v[0]*w[0] + v[1]*w[1]) /
                (Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]) *
                Math.sqrt(w[0]*w[0]+w[1]*w[1])), 1), -1));
            if (v[2] < 0) roll_adj = TWO_PI - roll_adj;
            roll += roll_adj;
        }

        // If no WebGL
        if (!gl && (imageType === 'multires' || imageType === 'cubemap')) {
            // Determine face transforms
            s = fallbackImgSize / 2;

            const transforms = {
                f: 'translate3d(-' + (s + 2) + 'px, -' + (s + 2) + 'px, -' + s + 'px)',
                b: 'translate3d(' + (s + 2) + 'px, -' + (s + 2) + 'px, ' + s + 'px) rotateX(180deg) rotateZ(180deg)',
                u: 'translate3d(-' + (s + 2) + 'px, -' + s + 'px, ' + (s + 2) + 'px) rotateX(270deg)',
                d: 'translate3d(-' + (s + 2) + 'px, ' + s + 'px, -' + (s + 2) + 'px) rotateX(90deg)',
                l: 'translate3d(-' + s + 'px, -' + (s + 2) + 'px, ' + (s + 2) + 'px) rotateX(180deg) rotateY(90deg) rotateZ(180deg)',
                r: 'translate3d(' + s + 'px, -' + (s + 2) + 'px, -' + (s + 2) + 'px) rotateY(270deg)'
            };

            focal = 1 / Math.tan(hfov / 2);
            const zoom = focal * canvas.clientWidth / 2 + 'px';
            const transform = 'perspective(' + zoom + ') translateZ(' + zoom + ') rotateX(' + pitch + 'rad) rotateY(' + yaw + 'rad) ';

            // Apply face transforms
            const faces = Object.keys(transforms);
            for (i = 0; i < CUBE_FACES; i++) {
                const face = world.querySelector('.pnlm-' + faces[i] + 'face');
                if (!face) continue;
                face.style.webkitTransform = transform + transforms[faces[i]];
                face.style.transform = transform + transforms[faces[i]];
            }

            if (params.returnImage !== undefined) {
                return canvas.toDataURL('image/png');
            }
            return;
        }

        if (imageType !== 'multires') {
            // Calculate focal length from vertical field of view
            const vfov = 2 * Math.atan(Math.tan(hfov * 0.5) / (gl.drawingBufferWidth / gl.drawingBufferHeight));
            focal = 1 / Math.tan(vfov * 0.5);

            // Pass psi, theta, roll, and focal length
            gl.uniform1f(program.psi, yaw);
            gl.uniform1f(program.theta, pitch);
            gl.uniform1f(program.rot, roll);
            gl.uniform1f(program.f, focal);

            if (dynamic === true) {
                // Update texture if dynamic
                if (imageType === 'equirectangular') {
                    gl.bindTexture(gl.TEXTURE_2D, program.texture);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
                }
            }

            // Draw using current buffer
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        } else {
            // Create perspective matrix
            const perspMatrix = makePersp(hfov, gl.drawingBufferWidth / gl.drawingBufferHeight, 0.1, 100.0);

            // Find correct zoom level
            checkZoom(hfov);

            // Create rotation matrix
            let matrix = identityMatrix3();
            matrix = rotateMatrix(matrix, -roll, 'z');
            matrix = rotateMatrix(matrix, -pitch, 'x');
            matrix = rotateMatrix(matrix, yaw, 'y');
            matrix = makeMatrix4(matrix);

            // Set matrix uniforms
            gl.uniformMatrix4fv(program.perspUniform, false, new Float32Array(transposeMatrix4(perspMatrix)));
            gl.uniformMatrix4fv(program.cubeUniform, false, new Float32Array(transposeMatrix4(matrix)));

            // Find current nodes
            const rotPersp = rotatePersp(perspMatrix, matrix);
            program.nodeCache.sort(multiresNodeSort);

            if (program.nodeCache.length > 200 && program.nodeCache.length > program.currentNodes.length + 50) {
                // Remove older nodes from cache
                const removed = program.nodeCache.splice(200, program.nodeCache.length - 200);
                for (let j = 0; j < removed.length; j++) {
                    gl.deleteTexture(removed[j].texture);
                }
            }

            program.currentNodes = [];

            for (s = 0; s < CUBE_FACES; s++) {
                const ntmp = new MultiresNode(vtmps[s], SIDES[s], 1, 0, 0, image.fullpath);
                testMultiresNode(rotPersp, ntmp, pitch, yaw, hfov);
            }

            program.currentNodes.sort(multiresNodeRenderSort);

            // Unqueue any pending requests for nodes that are no longer visible
            for (i = pendingTextureRequests.length - 1; i >= 0; i--) {
                if (program.currentNodes.indexOf(pendingTextureRequests[i].node) === -1) {
                    pendingTextureRequests[i].node.textureLoad = false;
                    pendingTextureRequests.splice(i, 1);
                }
            }

            // Allow one request to be pending
            if (pendingTextureRequests.length === 0) {
                for (i = 0; i < program.currentNodes.length; i++) {
                    const node = program.currentNodes[i];
                    if (!node.texture && !node.textureLoad) {
                        node.textureLoad = true;
                        setTimeout(processNextTile, 0, node);
                        break;
                    }
                }
            }

            // Draw tiles
            multiresDraw();
        }

        if (params.returnImage !== undefined) {
            return canvas.toDataURL('image/png');
        }
    };

    /**
     * Check if images are loading.
     * @memberof Renderer
     * @instance
     * @returns {boolean} Whether or not images are loading.
     */
    this.isLoading = function() {
        if (gl && imageType === 'multires') {
            for (let i = 0; i < program.currentNodes.length; i++) {
                if (!program.currentNodes[i].textureLoaded) {
                    return true;
                }
            }
        }
        return false;
    };

    /**
     * Retrieve renderer's canvas.
     * @memberof Renderer
     * @instance
     * @returns {HTMLElement} Renderer's canvas.
     */
    this.getCanvas = function() {
        return canvas;
    };

    /**
     * Sorting method for multires nodes.
     * @private
     */
    function multiresNodeSort(a, b) {
        // Base tiles are always first
        if (a.level === 1 && b.level !== 1) return -1;
        if (b.level === 1 && a.level !== 1) return 1;

        // Higher timestamp first
        return b.timestamp - a.timestamp;
    }

    /**
     * Sorting method for multires node rendering.
     * @private
     */
    function multiresNodeRenderSort(a, b) {
        // Lower zoom levels first
        if (a.level !== b.level) return a.level - b.level;

        // Lower distance from center first
        return a.diff - b.diff;
    }

    /**
     * Draws multires nodes.
     * @private
     */
    function multiresDraw() {
        if (!program.drawInProgress) {
            program.drawInProgress = true;
            gl.clear(gl.COLOR_BUFFER_BIT);

            for (let i = 0; i < program.currentNodes.length; i++) {
                if (program.currentNodes[i].textureLoaded > 1) {
                    // Bind vertex buffer
                    gl.bindBuffer(gl.ARRAY_BUFFER, cubeVertBuf);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(program.currentNodes[i].vertices), gl.STATIC_DRAW);
                    gl.vertexAttribPointer(program.vertPosLocation, 3, gl.FLOAT, false, 0, 0);

                    // Bind texture coordinate buffer
                    gl.bindBuffer(gl.ARRAY_BUFFER, cubeVertTexCoordBuf);
                    gl.vertexAttribPointer(program.texCoordLocation, 2, gl.FLOAT, false, 0, 0);

                    // Bind texture and draw tile
                    gl.bindTexture(gl.TEXTURE_2D, program.currentNodes[i].texture);
                    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
                }
            }

            program.drawInProgress = false;
        }
    }

    /**
     * Test if multires node is visible.
     * @private
     */
    function testMultiresNode(rotPersp, node, pitch, yaw, hfov) {
        if (checkSquareInView(rotPersp, node.vertices)) {
            // Calculate central angle
            const v = node.vertices;
            const x = v[0] + v[3] + v[6] + v[9];
            const y = v[1] + v[4] + v[7] + v[10];
            const z = v[2] + v[5] + v[8] + v[11];
            const r = Math.sqrt(x*x + y*y + z*z);
            const theta = Math.asin(z / r);
            const phi = Math.atan2(y, x);
            let ydiff = phi - yaw;
            ydiff += (ydiff > PI) ? -TWO_PI : (ydiff < -PI) ? TWO_PI : 0;
            ydiff = Math.abs(ydiff);
            node.diff = Math.acos(Math.sin(pitch) * Math.sin(theta) + Math.cos(pitch) * Math.cos(theta) * Math.cos(ydiff));

            // Add node to current nodes
            let inCurrent = false;
            for (let k = 0; k < program.nodeCache.length; k++) {
                if (program.nodeCache[k].path === node.path) {
                    inCurrent = true;
                    program.nodeCache[k].timestamp = nodeCacheTimestamp++;
                    program.nodeCache[k].diff = node.diff;
                    program.currentNodes.push(program.nodeCache[k]);
                    break;
                }
            }

            if (!inCurrent) {
                node.timestamp = nodeCacheTimestamp++;
                program.currentNodes.push(node);
                program.nodeCache.push(node);
            }

            // Create child nodes
            if (node.level < program.level) {
                const cubeSize = image.cubeResolution * Math.pow(2, node.level - image.maxLevel);
                const numTiles = Math.ceil(cubeSize * image.invTileResolution) - 1;
                const doubleTileSize = cubeSize % image.tileResolution * 2;
                let lastTileSize = (cubeSize * 2) % image.tileResolution;
                if (lastTileSize === 0) lastTileSize = image.tileResolution;

                let doubleTileSizeAdj = doubleTileSize;
                if (doubleTileSizeAdj === 0) doubleTileSizeAdj = image.tileResolution * 2;

                let f = 0.5;
                if (node.x === numTiles || node.y === numTiles) {
                    f = 1.0 - image.tileResolution / (image.tileResolution + lastTileSize);
                }

                const i = 1.0 - f;
                const children = [];

                let f1 = f, f2 = f, f3 = f, i1 = i, i2 = i, i3 = i;

                // Handle non-symmetric tiles
                if (lastTileSize < image.tileResolution) {
                    if (node.x === numTiles && node.y !== numTiles) {
                        f2 = 0.5; i2 = 0.5;
                        if (node.side === 'd' || node.side === 'u') {
                            f3 = 0.5; i3 = 0.5;
                        }
                    } else if (node.x !== numTiles && node.y === numTiles) {
                        f1 = 0.5; i1 = 0.5;
                        if (node.side === 'l' || node.side === 'r') {
                            f3 = 0.5; i3 = 0.5;
                        }
                    }
                }

                // Handle small tiles
                if (doubleTileSizeAdj <= image.tileResolution) {
                    if (node.x === numTiles) {
                        f1 = 0; i1 = 1;
                        if (node.side === 'l' || node.side === 'r') {
                            f3 = 0; i3 = 1;
                        }
                    }
                    if (node.y === numTiles) {
                        f2 = 0; i2 = 1;
                        if (node.side === 'd' || node.side === 'u') {
                            f3 = 0; i3 = 1;
                        }
                    }
                }

                // Create child nodes
                let vtmp, ntmp;

                // Child 0
                vtmp = [v[0], v[1], v[2],
                       v[0]*f1+v[3]*i1, v[1]*f+v[4]*i, v[2]*f3+v[5]*i3,
                       v[0]*f1+v[6]*i1, v[1]*f2+v[7]*i2, v[2]*f3+v[8]*i3,
                       v[0]*f+v[9]*i, v[1]*f2+v[10]*i2, v[2]*f3+v[11]*i3];
                ntmp = new MultiresNode(vtmp, node.side, node.level + 1, node.x*2, node.y*2, image.fullpath);
                children.push(ntmp);

                // Child 1
                if (!(node.x === numTiles && doubleTileSizeAdj <= image.tileResolution)) {
                    vtmp = [v[0]*f1+v[3]*i1, v[1]*f+v[4]*i, v[2]*f3+v[5]*i3,
                           v[3], v[4], v[5],
                           v[3]*f+v[6]*i, v[4]*f2+v[7]*i2, v[5]*f3+v[8]*i3,
                           v[0]*f1+v[6]*i1, v[1]*f2+v[7]*i2, v[2]*f3+v[8]*i3];
                    ntmp = new MultiresNode(vtmp, node.side, node.level + 1, node.x*2+1, node.y*2, image.fullpath);
                    children.push(ntmp);
                }

                // Child 2
                if (!(node.x === numTiles && doubleTileSizeAdj <= image.tileResolution) &&
                    !(node.y === numTiles && doubleTileSizeAdj <= image.tileResolution)) {
                    vtmp = [v[0]*f1+v[6]*i1, v[1]*f2+v[7]*i2, v[2]*f3+v[8]*i3,
                           v[3]*f+v[6]*i, v[4]*f2+v[7]*i2, v[5]*f3+v[8]*i3,
                           v[6], v[7], v[8],
                           v[9]*f1+v[6]*i1, v[10]*f+v[7]*i, v[11]*f3+v[8]*i3];
                    ntmp = new MultiresNode(vtmp, node.side, node.level + 1, node.x*2+1, node.y*2+1, image.fullpath);
                    children.push(ntmp);
                }

                // Child 3
                if (!(node.y === numTiles && doubleTileSizeAdj <= image.tileResolution)) {
                    vtmp = [v[0]*f+v[9]*i, v[1]*f2+v[10]*i2, v[2]*f3+v[11]*i3,
                           v[0]*f1+v[6]*i1, v[1]*f2+v[7]*i2, v[2]*f3+v[8]*i3,
                           v[9]*f1+v[6]*i1, v[10]*f+v[7]*i, v[11]*f3+v[8]*i3,
                           v[9], v[10], v[11]];
                    ntmp = new MultiresNode(vtmp, node.side, node.level + 1, node.x*2, node.y*2+1, image.fullpath);
                    children.push(ntmp);
                }

                // Test child nodes
                for (let j = 0; j < children.length; j++) {
                    testMultiresNode(rotPersp, children[j], pitch, yaw, hfov);
                }
            }
        }
    }

    /**
     * Creates 3x3 identity matrix.
     * @private
     */
    function identityMatrix3() {
        return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    }

    /**
     * Rotates a 3x3 matrix.
     * @private
     */
    function rotateMatrix(m, angle, axis) {
        const s = Math.sin(angle);
        const c = Math.cos(angle);

        if (axis === 'x') {
            return [
                m[0], c*m[1] + s*m[2], c*m[2] - s*m[1],
                m[3], c*m[4] + s*m[5], c*m[5] - s*m[4],
                m[6], c*m[7] + s*m[8], c*m[8] - s*m[7]
            ];
        }

        if (axis === 'y') {
            return [
                c*m[0] - s*m[2], m[1], c*m[2] + s*m[0],
                c*m[3] - s*m[5], m[4], c*m[5] + s*m[3],
                c*m[6] - s*m[8], m[7], c*m[8] + s*m[6]
            ];
        }

        if (axis === 'z') {
            return [
                c*m[0] + s*m[1], c*m[1] - s*m[0], m[2],
                c*m[3] + s*m[4], c*m[4] - s*m[3], m[5],
                c*m[6] + s*m[7], c*m[7] - s*m[6], m[8]
            ];
        }

        return m;
    }

    /**
     * Turns a 3x3 matrix into a 4x4 matrix.
     * @private
     */
    function makeMatrix4(m) {
        return [
            m[0], m[1], m[2], 0,
            m[3], m[4], m[5], 0,
            m[6], m[7], m[8], 0,
            0, 0, 0, 1
        ];
    }

    /**
     * Transposes a 4x4 matrix.
     * @private
     */
    function transposeMatrix4(m) {
        return [
            m[0], m[4], m[8], m[12],
            m[1], m[5], m[9], m[13],
            m[2], m[6], m[10], m[14],
            m[3], m[7], m[11], m[15]
        ];
    }

    /**
     * Creates a perspective matrix.
     * @private
     */
    function makePersp(hfov, aspect, znear, zfar) {
        const fovy = 2 * Math.atan(Math.tan(hfov/2) * gl.drawingBufferHeight / gl.drawingBufferWidth);
        const f = 1 / Math.tan(fovy/2);
        return [
            f/aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (zfar+znear)/(znear-zfar), (2*zfar*znear)/(znear-zfar),
            0, 0, -1, 0
        ];
    }

    /**
     * Processes a loaded texture image into a WebGL texture.
     * @private
     */
    function processLoadedTexture(img, tex) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    // Texture loading system
    const loadTexture = (function() {
        const cacheTop = 4;
        const textureImageCache = {};
        let crossOrigin;

        function TextureImageLoader() {
            const self = this;
            this.texture = this.callback = null;
            this.image = new Image();
            this.image.crossOrigin = crossOrigin || 'anonymous';

            const loadFn = function() {
                if (self.image.width > 0 && self.image.height > 0) {
                    processLoadedTexture(self.image, self.texture);
                    self.callback(self.texture, true);
                } else {
                    self.callback(self.texture, false);
                }
                releaseTextureImageLoader(self);
            };

            this.image.addEventListener('load', loadFn);
            this.image.addEventListener('error', loadFn);
        }

        TextureImageLoader.prototype.loadTexture = function(src, texture, callback) {
            this.texture = texture;
            this.callback = callback;
            this.image.src = src;
        };

        function PendingTextureRequest(node, src, texture, callback) {
            this.node = node;
            this.src = src;
            this.texture = texture;
            this.callback = callback;
        }

        function releaseTextureImageLoader(til) {
            if (pendingTextureRequests.length) {
                const req = pendingTextureRequests.shift();
                til.loadTexture(req.src, req.texture, req.callback);
            } else {
                textureImageCache[cacheTop++] = til;
            }
        }

        // Initialize cache
        for (let i = 0; i < cacheTop; i++) {
            textureImageCache[i] = new TextureImageLoader();
        }

        return function(node, src, callback, _crossOrigin) {
            crossOrigin = _crossOrigin;
            const texture = gl.createTexture();

            if (cacheTop) {
                textureImageCache[--cacheTop].loadTexture(src, texture, callback);
            } else {
                pendingTextureRequests.push(new PendingTextureRequest(node, src, texture, callback));
            }

            return texture;
        };
    })();

    /**
     * Loads image and creates texture for a multires node.
     * @private
     */
    function processNextTile(node) {
        loadTexture(node, node.path + '.' + image.extension, function(texture, loaded) {
            node.texture = texture;
            node.textureLoaded = loaded ? 2 : 1;
        }, globalParams.crossOrigin);
    }

    /**
     * Finds and applies optimal multires zoom level.
     * @private
     */
    function checkZoom(hfov) {
        let newLevel = 1;
        while (newLevel < image.maxLevel &&
               gl.drawingBufferWidth > image.tileResolution *
               Math.pow(2, newLevel - 1) * Math.tan(hfov / 2) * 0.707) {
            newLevel++;
        }

        program.level = newLevel;
    }

    /**
     * Rotates perspective matrix.
     * @private
     */
    function rotatePersp(p, r) {
        return [
            p[0]*r[0], p[0]*r[1], p[0]*r[2], 0,
            p[5]*r[4], p[5]*r[5], p[5]*r[6], 0,
            p[10]*r[8], p[10]*r[9], p[10]*r[10], p[11],
            -r[8], -r[9], -r[10], 0
        ];
    }

    /**
     * Applies rotated perspective matrix to a 3-vector.
     * @private
     */
    function applyRotPerspToVec(m, v) {
        return [
            m[0]*v[0] + m[1]*v[1] + m[2]*v[2],
            m[4]*v[0] + m[5]*v[1] + m[6]*v[2],
            m[11] + m[8]*v[0] + m[9]*v[1] + m[10]*v[2],
            1/(m[12]*v[0] + m[13]*v[1] + m[14]*v[2])
        ];
    }

    /**
     * Checks if a vertex is visible.
     * @private
     */
    function checkInView(m, v) {
        const vpp = applyRotPerspToVec(m, v);
        const winX = vpp[0]*vpp[3];
        const winY = vpp[1]*vpp[3];
        const winZ = vpp[2]*vpp[3];
        const ret = [0, 0, 0];

        if (winX < -1) ret[0] = -1;
        if (winX > 1) ret[0] = 1;
        if (winY < -1) ret[1] = -1;
        if (winY > 1) ret[1] = 1;
        if (winZ < -1 || winZ > 1) ret[2] = 1;

        return ret;
    }

    /**
     * Checks if a square (tile) is visible.setPointMap
     * @private
     */
    function checkSquareInView(m, v) {
        const check1 = checkInView(m, v.slice(0, 3));
        const check2 = checkInView(m, v.slice(3, 6));
        const check3 = checkInView(m, v.slice(6, 9));
        const check4 = checkInView(m, v.slice(9, 12));

        const testX = check1[0] + check2[0] + check3[0] + check4[0];
        if (testX === -4 || testX === 4) return false;

        const testY = check1[1] + check2[1] + check3[1] + check4[1];
        if (testY === -4 || testY === 4) return false;

        const testZ = check1[2] + check2[2] + check3[2] + check4[2];
        return testZ !== 4;
    }
}

// Public API
return {
    renderer: function(container) {
        return new Renderer(container);
    }
};

})(window, document);