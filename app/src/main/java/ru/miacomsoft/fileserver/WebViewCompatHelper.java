package ru.miacomsoft.fileserver;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;
import android.webkit.WebView;

/**
 * Утилита для проверки совместимости WebView.
 * Определяет версию System WebView и предлагает решения.
 */
public class WebViewCompatHelper {
    private static final String TAG = "WebViewCompat";

    // Минимальная рекомендуемая версия WebView (Chrome 80+)
    private static final int MIN_RECOMMENDED_WEBVIEW_VERSION = 80;

    // Критическая минимальная версия (Chrome 60+)
    private static final int MIN_CRITICAL_WEBVIEW_VERSION = 60;

    public static class WebViewInfo {
        public String packageName;
        public int versionCode;
        public String versionName;
        public int chromeMajorVersion;
        public boolean isOutdated;
        public boolean isCritical;
        public String userAgent;
    }

    /**
     * Получает информацию о текущем WebView.
     */
    public static WebViewInfo getWebViewInfo(Context context) {
        WebViewInfo info = new WebViewInfo();

        // Получаем версию System WebView
        try {
            PackageInfo pi = context.getPackageManager()
                    .getPackageInfo("com.google.android.webview", 0);
            info.packageName = pi.packageName;
            info.versionCode = pi.versionCode;
            info.versionName = pi.versionName;

            // Извлекаем мажорную версию Chrome из versionName
            // Формат обычно: "80.0.3987.132" или "120.0.6099.144"
            info.chromeMajorVersion = extractChromeMajorVersion(info.versionName);

        } catch (PackageManager.NameNotFoundException e) {
            // System WebView не найден - возможно используется другой провайдер
            Log.w(TAG, "System WebView not found, trying alternative packages");

            // Пробуем другие возможные пакеты WebView
            String[] alternativePackages = {
                    "com.android.webview",
                    "org.chromium.android_webview",
                    "com.huawei.webview",
                    "com.sec.android.webview"
            };

            for (String pkg : alternativePackages) {
                try {
                    PackageInfo pi = context.getPackageManager()
                            .getPackageInfo(pkg, 0);
                    info.packageName = pi.packageName;
                    info.versionCode = pi.versionCode;
                    info.versionName = pi.versionName;
                    info.chromeMajorVersion = extractChromeMajorVersion(info.versionName);
                    break;
                } catch (PackageManager.NameNotFoundException ignored) {}
            }
        }

        // Определяем статус
        if (info.chromeMajorVersion > 0) {
            info.isCritical = info.chromeMajorVersion < MIN_CRITICAL_WEBVIEW_VERSION;
            info.isOutdated = info.chromeMajorVersion < MIN_RECOMMENDED_WEBVIEW_VERSION;
        } else {
            // Не смогли определить версию - считаем критичным
            info.isCritical = true;
            info.isOutdated = true;
        }

        // Получаем User-Agent для диагностики
        try {
            WebView testWebView = new WebView(context);
            info.userAgent = testWebView.getSettings().getUserAgentString();
            testWebView.destroy();
        } catch (Exception e) {
            info.userAgent = "Unable to get User-Agent";
        }

        Log.i(TAG, "WebView Info: pkg=" + info.packageName
                + ", version=" + info.versionName
                + ", chrome=" + info.chromeMajorVersion
                + ", outdated=" + info.isOutdated
                + ", critical=" + info.isCritical);

        return info;
    }

    /**
     * Извлекает мажорную версию Chrome из строки версии WebView.
     * Например: "120.0.6099.144" -> 120
     */
    private static int extractChromeMajorVersion(String versionName) {
        if (versionName == null || versionName.isEmpty()) return 0;

        try {
            // Формат: "MAJOR.MINOR.BUILD.PATCH"
            String[] parts = versionName.split("\\.");
            if (parts.length > 0) {
                return Integer.parseInt(parts[0]);
            }
        } catch (NumberFormatException e) {
            Log.w(TAG, "Failed to parse WebView version: " + versionName);
        }

        return 0;
    }

    /**
     * Проверяет, поддерживает ли WebView необходимые функции.
     */
    public static boolean isWebViewCompatible(Context context) {
        WebViewInfo info = getWebViewInfo(context);
        return !info.isCritical;
    }

    /**
     * Получает рекомендацию для пользователя.
     */
    public static String getRecommendation(Context context) {
        WebViewInfo info = getWebViewInfo(context);

        if (!info.isCritical && !info.isOutdated) {
            return "WebView актуален (Chrome " + info.chromeMajorVersion + ")";
        }

        if (info.isCritical) {
            return "КРИТИЧНО: WebView слишком старый (Chrome "
                    + info.chromeMajorVersion + "). "
                    + "Обновите Android System WebView через Google Play или "
                    + "используйте встроенный браузер.";
        }

        return "WebView устарел (Chrome " + info.chromeMajorVersion
                + "). Рекомендуется обновить через Google Play. "
                + "Некоторые функции могут работать некорректно.";
    }

    /**
     * Проверяет, доступен ли Google Play для обновления WebView.
     */
    public static boolean isGooglePlayAvailable(Context context) {
        try {
            context.getPackageManager()
                    .getPackageInfo("com.android.vending", 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /**
     * Определяет оптимальный режим работы для текущего устройства.
     */
    public static WorkMode getOptimalWorkMode(Context context) {
        WebViewInfo info = getWebViewInfo(context);

        if (!info.isCritical) {
            return WorkMode.WEBVIEW;
        }

        // Если WebView критически устарел, предлагаем встроенный браузер
        if (isGooglePlayAvailable(context)) {
            return WorkMode.WEBVIEW_UPDATE_RECOMMENDED;
        }

        // Если Google Play недоступен, используем встроенный браузер
        return WorkMode.NATIVE_BROWSER;
    }

    public enum WorkMode {
        WEBVIEW,                    // Нормальный режим через WebView
        WEBVIEW_UPDATE_RECOMMENDED, // WebView работает, но рекомендуется обновление
        NATIVE_BROWSER              // Используем встроенный браузер (BrowserActivity)
    }
}