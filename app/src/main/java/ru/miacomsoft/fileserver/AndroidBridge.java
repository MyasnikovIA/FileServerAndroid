package ru.miacomsoft.fileserver;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class AndroidBridge {

    private static final String TAG = "AndroidBridge";

    /** Ожидающий установки APK — переживает возврат из «Неизвестных источников». */
    private static volatile String sPendingInstallPath = null;

    private final Activity activity;
    private final Context context;

    public AndroidBridge(Activity activity) {
        this.activity = activity;
        this.context = activity.getApplicationContext();
    }

    @JavascriptInterface
    public boolean isAndroidApp() { return true; }

    // ============================================================
    // Список приложений
    // ============================================================

    @JavascriptInterface
    public String getApps() {
        JSONArray arr = new JSONArray();
        try {
            PackageManager pm = context.getPackageManager();
            Intent main = new Intent(Intent.ACTION_MAIN, null);
            main.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> list = pm.queryIntentActivities(main, 0);

            String selfPkg = context.getPackageName();
            Set<String> seen = new HashSet<>();

            float density = context.getResources().getDisplayMetrics().density;
            int iconPx = Math.min((int) (48 * density), 96);
            if (iconPx < 32) iconPx = 32;

            for (ResolveInfo ri : list) {
                if (ri.activityInfo == null) continue;
                String pkg = ri.activityInfo.packageName;
                String act = ri.activityInfo.name;
                if (pkg == null || act == null) continue;
                if (selfPkg.equals(pkg)) continue;
                String key = pkg + "/" + act;
                if (!seen.add(key)) continue;

                String label;
                try { label = ri.loadLabel(pm).toString(); }
                catch (Exception e) { label = pkg; }

                String icon = "";
                try { icon = drawableToDataUri(ri.loadIcon(pm), iconPx); }
                catch (Exception e) { /* skip */ }

                try {
                    JSONObject o = new JSONObject();
                    o.put("pkg", pkg);
                    o.put("activity", act);
                    o.put("label", label);
                    if (!icon.isEmpty()) o.put("icon", icon);
                    arr.put(o);
                } catch (JSONException e) { /* skip */ }
            }
        } catch (Exception e) {
            Log.e(TAG, "getApps failed", e);
        }
        return arr.toString();
    }

    private String drawableToDataUri(Drawable d, int sizePx) {
        if (d == null || sizePx <= 0) return "";
        Bitmap bmp = null;
        try {
            bmp = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(bmp);
            d.setBounds(0, 0, sizePx, sizePx);
            d.draw(c);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            Bitmap.CompressFormat fmt = (Build.VERSION.SDK_INT >= 30)
                    ? Bitmap.CompressFormat.WEBP_LOSSY
                    : Bitmap.CompressFormat.WEBP;
            bmp.compress(fmt, 85, baos);
            return "data:image/webp;base64,"
                    + Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        } finally {
            if (bmp != null) try { bmp.recycle(); } catch (Exception ignored) {}
        }
    }

    // ============================================================
    // Запуск приложения
    // ============================================================

    @JavascriptInterface
    public boolean launchApp(String pkg, String activityName) {
        if (pkg == null || pkg.isEmpty()) return false;
        Log.i(TAG, "launchApp: pkg=" + pkg + " act=" + activityName);

        Intent intent = buildLaunchIntent(pkg, activityName);
        if (intent == null) {
            Log.e(TAG, "launchApp: no intent for " + pkg);
            return false;
        }

        // Отправляем интент с задержкой 150 мс через Handler.
        // Это даёт WebView / start menu время завершить закрытие,
        // после чего startActivity не «проглатывается» системой.
        return dispatchWithDelay(intent);
    }

    private Intent buildLaunchIntent(String pkg, String activityName) {
        PackageManager pm = context.getPackageManager();

        // === Стратегия 1: getLaunchIntentForPackage (самый надёжный) ===
        try {
            Intent intent = pm.getLaunchIntentForPackage(pkg);
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                Log.i(TAG, "buildLaunchIntent: via getLaunchIntentForPackage");
                return intent;
            }
        } catch (Exception e) {
            Log.w(TAG, "getLaunchIntentForPackage failed: " + e.getMessage());
        }

        // === Стратегия 2: явный ComponentName ===
        if (activityName != null && !activityName.isEmpty()) {
            try {
                Intent intent = new Intent(Intent.ACTION_MAIN);
                intent.addCategory(Intent.CATEGORY_LAUNCHER);
                intent.setComponent(new ComponentName(pkg, activityName));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                Log.i(TAG, "buildLaunchIntent: via ComponentName");
                return intent;
            } catch (Exception e) {
                Log.w(TAG, "ComponentName failed: " + e.getMessage());
            }
        }

        // === Стратегия 3: queryIntentActivities(pkg) ===
        try {
            Intent main = new Intent(Intent.ACTION_MAIN);
            main.addCategory(Intent.CATEGORY_LAUNCHER);
            main.setPackage(pkg);
            List<ResolveInfo> list = pm.queryIntentActivities(main, 0);
            if (list != null && !list.isEmpty()) {
                ResolveInfo ri = list.get(0);
                Intent intent = new Intent(Intent.ACTION_MAIN);
                intent.addCategory(Intent.CATEGORY_LAUNCHER);
                intent.setComponent(new ComponentName(
                        ri.activityInfo.packageName,
                        ri.activityInfo.name));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                Log.i(TAG, "buildLaunchIntent: via queryIntentActivities");
                return intent;
            }
        } catch (Exception e) {
            Log.w(TAG, "queryIntentActivities failed: " + e.getMessage());
        }

        return null;
    }

    /**
     * Отправляет интент с задержкой 150 мс через Handler.
     * Возвращает true сразу (интент гарантированно отправлен асинхронно).
     * Если activity.startActivity() упадёт — лог, но пользователь уже
     * не увидит тоста (это асинхронный вызов).
     */
    private boolean dispatchWithDelay(final Intent intent) {
        try {
            Handler handler = new Handler(Looper.getMainLooper());
            handler.postDelayed(() -> {
                try {
                    // Всегда activity.startActivity — Activity-контекст
                    // самый надёжный для запуска из лаунчера
                    activity.startActivity(intent);
                    Log.i(TAG, "dispatchWithDelay: startActivity OK");
                } catch (Exception e) {
                    Log.e(TAG, "dispatchWithDelay: startActivity failed", e);
                    // Fallback: через context
                    try {
                        context.startActivity(intent);
                        Log.i(TAG, "dispatchWithDelay: context.startActivity OK");
                    } catch (Exception e2) {
                        Log.e(TAG, "dispatchWithDelay: context.startActivity failed", e2);
                    }
                }
            }, 150);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "dispatchWithDelay setup failed", e);
            return false;
        }
    }

    // ============================================================
    // Установка APK
    // ============================================================

    @JavascriptInterface
    public boolean installApk(String virtualPath) {
        if (virtualPath == null || virtualPath.isEmpty()) {
            Log.w(TAG, "installApk: empty path");
            return false;
        }
        Log.i(TAG, "installApk: virtualPath=" + virtualPath);

        // Android 8+: разрешение «Установка из неизвестных источников»
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                PackageManager pm = context.getPackageManager();
                if (!pm.canRequestPackageInstalls()) {
                    Log.i(TAG, "installApk: requesting unknown sources permission");
                    sPendingInstallPath = virtualPath;
                    openUnknownSourcesSettings();
                    return false;
                }
            } catch (Exception e) {
                Log.w(TAG, "canRequestPackageInstalls failed: " + e.getMessage());
            }
        }

        return doInstall(virtualPath);
    }

    private void openUnknownSourcesSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
        } catch (Exception e) {
            Log.w(TAG, "unknown-sources settings failed: " + e.getMessage());
            try {
                Intent intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception e2) {
                try {
                    Intent intent = new Intent(Settings.ACTION_SETTINGS);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(intent);
                } catch (Exception e3) {
                    Log.e(TAG, "cannot open settings", e3);
                }
            }
        }
    }

    /**
     * Вызывается из MainActivity.onResume().
     * Если пользователь уходил включать «Неизвестные источники»
     * и вернулся — повторяем установку.
     */
    public static void retryPendingInstall(Activity activity) {
        final String path = sPendingInstallPath;
        if (path == null) return;

        try {
            PackageManager pm = activity.getPackageManager();
            if (pm.canRequestPackageInstalls()) {
                sPendingInstallPath = null;
                Log.i(TAG, "retryPendingInstall: permission granted, retrying");
                new AndroidBridge(activity).installApk(path);
            }
        } catch (Exception e) {
            Log.w(TAG, "retryPendingInstall failed: " + e.getMessage());
        }
    }

    private boolean doInstall(String virtualPath) {
        File apkFile = resolveVirtualPath(virtualPath);
        if (apkFile == null) {
            Log.e(TAG, "doInstall: cannot resolve " + virtualPath);
            return false;
        }
        if (!apkFile.exists() || !apkFile.isFile()) {
            Log.e(TAG, "doInstall: file not found " + apkFile.getAbsolutePath());
            return false;
        }
        if (!apkFile.getName().toLowerCase().endsWith(".apk")) {
            Log.e(TAG, "doInstall: not .apk");
            return false;
        }

        try {
            // Копируем в cache (нужно для FileProvider)
            File cacheDir = new File(context.getCacheDir(), "apk");
            if (!cacheDir.exists()) cacheDir.mkdirs();
            File cacheFile = new File(cacheDir, apkFile.getName());

            try (InputStream in = new FileInputStream(apkFile);
                 OutputStream out = new FileOutputStream(cacheFile)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }

            Uri apkUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    cacheFile);

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri,
                    "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            activity.startActivity(intent);
            Log.i(TAG, "doInstall: installer opened");
            return true;
        } catch (Exception e) {
            Log.e(TAG, "doInstall failed", e);
            return false;
        }
    }

    private File resolveVirtualPath(String virtualPath) {
        Config cfg = FileServer.config();
        if (cfg == null) {
            Log.e(TAG, "resolveVirtualPath: FileServer.config() is null");
            return null;
        }

        String norm = virtualPath.replace('\\', '/');
        while (norm.startsWith("/")) norm = norm.substring(1);
        if (norm.isEmpty()) return null;

        int slash = norm.indexOf('/');
        if (slash > 0) {
            String shareName = norm.substring(0, slash);
            String rel = norm.substring(slash + 1);
            Config.Share sh = cfg.findShare(shareName);
            if (sh != null && sh.isFolder()) {
                try {
                    return sh.physicalPath().resolve(rel).normalize().toFile();
                } catch (Exception e) {
                    Log.w(TAG, "resolveVirtualPath via share", e);
                }
            }
        }

        Config.Share root = cfg.findRootShare();
        if (root != null && root.isFolder()) {
            try {
                return root.physicalPath().resolve(norm).normalize().toFile();
            } catch (Exception e) {
                Log.w(TAG, "resolveVirtualPath via root", e);
            }
        }
        return null;
    }

    // ============================================================
    // Настройки Android
    // ============================================================

    @JavascriptInterface
    public boolean openSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            return true;
        } catch (Exception e) {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
                return true;
            } catch (Exception e2) {
                return false;
            }
        }
    }

    // ============================================================
    // Лаунчер по умолчанию
    // ============================================================

    @JavascriptInterface
    public boolean isDefaultLauncher() {
        try {
            PackageManager pm = context.getPackageManager();
            Intent home = new Intent(Intent.ACTION_MAIN);
            home.addCategory(Intent.CATEGORY_HOME);
            ResolveInfo ri = pm.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
            if (ri == null || ri.activityInfo == null) return false;
            return context.getPackageName().equals(ri.activityInfo.packageName);
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean openHomeSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_HOME_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            return true;
        } catch (Exception ignored) {}
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            return true;
        } catch (Exception ignored) {}
        try {
            Intent intent = new Intent(Settings.ACTION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            return true;
        } catch (Exception ignored) {}
        return false;
    }
}