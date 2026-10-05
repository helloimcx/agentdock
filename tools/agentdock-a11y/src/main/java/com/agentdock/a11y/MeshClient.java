package com.agentdock.a11y;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Socket;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

public class MeshClient {
    private static final String TAG = "AgentDockMeshClient";
    private static volatile MeshClient instance;

    public interface StatusListener {
        void onStatusChanged(String status, String details);
    }

    private final Context context;
    private final MeshPreferences preferences;
    private final CommandDispatcher dispatcher;
    private final ExecutorService workerPool = Executors.newCachedThreadPool();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    private Socket socket;
    private OutputStream socketOut;
    private InputStream socketIn;
    private final AtomicBoolean stopped = new AtomicBoolean(true);
    private final ConcurrentHashMap<String, Thread> activeTasks = new ConcurrentHashMap<>();
    private StatusListener statusListener;
    private ScheduledFuture<?> heartbeatTask;
    private ScheduledFuture<?> reconnectTask;
    private long lastSeen = 0;
    private int retryCount = 0;
    private String currentStatus = "DISCONNECTED";

    public static synchronized MeshClient getInstance(Context context) {
        if (instance == null) {
            instance = new MeshClient(context.getApplicationContext());
        }
        return instance;
    }

    private MeshClient(Context context) {
        this.context = context;
        this.preferences = new MeshPreferences(context);
        this.dispatcher = new CommandDispatcher(context);
    }

    public void setStatusListener(StatusListener listener) {
        this.statusListener = listener;
        if (listener != null) {
            listener.onStatusChanged(currentStatus, preferences.getNodeId());
        }
    }

    public synchronized String getStatus() {
        return currentStatus;
    }

    private void updateStatus(String status, String details) {
        currentStatus = status;
        Log.i(TAG, "Mesh status: " + status + " (" + details + ")");
        if (statusListener != null) {
            statusListener.onStatusChanged(status, details);
        }
    }

    public static JSONObject enroll(String serverUrl, String pairingToken) throws Exception {
        String base = serverUrl.replaceAll("/+$", "");
        if (!base.endsWith("/api/local/v1")) {
            base += "/api/local/v1";
        }
        URL url = new URL(base + "/mesh/enroll");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(10000);
        conn.setDoOutput(true);

        JSONObject req = new JSONObject();
        req.put("pairingToken", pairingToken.trim());
        try (OutputStream os = conn.getOutputStream()) {
            os.write(req.toString().getBytes(StandardCharsets.UTF_8));
        }

        int code = conn.getResponseCode();
        InputStream is = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[1024];
        int len;
        while ((len = is.read(buf)) != -1) baos.write(buf, 0, len);
        String respStr = baos.toString(StandardCharsets.UTF_8.name());

        JSONObject envelope = new JSONObject(respStr);
        if (!envelope.optBoolean("ok", false)) {
            throw new Exception(envelope.optString("error", "Enrollment failed: HTTP " + code));
        }
        return envelope.getJSONObject("data");
    }

    public synchronized void start() {
        if (!preferences.isConfigured()) {
            updateStatus("NOT_CONFIGURED", "No mesh server configured");
            return;
        }
        if (!stopped.get()) return;
        stopped.set(false);
        retryCount = 0;
        workerPool.execute(this::connectLoop);
    }

    public synchronized void stop() {
        stopped.set(true);
        if (heartbeatTask != null) heartbeatTask.cancel(true);
        if (reconnectTask != null) reconnectTask.cancel(true);
        closeSocket();
        abortAll();
        updateStatus("STOPPED", "Client stopped");
    }

    private synchronized void closeSocket() {
        try {
            if (socketOut != null) socketOut.close();
            if (socketIn != null) socketIn.close();
            if (socket != null && !socket.isClosed()) socket.close();
        } catch (Throwable ignored) {}
        socketOut = null;
        socketIn = null;
        socket = null;
    }

    private void abortAll() {
        for (Thread thread : activeTasks.values()) {
            try { thread.interrupt(); } catch (Throwable ignored) {}
        }
        activeTasks.clear();
    }

    private void connectLoop() {
        if (stopped.get()) return;
        updateStatus("CONNECTING", preferences.getServerUrl());

        try {
            String serverUrl = preferences.getServerUrl().replaceAll("/+$", "");
            URI uri = URI.create(serverUrl);
            boolean isSsl = "https".equalsIgnoreCase(uri.getScheme()) || "wss".equalsIgnoreCase(uri.getScheme());
            String host = uri.getHost();
            int port = uri.getPort();
            if (port <= 0) port = isSsl ? 443 : 80;

            String path = uri.getPath();
            if (path == null || path.isEmpty()) path = "";
            if (!path.endsWith("/api/local/v1")) path += "/api/local/v1";
            path += "/mesh/connect";

            if (isSsl) {
                socket = SSLSocketFactory.getDefault().createSocket(host, port);
                if (socket instanceof SSLSocket) {
                    SSLSocket sslSocket = (SSLSocket) socket;
                    javax.net.ssl.SSLParameters params = sslSocket.getSSLParameters();
                    params.setEndpointIdentificationAlgorithm("HTTPS");
                    sslSocket.setSSLParameters(params);
                }
            } else {
                socket = new Socket(host, port);
            }
            socket.setSoTimeout(0);
            socket.setTcpNoDelay(true);

            socketOut = socket.getOutputStream();
            socketIn = socket.getInputStream();

            byte[] nonce = new byte[16];
            new SecureRandom().nextBytes(nonce);
            String secKey = Base64.encodeToString(nonce, Base64.NO_WRAP);

            String request = "GET " + path + " HTTP/1.1\r\n" +
                "Host: " + host + ":" + port + "\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Key: " + secKey + "\r\n" +
                "Sec-WebSocket-Version: 13\r\n\r\n";

            socketOut.write(request.getBytes(StandardCharsets.US_ASCII));
            socketOut.flush();

            String statusLine = readHttpHeaderLine(socketIn);
            if (statusLine == null || !statusLine.contains("101")) {
                throw new Exception("Handshake failed: " + statusLine);
            }
            while (true) {
                String header = readHttpHeaderLine(socketIn);
                if (header == null || header.isEmpty()) break;
            }

            JSONObject hello = new JSONObject();
            hello.put("version", 1);
            hello.put("type", "hello");
            hello.put("token", preferences.getToken());
            hello.put("platform", "android");
            JSONArray caps = new JSONArray();
            caps.put("filesystem.list");
            caps.put("filesystem.read");
            caps.put("filesystem.write");
            caps.put("shell.exec");
            hello.put("capabilities", caps);

            sendFrame(hello.toString());
            lastSeen = System.currentTimeMillis();

            if (heartbeatTask != null) heartbeatTask.cancel(true);
            heartbeatTask = scheduler.scheduleAtFixedRate(() -> {
                if (stopped.get()) return;
                try {
                    if (System.currentTimeMillis() - lastSeen > 45000) {
                        Log.w(TAG, "Heartbeat timeout (>45s), disconnecting");
                        closeSocket();
                    } else {
                        JSONObject hb = new JSONObject();
                        hb.put("version", 1);
                        hb.put("type", "heartbeat");
                        sendFrame(hb.toString());
                    }
                } catch (Throwable t) {
                    closeSocket();
                }
            }, 10, 10, TimeUnit.SECONDS);

            while (!stopped.get() && socket != null && !socket.isClosed()) {
                String message = readFrame(socketIn);
                if (message == null) break;
                lastSeen = System.currentTimeMillis();
                handleServerMessage(message);
            }
        } catch (Throwable t) {
            Log.w(TAG, "Mesh connection error: " + t.getMessage());
        } finally {
            closeSocket();
            abortAll();
            if (heartbeatTask != null) heartbeatTask.cancel(true);
        }

        if (!stopped.get()) {
            long delay = Math.min(30000, 1000L * (1L << Math.min(retryCount++, 5)));
            updateStatus("RECONNECTING", "Retry in " + (delay / 1000) + "s");
            reconnectTask = scheduler.schedule(this::connectLoop, delay, TimeUnit.MILLISECONDS);
        } else {
            updateStatus("DISCONNECTED", "Disconnected");
        }
    }

    private void handleServerMessage(String raw) {
        try {
            JSONObject msg = new JSONObject(raw);
            String type = msg.optString("type");

            if ("welcome".equals(type)) {
                retryCount = 0;
                String nodeId = msg.optString("nodeId", preferences.getNodeId());
                updateStatus("CONNECTED", nodeId);
                return;
            }

            if ("heartbeat".equals(type)) return;

            if ("cancel".equals(type)) {
                String reqId = msg.optString("requestId");
                Thread t = activeTasks.remove(reqId);
                if (t != null) t.interrupt();
                return;
            }

            if ("execute".equals(type)) {
                JSONObject request = msg.getJSONObject("request");
                String id = request.optString("id");
                workerPool.execute(() -> executeRequest(id, request));
            }
        } catch (Throwable t) {
            Log.e(TAG, "Error handling message: " + t.getMessage());
        }
    }

    private void executeRequest(String id, JSONObject request) {
        Thread current = Thread.currentThread();
        activeTasks.put(id, current);
        try {
            JSONObject result = dispatcher.dispatch(request);
            JSONObject resMsg = new JSONObject();
            resMsg.put("version", 1);
            resMsg.put("type", "result");
            resMsg.put("requestId", id);
            resMsg.put("ok", true);
            resMsg.put("result", result);
            sendFrame(resMsg.toString());
        } catch (Throwable t) {
            try {
                JSONObject err = new JSONObject();
                err.put("version", 1);
                err.put("type", "result");
                err.put("requestId", id);
                err.put("ok", false);
                err.put("error", String.valueOf(t.getMessage()));
                sendFrame(err.toString());
            } catch (Throwable ignored) {}
        } finally {
            activeTasks.remove(id);
        }
    }

    private synchronized void sendFrame(String text) throws Exception {
        if (socketOut == null) throw new Exception("Socket not connected");
        byte[] payload = text.getBytes(StandardCharsets.UTF_8);
        int len = payload.length;
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        baos.write(0x81); // FIN + text opcode 1

        byte[] mask = new byte[4];
        new Random().nextBytes(mask);

        if (len <= 125) {
            baos.write(0x80 | len);
        } else if (len <= 65535) {
            baos.write(0x80 | 126);
            baos.write((len >> 8) & 0xFF);
            baos.write(len & 0xFF);
        } else {
            baos.write(0x80 | 127);
            for (int i = 7; i >= 0; i--) {
                baos.write((int) ((len >> (i * 8)) & 0xFF));
            }
        }

        baos.write(mask, 0, 4);
        for (int i = 0; i < len; i++) {
            baos.write(payload[i] ^ mask[i % 4]);
        }
        socketOut.write(baos.toByteArray());
        socketOut.flush();
    }

    private String readFrame(InputStream in) throws Exception {
        int b0 = in.read();
        if (b0 == -1) return null;
        int opcode = b0 & 0x0F;

        int b1 = in.read();
        if (b1 == -1) return null;
        boolean masked = (b1 & 0x80) != 0;
        long payloadLen = b1 & 0x7F;

        if (payloadLen == 126) {
            int h = in.read();
            int l = in.read();
            if (h == -1 || l == -1) return null;
            payloadLen = ((h & 0xFF) << 8) | (l & 0xFF);
        } else if (payloadLen == 127) {
            payloadLen = 0;
            for (int i = 0; i < 8; i++) {
                int b = in.read();
                if (b == -1) return null;
                payloadLen = (payloadLen << 8) | (b & 0xFF);
            }
        }

        byte[] mask = null;
        if (masked) {
            mask = new byte[4];
            readFully(in, mask, 4);
        }

        byte[] data = new byte[(int) payloadLen];
        readFully(in, data, (int) payloadLen);

        if (masked && mask != null) {
            for (int i = 0; i < data.length; i++) {
                data[i] ^= mask[i % 4];
            }
        }

        if (opcode == 8) { // CLOSE
            return null;
        } else if (opcode == 9) { // PING
            sendPong(data);
            return readFrame(in);
        } else if (opcode == 10) { // PONG
            return readFrame(in);
        }

        return new String(data, StandardCharsets.UTF_8);
    }

    private synchronized void sendPong(byte[] payload) {
        try {
            if (socketOut == null) return;
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            baos.write(0x8A); // FIN + PONG (10)
            int len = payload != null ? payload.length : 0;
            byte[] mask = new byte[4];
            new Random().nextBytes(mask);
            baos.write(0x80 | len);
            baos.write(mask);
            for (int i = 0; i < len; i++) {
                baos.write(payload[i] ^ mask[i % 4]);
            }
            socketOut.write(baos.toByteArray());
            socketOut.flush();
        } catch (Throwable ignored) {}
    }

    private static void readFully(InputStream in, byte[] buf, int len) throws Exception {
        int read = 0;
        while (read < len) {
            int n = in.read(buf, read, len - read);
            if (n == -1) throw new Exception("Unexpected EOF in WebSocket frame");
            read += n;
        }
    }

    private static String readHttpHeaderLine(InputStream in) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        int prev = -1;
        int curr;
        while ((curr = in.read()) != -1) {
            if (prev == '\r' && curr == '\n') {
                byte[] bytes = baos.toByteArray();
                return new String(bytes, 0, bytes.length - 1, StandardCharsets.US_ASCII);
            }
            baos.write(curr);
            prev = curr;
        }
        return null;
    }
}
