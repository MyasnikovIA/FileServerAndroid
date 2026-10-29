package ru.miacomsoft.fileserver;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentSender;
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
    public boolean launchApp(final String pkg, final String activityName) {
        // ЭТОТ ЛОГ — ПЕРВОЙ СТРОКОЙ. Если его нет в logcat,
        // значит JS-метод вообще не вызвал AndroidBridge.launchApp().
        Log.i(TAG, ">>> launchApp CALLED: pkg=" + pkg + " act=" + activityName);

        if (pkg == null || pkg.isEmpty()) {
            Log.i(TAG, "launchApp: empty pkg");
            return false;
        }
        Log.i(TAG, "=== launchApp START: pkg=" + pkg + " act=" + activityName);

        final Intent intent = buildLaunchIntent(pkg, activityName);
        if (intent == null) {
            Log.i(TAG, "launchApp: no intent for " + pkg);
            return false;
        }

        // Обязательные флаги для запуска из лаунчера
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);

        Log.i(TAG, "launchApp: intent=" + intent
                + " flags=0x" + Integer.toHexString(intent.getFlags()));

        // ВАЖНО: запускаем со ГЛАВНОГО потока — иначе Android 10+
        // блокирует как background activity launch и приложение
        // открывается за WebView.
        try {
            Handler handler = new Handler(Looper.getMainLooper());
            handler.post(() -> doLaunchOnMain(intent));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "launchApp: handler setup failed", e);
            // Крайний случай — прямой вызов
            return fireDirectly(intent);
        }
    }

    /**
     * Все попытки запуска. Выполняется на главном потоке.
     */
    private void doLaunchOnMain(Intent intent) {
        Log.i(TAG, "doLaunchOnMain: START intent=" + intent.getComponent());

        // === 1. activity.startActivity ===
        try {
            activity.startActivity(intent);
            Log.i(TAG, "doLaunch[1] activity.startActivity OK");
            return;
        } catch (Exception e) {
            Log.w(TAG, "doLaunch[1] activity.startActivity: " + e.getMessage());
        }

        // === 2. context.startActivity ===
        try {
            context.startActivity(intent);
            Log.i(TAG, "doLaunch[2] context.startActivity OK");
            return;
        } catch (Exception e) {
            Log.w(TAG, "doLaunch[2] context.startActivity: " + e.getMessage());
        }

        // === 3. PendingIntent.send ===
        try {
            PendingIntent pi = PendingIntent.getActivity(
                    context, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT
                            | PendingIntent.FLAG_IMMUTABLE);
            pi.send();
            Log.i(TAG, "doLaunch[3] PendingIntent.send OK");
            return;
        } catch (Exception e) {
            Log.w(TAG, "doLaunch[3] PendingIntent.send: " + e.getMessage());
        }

        // === 4. Activity.startIntentSender ===
        try {
            PendingIntent pi = PendingIntent.getActivity(
                    context, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT
                            | PendingIntent.FLAG_IMMUTABLE);
            IntentSender sender = pi.getIntentSender();
            activity.startIntentSender(sender, null, 0, 0, 0, null);
            Log.i(TAG, "doLaunch[4] startIntentSender OK");
            return;
        } catch (Exception e) {
            Log.w(TAG, "doLaunch[4] startIntentSender: " + e.getMessage());
        }

        // === 5. Activity.startActivities ===
        try {
            activity.startActivities(new Intent[]{ intent });
            Log.i(TAG, "doLaunch[5] startActivities OK");
            return;
        } catch (Exception e) {
            Log.w(TAG, "doLaunch[5] startActivities: " + e.getMessage());
        }

        // === 6. moveTaskToFront (если приложение уже запущено) ===
        try {
            ActivityManager am = (ActivityManager)
                    context.getSystemService(Context.ACTIVITY_SERVICE);
            List<ActivityManager.RunningTaskInfo> tasks = am.getRunningTasks(50);
            if (tasks != null) {
                for (ActivityManager.RunningTaskInfo task : tasks) {
                    if (task.baseActivity != null
                            && task.baseActivity.getPackageName() != null
                            && task.baseActivity.getPackageName().equals(
                            intent.getComponent() != null
                                    ? intent.getComponent().getPackageName()
                                    : "")) {
                        am.moveTaskToFront(task.id,
                                ActivityManager.MOVE_TASK_WITH_HOME);
                        Log.i(TAG, "doLaunch[6] moveTaskToFront OK, task=" + task.id);
                        return;
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "doLaunch[6] moveTaskToFront: " + e.getMessage());
        }

        Log.e(TAG, "doLaunch: ALL APPROACHES FAILED for " + intent);
    }

    private boolean fireDirectly(Intent intent) {
        try {
            activity.startActivity(intent);
            Log.i(TAG, "fireDirectly: OK");
            return true;
        } catch (Exception e) {
            Log.w(TAG, "fireDirectly failed: " + e.getMessage());
            return false;
        }
    }

    private Intent buildLaunchIntent(String pkg, String activityName) {
        PackageManager pm = context.getPackageManager();

        // === 1. getLaunchIntentForPackage ===
        try {
            Intent intent = pm.getLaunchIntentForPackage(pkg);
            if (intent != null) {
                Log.i(TAG, "buildLaunchIntent[1]: via getLaunchIntentForPackage");
                return intent;
            }
        } catch (Exception e) {
            Log.w(TAG, "getLaunchIntentForPackage: " + e.getMessage());
        }

        // === 2. Явный ComponentName ===
        if (activityName != null && !activityName.isEmpty()) {
            try {
                Intent intent = new Intent(Intent.ACTION_MAIN);
                intent.addCategory(Intent.CATEGORY_LAUNCHER);
                intent.setComponent(new ComponentName(pkg, activityName));
                Log.i(TAG, "buildLaunchIntent[2]: via ComponentName");
                return intent;
            } catch (Exception e) {
                Log.w(TAG, "ComponentName: " + e.getMessage());
            }
        }

        // === 3. queryIntentActivities(pkg) ===
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
                Log.i(TAG, "buildLaunchIntent[3]: via queryIntentActivities");
                return intent;
            }
        } catch (Exception e) {
            Log.w(TAG, "queryIntentActivities: " + e.getMessage());
        }

        return null;
    }

    // ============================================================
    // Установка APK (без изменений)
    // ============================================================

    @JavascriptInterface
    public boolean installApk(String virtualPath) {
        if (virtualPath == null || virtualPath.isEmpty()) {
            Log.w(TAG, "installApk: empty path");
            return false;
        }
        Log.i(TAG, "installApk: virtualPath=" + virtualPath);

        if (Build.VERSION.SDK_INT >= 26) {
            try {
                PackageManager pm = context.getPackageManager();
                if (!pm.canRequestPackageInstalls()) {
                    Log.i(TAG, "installApk: requesting unknown sources");
                    sPendingInstallPath = virtualPath;
                    openUnknownSourcesSettings();
                    return false;
                }
            } catch (Exception e) {
                Log.w(TAG, "canRequestPackageInstalls: " + e.getMessage());
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
            PackageManager pm = activity.getPackageManager();
            if (pm.canRequestPackageInstalls()) {
                sPendingInstallPath = null;
                Log.i(TAG, "retryPendingInstall: retrying install");
                new AndroidBridge(activity).installApk(path);
            }
        } catch (Exception e) {
            Log.w(TAG, "retryPendingInstall: " + e.getMessage());
        }
    }

    private boolean doInstall(String virtualPath) {
        File apkFile = resolveVirtualPath(virtualPath);
        if (apkFile == null || !apkFile.exists() || !apkFile.isFile()) {
            Log.e(TAG, "doInstall: file not found " + virtualPath);
            return false;
        }
        if (!apkFile.getName().toLowerCase().endsWith(".apk")) {
            Log.e(TAG, "doInstall: not .apk");
            return false;
        }
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
        if (cfg == null) return null;
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
                } catch (Exception ignored) {}
            }
        }
        Config.Share root = cfg.findRootShare();
        if (root != null && root.isFolder()) {
            try {
                return root.physicalPath().resolve(norm).normalize().toFile();
            } catch (Exception ignored) {}
        }
        return null;
    }

    // ============================================================
    // Настройки / лаунчер
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

    @JavascriptInterface
    public boolean isDefaultLauncher() {
        try {
            PackageManager pm = context.getPackageManager();
            Intent home = new Intent(Intent.ACTION_MAIN);
            home.addCategory(Intent.CATEGORY_HOME);
            ResolveInfo ri = pm.resolveActivity(home,
                    PackageManager.MATCH_DEFAULT_ONLY);
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