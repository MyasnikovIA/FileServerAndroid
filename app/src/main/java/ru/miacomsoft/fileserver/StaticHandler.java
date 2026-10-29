package ru.miacomsoft.fileserver;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.IOException;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Set;

public class StaticHandler implements HttpHandler {

    private static final Set<String> BLOCKED_SEGMENTS = Set.of(
            ".idea", ".git", ".gitignore", "config.json");

    private final Path webRoot;

    public StaticHandler(Path webRoot) {
        this.webRoot = webRoot.toAbsolutePath().normalize();
    }

    public Path getWebRoot() { return webRoot; }

    // ============================================================
    // Content-Type
    // ============================================================

    public static String detectContentType(Path file) {
        if (file == null) return "application/octet-stream";
        String name = file.getFileName().toString();
        String byExt = guessMime(name);
        if (!"application/octet-stream".equals(byExt)) return byExt;
        try {
            String ct = Files.probeContentType(file);
            if (ct != null && !ct.isEmpty() && !"content/unknown".equals(ct)) return ct;
        } catch (IOException ignored) {}
        return "application/octet-stream";
    }

    public static String guessMime(String name) {
        if (name == null) return "application/octet-stream";
        String lower = name.toLowerCase(Locale.ROOT);

        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js")   || lower.endsWith(".mjs")) return "application/javascript; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".json")) return "application/json; charset=utf-8";
        if (lower.endsWith(".xml")) return "application/xml; charset=utf-8";
        if (lower.endsWith(".map")) return "application/json; charset=utf-8";
        if (lower.endsWith(".wasm")) return "application/wasm";

        if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
        if (lower.endsWith(".md"))  return "text/markdown; charset=utf-8";
        if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
        if (lower.endsWith(".log")) return "text/plain; charset=utf-8";
        if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "application/x-yaml; charset=utf-8";
        if (lower.endsWith(".ini")  || lower.endsWith(".cfg")) return "text/plain; charset=utf-8";

        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".bmp")) return "image/bmp";
        if (lower.endsWith(".ico")) return "image/x-icon";

        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".m4a")) return "audio/mp4";
        if (lower.endsWith(".aac")) return "audio/aac";
        if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".flac")) return "audio/flac";

        if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
        if (lower.endsWith(".webm")) return "video/webm";
        if (lower.endsWith(".mkv")) return "video/x-matroska";
        if (lower.endsWith(".mov")) return "video/quicktime";
        if (lower.endsWith(".ogv")) return "video/ogg";
        if (lower.endsWith(".avi")) return "video/x-msvideo";

        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".rar")) return "application/vnd.rar";
        if (lower.endsWith(".7z"))  return "application/x-7z-compressed";
        if (lower.endsWith(".tar")) return "application/x-tar";
        if (lower.endsWith(".gz"))  return "application/gzip";

        if (lower.endsWith(".woff"))  return "font/woff";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".ttf"))   return "font/ttf";
        if (lower.endsWith(".otf"))   return "font/otf";

        return "application/octet-stream";
    }

    // ============================================================
    // resolve
    // ============================================================

    public Path tryResolve(String cleanPath) {
        if (cleanPath == null) return null;
        if (cleanPath.isEmpty()) cleanPath = "index.html";

        String[] parts = cleanPath.split("/");
        for (String part : parts) {
            if (BLOCKED_SEGMENTS.contains(part)) return null;
        }

        Path target = webRoot.resolve(cleanPath).normalize();
        if (!target.startsWith(webRoot)) return null;
        if (!Files.isRegularFile(target)) return null;
        return target;
    }

    // ============================================================
    // serve
    // ============================================================

    public static void serveFileWithRange(HttpExchange ex, Path file, String contentType)
            throws Exception {

        String method = ex.getRequestMethod().toUpperCase();
        boolean isHead = "HEAD".equals(method);
        if (!isHead && !"GET".equals(method)) {
            FileServer.sendError(ex, 405, "Method not allowed");
            return;
        }

        long size = Files.size(file);

        FileServer.handleCors(ex);
        ex.getResponseHeaders().set("Content-Type", contentType);
        ex.getResponseHeaders().set("Accept-Ranges", "bytes");
        ex.getResponseHeaders().set("Cache-Control", "no-cache");
        ex.getResponseHeaders().set("X-Content-Type-Options", "nosniff");

        String rangeHeader = ex.getRequestHeaders().getFirst("Range");
        long start = 0, end = size - 1;
        boolean partial = false;

        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            String range = rangeHeader.substring(6).trim();
            int comma = range.indexOf(',');
            if (comma > 0) range = range.substring(0, comma);
            int dash = range.indexOf('-');
            if (dash >= 0) {
                String startStr = range.substring(0, dash).trim();
                String endStr   = range.substring(dash + 1).trim();
                try {
                    if (startStr.isEmpty() && !endStr.isEmpty()) {
                        long suffix = Long.parseLong(endStr);
                        start = Math.max(0, size - suffix);
                        end = size - 1;
                        partial = true;
                    } else if (!startStr.isEmpty() && endStr.isEmpty()) {
                        start = Long.parseLong(startStr);
                        end = size - 1;
                        partial = true;
                    } else if (!startStr.isEmpty() && !endStr.isEmpty()) {
                        start = Long.parseLong(startStr);
                        end = Math.min(Long.parseLong(endStr), size - 1);
                        partial = true;
                    }
                } catch (NumberFormatException e) {
                    partial = false;
                }
            }
        }

        if (partial && (start > end || start >= size)) {
            ex.getResponseHeaders().set("Content-Range", "bytes */" + size);
            ex.sendResponseHeaders(416, -1);
            ex.close();
            return;
        }

        long contentLength = partial ? (end - start + 1) : size;
        int status = partial ? 206 : 200;

        if (partial) {
            ex.getResponseHeaders().set("Content-Range",
                    "bytes " + start + "-" + end + "/" + size);
        }

        if (isHead) {
            ex.getResponseHeaders().set("Content-Length", String.valueOf(contentLength));
            ex.sendResponseHeaders(status, -1);
            ex.close();
            return;
        }

        ex.sendResponseHeaders(status, contentLength);

        try (java.io.RandomAccessFile raf =
                     new java.io.RandomAccessFile(file.toFile(), "r");
             OutputStream os = ex.getResponseBody()) {
            raf.seek(start);
            byte[] buf = new byte[16384];
            long remaining = contentLength;
            while (remaining > 0) {
                int toRead = (int) Math.min(buf.length, remaining);
                int n = raf.read(buf, 0, toRead);
                if (n <= 0) break;
                os.write(buf, 0, n);
                remaining -= n;
            }
        }
    }

    public void serveFile(HttpExchange ex, Path file) throws Exception {
        serveFileWithRange(ex, file, detectContentType(file));
    }

    @Override
    public void handle(HttpExchange ex) throws Exception {
        if (FileServer.handleOptions(ex)) return;

        String uriPath = ex.getRequestURI().getRawPath();
        if (uriPath == null || uriPath.isEmpty() || "/".equals(uriPath)) {
            uriPath = "/index.html";
        }

        String decoded;
        try { decoded = URLDecoder.decode(uriPath, "UTF-8"); }
        catch (Exception e) { decoded = uriPath; }

        String clean = decoded.replace('\\', '/');
        while (clean.startsWith("/")) clean = clean.substring(1);

        Path file = tryResolve(clean);
        if (file == null) {
            FileServer.sendError(ex, 404, "Not found: " + clean);
            return;
        }
        serveFile(ex, file);
    }
}