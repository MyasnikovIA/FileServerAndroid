package ru.miacomsoft.fileserver;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.IOException;
import java.net.URLDecoder;
import java.nio.file.Files;
import java.nio.file.Path;

public class RootHandler implements HttpHandler {

    private final StaticHandler staticHandler;

    public RootHandler(StaticHandler staticHandler) {
        this.staticHandler = staticHandler;
    }

    @Override
    public void handle(HttpExchange ex) throws Exception {
        if (FileServer.handleOptions(ex)) return;

        String rawPath = ex.getRequestURI().getRawPath();
        if (rawPath == null || rawPath.isEmpty() || "/".equals(rawPath)) {
            rawPath = "/index.html";
        }

        String decoded;
        try { decoded = URLDecoder.decode(rawPath, "UTF-8"); }
        catch (Exception e) { decoded = rawPath; }

        String clean = decoded.replace('\\', '/');
        while (clean.startsWith("/")) clean = clean.substring(1);

        Path staticFile = staticHandler.tryResolve(clean);
        if (staticFile != null) {
            staticHandler.serveFile(ex, staticFile);
            return;
        }

        int slash = clean.indexOf('/');
        String firstSeg = slash < 0 ? clean : clean.substring(0, slash);

        Config.Share share = FileServer.config().findShare(firstSeg);
        if (share != null) {
            String rel = slash < 0 ? "" : clean.substring(slash + 1);
            serveFromShare(ex, share, rel);
            return;
        }

        Config.Share rootShare = FileServer.config().findRootShare();
        if (rootShare != null) {
            serveFromShare(ex, rootShare, clean);
            return;
        }

        FileServer.sendError(ex, 404,
                "Static file not found and no shares configured: " + clean);
    }

    public void serveFromShare(HttpExchange ex, Config.Share share, String relDecoded)
            throws Exception {

        String method = ex.getRequestMethod().toUpperCase();
        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            FileServer.sendError(ex, 405, "Method not allowed");
            return;
        }

        String rel = FileService.normalize(relDecoded == null ? "" : relDecoded);

        if (!share.hasRead()) {
            FileServer.sendError(ex, 403, "Read not allowed for share " + share.name);
            return;
        }

        AuthService.Session session = FileServer.auth().authenticate(ex);
        if (session == null) {
            ex.getResponseHeaders().set("WWW-Authenticate", "Basic realm=\"FileServer\"");
            FileServer.sendError(ex, 401, "Unauthorized");
            return;
        }

        if (!share.visibleTo(session.username, session.anonymous)) {
            FileServer.sendError(ex, 403, "Access denied to share " + share.name);
            return;
        }

        Path shareRoot = share.physicalPath();
        Path target;

        if (share.isFile()) {
            if (!rel.isEmpty()) {
                FileServer.sendError(ex, 404, "File share has no children");
                return;
            }
            target = shareRoot;
        } else {
            if (rel.isEmpty()) {
                FileServer.sendError(ex, 404,
                        "Directory listing not available via direct URL");
                return;
            }
            target = shareRoot.resolve(rel).normalize();
            if (!target.startsWith(shareRoot)) {
                FileServer.sendError(ex, 403, "Path escapes share");
                return;
            }
        }

        if (!Files.isRegularFile(target)) {
            FileServer.sendError(ex, 404,
                    "Not a file in share '" + share.name + "': " + rel);
            return;
        }

        staticHandler.serveFile(ex, target);
    }
}