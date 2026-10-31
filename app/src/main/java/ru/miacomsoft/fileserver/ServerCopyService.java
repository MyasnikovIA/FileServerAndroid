package ru.miacomsoft.fileserver;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class ServerCopyService {

    private static final int  BUF              = 256 * 1024;    // 256 KB
    private static final int  CONNECT_TIMEOUT  = 15000;
    private static final int  READ_TIMEOUT     = 120000;
    private static final long PROGRESS_STEP    = 1024 * 1024;   // 1 MB
    private static final long PROGRESS_TIME_MS = 500;
    private static final int  PARALLEL_TASKS   = 2;

    private final Map<String, Task> tasks = new ConcurrentHashMap<>();
    private final ExecutorService exec =
            Executors.newFixedThreadPool(PARALLEL_TASKS, r -> {
                Thread t = new Thread(r, "ServerCopy");
                t.setDaemon(true);
                return t;
            });

    // ============================================================
    // Task
    // ============================================================

    public static class Task {
        public String id;

        /** "local" | "push" | "pull" | "relay" */
        public String mode;

        public String srcPath;      // виртуальный путь на локальном сервере (local/push)
        public String srcUrl;       // база удалённого сервера (pull/relay)
        public String srcToken;     // bearer для srcUrl
        public String dstPath;
        public String dstUrl;
        public String dstToken;

        /** Кто запустил (для permission checks в фоне). */
        public String username;
        public boolean isAnonymous;

        public volatile String  status         = "queued"; // queued|running|done|error|canceled
        public volatile long    bytesDone      = 0;
        public volatile long    bytesTotal     = -1;
        public volatile String  error          = null;
        public volatile long    startedAt      = 0;
        public volatile long    finishedAt     = 0;
        public volatile boolean cancelRequested = false;

        public JSONObject toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("taskId", id);
                o.put("mode", mode);
                if (srcPath  != null) o.put("srcPath",  srcPath);
                if (srcUrl   != null) o.put("srcUrl",   srcUrl);
                if (dstPath  != null) o.put("dstPath",  dstPath);
                if (dstUrl   != null) o.put("dstUrl",   dstUrl);
                o.put("status",     status);
                o.put("bytesDone",  bytesDone);
                o.put("bytesTotal", bytesTotal);
                if (error != null) o.put("error", error);
                o.put("startedAt",  startedAt);
                o.put("finishedAt", finishedAt);
                if (bytesTotal > 0) {
                    o.put("percent", Math.min(100,
                            (int) (bytesDone * 100L / bytesTotal)));
                }
            } catch (Exception ignored) {}
            return o;
        }
    }

    // ============================================================
    // Публичный API
    // ============================================================

    public Task start(Task t) {
        t.id = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        t.status = "queued";
        tasks.put(t.id, t);
        broadcast("copy-start", t);
        exec.submit(() -> runTask(t));
        return t;
    }

    public Task get(String taskId)   { return tasks.get(taskId); }
    public Map<String, Task> list()  { return tasks; }

    public boolean cancel(String taskId) {
        Task t = tasks.get(taskId);
        if (t == null) return false;
        t.cancelRequested = true;
        return true;
    }

    public void shutdown() {
        exec.shutdownNow();
        tasks.clear();
    }

    // ============================================================
    // Исполнение
    // ============================================================

    private void runTask(Task t) {
        t.status    = "running";
        t.startedAt = System.currentTimeMillis();
        broadcast("copy-progress", t);

        try {
            AuthService.Session session = reResolveSession(t);
            switch (t.mode) {
                case "local": runLocal(t, session); break;
                case "push":  runPush(t, session);  break;
                case "pull":  runPull(t, session);  break;
                case "relay": runRelay(t);          break;
                default: throw new IllegalArgumentException(
                        "Unknown mode: " + t.mode);
            }
            t.status = t.cancelRequested ? "canceled" : "done";
        } catch (Exception e) {
            t.status = "error";
            t.error  = e.getClass().getSimpleName()
                    + (e.getMessage() != null ? ": " + e.getMessage() : "");
        } finally {
            t.finishedAt = System.currentTimeMillis();
            broadcast("copy-done", t);
        }
    }

    private AuthService.Session reResolveSession(Task t) throws Exception {
        AuthService auth = FileServer.auth();
        if (auth == null) throw new IllegalStateException("Server not running");
        if (t.isAnonymous) {
            AuthService.Session s = new AuthService.Session();
            s.anonymous = true;
            return s;
        }
        Config.User u = auth.config().users.get(t.username);
        if (u == null) throw new SecurityException(
                "User no longer exists: " + t.username);
        AuthService.Session s = new AuthService.Session();
        s.username  = t.username;
        s.anonymous = false;
        s.user      = u;
        return s;
    }

    // ------------------------------------------------------------
    // LOCAL: копия внутри одного сервера (без сети)
    // ------------------------------------------------------------
    private void runLocal(Task t, AuthService.Session session) throws Exception {
        VirtualResolver.Resolved src = VirtualResolver.resolve(
                FileServer.auth(), session, t.srcPath, "read");
        VirtualResolver.Resolved dst = VirtualResolver.resolve(
                FileServer.auth(), session, t.dstPath, "write");

        if (!Files.exists(src.physicalPath)) {
            throw new IOException("Source not found: " + t.srcPath);
        }
        t.bytesTotal = FileService.sizeOf(src.physicalPath);

        copyRecursive(src.physicalPath, dst.physicalPath, t);
    }

    private void copyRecursive(Path src, Path dst, Task t) throws IOException {
        if (t.cancelRequested) throw new IOException("Canceled");

        if (Files.isDirectory(src)) {
            Files.createDirectories(dst);
            try (DirectoryStream<Path> ds = Files.newDirectoryStream(src)) {
                for (Path child : ds) {
                    Path target = dst.resolve(child.getFileName().toString());
                    copyRecursive(child, target, t);
                }
            }
            return;
        }

        Path parent = dst.getParent();
        if (parent != null && !Files.exists(parent)) Files.createDirectories(parent);

        long lastReport = 0L;
        long lastTime   = System.currentTimeMillis();

        try (InputStream in = Files.newInputStream(src);
             OutputStream out = Files.newOutputStream(dst,
                     StandardOpenOption.CREATE,
                     StandardOpenOption.TRUNCATE_EXISTING,
                     StandardOpenOption.WRITE)) {
            byte[] buf = new byte[BUF];
            int n;
            while ((n = in.read(buf)) > 0) {
                if (t.cancelRequested) throw new IOException("Canceled");
                out.write(buf, 0, n);
                t.bytesDone += n;

                long now = System.currentTimeMillis();
                if (t.bytesDone - lastReport >= PROGRESS_STEP
                        || now - lastTime >= PROGRESS_TIME_MS) {
                    lastReport = t.bytesDone;
                    lastTime   = now;
                    broadcast("copy-progress", t);
                }
            }
        }
    }

    // ------------------------------------------------------------
    // PUSH: локальный файл → удалённый сервер (PUT /api/write)
    // ------------------------------------------------------------
    private void runPush(Task t, AuthService.Session session) throws Exception {
        VirtualResolver.Resolved src = VirtualResolver.resolve(
                FileServer.auth(), session, t.srcPath, "read");

        if (!Files.isRegularFile(src.physicalPath)) {
            throw new IOException("Source is not a regular file: " + t.srcPath);
        }
        t.bytesTotal = Files.size(src.physicalPath);

        String url = t.dstUrl + "/api/write?path="
                + URLEncoder.encode(t.dstPath, "UTF-8");

        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod("PUT");
        conn.setConnectTimeout(CONNECT_TIMEOUT);
        conn.setReadTimeout(READ_TIMEOUT);
        conn.setDoOutput(true);
        conn.setFixedLengthStreamingMode(t.bytesTotal);
        conn.setRequestProperty("Content-Type", "application/octet-stream");
        if (t.dstToken != null && !t.dstToken.isEmpty()) {
            conn.setRequestProperty("Authorization", "Bearer " + t.dstToken);
        }

        try (InputStream in = Files.newInputStream(src.physicalPath);
             OutputStream out = conn.getOutputStream()) {
            pumpWithProgress(in, out, t);
        }

        int code = conn.getResponseCode();
        if (code != 200) {
            String err = readError(conn);
            throw new IOException("Remote PUT returned " + code
                    + (err.isEmpty() ? "" : ": " + err));
        }
    }

    // ------------------------------------------------------------
    // PULL: удалённый файл → локальный (GET /api/read)
    // ------------------------------------------------------------
    private void runPull(Task t, AuthService.Session session) throws Exception {
        VirtualResolver.Resolved dst = VirtualResolver.resolve(
                FileServer.auth(), session, t.dstPath, "write");

        String url = t.srcUrl + "/api/read?path="
                + URLEncoder.encode(t.srcPath, "UTF-8");

        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(CONNECT_TIMEOUT);
        conn.setReadTimeout(READ_TIMEOUT);
        if (t.srcToken != null && !t.srcToken.isEmpty()) {
            conn.setRequestProperty("Authorization", "Bearer " + t.srcToken);
        }

        int code = conn.getResponseCode();
        if (code != 200) {
            String err = readError(conn);
            throw new IOException("Remote GET returned " + code
                    + (err.isEmpty() ? "" : ": " + err));
        }

        long total = conn.getContentLengthLong();
        t.bytesTotal = total > 0 ? total : -1;

        Path parent = dst.physicalPath.getParent();
        if (parent != null && !Files.exists(parent)) Files.createDirectories(parent);

        Path temp = Files.createTempFile(parent, ".far-pull-", ".tmp");
        boolean moved = false;
        try {
            try (InputStream in  = conn.getInputStream();
                 OutputStream out = Files.newOutputStream(temp,
                         StandardOpenOption.WRITE,
                         StandardOpenOption.TRUNCATE_EXISTING)) {
                pumpWithProgress(in, out, t);
            }
            try {
                Files.move(temp, dst.physicalPath,
                        StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE);
            } catch (IOException atomicFail) {
                Files.move(temp, dst.physicalPath,
                        StandardCopyOption.REPLACE_EXISTING);
            }
            moved = true;
        } finally {
            if (!moved) {
                try { Files.deleteIfExists(temp); } catch (IOException ignored) {}
            }
            conn.disconnect();
        }
    }

    // ------------------------------------------------------------
    // RELAY: удалённый A → удалённый B, через наш сервер как pipe
    // ------------------------------------------------------------
    private void runRelay(Task t) throws Exception {
        String srcUrl = t.srcUrl + "/api/read?path="
                + URLEncoder.encode(t.srcPath, "UTF-8");

        HttpURLConnection srcConn =
                (HttpURLConnection) new URL(srcUrl).openConnection();
        srcConn.setRequestMethod("GET");
        srcConn.setConnectTimeout(CONNECT_TIMEOUT);
        srcConn.setReadTimeout(READ_TIMEOUT);
        if (t.srcToken != null && !t.srcToken.isEmpty()) {
            srcConn.setRequestProperty("Authorization", "Bearer " + t.srcToken);
        }

        int code = srcConn.getResponseCode();
        if (code != 200) {
            String err = readError(srcConn);
            srcConn.disconnect();
            throw new IOException("Source GET returned " + code
                    + (err.isEmpty() ? "" : ": " + err));
        }

        long total = srcConn.getContentLengthLong();
        t.bytesTotal = total > 0 ? total : -1;

        String dstUrl = t.dstUrl + "/api/write?path="
                + URLEncoder.encode(t.dstPath, "UTF-8");

        HttpURLConnection dstConn =
                (HttpURLConnection) new URL(dstUrl).openConnection();
        dstConn.setRequestMethod("PUT");
        dstConn.setConnectTimeout(CONNECT_TIMEOUT);
        dstConn.setReadTimeout(READ_TIMEOUT);
        dstConn.setDoOutput(true);
        if (total > 0) dstConn.setFixedLengthStreamingMode(total);
        else           dstConn.setChunkedStreamingMode(BUF);
        dstConn.setRequestProperty("Content-Type", "application/octet-stream");
        if (t.dstToken != null && !t.dstToken.isEmpty()) {
            dstConn.setRequestProperty("Authorization", "Bearer " + t.dstToken);
        }

        try (InputStream in  = srcConn.getInputStream();
             OutputStream out = dstConn.getOutputStream()) {
            pumpWithProgress(in, out, t);
        } finally {
            try { srcConn.disconnect(); } catch (Exception ignored) {}
        }

        int dstCode = dstConn.getResponseCode();
        try { dstConn.disconnect(); } catch (Exception ignored) {}
        if (dstCode != 200) {
            throw new IOException("Destination PUT returned " + dstCode);
        }
    }

    // ------------------------------------------------------------
    // Хелперы
    // ------------------------------------------------------------

    private void pumpWithProgress(InputStream in, OutputStream out, Task t)
            throws IOException {
        byte[] buf = new byte[BUF];
        long lastReport = 0L;
        long lastTime   = System.currentTimeMillis();
        int n;
        while ((n = in.read(buf)) > 0) {
            if (t.cancelRequested) throw new IOException("Canceled");
            out.write(buf, 0, n);
            t.bytesDone += n;

            long now = System.currentTimeMillis();
            if (t.bytesDone - lastReport >= PROGRESS_STEP
                    || now - lastTime >= PROGRESS_TIME_MS) {
                lastReport = t.bytesDone;
                lastTime   = now;
                broadcast("copy-progress", t);
            }
        }
    }

    private String readError(HttpURLConnection conn) {
        try (InputStream es = conn.getErrorStream()) {
            if (es == null) return "";
            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[2048];
            int n;
            while ((n = es.read(buf)) > 0) baos.write(buf, 0, n);
            String s = baos.toString("utf-8").trim();
            return s.length() > 200 ? s.substring(0, 200) + "…" : s;
        } catch (Exception e) {
            return "";
        }
    }

    private void broadcast(String event, Task t) {
        try {
            if (FileServer.config() != null) {
                FileServer.broadcastEvent(event, t.toJson().toString());
            }
        } catch (Exception ignored) {}
    }
}