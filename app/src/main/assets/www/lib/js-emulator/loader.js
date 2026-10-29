(async function() {
    const scripts = [
        "emulator.js",
        "nipplejs.js",
        "shaders.js",
        "storage.js",
        "gamepad.js",
        "GameManager.js",
        "socket.io.min.js",
        "compression.js"
    ];

    const folderPath = (path) => path.substring(0, path.length - path.split("/").pop().length);

    // Определяем базовый путь к данным.
    // Приоритет: EJS_pathtodata -> путь от текущего script src -> локальный lib/js-emulator/
    let scriptPath = (typeof window.EJS_pathtodata === "string")
        ? window.EJS_pathtodata
        : (document.currentScript && document.currentScript.src
            ? folderPath((new URL(document.currentScript.src)).pathname)
            : "lib/js-emulator/");

    if (!scriptPath.endsWith("/")) scriptPath += "/";
    // console.log("EmulatorJS scriptPath:", scriptPath);

    function resolvePath(file) {
        // Если пользователь явно переопределил путь через EJS_paths — используем его
        if ("undefined" != typeof EJS_paths && typeof EJS_paths[file] === "string") {
            return EJS_paths[file];
        }
        // emulator.min.js / emulator.min.css лежат в корне data/
        if (file.endsWith("emulator.min.js") || file.endsWith("emulator.min.css")) {
            return scriptPath + file;
        }
        // emulator.css лежит в корне data/
        if (file === "emulator.css") {
            return scriptPath + file;
        }
        // Всё остальное (src/*.js) — в подпапке src/
        return scriptPath + "src/" + file;
    }

    function loadScript(file) {
        return new Promise(function(resolve) {
            let script = document.createElement("script");
            script.src = resolvePath(file);
            script.onload = resolve;
            script.onerror = () => {
                filesmissing(file).then(() => resolve());
            };
            document.head.appendChild(script);
        });
    }

    function loadStyle(file) {
        return new Promise(function(resolve) {
            let css = document.createElement("link");
            css.rel = "stylesheet";
            css.href = resolvePath(file);
            css.onload = resolve;
            css.onerror = () => {
                filesmissing(file).then(() => resolve());
            };
            document.head.appendChild(css);
        });
    }

    async function filesmissing(file) {
        console.error("Failed to load " + file + " (local path: " + resolvePath(file) + ")");
        const minifiedFailed = file.includes(".min.") && !file.includes("socket");

        console[minifiedFailed ? "warn" : "error"](
            "Failed to load " + file + " because it's likely that the local files are missing.\n" +
            "Make sure the EmulatorJS data folder is present locally at: " + scriptPath + "\n" +
            "You can download the zip from:\n" +
            "  https://cdn.emulatorjs.org/stable/data/emulator.min.zip\n" +
            "and extract it into: " + scriptPath + "\n" +
            "Don't forget the cores — extract them into: " + scriptPath + "cores/"
        );

        if (minifiedFailed) {
            console.log("Attempting to load non-minified files");
            if (file === "emulator.min.js") {
                for (let i = 0; i < scripts.length; i++) {
                    await loadScript(scripts[i]);
                }
            } else {
                await loadStyle("emulator.css");
            }
        }
    }

    if (("undefined" != typeof EJS_DEBUG_XX && true === EJS_DEBUG_XX)) {
        for (let i = 0; i < scripts.length; i++) {
            await loadScript(scripts[i]);
        }
        await loadStyle("emulator.css");
    } else {
        await loadScript("emulator.min.js");
        await loadStyle("emulator.min.css");
    }

    const config = {};
    config.gameUrl = window.EJS_gameUrl;
    config.dataPath = scriptPath;
    config.system = window.EJS_core;
    config.biosUrl = window.EJS_biosUrl;
    config.gameName = window.EJS_gameName;
    config.color = window.EJS_color;
    config.adUrl = window.EJS_AdUrl;
    config.adMode = window.EJS_AdMode;
    config.adTimer = window.EJS_AdTimer;
    config.adSize = window.EJS_AdSize;
    config.alignStartButton = window.EJS_alignStartButton;
    config.VirtualGamepadSettings = window.EJS_VirtualGamepadSettings;
    config.buttonOpts = window.EJS_Buttons;
    config.volume = window.EJS_volume;
    config.defaultControllers = window.EJS_defaultControls;
    config.startOnLoad = window.EJS_startOnLoaded;
    config.fullscreenOnLoad = window.EJS_fullscreenOnLoaded;
    config.filePaths = window.EJS_paths;
    config.loadState = window.EJS_loadStateURL;
    config.cacheLimit = window.EJS_CacheLimit;
    config.cheats = window.EJS_cheats;
    config.defaultOptions = window.EJS_defaultOptions;
    config.gamePatchUrl = window.EJS_gamePatchUrl;
    config.gameParentUrl = window.EJS_gameParentUrl;
    config.netplayUrl = window.EJS_netplayServer;
    config.gameId = window.EJS_gameID;
    config.backgroundImg = window.EJS_backgroundImage;
    config.backgroundBlur = window.EJS_backgroundBlur;
    config.backgroundColor = window.EJS_backgroundColor;
    config.controlScheme = window.EJS_controlScheme;
    config.threads = window.EJS_threads;
    config.disableCue = window.EJS_disableCue;
    config.startBtnName = window.EJS_startButtonName;
    config.softLoad = window.EJS_softLoad;
    config.capture = window.EJS_screenCapture;
    config.externalFiles = window.EJS_externalFiles;
    config.dontExtractBIOS = window.EJS_dontExtractBIOS;
    config.disableDatabases = window.EJS_disableDatabases;
    config.disableLocalStorage = window.EJS_disableLocalStorage;
    config.forceLegacyCores = window.EJS_forceLegacyCores;
    config.noAutoFocus = window.EJS_noAutoFocus;
    config.videoRotation = window.EJS_videoRotation;
    config.hideSettings = window.EJS_hideSettings;
    config.shaders = Object.assign({}, window.EJS_SHADERS, window.EJS_shaders ? window.EJS_shaders : {});

    let systemLang;
    try {
        systemLang = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch (e) {} // Ignore

    if ((typeof window.EJS_language === "string" && window.EJS_language !== "en-US") ||
        (systemLang && window.EJS_disableAutoLang !== false)) {
        const language = window.EJS_language || systemLang;
        try {
            let path;
            console.log("Loading language", language);
            if ("undefined" != typeof EJS_paths && typeof EJS_paths[language] === "string") {
                path = EJS_paths[language];
            } else {
                path = scriptPath + "localization/" + language + ".json";
            }
            config.language = language;
            config.langJson = JSON.parse(await (await fetch(path)).text());
        } catch (e) {
            console.log("Missing language", language, "!!");
            delete config.language;
            delete config.langJson;
        }
    }

    window.EJS_emulator = new EmulatorJS(EJS_player, config);
    window.EJS_adBlocked = (url, del) => window.EJS_emulator.adBlocked(url, del);

    if (typeof window.EJS_ready === "function") {
        window.EJS_emulator.on("ready", window.EJS_ready);
    }
    if (typeof window.EJS_onGameStart === "function") {
        window.EJS_emulator.on("start", window.EJS_onGameStart);
    }
    if (typeof window.EJS_onLoadState === "function") {
        window.EJS_emulator.on("loadState", window.EJS_onLoadState);
    }
    if (typeof window.EJS_onSaveState === "function") {
        window.EJS_emulator.on("saveState", window.EJS_onSaveState);
    }
    if (typeof window.EJS_onLoadSave === "function") {
        window.EJS_emulator.on("loadSave", window.EJS_onLoadSave);
    }
    if (typeof window.EJS_onSaveSave === "function") {
        window.EJS_emulator.on("saveSave", window.EJS_onSaveSave);
    }
})();