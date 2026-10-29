package ru.miacomsoft.fileserver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class FileServerService extends Service {

    public static final String ACTION_START = "ru.miacomsoft.fileserver.START";
    public static final String ACTION_STOP  = "ru.miacomsoft.fileserver.STOP";

    private static final String TAG = "FileServerService";
    private static final String CHANNEL_ID = "file_server_channel";
    private static final int NOTIF_ID = 1001;

    public interface StateListener {
        void onStateChanged(boolean running, String url);
    }

    private static volatile StateListener sListener;
    private static volatile boolean sRunning = false;
    private static volatile String sLastUrl = "";

    /** Защита от двойного запуска (startServer может быть вызван дважды). */
    private final Object lock = new Object();
    private boolean isStarting = false;

    private FileServerAndroid server;
    private Thread serverThread;

    public static void setStateListener(StateListener l) {
        sListener = l;
        if (l != null) {
            l.onStateChanged(sRunning, sLastUrl);
        }
    }

    public static boolean isRunning() { return sRunning; }
    public static String getLastUrl() { return sLastUrl; }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_START.equals(action)) {
            startServer();
        } else if (ACTION_STOP.equals(action)) {
            stopServer();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    // ============================================================
    // Старт / стоп — защищено от двойного вызова
    // ============================================================

    private void startServer() {
        synchronized (lock) {
            if (sRunning || isStarting) {
                Log.i(TAG, "startServer ignored: running=" + sRunning + ", starting=" + isStarting);
                return;
            }
            isStarting = true;
        }

        startForeground(NOTIF_ID, buildNotification("FileServer работает"));

        serverThread = new Thread(() -> {
            FileServerAndroid srv = null;
            try {
                srv = new FileServerAndroid(this);
                srv.start();

                synchronized (lock) {
                    server = srv;
                    sRunning = true;
                    sLastUrl = srv.getListenUrl();
                    isStarting = false;
                }
                notifyState();
                Log.i(TAG, "Server started: " + sLastUrl);
            } catch (Exception e) {
                Log.e(TAG, "Server start failed", e);
                synchronized (lock) {
                    if (srv != null) {
                        try { srv.stop(); } catch (Exception ignored) {}
                    }
                    server = null;
                    sRunning = false;
                    sLastUrl = "";
                    isStarting = false;
                }
                notifyState();
                stopSelf();
            }
        }, "FileServerThread");
        serverThread.start();
    }

    private void stopServer() {
        FileServerAndroid srv;
        Thread t;
        synchronized (lock) {
            srv = server;
            t = serverThread;
            server = null;
            serverThread = null;
            sRunning = false;
            isStarting = false;
            sLastUrl = "";
        }
        if (srv != null) {
            try { srv.stop(); } catch (Exception e) { Log.w(TAG, "stop", e); }
        }
        if (t != null) {
            t.interrupt();
        }
        notifyState();
    }

    private void notifyState() {
        final StateListener l = sListener;
        if (l != null) {
            l.onStateChanged(sRunning, sLastUrl);
        }
        updateNotification();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        stopServer();
        super.onDestroy();
    }

    // ---------- Notification ----------

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "FileServer",
                    NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Сервер файлов");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification(String text) {
        Intent mainIntent = new Intent(this, MainActivity.class);
        mainIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                this, 0, mainIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stopIntent = new Intent(this, FileServerService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(
                this, 1, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("FileServer")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentIntent(pi)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel,
                        "Остановить", stopPi)
                .setOngoing(true)
                .build();
    }

    private void updateNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        String text = sRunning ? "Сервер работает: " + sLastUrl : "Сервер остановлен";
        nm.notify(NOTIF_ID, buildNotification(text));
    }
}