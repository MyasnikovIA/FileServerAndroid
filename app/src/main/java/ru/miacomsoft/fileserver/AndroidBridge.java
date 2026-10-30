package ru.miacomsoft.fileserver;

import android.app.Activity;
import android.app.ActivityOptions;
import android.app.PendingIntent;
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

    // ============================================================
    // Дебаунс: если тот же pkg запускается повторно в течение 800мс —
    // пропускаем. Это защищает от тройного вызова:
    //   • JS touchend → launchApp
    //   • Native ACTION_UP → launchApp
    //   • console.log marker → onConsoleMessage → launchApp
    // ============================================================
    private static final long LAUNCH_DEBOUNCE_MS = 800L;
    private static volatile String sLastLaunchPkg = null;
    private static volatile long   sLastLaunchTime = 0L;

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
        final long t0 = System.currentTimeMillis();
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
        Log.i(TAG, "getApps: " + arr.length() + " apps in "
                + (System.currentTimeMillis() - t0) + "ms");
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
    //
    // ВСЕГДА асинхронно через Handler.post — не блокирует UI/JS поток.
    //
    // Плюс дебаунс — если тот же pkg уже запускался < 800мс назад,
    // второй вызов игнорируется. Это нужно, потому что launchApp может
    // быть вызван одновременно из 2-3 мест (JS touchend, native ACTION_UP,
    // onConsoleMessage). Дебаунс гарантирует единственный запуск.

    @JavascriptInterface
    public boolean launchApp(final String pkg, final String activityName) {
        Log.i(TAG, ">>> launchApp CALLED: pkg=" + pkg + " act=" + activityName);

        if (pkg == null || pkg.isEmpty()) {
            Log.w(TAG, "launchApp: empty pkg");
            return false;
        }

        long now = System.currentTimeMillis();
        synchronized (AndroidBridge.class) {
            if (pkg.equals(sLastLaunchPkg)
                    && (now - sLastLaunchTime) < LAUNCH_DEBOUNCE_MS) {
                Log.i(TAG, "launchApp: debounced duplicate for " + pkg);
                return true;
            }
            sLastLaunchPkg = pkg;
            sLastLaunchTime = now;
        }

        try {
            Handler handler = new Handler(Looper.getMainLooper());
            handler.post(() -> {
                try {
                    launchOnMain(pkg, activityName);
                } catch (Throwable t) {
                    Log.e(TAG, "launchOnMain uncaught", t);
                }
            });
            Log.i(TAG, "launchApp: posted to UI thread");
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "launchApp: handler.post failed", t);
            return false;
        }
    }

    private void launchOnMain(String pkg, String activityName) {
        final long t0 = System.currentTimeMillis();
        Log.i(TAG, "launchOnMain START: pkg=" + pkg + " act=" + activityName);

        if (activity == null) { Log.e(TAG, "launchOnMain: activity null"); return; }
        if (Build.VERSION.SDK_INT >= 17 && activity.isDestroyed()) {
            Log.w(TAG, "launchOnMain: activity destroyed"); return;
        }

        final Intent intent;
        try { intent = buildLaunchIntent(pkg, activityName); }
        catch (Throwable t) { Log.e(TAG, "buildLaunchIntent failed", t); return; }

        if (intent == null) {
            Log.w(TAG, "launchOnMain: no intent for " + pkg);
            return;
        }

        // FLAG_ACTIVITY_NEW_TASK обязателен: запуск из non-Activity контекста
        // + отдельная задача для целевого приложения (как из лаунчера).
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        Log.i(TAG, "launchOnMain intent=" + intent
                + " component=" + intent.getComponent()
                + " flags=0x" + Integer.toHexString(intent.getFlags())
                + " buildMs=" + (System.currentTimeMillis() - t0));

        // 1. PendingIntent.send — обходит OEM-ограничения
        try {
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getActivity(context, 0, intent, flags);
            pi.send();
            Log.i(TAG, "launch[1] PendingIntent.send OK ("
                    + (System.currentTimeMillis() - t0) + "ms)");
            return;
        } catch (Throwable t) {
            Log.w(TAG, "launch[1] PendingIntent.send failed: " + t.getMessage());
        }

        // 2. activity.startActivity с ActivityOptions
        try {
            ActivityOptions opts = ActivityOptions.makeBasic();
            activity.startActivity(intent, opts.toBundle());
            Log.i(TAG, "launch[2] activity.startActivity OK ("
                    + (System.currentTimeMillis() - t0) + "ms)");
            return;
        } catch (Throwable t) {
            Log.w(TAG, "launch[2] activity.startActivity failed: " + t.getMessage());
        }

        // 3. context.startActivity
        try {
            context.startActivity(intent);
            Log.i(TAG, "launch[3] context.startActivity OK ("
                    + (System.currentTimeMillis() - t0) + "ms)");
            return;
        } catch (Throwable t) {
            Log.w(TAG, "launch[3] context.startActivity failed: " + t.getMessage());
        }

        Log.e(TAG, "launchOnMain: ALL APPROACHES FAILED for " + intent);
    }

    private Intent buildLaunchIntent(String pkg, String activityName) {
        PackageManager pm = context.getPackageManager();

        try {
            Intent intent = pm.getLaunchIntentForPackage(pkg);
            if (intent != null) {
                Log.i(TAG, "buildLaunchIntent[1]: getLaunchIntentForPackage");
                return intent;
            }
        } catch (Throwable t) {
            Log.w(TAG, "getLaunchIntentForPackage: " + t.getMessage());
        }

        if (activityName != null && !activityName.isEmpty()) {
            try {
                Intent intent = new Intent(Intent.ACTION_MAIN);
                intent.addCategory(Intent.CATEGORY_LAUNCHER);
                intent.setComponent(new ComponentName(pkg, activityName));
                Log.i(TAG, "buildLaunchIntent[2]: ComponentName");
                return intent;
            } catch (Throwable t) {
                Log.w(TAG, "ComponentName: " + t.getMessage());
            }
        }

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
                        ri.activityInfo.packageName, ri.activityInfo.name));
                Log.i(TAG, "buildLaunchIntent[3]: queryIntentActivities");
                return intent;
            }
        } catch (Throwable t) {
            Log.w(TAG, "queryIntentActivities: " + t.getMessage());
        }

        return null;
    }

    // ============================================================
    // Установка APK
    // ============================================================

    @JavascriptInterface
    public boolean installApk(String virtualPath) {
        if (virtualPath == null || virtualPath.isEmpty()) return false;
        Log.i(TAG, "installApk: " + virtualPath);

        if (Build.VERSION.SDK_INT >= 26) {
            try {
                if (!context.getPackageManager().canRequestPackageInstalls()) {
                    sPendingInstallPath = virtualPath;
                    openUnknownSourcesSettings();
                    return false;
                }
            } catch (Exception e) { Log.w(TAG, "canRequest: " + e.getMessage()); }
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

    public static void retryPendingInstall(Activity activity) {
        final String path = sPendingInstallPath;
        if (path == null) return;
        try {
            if (activity.getPackageManager().canRequestPackageInstalls()) {
                sPendingInstallPath = null;
                new AndroidBridge(activity).installApk(path);
            }
        } catch (Exception e) { Log.w(TAG, "retryPendingInstall: " + e.getMessage()); }
    }

    private boolean doInstall(String virtualPath) {
        File apkFile = resolveVirtualPath(virtualPath);
        if (apkFile == null || !apkFile.exists() || !apkFile.isFile()) return false;
        if (!apkFile.getName().toLowerCase().endsWith(".apk")) return false;
        try {
            File cacheDir = new File(context.getCacheDir(), "apk");
            if (!cacheDir.exists()) cacheDir.mkdirs();
            File cacheFile = new File(cacheDir, apkFile.getName());
            try (InputStream in = new FileInputStream(apkFile);
                 OutputStream out = new FileOutputStream(cacheFile)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            Uri apkUri = FileProvider.getUriForFile(context,
                    context.getPackageName() + ".fileprovider", cacheFile);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(intent);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "doInstall failed", e);
            return false;
        }
    }

    private File resolveVirtualPath(String virtualPath) {
        Config cfg = FileServer.config();
        if (cfg == null) return null;
        String norm = virtualPath.replace('\\', '/');
        while (norm.startsWith("/")) norm = norm.substring(1);
        if (norm.isEmpty()) return null;
        int slash = norm.indexOf('/');
        if (slash > 0) {
            Config.Share sh = cfg.findShare(norm.substring(0, slash));
            if (sh != null && sh.isFolder()) {
                try { return sh.physicalPath().resolve(norm.substring(slash + 1)).normalize().toFile(); }
                catch (Exception ignored) {}
            }
        }
        Config.Share root = cfg.findRootShare();
        if (root != null && root.isFolder()) {
            try { return root.physicalPath().resolve(norm).normalize().toFile(); }
            catch (Exception ignored) {}
        }
        return null;
    }

    // ============================================================
    // Настройки / лаунчер
    // ============================================================

    @JavascriptInterface
    public boolean openSettings() {
        try {
            Intent i = new Intent(Settings.ACTION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
            return true;
        } catch (Exception e) {
            try {
                Intent i = new Intent(Settings.ACTION_APPLICATION_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(i);
                return true;
            } catch (Exception e2) { return false; }
        }
    }

    @JavascriptInterface
    public boolean isDefaultLauncher() {
        try {
            PackageManager pm = context.getPackageManager();
            Intent home = new Intent(Intent.ACTION_MAIN);
            home.addCategory(Intent.CATEGORY_HOME);
            ResolveInfo ri = pm.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
            if (ri == null || ri.activityInfo == null) return false;
            return context.getPackageName().equals(ri.activityInfo.packageName);
        } catch (Exception e) { return false; }
    }

    @JavascriptInterface
    public boolean openHomeSettings() {
        try {
            Intent i = new Intent(Settings.ACTION_HOME_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
            return true;
        } catch (Exception ignored) {}
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
            return true;
        } catch (Exception ignored) {}
        try {
            Intent i = new Intent(Settings.ACTION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
            return true;
        } catch (Exception ignored) {}
        return false;
    }
}