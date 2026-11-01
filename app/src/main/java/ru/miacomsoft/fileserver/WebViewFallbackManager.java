package ru.miacomsoft.fileserver;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.graphics.Bitmap;
import android.widget.Toast;

/**
 * Менеджер fallback-механизмов для WebView.
 * Обрабатывает ошибки и предлагает альтернативные решения.
 */
public class WebViewFallbackManager {
    private static final String TAG = "WebViewFallback";

    private final Context context;
    private final WebView webView;
    private int errorCount = 0;
    private long lastErrorTime = 0;
    private static final int MAX_ERRORS_BEFORE_FALLBACK = 3;
    private static final long ERROR_RESET_INTERVAL_MS = 30000;

    public interface FallbackListener {
        void onWebViewFailed(String error);
        void onFallbackActivated();
    }

    private FallbackListener listener;

    public WebViewFallbackManager(Context context, WebView webView) {
        this.context = context;
        this.webView = webView;
    }

    public void setFallbackListener(FallbackListener listener) {
        this.listener = listener;
    }

    /**
     * Обрабатывает ошибку загрузки WebView.
     * Возвращает true, если нужно активировать fallback.
     */
    public boolean handleError(int errorCode, String description) {
        long now = System.currentTimeMillis();

        // Сбрасываем счётчик если прошло много времени
        if (now - lastErrorTime > ERROR_RESET_INTERVAL_MS) {
            errorCount = 0;
        }

        errorCount++;
        lastErrorTime = now;

        Log.w(TAG, "WebView error #" + errorCount + ": "
                + errorCode + " - " + description);

        // Критические ошибки
        boolean isCritical = isCriticalError(errorCode);

        if (isCritical || errorCount >= MAX_ERRORS_BEFORE_FALLBACK) {
            Log.e(TAG, "Critical WebView failure, activating fallback");
            activateFallback(description);
            return true;
        }

        return false;
    }

    /**
     * Проверяет, является ли ошибка критической.
     */
    private boolean isCriticalError(int errorCode) {
        switch (errorCode) {
            case WebViewClient.ERROR_FAILED_SSL_HANDSHAKE:
            case WebViewClient.ERROR_UNSUPPORTED_SCHEME:
            case WebViewClient.ERROR_CONNECT:
            case WebViewClient.ERROR_TIMEOUT:
            case WebViewClient.ERROR_HOST_LOOKUP:
                return true;
            default:
                return false;
        }
    }

    /**
     * Активирует fallback-механизм.
     */
    private void activateFallback(String errorDescription) {
        if (listener != null) {
            listener.onWebViewFailed(errorDescription);
        }

        // Предлагаем пользователю использовать встроенный браузер
        if (context instanceof MainActivity) {
            ((MainActivity) context).showFallbackOptions(errorDescription);
        }

        if (listener != null) {
            listener.onFallbackActivated();
        }
    }

    /**
     * Создаёт WebViewClient с улучшенной обработкой ошибок.
     */
    public WebViewClient createResilientWebViewClient() {
        return new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
                    handleError(error.getErrorCode(),
                            error.getDescription().toString());
                }
            }

            @Override
            public void onReceivedHttpError(WebView view,
                                            WebResourceRequest request,
                                            WebResourceResponse errorResponse) {
                if (request.isForMainFrame()) {
                    int statusCode = errorResponse.getStatusCode();
                    if (statusCode >= 500) {
                        handleError(-1, "HTTP " + statusCode);
                    }
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // Сбрасываем счётчик ошибок при успешной загрузке
                errorCount = 0;
                Log.i(TAG, "Page loaded successfully: " + url);
            }
        };
    }

    /**
     * Открывает URL во встроенном браузере (BrowserActivity).
     */
    public void openInNativeBrowser(String url) {
        try {
            Intent intent = new Intent(context, BrowserActivity.class);
            intent.putExtra(BrowserActivity.EXTRA_URL, url);
            intent.putExtra(BrowserActivity.EXTRA_TITLE, "FileServer");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Failed to open native browser", e);
            Toast.makeText(context,
                    "Не удалось открыть браузер: " + e.getMessage(),
                    Toast.LENGTH_LONG).show();
        }
    }

    /**
     * Открывает URL в системном браузере.
     */
    public void openInSystemBrowser(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Failed to open system browser", e);
            Toast.makeText(context,
                    "Не удалось открыть браузер: " + e.getMessage(),
                    Toast.LENGTH_LONG).show();
        }
    }

    /**
     * Проверяет и применяет настройки совместимости для старых WebView.
     */
    public void applyCompatibilitySettings() {
        if (webView == null) return;

        WebViewCompatHelper.WebViewInfo info =
                WebViewCompatHelper.getWebViewInfo(context);

        if (info.isCritical) {
            Log.w(TAG, "Applying compatibility settings for old WebView");

            // Включаем функции, которые могут быть отключены по умолчанию в старых WebView
            webView.getSettings().setDomStorageEnabled(true);
            webView.getSettings().setDatabaseEnabled(true);

            // Упрощаем User-Agent для старых устройств, чтобы сервер отдавал более совместимый контент
            String simpleUA = "Mozilla/5.0 (Linux; Android "
                    + Build.VERSION.RELEASE + "; "
                    + Build.MODEL + ") AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/"
                    + Math.max(info.chromeMajorVersion, 60)
                    + ".0.0.0 Mobile Safari/537.36";
            webView.getSettings().setUserAgentString(simpleUA);
        }
    }
}