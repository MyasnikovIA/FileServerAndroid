package ru.miacomsoft.fileserver;

import com.sun.net.httpserver.HttpExchange;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.Objects;

public class AuthService {

    public static final String AUTH_COOKIE_NAME = "filebd_token";

    public static class Session {
        public String username;
        public boolean anonymous;
        public Config.User user;
    }

    private final Config config;
    private final TokenService tokens;

    public AuthService(Config config, TokenService tokens) {
        this.config = config;
        this.tokens = tokens;
    }

    public Config config() { return config; }
    public TokenService tokens() { return tokens; }

    // ---------- Аутентификация ----------

    /**
     * Определяет сессию по запросу.
     *
     * Порядок проверки (все шаги, КРОМЕ явных — «мягкие»):
     *   1. Authorization: Bearer <token>   — если токен невалиден, идём дальше
     *   2. X-Auth-Token: <token>           — если невалиден, идём дальше
     *   3. Authorization: Basic <base64>   — если невалиден, идём дальше
     *   4. Cookie: filebd_token=<token>    — если невалиден, идём дальше
     *   5. ?token=<token>                  — ЕСЛИ УКАЗАН, ТО СТРОГО
     *   6. ?user=<u>&pass=<p>              — ЕСЛИ УКАЗАН, ТО СТРОГО
     *   7. Анонимная сессия
     *
     * ВАЖНО: именно «мягкость» шагов 1–4 позволяет корректно
     * работать, когда клиент по ошибке прислал устаревший
     * Bearer-токен, а актуальная авторизация живёт в cookie.
     */
    public Session authenticate(HttpExchange ex) {
        String authHeader   = ex.getRequestHeaders().getFirst("Authorization");
        String tokenHeader  = ex.getRequestHeaders().getFirst("X-Auth-Token");
        String cookieHeader = ex.getRequestHeaders().getFirst("Cookie");

        // 1. Bearer <token>
        //    Если токен указан, но невалиден — НЕ возвращаем null,
        //    пробуем следующие способы (cookie / query).
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String tok = authHeader.substring("Bearer ".length()).trim();
            Session s = sessionFromToken(tok);
            if (s != null) return s;
        }

        // 2. X-Auth-Token
        if (tokenHeader != null && !tokenHeader.isEmpty()) {
            Session s = sessionFromToken(tokenHeader.trim());
            if (s != null) return s;
        }

        // 3. Basic <base64>
        if (authHeader != null && authHeader.startsWith("Basic ")) {
            Session s = sessionFromBasic(authHeader);
            if (s != null) return s;
        }

        // 4. Cookie: filebd_token=<token>
        if (cookieHeader != null && !cookieHeader.isEmpty()) {
            String cookieToken = parseCookieValue(cookieHeader, AUTH_COOKIE_NAME);
            if (cookieToken != null && !cookieToken.isEmpty()) {
                Session s = sessionFromToken(cookieToken);
                if (s != null) return s;
            }
        }

        // 5. Query ?token= — строго: если указан, но невалиден → null
        String query = ex.getRequestURI().getQuery();
        Map<String, String> q = FileServer.parseQuery(query);

        String qToken = q.get("token");
        if (qToken != null && !qToken.isEmpty()) {
            Session s = sessionFromToken(qToken);
            if (s == null) return null;
            return s;
        }

        // 6. Query ?user=&pass= — строго
        String qUser = q.get("user");
        if (qUser == null) qUser = q.get("username");
        if (qUser != null && !qUser.isEmpty()) {
            String qPass = q.get("pass");
            if (qPass == null) qPass = q.get("password");
            return sessionFromCredentials(qUser, qPass == null ? "" : qPass);
        }

        // 7. Аноним
        Session anon = new Session();
        anon.anonymous = true;
        return anon;
    }

    // ---------- Хелперы ----------

    private Session sessionFromToken(String token) {
        if (token == null || token.isEmpty()) return null;
        TokenService.Token t = tokens.validate(token);
        if (t == null) return null;
        return sessionFromUsername(t.username);
    }

    private Session sessionFromBasic(String header) {
        try {
            String b64 = header.substring("Basic ".length()).trim();
            byte[] decoded = Base64.getDecoder().decode(b64);
            String creds = new String(decoded, StandardCharsets.UTF_8);
            int idx = creds.indexOf(':');
            if (idx < 0) return null;
            return sessionFromCredentials(
                    creds.substring(0, idx),
                    creds.substring(idx + 1));
        } catch (Exception e) {
            return null;
        }
    }

    private Session sessionFromUsername(String username) {
        if (username == null) {
            Session s = new Session();
            s.anonymous = true;
            return s;
        }
        Config.User u = config.users.get(username);
        if (u == null) return null;
        Session s = new Session();
        s.username = username;
        s.anonymous = false;
        s.user = u;
        return s;
    }

    private Session sessionFromCredentials(String user, String pass) {
        if (user == null) return null;
        Config.User u = config.users.get(user);
        if (u == null) return null;
        String expected = u.password == null ? "" : u.password;
        if (!Objects.equals(expected, pass == null ? "" : pass)) return null;
        Session s = new Session();
        s.username = user;
        s.anonymous = false;
        s.user = u;
        return s;
    }

    /**
     * Извлекает значение cookie по имени из заголовка Cookie.
     * Возвращает null, если cookie нет.
     */
    public static String parseCookieValue(String cookieHeader, String name) {
        if (cookieHeader == null || name == null) return null;
        String[] parts = cookieHeader.split(";");
        for (String part : parts) {
            String trimmed = part.trim();
            int eq = trimmed.indexOf('=');
            if (eq <= 0) continue;
            String k = trimmed.substring(0, eq).trim();
            if (k.equals(name)) {
                String v = trimmed.substring(eq + 1);
                try {
                    return java.net.URLDecoder.decode(v, "UTF-8");
                } catch (Exception e) {
                    return v;
                }
            }
        }
        return null;
    }

    // ---------- Видимость / права ----------

    public boolean shareVisible(Session s, Config.Share sh) {
        if (sh == null || s == null) return false;
        return sh.visibleTo(s.username, s.anonymous);
    }

    public boolean canRead(Session s, Config.Share sh) {
        return shareVisible(s, sh) && sh.hasRead();
    }
    public boolean canWrite(Session s, Config.Share sh) {
        return shareVisible(s, sh) && sh.hasWrite();
    }
    public boolean canDelete(Session s, Config.Share sh) {
        return shareVisible(s, sh) && sh.hasDelete();
    }

    public Config.Share findPublicShare(String shareName) {
        Config.Share sh = config.findShare(shareName);
        if (sh == null) return null;
        if (!sh.anonymous) return null;
        if (!sh.hasRead()) return null;
        return sh;
    }
}