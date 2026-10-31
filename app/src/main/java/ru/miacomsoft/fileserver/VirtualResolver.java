package ru.miacomsoft.fileserver;

import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;

public class VirtualResolver {

    public static class Resolved {
        public Config.Share share;
        public String relPath = "";
        public Path   physicalPath;
        public boolean isRoot = false;
    }

    public static Resolved resolve(AuthService auth, AuthService.Session session,
                                   String virtualPath, String action)
            throws NoSuchFileException {

        String norm = FileService.normalize(virtualPath);

        if (norm.isEmpty()) {
            Resolved r = new Resolved();
            r.isRoot = true;
            return r;
        }

        String shareName;
        String rest;
        int slash = norm.indexOf('/');
        if (slash < 0) { shareName = norm; rest = ""; }
        else           { shareName = norm.substring(0, slash); rest = norm.substring(slash + 1); }

        Config.Share share = auth.config().findShare(shareName);

        if (share == null) {
            Config.Share rootShare = auth.config().findRootShare();
            if (rootShare != null) {
                share = rootShare;
                rest = norm;
            } else {
                throw new java.util.NoSuchElementException("Unknown share: " + shareName);
            }
        }

        boolean ok;
        switch (action) {
            case "read":   ok = auth.canRead(session, share);   break;
            case "write":  ok = auth.canWrite(session, share);  break;
            case "delete": ok = auth.canDelete(session, share); break;
            default:       ok = false;
        }
        if (!ok) {
            throw new SecurityException("Access denied to share: " + share.name
                    + " (" + action + ")");
        }

        if (share.isFile() && !rest.isEmpty()) {
            throw new NoSuchFileException("File share has no children: " + virtualPath);
        }

        // === Проверка, что физический корень share ещё существует ===
        // (SD-карта вынута, диск отключён, путь устарел после переформатирования)
        Path shareRoot;
        try {
            shareRoot = share.physicalPath();
        } catch (Exception e) {
            throw new java.util.NoSuchElementException(
                    "Share '" + share.name + "' has invalid physical path");
        }
        if (!Files.exists(shareRoot)) {
            throw new java.util.NoSuchElementException(
                    "Share '" + share.name + "' is not available: "
                            + shareRoot + " (SD card removed or disk detached)");
        }
        if (!Files.isDirectory(shareRoot) && !Files.isRegularFile(shareRoot)) {
            throw new java.util.NoSuchElementException(
                    "Share '" + share.name + "' is not available: "
                            + shareRoot + " is not a file/directory");
        }

        Path physical = shareRoot;
        if (!rest.isEmpty()) {
            physical = physical.resolve(rest).normalize();
            if (!physical.startsWith(shareRoot)) {
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