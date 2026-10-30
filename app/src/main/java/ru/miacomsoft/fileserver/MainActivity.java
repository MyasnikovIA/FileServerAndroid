package ru.miacomsoft.fileserver;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.RenderProcessGoneDetail;
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

    private static final String LOCAL_URL = "http://127.0.0.1:8080/";
    private static final int REQ_FILE_CHOOSER = 1001;

    private WebView      webView;
    private LinearLayout loadingView;
    private ProgressBar  loadingProgress;
    private TextView     loadingText;
    private Button       permissionBtn;

    private boolean urlLoaded = false;

    private ValueCallback<Uri[]> filePathCallback;

    private final ActivityResultLauncher<String[]> permissionLauncher =
            registerForActivityResult(
                    new ActivityResultContracts.RequestMultiplePermissions(),
                    result -> {
                        boolean all = true;
                        for (Boolean granted : result.values()) {
                            if (granted == null || !granted) { all = false; break; }
                        }
                        if (!all) {
                            Toast.makeText(MainActivity.this,
                                    "Не все разрешения выданы",
                                    Toast.LENGTH_LONG).show();
                        }
                        evaluateState();
                    });

    // ============================================================
    // Жизненный цикл
    // ============================================================

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // FLAG_FULLSCREEN можно ставить до setContentView —
        // он не трогает DecorView.
        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);

        setContentView(R.layout.activity_main);

        // applyImmersive ТОЛЬКО после setContentView —
        // иначе DecorView ещё не создан и getInsetsController() → NPE.
        applyImmersive();

        webView          = findViewById(R.id.webView);
        loadingView      = findViewById(R.id.loadingView);
        loadingProgress  = findViewById(R.id.loadingProgress);
        loadingText      = findViewById(R.id.loadingText);
        permissionBtn    = findViewById(R.id.permissionBtn);

        permissionBtn.setOnClickListener(v -> requestPermissions());

        setupWebView();

        FileServerService.setStateListener((running, url) -> runOnUiThread(() -> {
            if (running && !urlLoaded) {
                urlLoaded = true;
                webView.loadUrl(LOCAL_URL);
            }
        }));

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });

        evaluateState();
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersive();
        evaluateState();

        // 1) Возврат из «Неизвестных источников» — продолжаем установку
        try {
            AndroidBridge.retryPendingInstall(this);
        } catch (Exception e) {
            Log.w("MainActivity", "retryPendingInstall", e);
        }

        // 2) Обновляем список Android-приложений после установки/удаления
        if (webView != null && urlLoaded) {
            webView.evaluateJavascript(
                    "try { FAR && FAR.AndroidPrograms && FAR.AndroidPrograms.reloadApps && FAR.AndroidPrograms.reloadApps(); } catch(e) {}",
                    null);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            // Система может показать статус-бар — восстанавливаем immersive.
            applyImmersive();
        }
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
                    results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ============================================================
    // Полноэкранный режим — безопасно к null
    // ============================================================

    private void applyImmersive() {
        View decor = getWindow() != null ? getWindow().getDecorView() : null;

        if (Build.VERSION.SDK_INT >= 30) {
            if (getWindow() != null) {
                getWindow().setDecorFitsSystemWindows(false);
            }
            if (decor != null) {
                WindowInsetsController ctrl = decor.getWindowInsetsController();
                if (ctrl != null) {
                    ctrl.hide(WindowInsets.Type.statusBars()
                            | WindowInsets.Type.navigationBars());
                    ctrl.setSystemBarsBehavior(
                            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            }
        } else {
            if (decor != null) {
                decor.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                                | View.SYSTEM_UI_FLAG_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            }
        }
    }

    // ============================================================
    // Права
    // ============================================================

    private boolean hasFilesPermission() {
        if (Build.VERSION.SDK_INT >= 30) {
            return Environment.isExternalStorageManager();
        }
        return ContextCompat.checkSelfPermission(this,
                Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(this,
                Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestPermissions() {
        if (Build.VERSION.SDK_INT >= 30) {
            if (!Environment.isExternalStorageManager()) {
                try {
                    Intent intent = new Intent(
                            Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                    return;
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(
                                Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                    } catch (Exception e2) {
                        Toast.makeText(this,
                                "Не удалось открыть настройки: " + e2.getMessage(),
                                Toast.LENGTH_LONG).show();
                    }
                }
                return;
            }
        }

        List<String> perms = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(this,
                Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            perms.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        if (ContextCompat.checkSelfPermission(this,
                Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            perms.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this,
                Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!perms.isEmpty()) {
            permissionLauncher.launch(perms.toArray(new String[0]));
        }
    }

    // ============================================================
    // Состояние
    // ============================================================

    private void evaluateState() {
        if (!hasFilesPermission()) {
            showPermissionScreen();
            return;
        }

        permissionBtn.setVisibility(View.GONE);

        if (urlLoaded) return;

        if (FileServerService.isRunning()) {
            showLoading("Подключение…");
            urlLoaded = true;
            webView.loadUrl(LOCAL_URL);
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

    private void hideLoading() {
        loadingView.setVisibility(View.GONE);
    }

    private void startServerService() {
        Intent i = new Intent(this, FileServerService.class);
        i.setAction(FileServerService.ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(i);
        } else {
            startService(i);
        }
    }

    // ============================================================
    // WebView
    // ============================================================

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

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setBackgroundColor(0xFF1E1E2E);
        webView.setLongClickable(false);
        webView.setHapticFeedbackEnabled(false);
        webView.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                hideLoading();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
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
                    if ("127.0.0.1".equals(host) || "localhost".equals(host)) {
                        return false;
                    }
                }

                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this,
                            "Не удалось открыть ссылку", Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
                    Toast.makeText(MainActivity.this,
                            "Сервер недоступен, перезапуск…",
                            Toast.LENGTH_SHORT).show();
                    startServerService();
                    view.postDelayed(() -> view.loadUrl(LOCAL_URL), 1500);
                }
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
        });

        webView.setWebChromeClient(new WebChromeClient() {

            @Override
            public boolean onJsAlert(WebView view, String url, String message,
                                     JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message,
                                       JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message,
                                      String defaultValue, JsPromptResult result) {
                final android.widget.EditText input = new android.widget.EditText(MainActivity.this);
                if (defaultValue != null) input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setView(input)
                        .setPositiveButton(android.R.string.ok,
                                (d, w) -> result.confirm(input.getText().toString()))
                        .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView webView,
                                             ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this,
                            "Не удалось открыть выбор файлов: " + e.getMessage(),
                            Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition,
                                     mimetype, contentLength) -> {
            if (url == null) return;
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                Toast.makeText(MainActivity.this,
                        "Файл уже в файловой системе устройства",
                        Toast.LENGTH_LONG).show();
                return;
            }
            if (url.startsWith("http://") || url.startsWith("https://")) {
                try {
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                    String fileName = android.webkit.URLUtil.guessFileName(
                            url, contentDisposition, mimetype);
                    req.setDestinationInExternalPublicDir(
                            Environment.DIRECTORY_DOWNLOADS, fileName);
                    req.setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    DownloadManager dm = (DownloadManager)
                            getSystemService(DOWNLOAD_SERVICE);
                    if (dm != null) dm.enqueue(req);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this,
                            "Ошибка загрузки: " + e.getMessage(),
                            Toast.LENGTH_LONG).show();
                }
            }
        });
    }
}