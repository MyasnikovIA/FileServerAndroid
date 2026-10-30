package ru.miacomsoft.fileserver;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Intent;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

public class BrowserActivity extends AppCompatActivity {

    private static final String TAG = "BrowserActivity";

    public static final String EXTRA_URL   = "url";
    public static final String EXTRA_TITLE = "title";

    private static final int REQ_FILE_CHOOSER = 2001;

    private WebView     webView;
    private EditText    addressBar;
    private ProgressBar progressBar;
    private Button      backBtn, fwdBtn, reloadBtn, goBtn;

    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String startUrl = getIntent().getStringExtra(EXTRA_URL);
        String title    = getIntent().getStringExtra(EXTRA_TITLE);
        if (startUrl == null || startUrl.isEmpty()) startUrl = "https://www.google.com";
        if (title != null && !title.isEmpty()) setTitle(title);

        setContentView(R.layout.activity_browser);

        webView     = findViewById(R.id.brWebView);
        addressBar  = findViewById(R.id.brAddress);
        progressBar = findViewById(R.id.brProgress);
        backBtn     = findViewById(R.id.brBack);
        fwdBtn      = findViewById(R.id.brFwd);
        reloadBtn   = findViewById(R.id.brReload);
        goBtn       = findViewById(R.id.brGo);

        setupWebView();
        bindButtons();

        webView.loadUrl(normalizeUrl(startUrl));
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
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        s.setUserAgentString(
                "Mozilla/5.0 (Linux; Android 10; K) " +
                        "AppleWebKit/537.36 (KHTML, like Gecko) " +
                        "Chrome/120.0.0.0 Mobile Safari/537.36");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Игнорируем ошибки SSL (например, самоподписанные сертификаты на порту 8080)
                Log.w(TAG, "SSL error: " + error.toString() + " — proceeding anyway.");
                handler.proceed();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                if (scheme.equals("http") || scheme.equals("https")
                        || scheme.equals("file") || scheme.equals("about")
                        || scheme.equals("data") || scheme.equals("blob")
                        || scheme.equals("content")) {
                    return false;
                }
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (Exception e) {
                    Log.w(TAG, "external scheme failed: " + uri, e);
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                addressBar.setText(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                addressBar.setText(url);
                updateNavButtons();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                try { request.grant(request.getResources()); }
                catch (Exception e) { request.deny(); }
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(
                    String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            @Override
            public boolean onShowFileChooser(WebView webView,
                                             ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog,
                                          boolean isUserGesture, Message resultMsg) {
                WebView temp = new WebView(BrowserActivity.this);
                temp.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                        webView.loadUrl(req.getUrl().toString());
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(temp);
                resultMsg.sendToTarget();
                return true;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null) return;
            if (url.startsWith("data:") || url.startsWith("blob:")) {
                Toast.makeText(this, "Файл уже загружен", Toast.LENGTH_SHORT).show();
                return;
            }
            try {
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                String fn = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fn);
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null && !cookie.isEmpty()) {
                    req.addRequestHeader("Cookie", cookie);
                }
                DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                if (dm != null) dm.enqueue(req);
            } catch (Exception e) {
                Toast.makeText(this, "Ошибка загрузки: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    private void bindButtons() {
        backBtn.setOnClickListener(v -> { if (webView.canGoBack()) webView.goBack(); });
        fwdBtn.setOnClickListener(v -> { if (webView.canGoForward()) webView.goForward(); });
        reloadBtn.setOnClickListener(v -> webView.reload());

        goBtn.setOnClickListener(v -> {
            String input = addressBar.getText().toString().trim();
            if (input.isEmpty()) return;
            webView.loadUrl(normalizeUrl(input));
        });

        addressBar.setOnEditorActionListener((v, actionId, event) -> {
            if (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER) {
                goBtn.performClick();
                return true;
            }
            return false;
        });

        updateNavButtons();
    }

    private String normalizeUrl(String input) {
        input = input.trim();
        if (input.matches("^[a-z][a-z0-9+.-]*:.*")) return input;
        if (input.startsWith("//")) return "https:" + input;

        if (input.matches("^[^\\s/]+\\.[^\\s/]+.*") && !input.contains(" ")) {
            // Если указан порт или локальный IP — используем http://
            if (input.matches("^[^\\s/]+:\\d+.*") || input.matches("^(\\d{1,3}\\.){3}\\d{1,3}.*")) {
                return "http://" + input;
            }
            return "https://" + input;
        }
        return "https://www.google.com/search?q=" + Uri.encode(input);
    }

    private void updateNavButtons() {
        backBtn.setEnabled(webView.canGoBack());
        fwdBtn.setEnabled(webView.canGoForward());
        backBtn.setAlpha(webView.canGoBack() ? 1f : 0.4f);
        fwdBtn.setAlpha(webView.canGoForward() ? 1f : 0.4f);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
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

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            try {
                webView.loadUrl("about:blank");
                webView.stopLoading();
                webView.destroy();
            } catch (Exception e) {
                Log.w(TAG, "webView.destroy", e);
            }
            webView = null;
        }
        super.onDestroy();
    }
}