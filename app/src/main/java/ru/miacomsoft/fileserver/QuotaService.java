package ru.miacomsoft.fileserver;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class QuotaService {

    public static final long MB = 1024L * 1024L;
    private static final long TTL_MS = 5000L;

    private static class Entry {
        long size;
        long ts;
    }

    private final Map<String, Entry> cache = new ConcurrentHashMap<>();
    private final AuthService auth;

    public QuotaService(AuthService auth) {
        this.auth = auth;
    }

    public long getShareUsedBytes(Config.Share share) {
        if (share == null || !share.hasQuota()) return 0;

        Path p = share.physicalPath();
        String key = "share:" + p.toString();
        Entry e = cache.get(key);
        long now = System.currentTimeMillis();
        if (e != null && now - e.ts < TTL_MS) return e.size;

        long size = safeSize(p);
        Entry ne = new Entry();
        ne.size = size;
        ne.ts = now;
        cache.put(key, ne);
        return size;
    }

    public long getUserUsedBytes(AuthService.Session s) {
        if (s == null) return 0;

        if (s.anonymous) {
            long total = 0;
            for (Config.Share sh : auth.config().shares) {
                if (sh.anonymous) total += getShareUsedBytes(sh);
            }
            return total;
        }

        if (s.user != null && !s.user.hasQuota()) return 0;

        String key = "user:" + s.username;
        Entry e = cache.get(key);
        long now = System.currentTimeMillis();
        if (e != null && now - e.ts < TTL_MS) return e.size;

        long total = 0;
        for (Config.Share sh : auth.config().shares) {
            if (!sh.visibleTo(s.username, false)) continue;
            total += getShareUsedBytes(sh);
        }
        Entry ne = new Entry();
        ne.size = total;
        ne.ts = now;
        cache.put(key, ne);
        return total;
    }

    public void checkWriteQuota(Config.Share share, AuthService.Session session,
                                long deltaBytes) throws QuotaExceededException {
        if (deltaBytes <= 0) return;

        if (share.hasQuota()) {
            long used = getShareUsedBytes(share);
            long limit = share.quotaMb * MB;
            if (used + deltaBytes > limit) {
                throw new QuotaExceededException(
                        "Share quota exceeded", share.name, share.quotaMb,
                        used, limit - used, deltaBytes);
            }
        }

        if (session != null && !session.anonymous && session.user != null
                && session.user.hasQuota()) {
            long used = getUserUsedBytes(session);
            long limit = session.user.quotaMb * MB;
            if (used + deltaBytes > limit) {
                throw new QuotaExceededException(
                        "User quota exceeded", session.user.name, session.user.quotaMb,
                        used, limit - used, deltaBytes);
            }
        }
    }

    public void invalidate(Config.Share share) {
        if (share == null) return;
        cache.remove("share:" + share.physicalPath().toString());
        cache.clear();
    }

    public void invalidateAll() {
        cache.clear();
    }

    private long safeSize(Path p) {
        if (p == null || !Files.exists(p)) return 0L;
        if (Files.isRegularFile(p)) {
            try { return Files.size(p); } catch (IOException e) { return 0L; }
        }
        final long[] total = { 0L };
        try {
            Files.walkFileTree(p, new SimpleFileVisitor<Path>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    total[0] += attrs.size();
                    return FileVisitResult.CONTINUE;
                }
                @Override
                public FileVisitResult visitFileFailed(Path file, IOException exc) {
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException ignored) {}
        return total[0];
    }

    public static class QuotaExceededException extends Exception {
        public String scope;
        public long quotaMb;
        public long usedBytes;
        public long freeBytes;
        public long deltaBytes;

        public QuotaExceededException(String msg, String scope, long quotaMb,
                                      long usedBytes, long freeBytes, long deltaBytes) {
            super(msg);
            this.scope = scope;
            this.quotaMb = quotaMb;
            this.usedBytes = usedBytes;
            this.freeBytes = freeBytes;
            this.deltaBytes = deltaBytes;
        }
    }
}