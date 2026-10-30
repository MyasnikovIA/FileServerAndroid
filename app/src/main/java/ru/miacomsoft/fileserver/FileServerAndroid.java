package ru.miacomsoft.fileserver;

import android.content.Context;
import android.os.Build;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.util.Log;

import com.sun.net.httpserver.HttpServer;

import java.io.File;
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

    public void start() throws Exception {
        prepareWebRoot();
        prepareConfig();

        config = Config.load(configTemp);

        config.host = "0.0.0.0";
        config.port = 8080;

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

        FileServer.bind(this);

        HttpServer srv = HttpServer.create(
                new InetSocketAddress(config.host, config.port), 0);

        srv.createContext("/api/events", new SseHandler());
        srv.createContext("/api",        new ApiHandler());
        srv.createContext("/",           rootHandler);

        srv.setExecutor(Executors.newFixedThreadPool(8));
        srv.start();
        server = srv;

        // Асинхронное сканирование дисков и запуск вотчера (чтобы не блокировать сервер)
        new Thread(() -> {
            try {
                mountExternalDrives();
                startWatcher();
            } catch (Exception e) {
                Log.e(TAG, "Async disk init failed", e);
            }
        }, "DiskScanner").start();

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

    public void mountExternalDrives() {
        try {
            StorageManager sm = (StorageManager) context.getSystemService(Context.STORAGE_SERVICE);
            if (sm != null) {
                List<StorageVolume> volumes = sm.getStorageVolumes();
                for (StorageVolume vol : volumes) {
                    if (Build.VERSION.SDK_INT >= 30 && vol.isPrimary()) continue;

                    File dir = null;
                    if (Build.VERSION.SDK_INT >= 30) {
                        dir = vol.getDirectory();
                    }

                    // Резервный метод для старых Android или если getDirectory вернул null
                    if (dir == null) {
                        String uuid = vol.getUuid();
                        if (uuid != null) dir = new File("/storage/" + uuid);
                    }

                    // Проверяем, что путь существует и доступен для чтения (избегаем /mnt/media_rw)
                    if (dir != null && dir.exists() && dir.isDirectory() && dir.canRead()) {
                        addShareIfMissing(vol.getDescription(context), dir);
                    }
                }
            }

            // Резервный поиск в /storage для ТВ-приставок
            File[] storageDirs = new File("/storage").listFiles();
            if (storageDirs != null) {
                for (File f : storageDirs) {
                    if (f.isDirectory() && !f.getName().equals("emulated") && !f.getName().equals("self")) {
                        if (f.canRead()) {
                            addShareIfMissing("USB_" + f.getName(), f);
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to auto-mount USB drives", e);
        }
    }

    private synchronized void addShareIfMissing(String rawName, File dir) {
        if (config == null) return;

        String volName = rawName != null ? rawName.replaceAll("[^a-zA-Z0-9_\\-]", "_") : "External_Drive";
        if (volName.isEmpty()) volName = "External_Drive";

        // Проверяем, не добавлен ли уже этот путь
        for (Config.Share sh : config.shares) {
            if (dir.getAbsolutePath().equals(sh.physical)) return;
        }

        // Генерируем уникальное имя
        String baseName = volName;
        int counter = 1;
        while (config.findShare(volName) != null) {
            volName = baseName + "_" + counter++;
        }

        Config.Share usbShare = new Config.Share();
        usbShare.name = volName;
        usbShare.physical = dir.getAbsolutePath();
        usbShare.type = "folder";
        usbShare.access.add("read");
        usbShare.access.add("write");
        usbShare.access.add("delete");

        for (String user : config.users.keySet()) {
            usbShare.users.add(user);
        }

        config.shares.add(usbShare);
        Log.i(TAG, "Auto-mounted USB share: " + volName + " -> " + dir.getAbsolutePath());
    }

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

    private void copyAssetFolder(String assetPath, Path dst) throws IOException {
        String[] children;
        try {
            children = context.getAssets().list(assetPath);
        } catch (IOException e) {
            return;
        }
        if (children == null || children.length == 0) {
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

    private static void deleteRecursive(Path p) throws IOException {
        if (p == null || !Files.exists(p)) return;

        List<Path> all = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(p)) {
            walk.forEach(all::add);
        }

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

    Config config()          { return config; }
    AuthService auth()       { return auth; }
    TokenService tokens()    { return tokens; }
    QuotaService quota()     { return quota; }
    Path webRoot()           { return webRoot; }
    RootHandler rootHandler(){ return rootHandler; }
    StaticHandler staticHandler() { return staticHandler; }
}