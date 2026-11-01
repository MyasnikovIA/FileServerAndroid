package ru.miacomsoft.fileserver;

import android.content.Context;
import android.os.Environment;
import android.util.Log;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Инициализатор проекта.
 *
 * 1. Создаёт каталог <external>/FileServerAndroid
 * 2. Копирует туда всё из assets (www, certs, config.json)
 * 3. Правит config.json ТЕКСТОВО (комментарии сохраняются!):
 *      "web"              -> абсолютный путь к .../FileServerAndroid/www
 *      https."keystore"   -> первый найденный *.p12 в .../FileServerAndroid/certs
 *                            (если .p12 нет — путь к каталогу certs)
 *    Блок https остаётся закомментированным, как в assets.
 */
public class ProjectInitializer {

    private static final String TAG = "ProjectInitializer";
    private static final String PROJECT_DIR_NAME = "FileServerAndroid";

    public static class InitResult {
        public Path projectRoot;
        public Path configPath;
        public Path webRoot;
        public Path certsDir;
    }

    // ============================================================
    // Публичная точка входа
    // ============================================================
    public static InitResult initialize(Context ctx) throws IOException {
        InitResult result = new InitResult();

        java.io.File externalDir = Environment.getExternalStorageDirectory();
        if (externalDir == null) {
            throw new IOException("External storage not available");
        }

        Path projectRoot = externalDir.toPath().resolve(PROJECT_DIR_NAME);
        result.projectRoot = projectRoot;
        result.webRoot     = projectRoot.resolve("www");
        result.certsDir    = projectRoot.resolve("certs");
        result.configPath  = projectRoot.resolve("config.json");

        Files.createDirectories(projectRoot);
        Log.i(TAG, "Project root: " + projectRoot);

        // Копирование assets (config.json не перезаписывается, если уже есть)
        copyAssetsRecursive(ctx, "", projectRoot);

        Files.createDirectories(result.webRoot);
        Files.createDirectories(result.certsDir);

        if (!Files.isRegularFile(result.configPath)) {
            throw new IOException("config.json not found after assets copy: " + result.configPath);
        }

        modifyConfig(result.configPath, result.webRoot, result.certsDir);

        Log.i(TAG, "Initialization complete: config=" + result.configPath
                + ", web=" + result.webRoot + ", certs=" + result.certsDir);
        return result;
    }

    // ============================================================
    // Копирование assets
    // ============================================================
    private static void copyAssetsRecursive(Context ctx, String assetPath, Path dst)
            throws IOException {

        String[] children = ctx.getAssets().list(assetPath);

        if (children != null && children.length > 0) {
            // Это каталог
            Files.createDirectories(dst);
            for (String child : children) {
                String childAsset = assetPath.isEmpty() ? child : assetPath + "/" + child;
                Path childDst = dst.resolve(child);

                // Существующий config.json не трогаем (правки пользователя)
                if (childDst.equals(dst.resolve("config.json"))
                        && "config.json".equals(child)
                        && Files.exists(childDst)) {
                    Log.i(TAG, "Skipping existing config.json");
                    continue;
                }
                copyAssetsRecursive(ctx, childAsset, childDst);
            }
            return;
        }

        // Пустой результат list() — либо файл, либо пустой каталог
        if (assetPath.isEmpty()) {
            Files.createDirectories(dst);
            return;
        }
        if (isAssetFile(ctx, assetPath)) {
            if (dst.getParent() != null) Files.createDirectories(dst.getParent());
            copyAssetFile(ctx, assetPath, dst);
        } else {
            Files.createDirectories(dst);
        }
    }

    private static boolean isAssetFile(Context ctx, String assetPath) {
        try (InputStream is = ctx.getAssets().open(assetPath)) {
            return is != null;
        } catch (IOException e) {
            return false;
        }
    }

    private static void copyAssetFile(Context ctx, String assetPath, Path dst) throws IOException {
        try (InputStream is = ctx.getAssets().open(assetPath);
             OutputStream os = Files.newOutputStream(dst,
                     StandardOpenOption.CREATE,
                     StandardOpenOption.TRUNCATE_EXISTING,
                     StandardOpenOption.WRITE)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
        }
    }

    // ============================================================
    // Правка config.json (без разбора JSON → комментарии целы)
    // ============================================================
    private static void modifyConfig(Path configPath, Path webRoot, Path certsDir)
            throws IOException {

        String text = new String(Files.readAllBytes(configPath), StandardCharsets.UTF_8);

        // 1. "web": "<абсолютный путь к www>"
        String patched = replaceJsonStringValue(text, "web", webRoot.toString());
        if (patched.equals(text)) {
            Log.w(TAG, "Key \"web\" not found in config.json");
        }
        text = patched;

        // 2. "keystore": первый *.p12 из certs, иначе сам каталог certs
        Path p12 = findFirstP12(certsDir);
        String keystoreValue = (p12 != null) ? p12.toString() : certsDir.toString();
        if (p12 != null) {
            Log.i(TAG, "Found .p12 file: " + p12);
        } else {
            Log.i(TAG, "No .p12 found, using certs dir: " + certsDir);
        }

        // Замена работает и внутри закомментированной строки —
        // блок https остаётся комментарием, но путь уже正确的 подготовлен.
        text = replaceJsonStringValue(text, "keystore", keystoreValue);

        Files.write(configPath, text.getBytes(StandardCharsets.UTF_8),
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE);

        Log.i(TAG, "config.json updated (comments preserved): web=" + webRoot
                + ", keystore=" + keystoreValue);
    }

    /**
     * Заменяет значение строкового ключа "key": "..." на newValue.
     * Совпадения ищутся по всему тексту, включая закомментированные строки.
     */
    private static String replaceJsonStringValue(String text, String key, String newValue) {
        Pattern p = Pattern.compile(
                "(\"" + Pattern.quote(key) + "\"\\s*:\\s*)\"(?:\\\\.|[^\"\\\\])*\"");
        Matcher m = p.matcher(text);
        StringBuffer sb = new StringBuffer();
        String replacementValue = "\"" + jsonEscape(newValue) + "\"";
        while (m.find()) {
            m.appendReplacement(sb,
                    Matcher.quoteReplacement(m.group(1) + replacementValue));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String jsonEscape(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"':  sb.append("\\\""); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:   sb.append(c);
            }
        }
        return sb.toString();
    }

    /**
     * Первый попавшийся файл *.p12 в каталоге certs (сортировка для стабильности).
     */
    private static Path findFirstP12(Path certsDir) {
        if (certsDir == null || !Files.isDirectory(certsDir)) return null;

        List<Path> found = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(certsDir)) {
            for (Path entry : stream) {
                if (!Files.isRegularFile(entry)) continue;
                String name = entry.getFileName().toString();
                if (name.toLowerCase(java.util.Locale.ROOT).endsWith(".p12")) {
                    found.add(entry);
                }
            }
        } catch (IOException e) {
            Log.w(TAG, "Error scanning certs dir: " + e.getMessage());
            return null;
        }
        if (found.isEmpty()) return null;
        Collections.sort(found);
        return found.get(0).toAbsolutePath().normalize();
    }
}