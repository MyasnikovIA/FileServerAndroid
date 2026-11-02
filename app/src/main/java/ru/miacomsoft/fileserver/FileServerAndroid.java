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
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import javax.net.ssl.SSLContext;

public class FileServerAndroid {
    private ServerCopyService serverCopy;
    private static final String TAG = "FileServerAndroid";
    private String actualProtocol = "http";
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

    // ============================================================
    // Горячая перезагрузка config.json
    // ============================================================
    private static final long CONFIG_POLL_MS = 2000L;
    private volatile Thread configWatcherThread;
    private volatile long lastConfigMtime = 0L;
    private volatile long suppressConfigReloadUntil = 0L;

    public FileServerAndroid(Context ctx) {
        this.context = ctx.getApplicationContext();
    }

    public void start() throws Exception {
        // Инициализация проекта
        ProjectInitializer.InitResult init = ProjectInitializer.initialize(context);
        this.webRoot = init.webRoot;
        this.configTemp = init.configPath;

        config = Config.load(configTemp);
        config.host = "0.0.0.0";
        config.port = 8080;
        config.videoChatEnabled = false;
        config.hermesEnabled    = false;
        config.consoleShell     = "";
        config.consoleCwd       = "";

        tokens = new TokenService();
        auth   = new AuthService(config, tokens);
        quota  = new QuotaService(auth);
        staticHandler = new StaticHandler(webRoot);
        rootHandler   = new RootHandler(staticHandler);
        serverCopy = new ServerCopyService();
        FileServer.bind(this, configTemp);

        // ============================================================
        // HTTPS / HTTP
        // ============================================================
        SSLContext sslContext = null;
        boolean httpsMode = false;
        if (config.httpsEnabled) {
            Path keystorePath = resolveHttpsKeystore();
            if (keystorePath == null) {
                Log.w(TAG, "HTTPS enabled but httpsKeystore is empty in config — using HTTP");
            } else if (Files.isRegularFile(keystorePath)) {
                try {
                    sslContext = SslHelper.createFromPkcs12(keystorePath, config.httpsPassword);
                    httpsMode  = true;
                    Log.i(TAG, "HTTPS enabled, keystore: " + keystorePath);
                } catch (Exception e) {
                    Log.e(TAG, "Failed to load keystore " + keystorePath
                            + " — falling back to HTTP: " + e.getMessage(), e);
                }
            } else {
                Log.w(TAG, "HTTPS enabled but keystore not found: " + keystorePath
                        + " — using HTTP. Place keystore.p12 at that path and restart.");
            }
        }

        // ============================================================
        // Создание сервера (с fallback HTTPS → HTTP)
        // ============================================================
        HttpServer srv = null;
        java.net.InetSocketAddress addr = new java.net.InetSocketAddress(config.host, config.port);
        actualProtocol = "http";
        if (httpsMode) {
            try {
                HttpsServer httpsSrv = HttpsServer.create(addr, 0);
                httpsSrv.setHttpsConfigurator(new HttpsConfigurator(sslContext));
                srv = httpsSrv;
                actualProtocol = "https";
                Log.i(TAG, "Starting HTTPS server on " + addr);
            } catch (Exception e) {
                Log.e(TAG, "Failed to create HTTPS server — falling back to HTTP: "
                        + e.getMessage(), e);
                httpsMode = false;
                srv = null;
            }
        }
        if (srv == null) {
            srv = HttpServer.create(addr, 0);
            actualProtocol = "http";
            Log.i(TAG, "Starting HTTP server on " + addr);
        }

        srv.createContext("/api/events", new SseHandler());
        srv.createContext("/api/proxy",  ex -> ProxyHandler.handle(ex));
        srv.createContext("/api",        new ApiHandler());
        srv.createContext("/",           rootHandler);
        srv.setExecutor(Executors.newFixedThreadPool(8));
        srv.start();
        server = srv;

        registerMediaReceiver();
        startConfigWatcher();
        new Thread(() -> {
            try {
                rescanAndRemountShares();
                startWatcher();
            } catch (Exception e) {
                Log.e(TAG, "Async disk init failed", e);
            }
        }, "DiskScanner").start();

        Log.i(TAG, "Started on " + actualProtocol + "://"
                + config.host + ":" + config.port + ", web=" + webRoot);
    }

    public void stop() {
        stopConfigWatcher();
        unregisterMediaReceiver();
        if (server != null) {
            try { server.stop(0); } catch (Exception ignored) {}
            server = null;
        }
        if (fileWatcher != null) {
            try { fileWatcher.stop(); } catch (Exception ignored) {}
            fileWatcher = null;
        }
        if (serverCopy != null) {
            try { serverCopy.shutdown(); } catch (Exception ignored) {}
            serverCopy = null;
        }
        FileServer.unbind();
        configTemp = null;
        actualProtocol = "http";
    }

    public String getListenUrl() {
        int port = (config != null) ? config.port : 8080;
        return actualProtocol + "://" + getLocalIpAddress() + ":" + port;
    }

    public String getLocalUrl() {
        int port = (config != null) ? config.port : 8080;
        return actualProtocol + "://" + getLocalIpAddress() + ":" + port + "/";
    }

    private Path resolveHttpsKeystore() {
        if (config == null || config.httpsKeystore == null) return null;
        String raw = config.httpsKeystore.trim();
        if (raw.isEmpty()) return null;

        try {
            Path p = java.nio.file.Paths.get(raw);
            if (p.isAbsolute()) return p.normalize();
        } catch (Exception e) {
            Log.e(TAG, "Invalid absolute path: " + raw, e);
            return null;
        }

        return null;
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

    public synchronized void rescanAndRemountShares() {
        if (config == null) {
            Log.w(TAG, "rescan: config is null");
            return;
        }
        StorageManager sm = (StorageManager) context.getSystemService(Context.STORAGE_SERVICE);
        if (sm == null) return;

        List<StorageVolume> volumes = sm.getStorageVolumes();
        Map<String, File> currentVolumes = new LinkedHashMap<>();
        for (StorageVolume vol : volumes) {
            File dir = resolveVolumeDirectory(vol);
            if (dir != null && dir.exists() && dir.isDirectory() && dir.canRead()) {
                currentVolumes.put(dir.getAbsolutePath(), dir);
            }
        }

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

        for (Config.Share stale : staleExternal) {
            File matched = null;
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

        for (Map.Entry<String, File> e : currentVolumes.entrySet()) {
            if (alivePaths.contains(e.getKey())) continue;
            String desc = volumeDescription(sm, volumes, e.getValue());
            addShareIfMissing(desc, e.getValue());
        }

        try {
            config.save(FileServer.configPath());
            noteInternalConfigSave();
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

    private synchronized void addShareIfMissing(String rawName, File dir) {
        if (config == null) return;
        String volName = rawName != null
                ? rawName.replaceAll("[^a-zA-Z0-9_\\-]", "_")
                : "External_Drive";
        if (volName.isEmpty()) volName = "External_Drive";

        for (Config.Share sh : config.shares) {
            if (dir.getAbsolutePath().equals(sh.physical)) return;
        }

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

    private void startConfigWatcher() {
        if (configTemp == null) return;
        try {
            lastConfigMtime = Files.getLastModifiedTime(configTemp).toMillis();
        } catch (IOException e) {
            lastConfigMtime = 0L;
        }
        final Path watchPath = configTemp;
        configWatcherThread = new Thread(() -> {
            Log.i(TAG, "ConfigWatcher: started for " + watchPath
                    + ", mtime=" + lastConfigMtime);
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    Thread.sleep(CONFIG_POLL_MS);
                } catch (InterruptedException ie) {
                    return;
                }
                try {
                    if (!Files.exists(watchPath)) continue;
                    long mtime = Files.getLastModifiedTime(watchPath).toMillis();
                    if (mtime <= lastConfigMtime) continue;
                    try { Thread.sleep(300); }
                    catch (InterruptedException ie) { return; }
                    mtime = Files.getLastModifiedTime(watchPath).toMillis();
                    lastConfigMtime = mtime;
                    if (System.currentTimeMillis() < suppressConfigReloadUntil) {
                        Log.i(TAG, "ConfigWatcher: change is internal, skipped");
                        continue;
                    }
                    Log.i(TAG, "ConfigWatcher: mtime changed → reload");
                    reloadConfig();
                } catch (Exception e) {
                    Log.w(TAG, "ConfigWatcher poll error: " + e.getMessage());
                }
            }
        }, "ConfigWatcher");
        configWatcherThread.setDaemon(true);
        configWatcherThread.start();
    }

    private void stopConfigWatcher() {
        Thread t = configWatcherThread;
        configWatcherThread = null;
        if (t != null) {
            t.interrupt();
            Log.i(TAG, "ConfigWatcher: stopped");
        }
    }

    private void noteInternalConfigSave() {
        suppressConfigReloadUntil = System.currentTimeMillis() + 3000L;
        if (configTemp != null) {
            try {
                lastConfigMtime = Files.getLastModifiedTime(configTemp).toMillis();
            } catch (IOException ignored) {}
        }
    }

    private synchronized void reloadConfig() {
        if (configTemp == null) return;
        Log.i(TAG, "reloadConfig: config changed, reloading...");
        Config newCfg;
        try {
            newCfg = Config.load(configTemp);
        } catch (Exception e) {
            Log.e(TAG, "reloadConfig: Config.load failed, keeping old config", e);
            return;
        }

        newCfg.videoChatEnabled = false;
        newCfg.hermesEnabled    = false;
        newCfg.consoleShell     = "";
        newCfg.consoleCwd       = "";

        if (newCfg.port != config.port) {
            Log.w(TAG, "reloadConfig: http.port change (" + config.port + " → "
                    + newCfg.port + ") requires full restart — keeping " + config.port);
        }
        if (newCfg.host == null ? config.host != null : !newCfg.host.equals(config.host)) {
            Log.w(TAG, "reloadConfig: http.host change requires full restart — keeping "
                    + config.host);
        }
        newCfg.port = config.port;
        newCfg.host = config.host;

        if (newCfg.httpsEnabled != config.httpsEnabled) {
            Log.w(TAG, "reloadConfig: https.enabled change requires restart");
        }
        newCfg.httpsEnabled  = config.httpsEnabled;
        newCfg.httpsKeystore = config.httpsKeystore;
        newCfg.httpsPassword = config.httpsPassword;
        newCfg.httpsCert     = config.httpsCert;
        newCfg.httpsKey      = config.httpsKey;

        if (newCfg.webPath == null ? config.webPath != null : !newCfg.webPath.equals(config.webPath)) {
            Log.w(TAG, "reloadConfig: web path change requires restart — keeping "
                    + config.webPath);
        }
        newCfg.webPath = config.webPath;

        Config oldCfg = this.config;
        this.config = newCfg;
        this.auth   = new AuthService(newCfg, tokens);
        this.quota  = new QuotaService(this.auth);
        this.quota.invalidateAll();

        FileServer.bind(this, configTemp);
        restartFileWatcher();

        Log.i(TAG, "reloadConfig OK: shares=" + newCfg.shares.size()
                + " (was " + oldCfg.shares.size() + "), users=" + newCfg.users.size()
                + " (was " + oldCfg.users.size() + ")");
    }

    private void restartFileWatcher() {
        if (fileWatcher != null) {
            try { fileWatcher.stop(); } catch (Exception ignored) {}
            fileWatcher = null;
        }
        try {
            startWatcher();
        } catch (Exception e) {
            Log.w(TAG, "restartFileWatcher failed: " + e.getMessage());
        }
    }

    Config config()          { return config; }
    AuthService auth()       { return auth; }
    TokenService tokens()    { return tokens; }
    QuotaService quota()     { return quota; }
    ServerCopyService serverCopy() { return serverCopy; }
    Path webRoot()           { return webRoot; }
    RootHandler rootHandler(){ return rootHandler; }
    StaticHandler staticHandler() { return staticHandler; }
    android.content.Context getAndroidContext() {
        return context;
    }
}