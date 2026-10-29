package ru.miacomsoft.fileserver;

import android.content.Context;
import android.util.Log;

import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.stream.Stream;

/**
 * Облегчённый сервер для Android.
 * Только HTTP, файловый менеджер. Без консоли, Ollama, GPU, VideoChat, Proxy.
 * Web-часть и config.json читаются из assets.
 */
public class FileServerAndroid {

    private static final String TAG = "FileServerAndroid";

    private final Context context;
    private HttpServer server;
    private Path configTemp;

    private Config config;
    private TokenService tokens;
    private AuthService auth;
    private QuotaService quota;
    private FileWatcher fileWatcher;
    private Path webRoot;
    private StaticHandler staticHandler;
    private RootHandler   rootHandler;

    public FileServerAndroid(Context ctx) {
        this.context = ctx.getApplicationContext();
    }

    // ============================================================
    // Старт / стоп
    // ============================================================

    public void start() throws Exception {
        prepareWebRoot();
        prepareConfig();

        config = Config.load(configTemp);

        config.host = "0.0.0.0";
        config.port = 8080;

        // Явное отключение всего, что не нужно на Android
        config.httpsEnabled      = false;
        config.videoChatEnabled  = false;
        config.hermesEnabled     = false;
        config.ollamaEnabled     = false;
        config.consoleShell      = "";
        config.consoleCwd        = "";

        tokens = new TokenService();
        auth   = new AuthService(config, tokens);
        quota  = new QuotaService(auth);

        staticHandler = new StaticHandler(webRoot);
        rootHandler   = new RootHandler(staticHandler);

        // Регистрируем статический фасад ДО старта сервера,
        // чтобы ApiHandler / SseHandler / RootHandler видели config/auth/quota.
        FileServer.bind(this);

        HttpServer srv = HttpServer.create(
                new InetSocketAddress(config.host, config.port), 0);

        srv.createContext("/api/events", new SseHandler());
        srv.createContext("/api",        new ApiHandler());
        srv.createContext("/",           rootHandler);

        srv.setExecutor(Executors.newFixedThreadPool(8));
        srv.start();
        server = srv;

        startWatcher();
        Log.i(TAG, "Started on " + config.host + ":" + config.port + ", web=" + webRoot);
    }

    public void stop() {
        if (server != null) {
            try { server.stop(0); } catch (Exception ignored) {}
            server = null;
        }
        if (fileWatcher != null) {
            try { fileWatcher.stop(); } catch (Exception ignored) {}
            fileWatcher = null;
        }
        FileServer.unbind();

        try { if (configTemp != null) Files.deleteIfExists(configTemp); }
        catch (Exception ignored) {}
        configTemp = null;
    }

    public String getListenUrl() {
        int port = (config != null) ? config.port : 8080;
        return "http://" + getLocalIpAddress() + ":" + port;
    }

    private String getLocalIpAddress() {
        try {
            java.util.Enumeration<java.net.NetworkInterface> en =
                    java.net.NetworkInterface.getNetworkInterfaces();
            while (en.hasMoreElements()) {
                java.net.NetworkInterface ni = en.nextElement();
                if (ni.isLoopback() || !ni.isUp()) continue;
                java.util.Enumeration<java.net.InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    java.net.InetAddress addr = addrs.nextElement();
                    if (!addr.isLoopbackAddress() && addr instanceof java.net.Inet4Address) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return "127.0.0.1";
    }

    // ============================================================
    // assets → files
    // ============================================================

    private void prepareWebRoot() throws IOException {
        Path filesDir = context.getFilesDir().toPath();
        Path www = filesDir.resolve("www");

        deleteRecursive(www);
        Files.createDirectories(www);

        copyAssetFolder("www", www);
        this.webRoot = www;
    }

    private void prepareConfig() throws IOException {
        Path filesDir = context.getFilesDir().toPath();
        Path cfg = filesDir.resolve("config.json");

        try (InputStream is = context.getAssets().open("config.json")) {
            Files.copy(is, cfg, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
        this.configTemp = cfg;
    }

    /**
     * Копирует asset-папку рекурсивно в dst.
     *
     * ВАЖНО: Files.copy(InputStream, Path, REPLACE_EXISTING) на некоторых
     * OEM-прошивках (замечено на RK3528 / Mali) игнорирует REPLACE_EXISTING
     * и бросает FileAlreadyExistsException. Поэтому используем явный
     * OutputStream с CREATE + TRUNCATE_EXISTING.
     */
    private void copyAssetFolder(String assetPath, Path dst) throws IOException {
        String[] children;
        try {
            children = context.getAssets().list(assetPath);
        } catch (IOException e) {
            return;
        }
        if (children == null || children.length == 0) {
            // Это файл — копируем содержимое
            try {
                Files.deleteIfExists(dst);
            } catch (IOException ignored) {}

            try (InputStream is = context.getAssets().open(assetPath);
                 OutputStream os = Files.newOutputStream(dst,
                         StandardOpenOption.CREATE,
                         StandardOpenOption.TRUNCATE_EXISTING,
                         StandardOpenOption.WRITE)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) {
                    os.write(buf, 0, n);
                }
            }
            return;
        }

        Files.createDirectories(dst);
        for (String name : children) {
            String childAsset = assetPath.isEmpty() ? name : assetPath + "/" + name;
            Path childDst = dst.resolve(name);
            copyAssetFolder(childAsset, childDst);
        }
    }

    /**
     * Удаляет директорию рекурсивно.
     *
     * ВАЖНО: Files.walk() возвращает Stream, который ОБЯЗАТЕЛЬНО надо
     * закрыть. Иначе на Android вложенные директории могут остаться,
     * и последующее копирование упадёт с FileAlreadyExistsException.
     */
    private static void deleteRecursive(Path p) throws IOException {
        if (p == null || !Files.exists(p)) return;

        List<Path> all = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(p)) {
            walk.forEach(all::add);
        }

        // Сортируем от самых глубоких к самым верхним
        all.sort((a, b) -> b.getNameCount() - a.getNameCount());

        for (Path x : all) {
            try { Files.deleteIfExists(x); } catch (IOException ignored) {}
        }
    }

    private void startWatcher() {
        for (Config.Share sh : config.shares) {
            if (sh.isFolder()) {
                Path p = sh.physicalPath();
                if (Files.isDirectory(p)) {
                    try {
                        fileWatcher = new FileWatcher(p, data -> FileServer.broadcastEvent("change", data));
                        fileWatcher.start();
                    } catch (IOException e) {
                        Log.w(TAG, "Watcher failed: " + e.getMessage());
                    }
                    break;
                }
            }
        }
    }

    // ============================================================
    // Аксессоры для FileServer.bind()
    // ============================================================

    Config config()          { return config; }
    AuthService auth()       { return auth; }
    TokenService tokens()    { return tokens; }
    QuotaService quota()     { return quota; }
    Path webRoot()           { return webRoot; }
    RootHandler rootHandler(){ return rootHandler; }
    StaticHandler staticHandler() { return staticHandler; }
}