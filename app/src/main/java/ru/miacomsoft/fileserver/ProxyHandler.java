package ru.miacomsoft.fileserver;

import com.sun.net.httpserver.HttpExchange;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class ProxyHandler {

    private static final int CONNECT_TIMEOUT = 10000;
    private static final int READ_TIMEOUT = 60000;

    // Заголовки, которые МЫ НЕ ПЕРЕДАЕМ на целевой сервер.
    // Важно: "authorization" и "cookie" мы убираем, так как они принадлежат текущему прокси-серверу.
    // Для авторизации на целевом сервере клиент будет слать "X-Proxy-Target-Token".
    private static final Set<String> SKIP_REQUEST_HEADERS = Set.of(
            "host", "connection", "content-length", "accept-encoding",
            "transfer-encoding", "upgrade", "keep-alive", "proxy-connection",
            "proxy-authorization", "cookie", "authorization", "x-proxy-target-token"
    );

    private static final Set<String> SKIP_RESPONSE_HEADERS = Set.of(
            "transfer-encoding", "connection", "content-length",
            "keep-alive", "upgrade", "set-cookie", "content-encoding"
    );

    public static void handle(HttpExchange ex) throws IOException {
        if (FileServer.handleOptions(ex)) return;

        // 1. Аутентификация на самом прокси-сервере (Android FileServer)
        AuthService.Session session = FileServer.auth().authenticate(ex);
        if (session == null) {
            ex.getResponseHeaders().set("WWW-Authenticate", "Basic realm=\"FileServer\"");
            FileServer.sendError(ex, 401, "Unauthorized");
            return;
        }

        String path = ex.getRequestURI().getPath();
        if (!path.startsWith("/api/proxy/")) {
            FileServer.sendError(ex, 400, "Invalid proxy path");
            return;
        }

        String after = path.substring("/api/proxy/".length());
        int slash = after.indexOf('/');
        String b64Target;
        String targetPath;
        if (slash < 0) {
            b64Target = after;
            targetPath = "/";
        } else {
            b64Target = after.substring(0, slash);
            targetPath = after.substring(slash);
        }

        if (b64Target.isEmpty()) {
            FileServer.sendError(ex, 400, "Missing target in proxy URL");
            return;
        }

        String targetBase;
        try {
            String padded = b64Target;
            int mod = padded.length() % 4;
            if (mod == 2) padded += "==";
            else if (mod == 3) padded += "=";
            byte[] decoded = Base64.getUrlDecoder().decode(padded);
            targetBase = new String(decoded, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            FileServer.sendError(ex, 400, "Invalid base64 target: " + e.getMessage());
            return;
        }

        targetBase = targetBase.replaceAll("/+$", "");

        if (!targetBase.startsWith("http://") && !targetBase.startsWith("https://")) {
            FileServer.sendError(ex, 400, "Target must be http(s): " + targetBase);
            return;
        }

        String targetUrl = targetBase + targetPath;
        String rawQuery = ex.getRequestURI().getRawQuery();
        if (rawQuery != null && !rawQuery.isEmpty()) {
            targetUrl += "?" + rawQuery;
        }

        String method = ex.getRequestMethod().toUpperCase();
        System.out.println("[Proxy] " + method + " " + targetUrl);

        try {
            forward(ex, targetUrl, method);
        } catch (Exception e) {
            System.err.println("[Proxy] ERROR " + method + " " + targetUrl + ": " + e.getMessage());
            try {
                FileServer.sendError(ex, 502, "Proxy error: " + e.getMessage());
            } catch (IOException ignored) {}
        }
    }

    private static void forward(HttpExchange ex, String targetUrl, String method) throws IOException {
        URL url = new URL(targetUrl);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(CONNECT_TIMEOUT);
        conn.setReadTimeout(READ_TIMEOUT);
        conn.setInstanceFollowRedirects(false);
        conn.setDoInput(true);

        // Передаем заголовки, кроме служебных и авторизационных прокси
        for (Map.Entry<String, List<String>> entry : ex.getRequestHeaders().entrySet()) {
            String key = entry.getKey();
            if (key == null) continue;
            String lower = key.toLowerCase();
            if (SKIP_REQUEST_HEADERS.contains(lower)) continue;
            for (String v : entry.getValue()) {
                conn.addRequestProperty(key, v);
            }
        }

        // ВАЖНО: Если клиент прислал токен для ЦЕЛЕВОГО сервера, добавляем его
        String targetToken = ex.getRequestHeaders().getFirst("X-Proxy-Target-Token");
        if (targetToken != null && !targetToken.isEmpty()) {
            conn.setRequestProperty("Authorization", "Bearer " + targetToken);
        }

        boolean hasBody = "POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method);
        if (hasBody) {
            conn.setDoOutput(true);
            String clHeader = ex.getRequestHeaders().getFirst("Content-Length");
            long contentLength = -1;
            if (clHeader != null) {
                try { contentLength = Long.parseLong(clHeader); } catch (NumberFormatException ignored) {}
            }
            if (contentLength >= 0) {
                conn.setFixedLengthStreamingMode(contentLength);
            } else {
                conn.setChunkedStreamingMode(16384);
            }
            try (InputStream in = ex.getRequestBody();
                 OutputStream out = conn.getOutputStream()) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
        }

        int status;
        InputStream responseStream;
        try {
            status = conn.getResponseCode();
            responseStream = (status >= 400) ? conn.getErrorStream() : conn.getInputStream();
        } catch (IOException io) {
            throw new IOException("Target unreachable: " + io.getMessage(), io);
        }

        if (responseStream == null) {
            ex.sendResponseHeaders(status, -1);
            ex.close();
            conn.disconnect();
            return;
        }

        String contentType = null;
        long responseLength = -1;
        for (Map.Entry<String, List<String>> entry : conn.getHeaderFields().entrySet()) {
            String key = entry.getKey();
            if (key == null) continue;
            String lower = key.toLowerCase();

            if (lower.equals("content-length")) {
                try { responseLength = Long.parseLong(entry.getValue().get(0)); }
                catch (NumberFormatException ignored) {}
                continue;
            }
            if (lower.equals("content-type")) {
                contentType = entry.getValue().get(0);
            }
            if (SKIP_RESPONSE_HEADERS.contains(lower)) continue;

            for (String v : entry.getValue()) {
                try { ex.getResponseHeaders().add(key, v); } catch (Exception ignored) {}
            }
        }

        boolean isSSE = contentType != null && contentType.contains("text/event-stream");

        if ("HEAD".equals(method)) {
            ex.getResponseHeaders().set("Content-Length", String.valueOf(responseLength >= 0 ? responseLength : 0));
            ex.sendResponseHeaders(status, -1);
            ex.close();
            try { responseStream.close(); } catch (IOException ignored) {}
            conn.disconnect();
            return;
        }

        if (isSSE) {
            ex.sendResponseHeaders(status, 0);
            try (OutputStream out = ex.getResponseBody()) {
                byte[] buf = new byte[4096];
                int n;
                while ((n = responseStream.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    out.flush();
                }
            } finally {
                try { responseStream.close(); } catch (IOException ignored) {}
                conn.disconnect();
            }
            return;
        }

        if (responseLength >= 0) {
            ex.sendResponseHeaders(status, responseLength);
            try (OutputStream out = ex.getResponseBody()) {
                byte[] buf = new byte[16384];
                long remaining = responseLength;
                int n;
                while (remaining > 0 && (n = responseStream.read(buf, 0, (int) Math.min(buf.length, remaining))) > 0) {
                    out.write(buf, 0, n);
                    remaining -= n;
                }
            } finally {
                try { responseStream.close(); } catch (IOException ignored) {}
                conn.disconnect();
            }
        } else {
            ex.sendResponseHeaders(status, 0);
            try (OutputStream out = ex.getResponseBody()) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = responseStream.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
            } finally {
                try { responseStream.close(); } catch (IOException ignored) {}
                conn.disconnect();
            }
        }
    }
}