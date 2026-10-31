package ru.miacomsoft.fileserver;

import android.util.Log;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

/**
 * Утилита для создания SSLContext из файла .p12 (PKCS12).
 * Используется FileServerAndroid-ом для HTTPS-режима.
 */
public final class SslHelper {

    private static final String TAG = "SslHelper";

    private SslHelper() {}

    /**
     * Создаёт SSLContext из PKCS12-файла (обычно keystore.p12).
     *
     * @param keystorePath путь к файлу .p12
     * @param password     пароль хранилища (может быть пустым)
     * @return готовый SSLContext
     * @throws Exception если файл не существует, пароль неверен или
     *                   не удалось инициализировать KeyManagerFactory
     */
    public static SSLContext createFromPkcs12(Path keystorePath, String password)
            throws Exception {

        if (keystorePath == null) {
            throw new IllegalArgumentException("keystorePath is null");
        }
        if (!Files.isRegularFile(keystorePath)) {
            throw new IllegalArgumentException("Keystore not found: " + keystorePath);
        }

        char[] pwd = (password == null) ? new char[0] : password.toCharArray();

        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        try (InputStream is = Files.newInputStream(keystorePath)) {
            keyStore.load(is, pwd);
        }

        KeyManagerFactory kmf = KeyManagerFactory.getInstance(
                KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(keyStore, pwd);

        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(kmf.getKeyManagers(), null, null);

        Log.i(TAG, "SSLContext created from " + keystorePath);
        return ctx;
    }
}