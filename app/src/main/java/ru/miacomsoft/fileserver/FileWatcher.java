package ru.miacomsoft.fileserver;

import org.json.JSONObject;

import java.io.IOException;
import java.nio.file.*;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

public class FileWatcher {

    private final Path root;
    private final Consumer<String> callback;
    private final Map<WatchKey, Path> keys = new ConcurrentHashMap<>();

    private WatchService watchService;
    private Thread thread;
    private volatile boolean running = true;

    public FileWatcher(Path root, Consumer<String> callback) {
        this.root = root;
        this.callback = callback;
    }

    public void start() throws IOException {
        watchService = FileSystems.getDefault().newWatchService();
        registerAll(root);

        thread = new Thread(this::run, "FileWatcher");
        thread.setDaemon(true);
        thread.start();
    }

    private void registerAll(Path dir) throws IOException {
        Files.walkFileTree(dir, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult preVisitDirectory(
                    Path d,
                    java.nio.file.attribute.BasicFileAttributes a) throws IOException {
                register(d);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private void register(Path dir) throws IOException {
        WatchKey key = dir.register(watchService,
                StandardWatchEventKinds.ENTRY_CREATE,
                StandardWatchEventKinds.ENTRY_DELETE,
                StandardWatchEventKinds.ENTRY_MODIFY);
        keys.put(key, dir);
    }

    private void run() {
        while (running) {
            WatchKey key;
            try { key = watchService.take(); }
            catch (InterruptedException ie) { return; }
            catch (ClosedWatchServiceException cw) { return; }

            Path dir = keys.get(key);
            if (dir == null) { key.reset(); continue; }

            for (WatchEvent<?> ev : key.pollEvents()) {
                WatchEvent.Kind<?> kind = ev.kind();
                if (kind == StandardWatchEventKinds.OVERFLOW) continue;

                Path name = (Path) ev.context();
                Path child = dir.resolve(name);

                if (kind == StandardWatchEventKinds.ENTRY_CREATE
                        && Files.isDirectory(child)) {
                    try { registerAll(child); } catch (IOException ignored) {}
                }

                String rel = root.relativize(child).toString().replace('\\', '/');
                boolean isFolder = Files.isDirectory(child);
                String type = kind == StandardWatchEventKinds.ENTRY_CREATE ? "create"
                        : kind == StandardWatchEventKinds.ENTRY_DELETE ? "delete"
                        : "modify";

                try {
                    JSONObject obj = new JSONObject();
                    obj.put("type", type);
                    obj.put("path", rel);
                    obj.put("isFolder", isFolder);
                    callback.accept(obj.toString());
                } catch (Exception ignored) {
                    // JSONException или любая другая — пропускаем событие
                }
            }

            boolean valid = key.reset();
            if (!valid) keys.remove(key);
        }
    }

    public void stop() {
        running = false;
        if (thread != null) thread.interrupt();
        try { if (watchService != null) watchService.close(); }
        catch (IOException ignored) {}
    }
}