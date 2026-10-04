package com.agentdock.a11y;

import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class HttpServerBridge {
    private static final String TAG = "AgentDockHttpBridge";
    public static final int PORT = 19832;

    private static ServerSocket serverSocket;
    private static ExecutorService threadPool;
    private static volatile boolean isRunning = false;

    public static synchronized void start(AgentDockAccessibilityService service) {
        if (isRunning) return;
        try {
            serverSocket = new ServerSocket(PORT, 50, InetAddress.getByName("127.0.0.1"));
            threadPool = Executors.newCachedThreadPool();
            isRunning = true;
            Log.i(TAG, "Accessibility Bridge Daemon listening on 127.0.0.1:" + PORT);

            Thread acceptThread = new Thread(() -> {
                while (isRunning && serverSocket != null && !serverSocket.isClosed()) {
                    try {
                        Socket client = serverSocket.accept();
                        client.setSoTimeout(10000);
                        client.setTcpNoDelay(true);
                        threadPool.execute(() -> handleClient(client, service));
                    } catch (Throwable t) {
                        if (!isRunning) break;
                        Log.e(TAG, "Error in accept loop: " + t.getMessage());
                        try { Thread.sleep(50); } catch (InterruptedException ignored) {}
                    }
                }
            }, "agentdock-http-accept");
            acceptThread.setDaemon(true);
            acceptThread.start();
        } catch (Throwable t) {
            Log.e(TAG, "Failed to start HTTP server on 127.0.0.1:" + PORT, t);
        }
    }

    public static synchronized void stop() {
        isRunning = false;
        try {
            if (serverSocket != null) {
                serverSocket.close();
                serverSocket = null;
            }
            if (threadPool != null) {
                threadPool.shutdownNow();
                threadPool = null;
            }
            Log.i(TAG, "Accessibility Bridge Daemon stopped");
        } catch (Throwable t) {
            Log.e(TAG, "Error stopping server", t);
        }
    }

    private static void handleClient(Socket client, AgentDockAccessibilityService service) {
        long t0 = System.currentTimeMillis();
        String method = "";
        String path = "";
        int statusCode = 200;
        try (InputStream in = client.getInputStream();
             OutputStream out = client.getOutputStream()) {

            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[2048];
            int headerEnd = -1;

            while (headerEnd == -1) {
                int read = in.read(chunk);
                if (read == -1) break;
                buffer.write(chunk, 0, read);
                byte[] current = buffer.toByteArray();
                for (int i = 3; i < current.length; i++) {
                    if (current[i - 3] == '\r' && current[i - 2] == '\n' &&
                        current[i - 1] == '\r' && current[i] == '\n') {
                        headerEnd = i + 1;
                        break;
                    }
                }
            }

            if (headerEnd == -1) return;

            byte[] allBytes = buffer.toByteArray();
            String headerStr = new String(allBytes, 0, headerEnd, StandardCharsets.UTF_8);
            String[] headerLines = headerStr.split("\r\n");
            if (headerLines.length == 0) return;

            String[] reqParts = headerLines[0].split(" ");
            if (reqParts.length < 2) return;
            method = reqParts[0].toUpperCase();
            String uri = reqParts[1];

            int contentLength = 0;
            for (String h : headerLines) {
                if (h.toLowerCase().startsWith("content-length:")) {
                    try {
                        contentLength = Integer.parseInt(h.substring(15).trim());
                    } catch (Exception ignored) {}
                }
            }

            int bodyBytesAlreadyRead = allBytes.length - headerEnd;
            ByteArrayOutputStream bodyStream = new ByteArrayOutputStream();
            if (bodyBytesAlreadyRead > 0) {
                bodyStream.write(allBytes, headerEnd, Math.min(bodyBytesAlreadyRead, contentLength));
            }
            while (bodyStream.size() < contentLength) {
                int needed = contentLength - bodyStream.size();
                int read = in.read(chunk, 0, Math.min(chunk.length, needed));
                if (read == -1) break;
                bodyStream.write(chunk, 0, read);
            }

            String body = new String(bodyStream.toByteArray(), StandardCharsets.UTF_8);
            path = uri.contains("?") ? uri.substring(0, uri.indexOf('?')) : uri;

            String responseJson;

            if ("/health".equals(path) || "/api/health".equals(path)) {
                responseJson = "{\"ok\":true,\"version\":\"1.1.0\"}";
            } else if (("/api/screen".equals(path) && ("GET".equals(method) || "POST".equals(method)))
                    || "/api/status".equals(path) || "/status".equals(path)
                    || "/api/dump".equals(path) || "/dump".equals(path)
                    || ("POST".equals(method) && (
                        "/api/click".equals(path) || "/click".equals(path)
                        || "/api/input".equals(path) || "/input".equals(path)
                        || "/api/scroll".equals(path) || "/scroll".equals(path)
                        || "/api/action".equals(path) || "/action".equals(path)))) {
                responseJson = service.handleRequest(method, path, uri, body);
            } else {
                statusCode = 404;
                responseJson = "{\"ok\":false,\"error\":\"Not Found\"}";
            }

            byte[] jsonBytes = responseJson.getBytes(StandardCharsets.UTF_8);
            String responseHeader = "HTTP/1.1 " + statusCode + (statusCode == 200 ? " OK" : " Not Found") + "\r\n" +
                    "Content-Type: application/json; charset=utf-8\r\n" +
                    "Content-Length: " + jsonBytes.length + "\r\n" +
                    "Connection: close\r\n" +
                    "Access-Control-Allow-Origin: *\r\n\r\n";

            out.write(responseHeader.getBytes(StandardCharsets.UTF_8));
            out.write(jsonBytes);
            out.flush();

            Log.i(TAG, method + " " + path + " -> " + statusCode + " in " + (System.currentTimeMillis() - t0) + "ms");
        } catch (Throwable t) {
            Log.e(TAG, "Error handling " + method + " " + path + ": " + t.getMessage());
        } finally {
            try { client.close(); } catch (Throwable ignored) {}
        }
    }
}
