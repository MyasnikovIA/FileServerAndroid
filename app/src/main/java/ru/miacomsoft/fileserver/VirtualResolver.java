package ru.miacomsoft.fileserver;

// ============================================================
// VirtualResolver.java — резолв виртуального пути.
//
//   ""                          → корень (список)
//   "Documents"                 → share "Documents", rel=""
//   "Documents/sub/file.txt"    → share "Documents", rel="sub/file.txt"
//
// ROOT SHARE (name=""):
//   если первый сегмент пути не совпал ни с одним явным share,
//   весь путь уходит внутрь root share:
//     "SubDir/file.txt"         → root share, rel="SubDir/file.txt"
// ============================================================

import java.nio.file.NoSuchFileException;
import java.nio.file.Path;

public class VirtualResolver {

    public static class Resolved {
        public Config.Share share;      // null для чистого корня
        public String relPath = "";
        public Path   physicalPath;
        public boolean isRoot = false;
    }

    public static Resolved resolve(AuthService auth, AuthService.Session session,
                                   String virtualPath, String action)
            throws NoSuchFileException {

        String norm = FileService.normalize(virtualPath);

        // Чистый корень
        if (norm.isEmpty()) {
            Resolved r = new Resolved();
            r.isRoot = true;
            return r;
        }

        // Разбор "shareName/rest"
        String shareName;
        String rest;
        int slash = norm.indexOf('/');
        if (slash < 0) { shareName = norm; rest = ""; }
        else           { shareName = norm.substring(0, slash); rest = norm.substring(slash + 1); }

        // 1. Явный share по имени
        Config.Share share = auth.config().findShare(shareName);

        // 2. Fallback на root share
        if (share == null) {
            Config.Share rootShare = auth.config().findRootShare();
            if (rootShare != null) {
                share = rootShare;
                // Для root share весь путь идёт внутрь
                rest = norm;
            } else {
                throw new java.util.NoSuchElementException("Unknown share: " + shareName);
            }
        }

        // Проверка прав
        boolean ok;
        switch (action) {
            case "read":   ok = auth.canRead(session, share);   break;
            case "write":  ok = auth.canWrite(session, share);  break;
            case "delete": ok = auth.canDelete(session, share); break;
            default:       ok = false;
        }
        if (!ok) {
            throw new SecurityException("Access denied to share: " + share.name +
                    " (" + action + ")");
        }

        // Файловый share не имеет детей
        if (share.isFile() && !rest.isEmpty()) {
            throw new NoSuchFileException("File share has no children: " + virtualPath);
        }

        // Физический путь + защита от escapes
        Path physical = share.physicalPath();
        if (!rest.isEmpty()) {
            physical = physical.resolve(rest).normalize();
            if (!physical.startsWith(share.physicalPath())) {
                throw new SecurityException("Path escapes share: " + virtualPath);
            }
        }

        Resolved r = new Resolved();
        r.share = share;
        r.relPath = rest;
        r.physicalPath = physical;
        return r;
    }
}