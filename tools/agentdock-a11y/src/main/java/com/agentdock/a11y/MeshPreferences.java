package com.agentdock.a11y;

import android.content.Context;
import android.content.SharedPreferences;

public class MeshPreferences {
    private static final String PREF_NAME = "agentdock_mesh_config";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_NODE_ID = "node_id";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_LABEL = "label";

    private final SharedPreferences prefs;

    public MeshPreferences(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
    }

    public synchronized String getServerUrl() {
        return prefs.getString(KEY_SERVER_URL, "");
    }

    public synchronized void setServerUrl(String url) {
        prefs.edit().putString(KEY_SERVER_URL, url != null ? url.trim() : "").apply();
    }

    public synchronized String getNodeId() {
        return prefs.getString(KEY_NODE_ID, "");
    }

    public synchronized String getToken() {
        return prefs.getString(KEY_TOKEN, "");
    }

    public synchronized String getLabel() {
        return prefs.getString(KEY_LABEL, "Android-Device");
    }

    public synchronized void setLabel(String label) {
        prefs.edit().putString(KEY_LABEL, label != null ? label.trim() : "Android-Device").apply();
    }

    public synchronized void saveCredentials(String serverUrl, String nodeId, String token) {
        prefs.edit()
            .putString(KEY_SERVER_URL, serverUrl != null ? serverUrl.trim() : "")
            .putString(KEY_NODE_ID, nodeId != null ? nodeId.trim() : "")
            .putString(KEY_TOKEN, token != null ? token.trim() : "")
            .apply();
    }

    public synchronized void clear() {
        prefs.edit().clear().apply();
    }

    public synchronized boolean isConfigured() {
        String server = getServerUrl();
        String token = getToken();
        String nodeId = getNodeId();
        return !server.isEmpty() && !token.isEmpty() && !nodeId.isEmpty();
    }
}
