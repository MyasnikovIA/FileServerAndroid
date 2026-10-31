package ru.miacomsoft.fileserver;

import android.util.Log;

import org.bouncycastle.jce.provider.BouncyCastleProvider;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.Security;

public final class SslHelper {
    private static final String TAG = "SslHelper";

    public static SSLContext createFromPkcs12(Path keystorePath, String password) throws Exception {
        if (keystorePath == null || !Files.isRegularFile(keystorePath)) {
            throw new IllegalArgumentException("Keystore not found: " + keystorePath);
        }

        char[] pwd = (password == null) ? new char[0] : password.toCharArray();

        // Явно создаем экземпляр BouncyCastle и используем его для KeyStore
        BouncyCastleProvider bcProvider = new BouncyCastleProvider();

        // ВАЖНО: используем BC в качестве второго аргумента, чтобы Android
        // не использовал свой встроенный урезанный провайдер
        KeyStore keyStore = KeyStore.getInstance("PKCS12", bcProvider);

        try (InputStream is = Files.newInputStream(keystorePath)) {
            keyStore.load(is, pwd);
        }

        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(keyStore, pwd);

        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(kmf.getKeyManagers(), null, null);

        Log.i(TAG, "SSLContext created from " + keystorePath + " (using full BouncyCastle)");
        return ctx;
    }
}