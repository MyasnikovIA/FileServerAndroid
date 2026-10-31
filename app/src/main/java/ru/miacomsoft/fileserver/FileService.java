package ru.miacomsoft.fileserver;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;

public class FileService {

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

    /**
     * Проверка одного сегмента имени файла/папки на совместимость
     * с FAT32/exFAT (SD-карты на Android).
     *
     * @return null, если имя допустимо; иначе — текст ошибки
     */
    public static String validateName(String name) {
        if (name == null || name.isEmpty()) return "empty name";
        if (name.length() > 255) return "name too long (max 255 chars)";
        if (".".equals(name) || "..".equals(name)) return "reserved name";

        char last = name.charAt(name.length() - 1);
        if (last == ' ' || last == '.') {
            return "name ends with space or dot (invalid on FAT32/exFAT)";
        }

        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (c < 0x20 || c == 0x7F) {
                return "control character (0x" + Integer.toHexString(c) + ")";
            }
            if (c == '\\' || c == '/' || c == ':' || c == '*' || c == '?'
                    || c == '"' || c == '<' || c == '>' || c == '|') {
                return "invalid character: '" + c + "'";
            }
        }

        // Зарезервированные DOS-имена
        int dot = name.indexOf('.');
        String base = (dot > 0 ? name.substring(0, dot) : name).toUpperCase(Locale.ROOT);
        if (base.equals("CON") || base.equals("PRN") || base.equals("AUX")
                || base.equals("NUL") || base.equals("CLOCK$")) {
            return "reserved DOS name: " + base;
        }
        if (base.matches("COM[1-9]") || base.matches("LPT[1-9]")) {
            return "reserved DOS name: " + base;
        }
        return null;
    }

    /**
     * Проверка всех сегментов пути (без учёта разделителя).
     * @return null, если все сегменты валидны; иначе текст ошибки
     */
    public static String validatePathSegments(String normPath) {
        if (normPath == null || normPath.isEmpty()) return null;
        for (String seg : normPath.split("/")) {
            if (seg.isEmpty()) continue;
            String err = validateName(seg);
            if (err != null) return "component '" + seg + "': " + err;
        }
        return null;
    }

    public static Path resolve(Path root, String relPath) {
        String norm = normalize(relPath);
        Path resolved = (norm.isEmpty() ? root : root.resolve(norm)).normalize();
        if (!resolved.startsWith(root)) {
            throw new SecurityException("Path escapes root: " + relPath);
        }
        return resolved;
    }

    public static List<Map<String, Object>> list(Path root, String relPath, boolean recursive)
            throws IOException {
        Path dir = resolve(root, relPath);
        if (!Files.exists(dir)) throw new NoSuchFileException(dir.toString());
        if (!Files.isDirectory(dir)) throw new IOException("Not a directory: " + relPath);

        List<Map<String, Object>> result = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
            for (Path child : stream) {
                try {
                    addEntry(root, result, child, recursive);
                } catch (IOException e) {
                    // Пропускаем нечитаемые файлы
                }
            }
        } catch (AccessDeniedException e) {
            System.err.println("[FileService] Access denied: " + dir);
        }
        return result;
    }

    private static void addEntry(Path root, List<Map<String, Object>> result,
                                 Path p, boolean recursive) throws IOException {
        result.add(entryFor(root, p));
        if (recursive && Files.isDirectory(p)) {
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(p)) {
                for (Path child : stream) addEntry(root, result, child, recursive);
            } catch (AccessDeniedException e) {
                // Пропускаем защищенные вложенные папки
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
            String ct = StaticHandler.detectContentType(p);
            e.put("contentType", ct);
            e.put("binary", !isTextContentType(ct));
        }
        return e;
    }

    private static boolean isTextContentType(String ct) {
        if (ct == null) return false;
        return ct.startsWith("text/") || ct.contains("json") || ct.contains("xml")
                || ct.contains("javascript") || ct.contains("yaml") || ct.contains("csv");
    }

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
        String err = validatePathSegments(normalize(relPath));
        if (err != null) throw new IOException("Invalid path: " + err);

        Path p = resolve(root, relPath);
        Path parent = p.getParent();
        if (parent != null && !Files.exists(parent)) Files.createDirectories(parent);
        Files.write(p, data,
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE);
    }

    public static void mkdir(Path root, String relPath) throws IOException {
        String err = validatePathSegments(normalize(relPath));
        if (err != null) throw new IOException("Invalid path: " + err);

        Path p = resolve(root, relPath);
        Files.createDirectories(p);
    }

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