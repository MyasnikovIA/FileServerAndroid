package ru.miacomsoft.fileserver;

// ============================================================
// SseConnection.java — один SSE-канал.
// ============================================================

import com.sun.net.httpserver.HttpExchange;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class SseConnection {

    private final OutputStream out;
    private final Object lock = new Object();

    public SseConnection(HttpExchange exchange) throws IOException {
        this.out = exchange.getResponseBody();
    }

    /**
     * Отправляет SSE-событие. Формат:
     *   event: <name>\n
     *   data: <line>\n
     *   data: <line>\n
     *   \n
     */
    public void send(String event, String data) throws IOException {
        if (data == null) data = "";
        StringBuilder sb = new StringBuilder();
        if (event != null && !event.isEmpty()) {
            sb.append("event: ").append(event).append('\n');
        }
        // Каждая строка — отдельный data:
        String[] lines = data.split("\n", -1);
        for (String line : lines) {
            sb.append("data: ").append(line).append('\n');
        }
        sb.append('\n');

        byte[] bytes = sb.toString().getBytes(StandardCharsets.UTF_8);
        synchronized (lock) {
            out.write(bytes);
            out.flush();
        }
    }

    public void close() {
        synchronized (lock) {
            try { out.close(); } catch (IOException ignored) {}
        }
    }
}