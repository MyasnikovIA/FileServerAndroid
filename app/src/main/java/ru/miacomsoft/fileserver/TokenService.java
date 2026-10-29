package ru.miacomsoft.fileserver;

// ============================================================
// TokenService.java — выдача и валидация токенов доступа.
//
// Токен действителен 24 часа или до перезапуска сервера.
// Формат — URL-safe Base64 от 24 случайных байт.
// ============================================================

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class TokenService {

    public static final long TTL_MS = 24L * 60L * 60L * 1000L;
    private static final SecureRandom RND = new SecureRandom();

    public static class Token {
        public String value;
        public String username;    // может быть null для анонимного
        public long issuedAt;
        public long expiresAt;
    }

    private final Map<String, Token> tokens = new ConcurrentHashMap<>();

    public Token issue(String username) {
        byte[] buf = new byte[24];
        RND.nextBytes(buf);
        String value = Base64.getUrlEncoder().withoutPadding().encodeToString(buf);

        Token t = new Token();
        t.value = value;
        t.username = username;
        t.issuedAt = System.currentTimeMillis();
        t.expiresAt = t.issuedAt + TTL_MS;

        tokens.put(value, t);
        cleanupExpired();
        return t;
    }

    public Token validate(String value) {
        if (value == null || value.isEmpty()) return null;
        Token t = tokens.get(value);
        if (t == null) return null;
        if (t.expiresAt < System.currentTimeMillis()) {
            tokens.remove(value);
            return null;
        }
        return t;
    }

    public void revoke(String value) {
        if (value != null) tokens.remove(value);
    }

    public int count() { return tokens.size(); }

    private void cleanupExpired() {
        long now = System.currentTimeMillis();
        tokens.entrySet().removeIf(e -> e.getValue().expiresAt < now);
    }
}