package ru.miacomsoft.fileserver;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.util.Log;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {
    private static final String TAG = "MainActivity";
    private String currentLocalUrl = "http://127.0.0.1:8080/";
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final String LAUNCH_MARKER = "__LAUNCH_APP__|";
    private static final long RELOAD_MIN_INTERVAL_MS = 5000L;
    private long lastReloadAt = 0L;
    private boolean reloadInProgress = false;
    private int reloadAttempt = 0;
    private WebView webView;
    private LinearLayout loadingView;
    private ProgressBar loadingProgress;
    private TextView loadingText;

    private static final long RELOAD_APPS_MIN_INTERVAL_MS = 30000L;
    private long lastReloadAppsAt = 0L;
    private float _downX = 0f, _downY = 0f;
    private long _downTime = 0L;
    private Button       permissionBtn;
    private boolean urlLoaded = false;
    private ValueCallback<Uri[]> filePathCallback;
    private WebViewFallbackManager fallbackManager;
    private boolean fallbackActivated = false;

    private final ActivityResultLauncher<String[]> permissionLauncher =
            registerForActivityResult(
                    new ActivityResultContracts.RequestMultiplePermissions(),
                    result -> {
                        boolean all = true;
                        for (Boolean g : result.values()) {
                            if (g == null || !g) { all = false; break; }
                        }
                        if (!all) Toast.makeText(MainActivity.this,
                                "Не все разрешения выданы", Toast.LENGTH_LONG).show();
                        evaluateState();
                    });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.i(TAG, "VERSION 2026-10-30 v5 — SSL ignore for WM iframes");

        // Проверяем совместимость WebView
        WebViewCompatHelper.WorkMode workMode =
                WebViewCompatHelper.getOptimalWorkMode(this);
        Log.i(TAG, "Work mode: " + workMode);

        if (workMode == WebViewCompatHelper.WorkMode.NATIVE_BROWSER) {
            // WebView критически устарел - сразу используем встроенный браузер
            Log.w(TAG, "WebView too old, using native browser");
            Toast.makeText(this,
                    "WebView устарел. Используется встроенный браузер.",
                    Toast.LENGTH_LONG).show();
            openNativeBrowser();
            finish();
            return;
        }

        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setContentView(R.layout.activity_main);
        applyImmersive();
        webView          = findViewById(R.id.webView);
        loadingView      = findViewById(R.id.loadingView);
        loadingProgress  = findViewById(R.id.loadingProgress);
        loadingText      = findViewById(R.id.loadingText);
        permissionBtn    = findViewById(R.id.permissionBtn);
        permissionBtn.setOnClickListener(v -> requestPermissions());

        // Инициализируем fallback менеджер
        fallbackManager = new WebViewFallbackManager(this, webView);
        fallbackManager.setFallbackListener(new WebViewFallbackManager.FallbackListener() {
            @Override
            public void onWebViewFailed(String error) {
                Log.e(TAG, "WebView failed: " + error);
            }

            @Override
            public void onFallbackActivated() {
                fallbackActivated = true;
            }
        });

        setupWebView();

        FileServerService.setStateListener((running, url) -> runOnUiThread(() -> {
            if (running && !urlLoaded && !fallbackActivated) {
                String localUrl = FileServerService.getLocalUrl();
                if (localUrl != null && !localUrl.isEmpty()) {
                    currentLocalUrl = localUrl.endsWith("/") ? localUrl : localUrl + "/";
                }
                urlLoaded = true;
                Log.i(TAG, "Loading: " + currentLocalUrl);
                webView.loadUrl(currentLocalUrl);
            }
        }));

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack();
                else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });

        evaluateState();
    }

    /**
     * Открывает встроенный браузер вместо WebView.
     */
    private void openNativeBrowser() {
        String url = FileServerService.isRunning()
                ? FileServerService.getLocalUrl()
                : "http://127.0.0.1:8080/";

        Intent intent = new Intent(this, BrowserActivity.class);
        intent.putExtra(BrowserActivity.EXTRA_URL, url);
        intent.putExtra(BrowserActivity.EXTRA_TITLE, "FileServer");
        startActivity(intent);
    }

    /**
     * Показывает опции fallback при критической ошибке WebView.
     */
    public void showFallbackOptions(String error) {
        if (isFinishing()) return;

        new AlertDialog.Builder(this)
                .setTitle("Ошибка WebView")
                .setMessage("Встроенный браузер не может отобразить интерфейс.\n\n"
                        + "Ошибка: " + error + "\n\n"
                        + "Попробовать встроенный браузер?")
                .setPositiveButton("Встроенный браузер", (d, w) -> {
                    openNativeBrowser();
                    finish();
                })
                .setNegativeButton("Обновить WebView", (d, w) -> {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW);
                        intent.setData(Uri.parse(
                                "https://play.google.com/store/apps/details?id=com.google.android.webview"));
                        startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(this,
                                "Google Play недоступен",
                                Toast.LENGTH_SHORT).show();
                    }
                })
                .setNeutralButton("Повторить", (d, w) -> {
                    fallbackActivated = false;
                    reloadAttempt = 0;
                    if (webView != null) {
                        webView.loadUrl(currentLocalUrl);
                    }
                })
                .setCancelable(false)
                .show();
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersive();
        evaluateState();
        try { AndroidBridge.retryPendingInstall(this); }
        catch (Exception e) { Log.w(TAG, "retryPendingInstall", e); }
        long now = System.currentTimeMillis();
        if (webView != null && urlLoaded && !fallbackActivated
                && (now - lastReloadAppsAt) > RELOAD_APPS_MIN_INTERVAL_MS) {
            lastReloadAppsAt = now;
            webView.evaluateJavascript(
                    "try { FAR && FAR.AndroidPrograms && FAR.AndroidPrograms.reloadApps && FAR.AndroidPrograms.reloadApps(); } catch(e) {}",
                    null);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    @Override
    protected void onDestroy() {
        FileServerService.setStateListener(null);
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    results = WebChromeClient.FileChooserParams
                            .parseResult(resultCode, data);
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void applyImmersive() {
        View decor = getWindow() != null ? getWindow().getDecorView() : null;
        if (Build.VERSION.SDK_INT >= 30) {
            if (getWindow() != null) getWindow().setDecorFitsSystemWindows(false);
            if (decor != null) {
                WindowInsetsController ctrl = decor.getWindowInsetsController();
                if (ctrl != null) {
                    ctrl.hide(WindowInsets.Type.statusBars()
                            | WindowInsets.Type.navigationBars());
                    ctrl.setSystemBarsBehavior(
                            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            }
        } else if (decor != null) {
            decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    private boolean hasFilesPermission() {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return ContextCompat.checkSelfPermission(this,
                Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(this,
                Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestPermissions() {
        if (Build.VERSION.SDK_INT >= 30) {
            if (!Environment.isExternalStorageManager()) {
                try {
                    Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                    i.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(i);
                    return;
                } catch (Exception e) {
                    try { startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)); }
                    catch (Exception e2) {
                        Toast.makeText(this, "Не удалось открыть настройки: " + e2.getMessage(),
                                Toast.LENGTH_LONG).show();
                    }
                }
                return;
            }
        }
        List<String> perms = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(this,
                Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED)
            perms.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        if (ContextCompat.checkSelfPermission(this,
                Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED)
            perms.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this,
                Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            perms.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!perms.isEmpty()) permissionLauncher.launch(perms.toArray(new String[0]));
    }

    private void evaluateState() {
        if (!hasFilesPermission()) { showPermissionScreen(); return; }
        permissionBtn.setVisibility(View.GONE);
        if (urlLoaded) return;
        if (FileServerService.isRunning()) {
            showLoading("Подключение…");
            String localUrl = FileServerService.getLocalUrl();
            if (localUrl != null && !localUrl.isEmpty()) {
                currentLocalUrl = localUrl.endsWith("/") ? localUrl : localUrl + "/";
            }
            urlLoaded = true;
            if (!fallbackActivated && webView != null) {
                webView.loadUrl(currentLocalUrl);
            }
        } else {
            showLoading("Запуск сервера…");
            startServerService();
        }
    }

    private void showPermissionScreen() {
        loadingProgress.setVisibility(View.GONE);
        loadingText.setText("Для работы приложения необходим доступ ко всем файлам.\n\n"
                + "Нажмите кнопку ниже и разрешите доступ.");
        permissionBtn.setVisibility(View.VISIBLE);
        loadingView.setVisibility(View.VISIBLE);
    }

    private void showLoading(String text) {
        loadingText.setText(text);
        loadingProgress.setVisibility(View.VISIBLE);
        permissionBtn.setVisibility(View.GONE);
        loadingView.setVisibility(View.VISIBLE);
    }

    private void hideLoading() { loadingView.setVisibility(View.GONE); }

    private void startServerService() {
        Intent i = new Intent(this, FileServerService.class);
        i.setAction(FileServerService.ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i);
        else startService(i);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // Убираем "wv" из User-Agent, чтобы сайты не блокировали WebView
        String ua = s.getUserAgentString();
        if (ua != null && ua.contains("wv")) {
            ua = ua.replace("; wv", "");
        }
        s.setUserAgentString("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setBackgroundColor(0xFF1E1E2E);
        webView.setLongClickable(false);
        webView.setHapticFeedbackEnabled(false);
        webView.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");

        // Обработка касаний для запуска приложений из веб-интерфейса
        webView.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        _downX = event.getX();
                        _downY = event.getY();
                        _downTime = System.currentTimeMillis();
                        return false;
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL: {
                        if (event.getActionMasked() != MotionEvent.ACTION_UP) {
                            return false;
                        }
                        float dx = event.getX() - _downX;
                        float dy = event.getY() - _downY;
                        long dt = System.currentTimeMillis() - _downTime;
                        float density = getResources().getDisplayMetrics().density;
                        float limit = 30f * density;
                        if (Math.abs(dx) > limit || Math.abs(dy) > limit || dt > 800 || dt < 15) {
                            return false;
                        }
                        webView.evaluateJavascript(
                                "(function(){" +
                                        "  try {" +
                                        "    var s = window._farTouchStart;" +
                                        "    if (!s) return '';" +
                                        "    return (s.pkg || '') + '|' + (s.act || '') + '|' + (s.appId || '');" +
                                        "  } catch(e) { return ''; }" +
                                        "})()",
                                result -> {
                                    if (result == null) return;
                                    String clean = result.trim();
                                    if (clean.startsWith("\"")) clean = clean.substring(1);
                                    if (clean.endsWith("\"")) clean = clean.substring(0, clean.length() - 1);
                                    if (clean.isEmpty() || "null".equals(clean)) return;
                                    String[] p = clean.split("\\|", -1);
                                    String pkg = p.length > 0 ? p[0] : "";
                                    String act = p.length > 1 ? p[1] : "";
                                    String appId = p.length > 2 ? p[2] : "";
                                    if (!pkg.isEmpty()) {
                                        Log.i(TAG, "Native ACTION_UP launch: " + pkg + "/" + act);
                                        Toast.makeText(MainActivity.this, "Запуск: " + pkg, Toast.LENGTH_SHORT).show();
                                        new AndroidBridge(MainActivity.this).launchApp(pkg, act);
                                    } else if (!appId.isEmpty()) {
                                        Log.i(TAG, "Native ACTION_UP WM app: " + appId);
                                        String safe = appId.replace("'", "\\'");
                                        webView.evaluateJavascript(
                                                "try { var a = FAR.WM.getApp('" + safe + "'); " +
                                                        "if (a) FAR.WM._invokeApp(a); } catch(e) {}",
                                                null);
                                    }
                                });
                        return false;
                    }
                }
                return false;
            }
        });

        // ============================================================
        // WebViewClient с обработкой SSL и перезагрузкой
        // ============================================================
        webView.setWebViewClient(new WebViewClient() {

            // !!! КРИТИЧЕСКИ ВАЖНО: Игнорируем ошибки SSL для самоподписанных сертификатов !!!
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                Log.w(TAG, "SSL error: " + error.toString() + " — proceeding anyway.");
                handler.proceed();
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                // Скрываем экран загрузки, как только началась загрузка страницы
                hideLoading();

                // Сбрасываем счётчик ошибок при успешном начале загрузки локального адреса
                if (url != null && (url.contains("127.0.0.1") || url.contains("localhost"))) {
                    reloadAttempt = 0;
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                reloadInProgress = false;
                // Патчим window.open, чтобы он не открывал внешние окна, а менял location
                view.evaluateJavascript(
                        "(function(){" +
                                "  if (window._farAndroidPatched) return;" +
                                "  window._farAndroidPatched = true;" +
                                "  window.open = function(u){" +
                                "    if (u && typeof u === 'string') location.href = u;" +
                                "    return null;" +
                                "  };" +
                                "})();", null);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                String host = uri.getHost() == null ? "" : uri.getHost();

                // Локальные адреса загружаем в этом же WebView
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    if ("127.0.0.1".equals(host) || "localhost".equals(host)) {
                        return false;
                    }
                }
                // Внешние адреса открываем в системном браузере
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Не удалось открыть ссылку", Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return; // Игнорируем ошибки iframe

                // SSL-ошибки уже отработаны выше, не пытаемся их перезагружать
                if (error.getErrorCode() == WebViewClient.ERROR_FAILED_SSL_HANDSHAKE) {
                    Log.w(TAG, "SSL handshake failed — not retrying");
                    return;
                }

                long now = System.currentTimeMillis();
                if (reloadInProgress) return;
                if (now - lastReloadAt < RELOAD_MIN_INTERVAL_MS) return;

                lastReloadAt = now;
                reloadInProgress = true;
                reloadAttempt++; // <-- УВЕЛИЧИВАЕМ СЧЁТЧИК

                // Экспоненциальная задержка: 1.5с, 3с, 6с, 12с, макс 30с
                long delayMs = Math.min(1500L * (1L << (reloadAttempt - 1)), 30000L);
                Log.w(TAG, "onReceivedError: reload #" + reloadAttempt + " in " + delayMs + "ms");

                Toast.makeText(MainActivity.this,
                        "Сервер недоступен, перезапуск… (попытка " + reloadAttempt + ")",
                        Toast.LENGTH_SHORT).show();

                showLoading("Переподключение…");
                startServerService();

                view.postDelayed(() -> {
                    if (!isFinishing() && webView != null) {
                        webView.loadUrl(currentLocalUrl);
                    }
                }, delayMs);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (!isFinishing()) {
                    Toast.makeText(MainActivity.this, "WebView перезапускается", Toast.LENGTH_SHORT).show();
                    recreate();
                }
                return true;
            }
        });

        // ============================================================
        // WebChromeClient
        // ============================================================
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                String msg = cm.message();
                if (msg != null && msg.startsWith("__LAUNCH_APP__|")) {
                    String[] parts = msg.substring("__LAUNCH_APP__|".length()).split("\\|", 2);
                    if (parts.length >= 1 && !parts[0].isEmpty()) {
                        String pkg = parts[0];
                        String act = parts.length > 1 ? parts[1] : "";
                        Log.i(TAG, "Console marker launch: " + pkg + "/" + act);
                        new AndroidBridge(MainActivity.this).launchApp(pkg, act);
                    }
                    return true;
                }
                switch (cm.messageLevel()) {
                    case ERROR:
                        Log.e("WebViewJS", msg + " (" + cm.sourceId() + ":" + cm.lineNumber() + ")");
                        break;
                    case WARNING:
                        Log.w("WebViewJS", msg + " (" + cm.sourceId() + ":" + cm.lineNumber() + ")");
                        break;
                    default:
                        Log.i("WebViewJS", msg + " (" + cm.sourceId() + ":" + cm.lineNumber() + ")");
                }
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> r.confirm())
                        .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> r.confirm())
                        .setNegativeButton(android.R.string.cancel, (d, w) -> r.cancel())
                        .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult r) {
                final android.widget.EditText input = new android.widget.EditText(MainActivity.this);
                if (defaultValue != null) input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setView(input)
                        .setPositiveButton(android.R.string.ok, (d, w) -> r.confirm(input.getText().toString()))
                        .setNegativeButton(android.R.string.cancel, (d, w) -> r.cancel())
                        .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), 1001);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "Не удалось открыть выбор файлов: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        // ============================================================
        // DownloadListener
        // ============================================================
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null) return;
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                Toast.makeText(MainActivity.this, "Файл уже в файловой системе устройства", Toast.LENGTH_LONG).show();
                return;
            }
            if (url.startsWith("http://") || url.startsWith("https://")) {
                try {
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                    String fn = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType);
                    req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fn);
                    req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    if (dm != null) dm.enqueue(req);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Ошибка загрузки: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        });
    }

    /**
     * Создаёт стандартный WebViewClient (если fallback менеджер не инициализирован).
     */
    private WebViewClient createDefaultWebViewClient() {
        return new WebViewClient() {
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                Log.w(TAG, "SSL error (iframe): " + error.toString() + " — proceeding.");
                handler.proceed();
            }
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                hideLoading();
                if (url != null
                        && (url.contains("127.0.0.1") || url.contains("localhost"))) {
                    reloadAttempt = 0;
                }
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                reloadInProgress = false;
                view.evaluateJavascript(
                        "(function(){" +
                                "  if (window._farAndroidPatched) return;" +
                                "  window._farAndroidPatched = true;" +
                                "  window.open = function(u){" +
                                "    if (u && typeof u === 'string') location.href = u;" +
                                "    return null;" +
                                "  };" +
                                "})();", null);
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                String host = uri.getHost() == null ? "" : uri.getHost();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    if ("127.0.0.1".equals(host) || "localhost".equals(host)) return false;
                }
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (Exception e) {
                    Toast.makeText(MainActivity.this,
                            "Не удалось открыть ссылку", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (!request.isForMainFrame()) return;
                if (error.getErrorCode() == WebViewClient.ERROR_FAILED_SSL_HANDSHAKE) {
                    Log.w(TAG, "SSL handshake failed — not retrying");
                    return;
                }
                long now = System.currentTimeMillis();
                if (reloadInProgress) return;
                if (now - lastReloadAt < RELOAD_MIN_INTERVAL_MS) return;
                lastReloadAt = now;
                reloadInProgress = true;
                reloadAttempt++;
                long delayMs = Math.min(1500L * (1L << (reloadAttempt - 1)), 30000L);
                Log.w(TAG, "onReceivedError: reload #" + reloadAttempt
                        + " in " + delayMs + "ms");
                Toast.makeText(MainActivity.this,
                        "Сервер недоступен, перезапуск… (попытка " + reloadAttempt + ")",
                        Toast.LENGTH_SHORT).show();
                startServerService();
                view.postDelayed(() -> {
                    if (!isFinishing() && webView != null) {
                        webView.loadUrl(currentLocalUrl);
                    }
                }, delayMs);
            }
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (!isFinishing()) {
                    Toast.makeText(MainActivity.this,
                            "WebView перезапускается", Toast.LENGTH_SHORT).show();
                    recreate();
                }
                return true;
            }
        };
    }
}