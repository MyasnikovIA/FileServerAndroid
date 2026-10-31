package ru.miacomsoft.fileserver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
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

    private BroadcastReceiver mediaReceiver;

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

        FileServer.bind(this, configTemp);

        HttpServer srv = HttpServer.create(
                new InetSocketAddress(config.host, config.port), 0);

        srv.createContext("/api/events", new SseHandler());
        srv.createContext("/api/proxy",  ex -> ProxyHandler.handle(ex));
        srv.createContext("/api",        new ApiHandler());
        srv.createContext("/",           rootHandler);

        srv.setExecutor(Executors.newFixedThreadPool(8));
        srv.start();
        server = srv;

        registerMediaReceiver();

        new Thread(() -> {
            try {
                rescanAndRemountShares();
                startWatcher();
            } catch (Exception e) {
                Log.e(TAG, "Async disk init failed", e);
            }
        }, "DiskScanner").start();

        Log.i(TAG, "Started on " + config.host + ":" + config.port + ", web=" + webRoot);
    }

    public void stop() {
        unregisterMediaReceiver();
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
    // Горячее перемонтирование
    // ============================================================

    private void registerMediaReceiver() {
        if (mediaReceiver != null) return;
        mediaReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                String action = intent != null ? intent.getAction() : null;
                Log.i(TAG, "Media event: " + action);

                new Thread(() -> {
                    try {
                        // Даём системе до-смонтировать volume
                        Thread.sleep(1500);
                    } catch (InterruptedException ignored) {}
                    try {
                        rescanAndRemountShares();
                    } catch (Exception e) {
                        Log.e(TAG, "rescanAndRemountShares failed", e);
                    }
                }, "MediaRemount").start();
            }
        };

        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_MEDIA_MOUNTED);
        filter.addAction(Intent.ACTION_MEDIA_UNMOUNTED);
        filter.addAction(Intent.ACTION_MEDIA_REMOVED);
        filter.addAction(Intent.ACTION_MEDIA_EJECT);
        filter.addAction(Intent.ACTION_MEDIA_BAD_REMOVAL);
        filter.addDataScheme("file");

        try {
            if (Build.VERSION.SDK_INT >= 33) {
                context.registerReceiver(mediaReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                context.registerReceiver(mediaReceiver, filter);
            }
            Log.i(TAG, "Media receiver registered");
        } catch (Exception e) {
            Log.e(TAG, "Failed to register media receiver", e);
            mediaReceiver = null;
        }
    }

    private void unregisterMediaReceiver() {
        if (mediaReceiver == null) return;
        try { context.unregisterReceiver(mediaReceiver); } catch (Exception ignored) {}
        mediaReceiver = null;
    }

    /**
     * Сканирует текущие подключённые volume'ы и приводит config.shares
     * в соответствие:
     *   • stale external share (путь под /storage/ не существует) —
     *     перемонтируется на новый volume:
     *       1) по похожему имени volume (сравнение normalized);
     *       2) если volume ровно один новый — берём его;
     *       3) иначе — оставляем как есть (share останется «мёртвым»);
     *   • новые volume, которых нет в shares — добавляются;
     *   • config сохраняется в файл.
     *
     * Публичный — можно вызвать вручную из будущего API-эндпоинта.
     */
    public synchronized void rescanAndRemountShares() {
        if (config == null) {
            Log.w(TAG, "rescan: config is null");
            return;
        }
        StorageManager sm = (StorageManager) context.getSystemService(Context.STORAGE_SERVICE);
        if (sm == null) return;

        // 1. Актуальные mount points
        List<StorageVolume> volumes = sm.getStorageVolumes();
        Map<String, File> currentVolumes = new LinkedHashMap<>();
        for (StorageVolume vol : volumes) {
            File dir = resolveVolumeDirectory(vol);
            if (dir != null && dir.exists() && dir.isDirectory() && dir.canRead()) {
                currentVolumes.put(dir.getAbsolutePath(), dir);
            }
        }
        // дополнительно — прямое сканирование /storage (для старых устройств)
        File[] storageDirs = new File("/storage").listFiles();
        if (storageDirs != null) {
            for (File f : storageDirs) {
                String n = f.getName();
                if ("emulated".equals(n) || "self".equals(n)) continue;
                if (f.isDirectory() && f.canRead()
                        && !currentVolumes.containsKey(f.getAbsolutePath())) {
                    currentVolumes.put(f.getAbsolutePath(), f);
                }
            }
        }

        // 2. Классификация shares
        Set<String> alivePaths = new HashSet<>();
        List<Config.Share> staleExternal = new ArrayList<>();
        for (Config.Share sh : config.shares) {
            if (sh.isRoot()) {
                alivePaths.add(sh.physical);
                continue;
            }
            File f = new File(sh.physical);
            if (f.exists() && f.isDirectory() && f.canRead()) {
                alivePaths.add(sh.physical);
            } else if (sh.physical != null && sh.physical.startsWith("/storage/")) {
                staleExternal.add(sh);
            }
        }

        // 3. Перемонтирование stale external
        for (Config.Share stale : staleExternal) {
            File matched = null;

            // 3a. Совпадение по похожему имени volume
            String normOld = normalizeShareName(stale.name);
            for (Map.Entry<String, File> e : currentVolumes.entrySet()) {
                if (alivePaths.contains(e.getKey())) continue;
                String desc = volumeDescription(sm, volumes, e.getValue());
                String normNew = normalizeShareName(desc);
                if (normNew.equals(normOld)
                        || normNew.startsWith(normOld)
                        || normOld.startsWith(normNew)) {
                    matched = e.getValue();
                    break;
                }
            }

            // 3b. Fallback: ровно один свободный volume — берём его
            if (matched == null) {
                List<File> free = new ArrayList<>();
                for (Map.Entry<String, File> e : currentVolumes.entrySet()) {
                    if (!alivePaths.contains(e.getKey())) free.add(e.getValue());
                }
                if (free.size() == 1) matched = free.get(0);
            }

            if (matched != null) {
                Log.i(TAG, "Remount share '" + stale.name + "': "
                        + stale.physical + " -> " + matched.getAbsolutePath());
                stale.physical = matched.getAbsolutePath();
                alivePaths.add(matched.getAbsolutePath());
            } else {
                Log.w(TAG, "Stale share '" + stale.name + "' at " + stale.physical
                        + " — no matching volume");
            }
        }

        // 4. Добавление новых volume
        for (Map.Entry<String, File> e : currentVolumes.entrySet()) {
            if (alivePaths.contains(e.getKey())) continue;
            String desc = volumeDescription(sm, volumes, e.getValue());
            addShareIfMissing(desc, e.getValue());
        }

        // 5. Сохраняем (иначе обновления потеряются при перезапуске)
        try {
            config.save(FileServer.configPath());
            Log.i(TAG, "Shares updated and saved");
        } catch (Exception ex) {
            Log.e(TAG, "Failed to save config after rescan", ex);
        }
    }

    private File resolveVolumeDirectory(StorageVolume vol) {
        File dir = null;
        try {
            if (Build.VERSION.SDK_INT >= 30) dir = vol.getDirectory();
        } catch (Exception ignored) {}
        if (dir == null) {
            try {
                String uuid = vol.getUuid();
                if (uuid != null) dir = new File("/storage/" + uuid);
            } catch (Exception ignored) {}
        }
        return dir;
    }

    private String volumeDescription(StorageManager sm, List<StorageVolume> volumes, File dir) {
        for (StorageVolume v : volumes) {
            File vd = resolveVolumeDirectory(v);
            if (vd != null && vd.getAbsolutePath().equals(dir.getAbsolutePath())) {
                try {
                    String desc = v.getDescription(context);
                    if (desc != null && !desc.isEmpty()) return desc;
                } catch (Exception ignored) {}
            }
        }
        return dir.getName();
    }

    private String normalizeShareName(String s) {
        if (s == null) return "";
        return s.replaceAll("[^a-zA-Z0-9]", "").toLowerCase(Locale.ROOT);
    }

    // ============================================================
    // Добавление нового share; обновление stale при совпадении имени
    // ============================================================

    private synchronized void addShareIfMissing(String rawName, File dir) {
        if (config == null) return;

        String volName = rawName != null
                ? rawName.replaceAll("[^a-zA-Z0-9_\\-]", "_")
                : "External_Drive";
        if (volName.isEmpty()) volName = "External_Drive";

        // 1. Тот же путь уже занят?
        for (Config.Share sh : config.shares) {
            if (dir.getAbsolutePath().equals(sh.physical)) return;
        }

        // 2. Имя занято share'ом с мёртвым путём → обновляем path
        for (Config.Share sh : config.shares) {
            if (sh.name.equals(volName)) {
                File old = new File(sh.physical);
                if (!old.exists() || !old.isDirectory()) {
                    Log.i(TAG, "Remount by name '" + sh.name + "': "
                            + sh.physical + " -> " + dir.getAbsolutePath());
                    sh.physical = dir.getAbsolutePath();
                    return;
                }
                break;
            }
        }

        // 3. Добавляем новый с уникальным именем
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
        Log.i(TAG, "Auto-mounted share: " + volName + " -> " + dir.getAbsolutePath());
    }

    // ============================================================
    // Подготовка webRoot / config, watcher
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

        if (!Files.exists(cfg)) {
            try (InputStream is = context.getAssets().open("config.json")) {
                Files.copy(is, cfg);
            }
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