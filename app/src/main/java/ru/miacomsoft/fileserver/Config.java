package ru.miacomsoft.fileserver;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class Config {

    public int port = 8080;
    public String host = "0.0.0.0";
    public String webPath = "www";

    public boolean httpsEnabled = false;
    public String httpsCert = "";
    public String httpsKey = "";
    public String httpsKeystore = "";
    public String httpsPassword = "";

    public String consoleShell = "";
    public String consoleCwd = "";
    public long consoleTimeoutSec = 300;
    public long consoleMaxOutputBytes = 1024 * 1024;

    public boolean hermesEnabled = false;
    public String hermesTitle = "Hermes Agent";
    public String hermesIcon  = "☤";
    public String hermesShell = "";
    public String hermesCwd   = "";
    public List<String> hermesCommands = new ArrayList<>();
    public long hermesStartupDelayMs = 800;
    public long hermesCommandDelayMs = 300;

    public boolean videoChatEnabled = false;
    public int videoChatPort = 8081;
    public String wsGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    public boolean ollamaEnabled = true;
    public String ollamaBinary = "ollama";
    public String ollamaCwd = "";

    // ============================================================
    // АВТОЗАПУСК
    // ============================================================
    public JSONArray autostartAndroid = new JSONArray();
    public JSONArray autostartJs = new JSONArray();
    public JSONArray autostartWm = new JSONArray();

    public Map<String, User> users = new LinkedHashMap<>();
    public List<Share> shares = new ArrayList<>();

    public static class User {
        public String name = "";
        public String password = "";
        public long quotaMb = -1;
        public boolean consoleEnabled = false;
        public boolean hasQuota() { return quotaMb >= 0; }
    }

    public static class Share {
        public String name = "";
        public String physical = "";
        public String type = "folder";
        public Set<String> access = new HashSet<>();
        public boolean anonymous = false;
        public Set<String> users = new HashSet<>();
        public long quotaMb = -1;

        public boolean isFolder() { return "folder".equalsIgnoreCase(type); }
        public boolean isFile()   { return !isFolder(); }
        public boolean isRoot()   { return name == null || name.isEmpty(); }
        public boolean hasRead()   { return access.contains("read");   }
        public boolean hasWrite()  { return access.contains("write");  }
        public boolean hasDelete() { return access.contains("delete"); }
        public boolean hasQuota()  { return quotaMb >= 0; }

        public boolean visibleTo(String username, boolean anonymousSession) {
            if (anonymous) return true;
            if (anonymousSession) return false;
            return username != null && users.contains(username);
        }

        public Path physicalPath() {
            return java.nio.file.Paths.get(physical).toAbsolutePath().normalize();
        }
    }

    public static Config load(Path configPath) throws IOException, JSONException {
        if (!Files.exists(configPath)) {
            throw new IOException("Config file not found: " + configPath);
        }
        String raw = new String(Files.readAllBytes(configPath), StandardCharsets.UTF_8);
        String cleanJson = JsonCommentsStripper.strip(raw);
        JSONObject root = new JSONObject(cleanJson);

        Config cfg = new Config();

        JSONObject http = root.optJSONObject("http");
        if (http != null) {
            cfg.port = http.optInt("port", cfg.port);
            cfg.host = http.optString("host", cfg.host);
        }

        JSONObject https = root.optJSONObject("https");
        if (https != null) {
            cfg.httpsEnabled = https.optBoolean("enabled", false);
            cfg.httpsCert = https.optString("cert", "");
            cfg.httpsKey = https.optString("key", "");
            cfg.httpsKeystore = https.optString("keystore", "");
            cfg.httpsPassword = https.optString("password", "");
        }

        String web = root.optString("web", "");
        if (web != null && !web.trim().isEmpty()) cfg.webPath = web.trim();

        JSONObject console = root.optJSONObject("console");
        if (console != null) {
            cfg.consoleShell = console.optString("shell", "");
            cfg.consoleCwd = console.optString("cwd", "");
            cfg.consoleTimeoutSec = console.optLong("timeoutSec", 300);
            cfg.consoleMaxOutputBytes = console.optLong("maxOutputBytes", 1024 * 1024);
        }

        JSONObject hermes = root.optJSONObject("hermes");
        if (hermes != null) {
            cfg.hermesEnabled = hermes.optBoolean("enabled", false);
            cfg.hermesTitle   = hermes.optString("title", "Hermes Agent").trim();
            cfg.hermesIcon    = hermes.optString("icon",  "☤").trim();
            cfg.hermesShell   = hermes.optString("shell", "").trim();
            cfg.hermesCwd     = hermes.optString("cwd",   "").trim();
            cfg.hermesStartupDelayMs = hermes.optLong("startupDelayMs", 800);
            cfg.hermesCommandDelayMs = hermes.optLong("commandDelayMs", 300);

            JSONArray cmds = hermes.optJSONArray("commands");
            if (cmds != null) {
                for (int i = 0; i < cmds.length(); i++) {
                    String c = cmds.optString(i, "").trim();
                    if (!c.isEmpty()) cfg.hermesCommands.add(c);
                }
            }
        }

        JSONObject vc = root.optJSONObject("videochat");
        if (vc != null) {
            cfg.videoChatEnabled = vc.optBoolean("enabled", false);
            cfg.videoChatPort = vc.optInt("port", 8081);
            String guid = vc.optString("wsGuid", "").trim();
            if (!guid.isEmpty()) cfg.wsGuid = guid;
        }

        JSONObject ol = root.optJSONObject("ollama");
        if (ol != null) {
            cfg.ollamaEnabled = ol.optBoolean("enabled", true);
            String bin = ol.optString("binary", "ollama").trim();
            if (!bin.isEmpty()) cfg.ollamaBinary = bin;
            cfg.ollamaCwd = ol.optString("cwd", "").trim();
        }

        // ============================================================
        // АВТОЗАПУСК
        // ============================================================
        JSONObject ast = root.optJSONObject("autostart");
        if (ast != null) {
            JSONArray apps = ast.optJSONArray("androidApps");
            if (apps != null) cfg.autostartAndroid = apps;

            JSONArray js = ast.optJSONArray("jsScripts");
            if (js != null) cfg.autostartJs = js;

            JSONArray wm = ast.optJSONArray("wmApps");
            if (wm != null) cfg.autostartWm = wm;
        }

        JSONArray arrU = root.optJSONArray("users");
        if (arrU != null) {
            for (int i = 0; i < arrU.length(); i++) {
                JSONObject u = arrU.getJSONObject(i);
                User user = new User();
                user.name = u.optString("name", "").trim();
                user.password = u.optString("password", "");
                user.quotaMb = u.optLong("quota", -1);
                user.consoleEnabled = u.optBoolean("console", false);
                if (user.name.isEmpty()) continue;
                cfg.users.put(user.name, user);
            }
        }

        boolean rootShareLogged = false;
        JSONArray arrS = root.optJSONArray("shares");
        if (arrS != null) {
            for (int i = 0; i < arrS.length(); i++) {
                JSONObject s = arrS.getJSONObject(i);
                Share sh = new Share();
                sh.name = s.optString("name", "").trim();
                sh.physical = s.optString("physical", "").trim();
                sh.type = s.optString("type", "folder").toLowerCase();
                sh.anonymous = s.optBoolean("anonymous", false);
                sh.quotaMb = s.optLong("quota", -1);

                JSONArray acc = s.optJSONArray("access");
                if (acc != null) {
                    for (int k = 0; k < acc.length(); k++) {
                        sh.access.add(acc.getString(k).toLowerCase());
                    }
                }
                if (sh.access.isEmpty()) sh.access.add("read");

                JSONArray us = s.optJSONArray("users");
                if (us != null) {
                    for (int k = 0; k < us.length(); k++) {
                        sh.users.add(us.getString(k));
                    }
                }
                if (sh.physical.isEmpty()) continue;

                if (sh.isRoot()) {
                    if (rootShareLogged) continue;
                    rootShareLogged = true;
                }
                cfg.shares.add(sh);
            }
        }

        return cfg;
    }

    public Share findShare(String name) {
        if (name == null || name.isEmpty()) return null;
        for (Share sh : shares) {
            if (sh.isRoot()) continue;
            if (sh.name.equals(name)) return sh;
        }
        return null;
    }

    public Share findRootShare() {
        for (Share sh : shares) {
            if (sh.isRoot()) return sh;
        }
        return null;
    }
}