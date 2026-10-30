package ru.miacomsoft.fileserver;

import com.sun.net.httpserver.HttpExchange;
import org.json.JSONException;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class FileServer {

    private static Config config;
    private static TokenService tokens;
    private static AuthService auth;
    private static QuotaService quota;
    private static Path webRoot;
    private static StaticHandler staticHandler;
    private static RootHandler rootHandler;
    private static Path configPath;

    static final Map<String, SseConnection> sseClients = new ConcurrentHashMap<>();

    static void bind(FileServerAndroid inst, Path cfgPath) {
        configPath = cfgPath;
        config = inst.config();
        tokens = inst.tokens();
        auth = inst.auth();
        quota = inst.quota();
        webRoot = inst.webRoot();
        staticHandler = inst.staticHandler();
        rootHandler = inst.rootHandler();
    }

    static void unbind() {
        config = null;
        tokens = null;
        auth = null;
        quota = null;
        webRoot = null;
        staticHandler = null;
        rootHandler = null;
        configPath = null;
        sseClients.clear();
    }

    static Config config() { return config; }
    static AuthService auth() { return auth; }
    static TokenService tokens() { return tokens; }
    static QuotaService quota() { return quota; }
    static Path webRoot() { return webRoot; }
    static RootHandler rootHandler() { return rootHandler; }
    static StaticHandler staticHandler() { return staticHandler; }
    static Path configPath() { return configPath; }

    static void broadcastEvent(String event, String data) {
        for (Map.Entry<String, SseConnection> e : sseClients.entrySet()) {
            try {
                e.getValue().send(event, data);
            } catch (IOException io) {
                sseClients.remove(e.getKey());
            }
        }
    }

    static void handleCors(HttpExchange ex) {
        String origin = ex.getRequestHeaders().getFirst("Origin");
        if (origin != null && !origin.isEmpty()) {
            ex.getResponseHeaders().set("Access-Control-Allow-Origin", origin);
            ex.getResponseHeaders().set("Vary", "Origin");
        } else {
            ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        }
        ex.getResponseHeaders().set("Access-Control-Allow-Credentials", "true");
        ex.getResponseHeaders().set("Access-Control-Allow-Methods",
                "GET, POST, PUT, DELETE, OPTIONS, HEAD");
        ex.getResponseHeaders().set("Access-Control-Allow-Headers",
                "Content-Type, Authorization, X-Auth-Token, X-Requested-With");
        ex.getResponseHeaders().set("Access-Control-Max-Age", "86400");
    }

    static boolean handleOptions(HttpExchange ex) throws IOException {
        if ("OPTIONS".equalsIgnoreCase(ex.getRequestMethod())) {
            handleCors(ex);
            ex.sendResponseHeaders(204, -1);
            ex.close();
            return true;
        }
        return false;
    }

    static void sendJson(HttpExchange ex, int status, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        handleCors(ex);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(status, body.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(body);
        }
    }

    static void sendError(HttpExchange ex, int status, String message)
            throws IOException {
        try {
            org.json.JSONObject obj = new org.json.JSONObject();
            obj.put("error", message == null ? "" : message);
            obj.put("status", status);
            sendJson(ex, status, obj.toString());
        } catch (JSONException e) {
            throw new RuntimeException(e);
        }
    }

    static Map<String, String> parseQuery(String query) {
        Map<String, String> result = new HashMap<>();
        if (query == null || query.isEmpty()) return result;
        for (String pair : query.split("&")) {
            int idx = pair.indexOf('=');
            if (idx < 0) result.put(urlDecode(pair), "");
            else result.put(urlDecode(pair.substring(0, idx)),
                    urlDecode(pair.substring(idx + 1)));
        }
        return result;
    }

    static String urlDecode(String s) {
        try {
            return java.net.URLDecoder.decode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }
}