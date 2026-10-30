package ru.miacomsoft.fileserver;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.*;

public class ApiHandler implements HttpHandler {

    @Override
    public void handle(HttpExchange ex) throws Exception {
        if (FileServer.handleOptions(ex)) return;

        String path = ex.getRequestURI().getPath();
        String method = ex.getRequestMethod().toUpperCase();
        Map<String, String> q = FileServer.parseQuery(ex.getRequestURI().getQuery());

        if (path.startsWith("/api/public/")) {
            handlePublic(ex, path);
            return;
        }
        if ("/api/login".equals(path)) {
            handleLogin(ex, method, q);
            return;
        }
        if ("/api/logout".equals(path)) {
            handleLogout(ex, method, q);
            return;
        }

        AuthService.Session session = FileServer.auth().authenticate(ex);
        if (session == null) {
            ex.getResponseHeaders().set("WWW-Authenticate", "Basic realm=\"FileServer\"");
            FileServer.sendError(ex, 401, "Unauthorized");
            return;
        }

        try {
            switch (path) {
                case "/api/info":    handleInfo(ex, method, session);      return;
                case "/api/whoami":  handleWhoami(ex, method, session);    return;
                case "/api/list":    handleList(ex, method, q, session);   return;
                case "/api/stat":    handleStat(ex, method, q, session);   return;
                case "/api/read":    handleRead(ex, method, q, session);   return;
                case "/api/write":   handleWrite(ex, method, q, session);  return;
                case "/api/mkdir":   handleMkdir(ex, method, q, session);  return;
                case "/api/delete":  handleDelete(ex, method, q, session); return;
                case "/api/move":    handleMove(ex, method, q, session);   return;
                case "/api/copy":    handleCopy(ex, method, q, session);   return;
                default:
                    if (tryApiSharePath(ex, path)) return;
                    FileServer.sendError(ex, 404, "Unknown endpoint: " + path);
            }
        } catch (NoSuchFileException e) {
            FileServer.sendError(ex, 404, "Not found: " + e.getFile());
        } catch (java.util.NoSuchElementException e) {
            FileServer.sendError(ex, 404, e.getMessage());
        } catch (SecurityException e) {
            FileServer.sendError(ex, 403, "Forbidden: " + e.getMessage());
        } catch (QuotaService.QuotaExceededException e) {
            JSONObject o = new JSONObject();
            o.put("error", "Quota exceeded");
            o.put("scope", e.scope);
            o.put("quotaMb", e.quotaMb);
            o.put("usedBytes", e.usedBytes);
            o.put("freeBytes", e.freeBytes);
            o.put("deltaBytes", e.deltaBytes);
            o.put("status", 507);
            FileServer.sendJson(ex, 507, o.toString());
        } catch (IllegalArgumentException e) {
            FileServer.sendError(ex, 400, "Bad request: " + e.getMessage());
        } catch (Exception e) {
            e.printStackTrace();
            FileServer.sendError(ex, 500, "Server error: " + e.getMessage());
        }
    }

    private boolean tryApiSharePath(HttpExchange ex, String path) throws Exception {
        if (!path.startsWith("/api/")) return false;
        String after = path.substring("/api/".length());
        if (after.isEmpty()) return false;

        int slash = after.indexOf('/');
        String shareName = slash < 0 ? after : after.substring(0, slash);

        // Защита от перехвата системных эндпоинтов и прокси
        if ("proxy".equals(shareName) || "login".equals(shareName) ||
                "logout".equals(shareName) || "info".equals(shareName) ||
                "whoami".equals(shareName) || "list".equals(shareName) ||
                "stat".equals(shareName) || "read".equals(shareName) ||
                "write".equals(shareName) || "mkdir".equals(shareName) ||
                "delete".equals(shareName) || "move".equals(shareName) ||
                "copy".equals(shareName) || "events".equals(shareName) ||
                "public".equals(shareName)) {
            return false;
        }

        String relDecoded = slash < 0 ? "" : after.substring(slash + 1);
        if (shareName.isEmpty()) return false;

        Config.Share share = FileServer.config().findShare(shareName);
        RootHandler rh = FileServer.rootHandler();
        if (rh == null) return false;
        if (share != null) {
            rh.serveFromShare(ex, share, relDecoded);
            return true;
        }
        Config.Share rootShare = FileServer.config().findRootShare();
        if (rootShare != null) {
            rh.serveFromShare(ex, rootShare, after);
            return true;
        }
        return false;
    }

    private void handleLogin(HttpExchange ex, String method, Map<String, String> q)
            throws Exception {
        String user = null, pass = null;
        if ("POST".equals(method)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            try (InputStream is = ex.getRequestBody()) {
                byte[] tmp = new byte[4096];
                int n;
                while ((n = is.read(tmp)) > 0) buf.write(tmp, 0, n);
            }
            String body = new String(buf.toByteArray(), StandardCharsets.UTF_8).trim();
            if (body.startsWith("{")) {
                try {
                    JSONObject jo = new JSONObject(body);
                    user = jo.optString("user", jo.optString("username", ""));
                    pass = jo.optString("pass", jo.optString("password", ""));
                } catch (Exception e) {
                    FileServer.sendError(ex, 400, "Invalid JSON body");
                    return;
                }
            } else {
                Map<String, String> fq = FileServer.parseQuery(body);
                user = fq.get("user");
                if (user == null) user = fq.get("username");
                pass = fq.get("pass");
                if (pass == null) pass = fq.get("password");
            }
        } else if ("GET".equals(method)) {
            user = q.get("user");
            if (user == null) user = q.get("username");
            pass = q.get("pass");
            if (pass == null) pass = q.get("password");
        } else {
            FileServer.sendError(ex, 405, "Method not allowed");
            return;
        }

        if (user == null || user.trim().isEmpty()) {
            FileServer.sendError(ex, 400, "user is required");
            return;
        }
        user = user.trim();
        if (pass == null) pass = "";

        Config.User u = FileServer.config().users.get(user);
        if (u == null || !Objects.equals(u.password == null ? "" : u.password, pass)) {
            FileServer.sendError(ex, 401, "Invalid credentials");
            return;
        }

        TokenService.Token t = FileServer.tokens().issue(user);

        long ttlSec = TokenService.TTL_MS / 1000;
        ex.getResponseHeaders().add("Set-Cookie",
                AuthService.AUTH_COOKIE_NAME + "=" + t.value +
                        "; Path=/; Max-Age=" + ttlSec + "; SameSite=Lax");

        JSONObject resp = new JSONObject();
        resp.put("ok", true);
        resp.put("token", t.value);
        resp.put("user", user);
        resp.put("issuedAt", t.issuedAt);
        resp.put("expiresAt", t.expiresAt);
        resp.put("ttlMs", TokenService.TTL_MS);
        FileServer.sendJson(ex, 200, resp.toString());
    }

    private void handleLogout(HttpExchange ex, String method, Map<String, String> q)
            throws Exception {
        String token = null;
        if ("POST".equals(method)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            try (InputStream is = ex.getRequestBody()) {
                byte[] tmp = new byte[4096];
                int n;
                while ((n = is.read(tmp)) > 0) buf.write(tmp, 0, n);
            }
            String body = new String(buf.toByteArray(), StandardCharsets.UTF_8).trim();
            if (body.startsWith("{")) {
                try {
                    JSONObject jo = new JSONObject(body);
                    token = jo.optString("token", "");
                } catch (Exception e) { /* ignore */ }
            } else {
                token = FileServer.parseQuery(body).get("token");
            }
        } else if ("GET".equals(method)) {
            token = q.get("token");
        } else {
            FileServer.sendError(ex, 405, "Method not allowed");
            return;
        }

        if (token == null || token.isEmpty()) {
            String h = ex.getRequestHeaders().getFirst("Authorization");
            if (h != null && h.startsWith("Bearer ")) {
                token = h.substring("Bearer ".length()).trim();
            }
        }
        if (token == null || token.isEmpty()) {
            String cookieHeader = ex.getRequestHeaders().getFirst("Cookie");
            if (cookieHeader != null) {
                String cookieToken = AuthService.parseCookieValue(
                        cookieHeader, AuthService.AUTH_COOKIE_NAME);
                if (cookieToken != null) token = cookieToken;
            }
        }
        if (token != null && !token.isEmpty()) {
            FileServer.tokens().revoke(token);
        }

        ex.getResponseHeaders().add("Set-Cookie",
                AuthService.AUTH_COOKIE_NAME + "=; Path=/; Max-Age=0; SameSite=Lax");

        JSONObject ok = new JSONObject();
        ok.put("ok", true);
        FileServer.sendJson(ex, 200, ok.toString());
    }

    private void handleWhoami(HttpExchange ex, String method, AuthService.Session s)
            throws Exception {
        if (!"GET".equals(method)) { FileServer.sendError(ex, 405, "Method not allowed"); return; }
        JSONObject o = new JSONObject();
        o.put("anonymous", s.anonymous);
        o.put("username", s.username == null ? JSONObject.NULL : s.username);
        if (s.user != null) {
            o.put("quotaMb", s.user.quotaMb);
            o.put("console", s.user.consoleEnabled);
        }
        FileServer.sendJson(ex, 200, o.toString());
    }

    private void handleInfo(HttpExchange ex, String method, AuthService.Session s)
            throws Exception {
        if (!"GET".equals(method)) { FileServer.sendError(ex, 405, "Method not allowed"); return; }
        JSONObject info = new JSONObject();
        info.put("type", "filesystem");
        info.put("version", "1.6-android");
        info.put("anonymous", s.anonymous);
        info.put("username", s.username == null ? JSONObject.NULL : s.username);
        info.put("console", false);
        info.put("videoChatEnabled", false);
        info.put("videoChatPort", 0);
        info.put("hermesEnabled", false);
        info.put("hermesTitle", "Hermes Agent");
        info.put("hermesIcon", "☤");

        long userQuotaMb = -1;
        if (s.user != null && s.user.hasQuota()) userQuotaMb = s.user.quotaMb;
        info.put("userQuotaMb", userQuotaMb);
        info.put("userUsedBytes", FileServer.quota().getUserUsedBytes(s));
        JSONArray sharesArr = new JSONArray();
        for (Config.Share sh : FileServer.config().shares) {
            if (!FileServer.auth().shareVisible(s, sh)) continue;
            JSONObject so = new JSONObject();
            so.put("name", sh.isRoot() ? "" : sh.name);
            so.put("type", sh.type);
            so.put("access", new JSONArray(sh.access));
            so.put("quotaMb", sh.quotaMb);
            so.put("usedBytes", FileServer.quota().getShareUsedBytes(sh));
            so.put("root", sh.isRoot());
            sharesArr.put(so);
        }
        info.put("shares", sharesArr);
        FileServer.sendJson(ex, 200, info.toString());
    }

    private void handleList(HttpExchange ex, String method, Map<String, String> q,
                            AuthService.Session s) throws Exception {
        if (!"GET".equals(method)) { FileServer.sendError(ex, 405, "Method not allowed"); return; }
        String vpath = q.getOrDefault("path", "");
        boolean recursive = "1".equals(q.get("recursive"))
                || "true".equals(q.get("recursive"));
        String norm = FileService.normalize(vpath);

        JSONArray entries;
        if (norm.isEmpty()) {
            entries = listRoot(s);
        } else {
            VirtualResolver.Resolved r = VirtualResolver.resolve(
                    FileServer.auth(), s, norm, "read");
            if (r.share.isFile()) {
                entries = new JSONArray();
            } else {
                Path root = r.share.physicalPath();
                List<Map<String, Object>> list =
                        FileService.list(root, r.relPath, recursive);
                String prefix = r.share.isRoot() ? "" : (r.share.name + "/");
                entries = new JSONArray();
                for (Map<String, Object> e : list) {
                    JSONObject eo = new JSONObject(e);
                    eo.put("path", prefix + e.get("path"));
                    entries.put(eo);
                }
            }
        }
        JSONObject resp = new JSONObject();
        resp.put("path", norm);
        resp.put("recursive", recursive);
        resp.put("entries", entries);
        FileServer.sendJson(ex, 200, resp.toString());
    }

    private JSONArray listRoot(AuthService.Session s) throws Exception {
        JSONArray arr = new JSONArray();
        Set<String> explicitNames = new HashSet<>();
        for (Config.Share sh : FileServer.config().shares) {
            if (!sh.isRoot()) explicitNames.add(sh.name);
        }
        Config.Share rootShare = FileServer.config().findRootShare();
        if (rootShare != null && FileServer.auth().canRead(s, rootShare)) {
            try {
                Path root = rootShare.physicalPath();
                List<Map<String, Object>> list = FileService.list(root, "", false);
                for (Map<String, Object> e : list) {
                    String entryName = String.valueOf(e.get("name"));
                    if (explicitNames.contains(entryName)) continue;
                    arr.put(new JSONObject(e));
                }
            } catch (IOException e) {
                System.err.println("[listRoot] root share not available: " + e.getMessage());
            }
        }
        for (Config.Share sh : FileServer.config().shares) {
            if (sh.isRoot()) continue;
            if (!FileServer.auth().shareVisible(s, sh)) continue;
            arr.put(shareEntry(sh));
        }
        return arr;
    }

    private JSONObject shareEntry(Config.Share sh) throws Exception {
        JSONObject e = new JSONObject();
        e.put("name", sh.name);
        e.put("path", sh.name);
        e.put("isFolder", sh.isFolder());
        e.put("mtime", 0);
        e.put("virtual", true);
        e.put("quotaMb", sh.quotaMb);
        e.put("usedBytes", FileServer.quota().getShareUsedBytes(sh));
        e.put("access", new JSONArray(sh.access));
        if (sh.isFile()) {
            try {
                e.put("size", Files.size(sh.physicalPath()));
                String ct = Files.probeContentType(sh.physicalPath());
                e.put("contentType", ct == null ? "application/octet-stream" : ct);
                e.put("binary", true);
            } catch (IOException io) {
                e.put("size", 0L);
                e.put("contentType", "application/octet-stream");
                e.put("binary", true);
            }
        } else {
            e.put("size", 0L);
            e.put("contentType", "");
            e.put("binary", false);
        }
        return e;
    }

    private void handleStat(HttpExchange ex, String method, Map<String, String> q,
                            AuthService.Session s) throws Exception {
        if (!"GET".equals(method)) { FileServer.sendError(ex, 405, "Method not allowed"); return; }
        String vpath = q.getOrDefault("path", "");
        String norm = FileService.normalize(vpath);
        if (norm.isEmpty()) {
            JSONObject result = new JSONObject();
            result.put("name", "/");
            result.put("path", "");
            result.put("isFolder", true);
            result.put("size", 0L);
            result.put("mtime", 0);
            FileServer.sendJson(ex, 200, result.toString());
            return;
        }
        VirtualResolver.Resolved r = VirtualResolver.resolve(
                FileServer.auth(), s, norm, "read");
        if (r.relPath.isEmpty() && !r.share.isRoot()) {
            JSONObject e = new JSONObject();
            e.put("name", r.share.name);
            e.put("path", r.share.name);
            e.put("isFolder", r.share.isFolder());
            e.put("mtime", 0);
            e.put("virtual", true);
            e.put("quotaMb", r.share.quotaMb);
            e.put("usedBytes", FileServer.quota().getShareUsedBytes(r.share));
            e.put("access", new JSONArray(r.share.access));
            if (r.share.isFile()) {
                try {
                    e.put("size", Files.size(r.physicalPath));
                    String ct = Files.probeContentType(r.physicalPath);
                    e.put("contentType", ct == null ? "application/octet-stream" : ct);
                    e.put("binary", true);
                } catch (IOException io) {
                    e.put("size", 0L);
                    e.put("contentType", "application/octet-stream");
                    e.put("binary", true);
                }
            } else {
                e.put("size", 0L);
                e.put("contentType", "");
                e.put("binary", false);
            }
            FileServer.sendJson(ex, 200, e.toString());
            return;
        }
        Map<String, Object> stat = FileService.stat(r.share.physicalPath(), r.relPath);
        JSONObject eo = new JSONObject(stat);
        String prefix = r.share.isRoot() ? "" : (r.share.name + "/");
        eo.put("path", prefix + stat.get("path"));
        FileServer.sendJson(ex, 200, eo.toString());
    }

    private void handleRead(HttpExchange ex, String method, Map<String, String> q,
                            AuthService.Session s) throws Exception {
        if (!"GET".equals(method)) { FileServer.sendError(ex, 405, "Method not allowed"); return; }
        String vpath = q.getOrDefault("path", "");
        String norm = FileService.normalize(vpath);
        if (norm.isEmpty()) { FileServer.sendError(ex, 400, "path is required"); return; }
        VirtualResolver.Resolved r = VirtualResolver.resolve(
                FileServer.auth(), s, norm, "read");
        if (r.share.isFile() && r.relPath.isEmpty()) {
            serveFile(ex, r.physicalPath);
            return;
        }
        if (r.share.isFolder()) {
            Path fsPath = r.physicalPath;
            if (!Files.isRegularFile(fsPath)) {
                FileServer.sendError(ex, 404, "Not a file");
                return;
            }
            serveFile(ex, fsPath);
            return;
        }
        FileServer.sendError(ex, 400, "Cannot read");
    }

    private void serveFile(HttpExchange ex, Path fsPath) throws Exception {
        if (!Files.isRegularFile(fsPath)) {
            FileServer.sendError(ex, 404, "Not a file");
            return;
        }
        StaticHandler.serveFileWithRange(
                ex, fsPath, StaticHandler.detectContentType(fsPath));
    }

    private void handleWrite(HttpExchange ex, String method, Map<String, String> q,
                             AuthService.Session s)
            throws Exception {
        if (!"PUT".equals(method) && !"POST".equals(method)) {
            FileServer.sendError(ex, 405, "Method not allowed"); return;
        }
        String vpath = q.getOrDefault("path", "");
        String norm = FileService.normalize(vpath);
        if (norm.isEmpty()) { FileServer.sendError(ex, 400, "path is required"); return; }

        VirtualResolver.Resolved r = VirtualResolver.resolve(
                FileServer.auth(), s, norm, "write");
        if (r.share.isFile() && !r.relPath.isEmpty()) {
            FileServer.sendError(ex, 400, "Cannot write into a file share");
            return;
        }

        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (InputStream is = ex.getRequestBody()) {
            byte[] tmp = new byte[16384];
            int n;
            while ((n = is.read(tmp)) > 0) buf.write(tmp, 0, n);
        }
        byte[] data = buf.toByteArray();

        long existingSize = 0;
        if (Files.isRegularFile(r.physicalPath)) existingSize = Files.size(r.physicalPath);
        long delta = data.length - existingSize;
        FileServer.quota().checkWriteQuota(r.share, s, delta);

        Path parent = r.physicalPath.getParent();
        if (parent != null && !Files.exists(parent)) Files.createDirectories(parent);

        Path tempFile = Files.createTempFile(
                parent != null ? parent : r.physicalPath.getParent(),
                ".far-write-", ".tmp");
        try {
            Files.write(tempFile, data,
                    java.nio.file.StandardOpenOption.WRITE,
                    java.nio.file.StandardOpenOption.TRUNCATE_EXISTING);
            try {
                Files.move(tempFile, r.physicalPath,
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                        java.nio.file.StandardCopyOption.ATOMIC_MOVE);
            } catch (java.nio.file.AtomicMoveNotSupportedException amnse) {
                Files.move(tempFile, r.physicalPath,
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            try { Files.deleteIfExists(tempFile); } catch (IOException ignored) {}
        }

        FileServer.quota().invalidate(r.share);

        JSONObject ok = new JSONObject();
        ok.put("ok", true);
        ok.put("path", norm);
        ok.put("size", data.length);
        FileServer.sendJson(ex, 200, ok.toString());
    }

    private void handleMkdir(HttpExchange ex, String method, Map<String, String> q,
                             AuthService.Session s) throws Exception {
        if (!"POST".equals(method)) { FileServer.sendError(ex, 405, "Method not allowed"); return; }
        String vpath = q.getOrDefault("path", "");
        String norm = FileService.normalize(vpath);
        if (norm.isEmpty()) { FileServer.sendError(ex, 400, "path is required"); return; }
        VirtualResolver.Resolved r = VirtualResolver.resolve(
                FileServer.auth(), s, norm, "write");
        if (!r.share.isFolder()) {
            FileServer.sendError(ex, 400, "Cannot create inside file share");
            return;
        }
        Files.createDirectories(r.physicalPath);
        FileServer.quota().invalidate(r.share);
        JSONObject ok = new JSONObject();
        ok.put("ok", true);
        ok.put("path", norm);
        FileServer.sendJson(ex, 200, ok.toString());
    }

    private void handleDelete(HttpExchange ex, String method, Map<String, String> q,
                              AuthService.Session s) throws Exception {
        if (!"DELETE".equals(method) && !"POST".equals(method)) {
            FileServer.sendError(ex, 405, "Method not allowed"); return;
        }
        String vpath = q.getOrDefault("path", "");
        String norm = FileService.normalize(vpath);
        if (norm.isEmpty()) { FileServer.sendError(ex, 400, "path is required"); return; }
        VirtualResolver.Resolved r = VirtualResolver.resolve(
                FileServer.auth(), s, norm, "delete");
        if (r.relPath.isEmpty() && !r.share.isRoot()) {
            FileServer.sendError(ex, 400, "Cannot delete share root");
            return;
        }
        if (Files.exists(r.physicalPath)) {
            FileService.delete(r.share.physicalPath(), r.relPath);
        }
        FileServer.quota().invalidate(r.share);
        JSONObject ok = new JSONObject();
        ok.put("ok", true);
        ok.put("path", norm);
        FileServer.sendJson(ex, 200, ok.toString());
    }

    private void handleMove(HttpExchange ex, String method, Map<String, String> q,
                            AuthService.Session s) throws Exception {
        if (!"POST".equals(method)) { FileServer.sendError(ex, 405, "Method not allowed"); return; }
        String fromV = FileService.normalize(q.getOrDefault("from", ""));
        String toV = FileService.normalize(q.getOrDefault("to", ""));
        if (fromV.isEmpty() || toV.isEmpty()) {
            FileServer.sendError(ex, 400, "from and to are required"); return;
        }

        VirtualResolver.Resolved rf = VirtualResolver.resolve(
                FileServer.auth(), s, fromV, "delete");
        VirtualResolver.Resolved rt = VirtualResolver.resolve(
                FileServer.auth(), s, toV, "write");

        if (!Files.exists(rf.physicalPath)) {
            FileServer.sendError(ex, 404, "Source not found: " + fromV);
            return;
        }

        if (rf.share != rt.share) {
            long srcSize = FileService.sizeOf(rf.physicalPath);
            FileServer.quota().checkWriteQuota(rt.share, s, srcSize);
            copyAcrossShares(rf, rt);
            FileService.delete(rf.share.physicalPath(), rf.relPath);
        } else {
            FileService.move(rf.share.physicalPath(), rf.relPath, rt.relPath);
        }

        FileServer.quota().invalidate(rf.share);
        FileServer.quota().invalidate(rt.share);

        JSONObject ok = new JSONObject();
        ok.put("ok", true);
        ok.put("from", fromV);
        ok.put("to", toV);
        FileServer.sendJson(ex, 200, ok.toString());
    }

    private void handleCopy(HttpExchange ex, String method, Map<String, String> q,
                            AuthService.Session s) throws Exception {
        if (!"POST".equals(method)) { FileServer.sendError(ex, 405, "Method not allowed"); return; }
        String fromV = FileService.normalize(q.getOrDefault("from", ""));
        String toV = FileService.normalize(q.getOrDefault("to", ""));
        if (fromV.isEmpty() || toV.isEmpty()) {
            FileServer.sendError(ex, 400, "from and to are required"); return;
        }

        VirtualResolver.Resolved rf = VirtualResolver.resolve(
                FileServer.auth(), s, fromV, "read");
        VirtualResolver.Resolved rt = VirtualResolver.resolve(
                FileServer.auth(), s, toV, "write");

        if (!Files.exists(rf.physicalPath)) {
            FileServer.sendError(ex, 404, "Source not found: " + fromV);
            return;
        }

        long srcSize = FileService.sizeOf(rf.physicalPath);
        FileServer.quota().checkWriteQuota(rt.share, s, srcSize);

        if (rf.share != rt.share) {
            copyAcrossShares(rf, rt);
        } else {
            FileService.copy(rf.share.physicalPath(), rf.relPath, rt.relPath);
        }

        FileServer.quota().invalidate(rt.share);

        JSONObject ok = new JSONObject();
        ok.put("ok", true);
        ok.put("from", fromV);
        ok.put("to", toV);
        FileServer.sendJson(ex, 200, ok.toString());
    }

    private void copyAcrossShares(VirtualResolver.Resolved rf,
                                  VirtualResolver.Resolved rt) throws IOException {
        Path src = rf.physicalPath;
        Path dst = rt.physicalPath;
        if (Files.isDirectory(src)) {
            Files.createDirectories(dst);
            try (java.nio.file.DirectoryStream<Path> stream = Files.newDirectoryStream(src)) {
                for (Path child : stream) {
                    Path target = dst.resolve(child.getFileName().toString());
                    if (Files.isDirectory(child)) {
                        Files.createDirectories(target);
                        copyDirRecursive(child, target);
                    } else {
                        Files.copy(child, target,
                                java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                    }
                }
            }
        } else {
            Path parent = dst.getParent();
            if (parent != null && !Files.exists(parent)) Files.createDirectories(parent);
            Files.copy(src, dst, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private void copyDirRecursive(Path src, Path dst) throws IOException {
        try (java.nio.file.DirectoryStream<Path> stream = Files.newDirectoryStream(src)) {
            for (Path child : stream) {
                Path target = dst.resolve(child.getFileName().toString());
                if (Files.isDirectory(child)) {
                    Files.createDirectories(target);
                    copyDirRecursive(child, target);
                } else {
                    Files.copy(child, target,
                            java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
            }
        }
    }

    private void handlePublic(HttpExchange ex, String path) throws Exception {
        String after = path.substring("/api/public/".length());
        int slash = after.indexOf('/');
        String shareName = slash < 0 ? after : after.substring(0, slash);
        String rel = slash < 0 ? "" : after.substring(slash + 1);
        try { shareName = FileServer.urlDecode(shareName); } catch (Exception ignored) {}
        try { rel = FileServer.urlDecode(rel); } catch (Exception ignored) {}
        Config.Share sh = FileServer.auth().findPublicShare(shareName);
        if (sh == null) {
            FileServer.sendError(ex, 403, "Not public: " + shareName);
            return;
        }
        Path fsPath;
        if (sh.isFile() && rel.isEmpty()) {
            fsPath = sh.physicalPath();
        } else if (sh.isFolder()) {
            Path root = sh.physicalPath();
            Path resolved = rel.isEmpty() ? root : root.resolve(rel).normalize();
            if (!resolved.startsWith(root)) {
                FileServer.sendError(ex, 403, "Path escapes share");
                return;
            }
            fsPath = resolved;
        } else {
            FileServer.sendError(ex, 404, "Not a file");
            return;
        }
        if (!Files.isRegularFile(fsPath)) {
            FileServer.sendError(ex, 404, "Not a file");
            return;
        }
        serveFile(ex, fsPath);
    }
}