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
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;

import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLSession;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

public class AndroidBridge {

    private static final String TAG = "AndroidBridge";

    private static final long LAUNCH_DEBOUNCE_MS = 800L;
    private static volatile String sLastLaunchPkg = null;
    private static volatile long   sLastLaunchTime = 0L;

    private static volatile String sPendingInstallPath = null;

    private static final int REMOTE_CONNECT_TIMEOUT_MS = 15000;
    private static final int REMOTE_READ_TIMEOUT_MS    = 15000;

    private final Activity activity;
    private final Context context;

    public AndroidBridge(Activity activity) {
        this.activity = activity;
        this.context = activity.getApplicationContext();
    }

    @JavascriptInterface
    public boolean isAndroidApp() { return true; }

    /**
     * Открывает URL в нашем встроенном нативном браузере (BrowserActivity).
     */
    @JavascriptInterface
    public boolean openInAppBrowser(String url, String title) {
        if (url == null || url.isEmpty()) url = "https://www.google.com";
        Log.i(TAG, "openInAppBrowser: " + url);

        try {
            Intent intent = new Intent(context, BrowserActivity.class);
            intent.putExtra(BrowserActivity.EXTRA_URL, url);
            if (title != null && !title.isEmpty()) {
                intent.putExtra(BrowserActivity.EXTRA_TITLE, title);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "openInAppBrowser failed", e);
            return false;
        }
    }

    @JavascriptInterface
    public boolean openInAppBrowser(String url) {
        return openInAppBrowser(url, null);
    }

    // ============================================================
    // Приложения Android
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

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        Log.i(TAG, "launchOnMain intent=" + intent
                + " component=" + intent.getComponent()
                + " flags=0x" + Integer.toHexString(intent.getFlags())
                + " buildMs=" + (System.currentTimeMillis() - t0));

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

        try {
            ActivityOptions opts = ActivityOptions.makeBasic();
            activity.startActivity(intent, opts.toBundle());
            Log.i(TAG, "launch[2] activity.startActivity OK ("
                    + (System.currentTimeMillis() - t0) + "ms)");
            return;
        } catch (Throwable t) {
            Log.w(TAG, "launch[2] activity.startActivity failed: " + t.getMessage());
        }

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
    // Настройки
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

    @JavascriptInterface
    public boolean openExternalUrl(String url) {
        if (url == null || url.isEmpty()) return false;
        Log.i(TAG, "openExternalUrl: " + url);
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "openExternalUrl failed", e);
            return false;
        }
    }

    // ============================================================
    // Логин на удалённый FileServer
    // ============================================================

    @JavascriptInterface
    public String loginRemoteAndSetCookie(String url, String user, String pass) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", false);

            URL parsed;
            try {
                parsed = new URL(url);
            } catch (Exception e) {
                result.put("error", "invalid_url");
                result.put("message", "Неверный адрес сервера: " + e.getMessage());
                return result.toString();
            }

            String host = parsed.getHost();
            int port = parsed.getPort();
            String scheme = parsed.getProtocol();
            if (host == null || host.isEmpty()) {
                result.put("error", "invalid_host");
                result.put("message", "Не указан хост в адресе");
                return result.toString();
            }
            if (port <= 0) {
                port = "https".equals(scheme) ? 443 : 80;
            }

            Log.i(TAG, "loginRemoteAndSetCookie: host=" + host
                    + " port=" + port + " scheme=" + scheme + " user=" + user);

            List<String> attempts = new ArrayList<>();
            String primaryBase = scheme + "://" + host + ":" + port;
            attempts.add(primaryBase + "/api/login");

            if ("https".equals(scheme)) {
                attempts.add("http://" + host + ":" + port + "/api/login");
            }

            JSONArray tried = new JSONArray();
            result.put("tried", tried);

            for (String loginUrl : attempts) {
                JSONObject att = tryRemoteLogin(loginUrl, user, pass);

                JSONObject diag = new JSONObject();
                diag.put("url", loginUrl);
                diag.put("error", att.optString("error", "unknown"));
                if (att.has("message")) diag.put("message", att.optString("message"));
                tried.put(diag);

                if (att.optBoolean("ok")) {
                    String token = att.optString("token", "");
                    String successBase = loginUrl.substring(0,
                            loginUrl.length() - "/api/login".length());

                    if (!token.isEmpty()) {
                        String cookieValue = "filebd_token=" + token
                                + "; Path=/; Max-Age=86400; SameSite=Lax";
                        try {
                            CookieManager.getInstance().setCookie(successBase, cookieValue);
                            CookieManager.getInstance().flush();
                        } catch (Exception e) {
                            Log.w(TAG, "CookieManager failed: " + e.getMessage());
                        }
                    }

                    result.put("ok", true);
                    result.put("scheme", successBase.startsWith("https://") ? "https" : "http");
                    result.put("port", port);
                    result.put("url", successBase);
                    result.put("token", token);
                    Log.i(TAG, "loginRemoteAndSetCookie: SUCCESS at " + successBase);
                    return result.toString();
                }
            }

            result.put("error", "all_attempts_failed");
            Log.e(TAG, "loginRemoteAndSetCookie: ALL FAILED. tried=" + tried);
        } catch (Exception e) {
            Log.e(TAG, "loginRemoteAndSetCookie exception", e);
            try {
                result.put("error", "exception");
                result.put("message", e.getClass().getSimpleName() + ": " + e.getMessage());
            } catch (JSONException ignored) {}
        }
        return result.toString();
    }

    private JSONObject tryRemoteLogin(String loginUrl, String user, String pass) {
        JSONObject att = new JSONObject();
        HttpURLConnection conn = null;
        try {
            att.put("ok", false);

            URL u = new URL(loginUrl);
            conn = (HttpURLConnection) u.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(REMOTE_CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(REMOTE_READ_TIMEOUT_MS);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");

            if (conn instanceof HttpsURLConnection) {
                HttpsURLConnection hc = (HttpsURLConnection) conn;
                try {
                    SSLContext sc = SSLContext.getInstance("TLS");
                    sc.init(null, new TrustManager[]{new X509TrustManager() {
                        public void checkClientTrusted(
                                java.security.cert.X509Certificate[] chain, String authType) {}
                        public void checkServerTrusted(
                                java.security.cert.X509Certificate[] chain, String authType) {}
                        public java.security.cert.X509Certificate[] getAcceptedIssuers() {
                            return new java.security.cert.X509Certificate[0];
                        }
                    }}, new java.security.SecureRandom());
                    hc.setSSLSocketFactory(sc.getSocketFactory());
                    hc.setHostnameVerifier(new HostnameVerifier() {
                        public boolean verify(String h, SSLSession s) { return true; }
                    });
                } catch (Exception e) {
                    Log.w(TAG, "SSL setup failed: " + e.getMessage());
                }
            }

            JSONObject body = new JSONObject();
            body.put("user", user == null ? "" : user);
            body.put("pass", pass == null ? "" : pass);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes("utf-8"));
            }

            int code = conn.getResponseCode();
            att.put("status", code);

            if (code == 200) {
                StringBuilder sb = new StringBuilder();
                try (BufferedReader br = new BufferedReader(
                        new InputStreamReader(conn.getInputStream(), "utf-8"))) {
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                }
                String raw = sb.toString().trim();
                JSONObject resp = new JSONObject(raw);
                String token = resp.optString("token", "");
                if (!token.isEmpty()) {
                    att.put("ok", true);
                    att.put("token", token);
                    return att;
                }
                att.put("error", "no_token_in_response");
                att.put("message", "Сервер ответил, но без токена. Ответ: "
                        + (raw.length() > 120 ? raw.substring(0, 120) + "…" : raw));
                return att;
            }

            String errBody = "";
            try (InputStream es = conn.getErrorStream()) {
                if (es != null) {
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    byte[] buf = new byte[2048];
                    int n;
                    while ((n = es.read(buf)) > 0) baos.write(buf, 0, n);
                    errBody = baos.toString("utf-8");
                }
            } catch (Exception ignored) {}

            att.put("error", "http_" + code);
            if (code == 401) {
                att.put("message", "Неверный логин или пароль (401)");
            } else {
                att.put("message", "HTTP " + code
                        + (errBody.isEmpty() ? "" : ": " + errBody.substring(0,
                        Math.min(errBody.length(), 120))));
            }
            return att;

        } catch (SocketTimeoutException e) {
            try {
                att.put("error", "timeout");
                att.put("message", "Сервер не отвечает (" +
                        (REMOTE_CONNECT_TIMEOUT_MS / 1000) + " сек). " +
                        "Порт " + loginUrl.replace("/api/login", "") +
                        " недоступен. Проверьте: включён ли сервер, " +
                        "правильный ли порт, не блокирует ли файрвол.");
            } catch (JSONException ignored) {}
            Log.w(TAG, "tryRemoteLogin timeout: " + loginUrl);
        } catch (ConnectException e) {
            try {
                att.put("error", "refused");
                att.put("message", "Сервер отклонил соединение (порт закрыт)");
            } catch (JSONException ignored) {}
            Log.w(TAG, "tryRemoteLogin connect refused: " + loginUrl);
        } catch (UnknownHostException e) {
            try {
                att.put("error", "dns");
                att.put("message", "DNS не смог разрешить адрес: " + e.getMessage());
            } catch (JSONException ignored) {}
            Log.w(TAG, "tryRemoteLogin dns failed: " + loginUrl);
        } catch (SSLException e) {
            try {
                att.put("error", "ssl");
                att.put("message", "SSL ошибка: " + e.getMessage());
            } catch (JSONException ignored) {}
            Log.w(TAG, "tryRemoteLogin ssl failed: " + loginUrl);
        } catch (Exception e) {
            try {
                att.put("error", "exception");
                att.put("message", e.getClass().getSimpleName() + ": " + e.getMessage());
            } catch (JSONException ignored) {}
            Log.w(TAG, "tryRemoteLogin exception: " + loginUrl, e);
        } finally {
            if (conn != null) try { conn.disconnect(); } catch (Exception ignored) {}
        }
        return att;
    }
}