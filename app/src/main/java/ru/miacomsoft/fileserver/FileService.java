package ru.miacomsoft.fileserver;

// ============================================================
// FileService.java — операции с ФС без привязки к конкретному root.
// Все методы принимают root первым аргументом.
// ============================================================

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;

public class FileService {

    // ---------- безопасное разрешение пути ----------

    public static String normalize(String p) {
        if (p == null) return "";
        p = p.replace('\\', '/');
        String[] parts = p.split("/");
        Deque<String> stack = new ArrayDeque<>();
        for (String part : parts) {
            if (part.isEmpty() || part.equals(".")) continue;
            if (part.equals("..")) {
                if (!stack.isEmpty()) stack.pop();
            } else {
                stack.push(part);
            }
        }
        List<String> list = new ArrayList<>(stack);
        Collections.reverse(list);
        return String.join("/", list);
    }

    public static Path resolve(Path root, String relPath) {
        String norm = normalize(relPath);
        Path resolved = (norm.isEmpty() ? root : root.resolve(norm)).normalize();
        if (!resolved.startsWith(root)) {
            throw new SecurityException("Path escapes root: " + relPath);
        }
        return resolved;
    }

    // ---------- list ----------

    public static List<Map<String, Object>> list(Path root, String relPath, boolean recursive)
            throws IOException {
        Path dir = resolve(root, relPath);
        if (!Files.exists(dir)) throw new NoSuchFileException(dir.toString());
        if (!Files.isDirectory(dir)) throw new IOException("Not a directory: " + relPath);

        List<Map<String, Object>> result = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
            for (Path child : stream) addEntry(root, result, child, recursive);
        }
        return result;
    }

    private static void addEntry(Path root, List<Map<String, Object>> result,
                                 Path p, boolean recursive) throws IOException {
        result.add(entryFor(root, p));
        if (recursive && Files.isDirectory(p)) {
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(p)) {
                for (Path child : stream) addEntry(root, result, child, recursive);
            }
        }
    }

    private static Map<String, Object> entryFor(Path root, Path p) throws IOException {
        Map<String, Object> e = new LinkedHashMap<>();
        String rel = root.relativize(p).toString().replace('\\', '/');
        e.put("name", p.getFileName().toString());
        e.put("path", rel);
        boolean isDir = Files.isDirectory(p);
        e.put("isFolder", isDir);
        e.put("mtime", Files.getLastModifiedTime(p).toMillis());

        if (isDir) {
            e.put("size", 0L);
            e.put("contentType", "");
            e.put("binary", false);
        } else {
            e.put("size", Files.size(p));
            // Используем общий детектор — так contentType совпадает
            // с тем, что реально отдаётся в serveFile.
            String ct = StaticHandler.detectContentType(p);
            e.put("contentType", ct);
            // ROM-образы и прочие "опознанные" бинарные форматы
            // правильно помечаются как binary.
            e.put("binary", !isTextContentType(ct));
        }
        return e;
    }

    private static boolean isTextContentType(String ct) {
        if (ct == null) return false;
        return ct.startsWith("text/") || ct.contains("json") || ct.contains("xml")
                || ct.contains("javascript") || ct.contains("yaml") || ct.contains("csv");
    }

    // ---------- stat / read / write ----------

    public static Map<String, Object> stat(Path root, String relPath) throws IOException {
        Path p = resolve(root, relPath);
        if (!Files.exists(p)) throw new NoSuchFileException(p.toString());
        return entryFor(root, p);
    }

    public static byte[] read(Path root, String relPath) throws IOException {
        Path p = resolve(root, relPath);
        if (!Files.isRegularFile(p)) throw new NoSuchFileException(p.toString());
        return Files.readAllBytes(p);
    }

    public static void write(Path root, String relPath, byte[] data) throws IOException {
        Path p = resolve(root, relPath);
        Path parent = p.getParent();
        if (parent != null && !Files.exists(parent)) Files.createDirectories(parent);
        Files.write(p, data,
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE);
    }

    public static void mkdir(Path root, String relPath) throws IOException {
        Path p = resolve(root, relPath);
        Files.createDirectories(p);
    }

    // ---------- delete / move / copy ----------

    public static void delete(Path root, String relPath) throws IOException {
        Path p = resolve(root, relPath);
        if (!Files.exists(p)) return;
        if (Files.isDirectory(p)) deleteRecursive(p);
        else Files.delete(p);
    }

    private static void deleteRecursive(Path p) throws IOException {
        Files.walkFileTree(p, new SimpleFileVisitor<Path>() {
            @Override public FileVisitResult visitFile(Path file, BasicFileAttributes a)
                    throws IOException { Files.delete(file); return FileVisitResult.CONTINUE; }
            @Override public FileVisitResult postVisitDirectory(Path dir, IOException e)
                    throws IOException { Files.delete(dir); return FileVisitResult.CONTINUE; }
        });
    }

    public static void move(Path root, String from, String to) throws IOException {
        Path src = resolve(root, from);
        Path dst = resolve(root, to);
        if (!Files.exists(src)) throw new NoSuchFileException(src.toString());
        Path parent = dst.getParent();
        if (parent != null && !Files.exists(parent)) Files.createDirectories(parent);
        try {
            Files.move(src, dst, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            copy(root, from, to);
            delete(root, from);
        }
    }

    public static void copy(Path root, String from, String to) throws IOException {
        Path src = resolve(root, from);
        Path dst = resolve(root, to);
        if (!Files.exists(src)) throw new NoSuchFileException(src.toString());
        Path parent = dst.getParent();
        if (parent != null && !Files.exists(parent)) Files.createDirectories(parent);
        if (Files.isDirectory(src)) copyRecursive(src, dst);
        else Files.copy(src, dst, StandardCopyOption.REPLACE_EXISTING);
    }

    private static void copyRecursive(Path src, Path dst) throws IOException {
        Files.createDirectories(dst);
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(src)) {
            for (Path child : stream) {
                Path target = dst.resolve(child.getFileName().toString());
                if (Files.isDirectory(child)) copyRecursive(child, target);
                else Files.copy(child, target, StandardCopyOption.REPLACE_EXISTING);
            }
        }
    }
    // ---------- подсчёт размера ----------
//
// Возвращает сумму размеров всех файлов под p (рекурсивно).
// Для одного файла — его размер. Для несуществующего пути — 0.
    public static long sizeOf(Path p) throws IOException {
        if (p == null || !Files.exists(p)) return 0L;
        if (Files.isRegularFile(p)) return Files.size(p);
        final long[] total = { 0L };
        Files.walkFileTree(p, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes a) {
                total[0] += a.size();
                return FileVisitResult.CONTINUE;
            }
            @Override
            public FileVisitResult visitFileFailed(Path file, IOException exc) {
                return FileVisitResult.CONTINUE;
            }
        });
        return total[0];
    }
}