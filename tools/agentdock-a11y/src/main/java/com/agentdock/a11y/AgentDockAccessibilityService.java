package com.agentdock.a11y;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class AgentDockAccessibilityService extends AccessibilityService {
    private static final String TAG = "AgentDockA11y";
    public static AgentDockAccessibilityService instance = null;

    private String lastPackage = "";
    private String lastActivity = "";
    private PowerManager.WakeLock wakeLock = null;

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        startForegroundNotification();
        acquireWakeLock();
        HttpServerBridge.start(this);
        Log.i(TAG, "AgentDock Accessibility Service Connected (Foreground + WakeLock)");
    }

    @Override
    public void onDestroy() {
        HttpServerBridge.stop();
        releaseWakeLock();
        try { stopForeground(true); } catch (Throwable ignored) {}
        instance = null;
        super.onDestroy();
        Log.i(TAG, "AgentDock Accessibility Service Destroyed");
    }

    private void startForegroundNotification() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            String channelId = "agentdock_a11y_channel";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                    channelId,
                    "AgentDock A11y Service",
                    NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("AgentDock Local Accessibility Bridge Daemon");
                if (nm != null) nm.createNotificationChannel(channel);
            }

            Intent appIntent = new Intent(this, MainActivity.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pi = PendingIntent.getActivity(this, 0, appIntent, flags);

            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ?
                new Notification.Builder(this, channelId) : new Notification.Builder(this);

            Notification notification = builder
                .setContentTitle("AgentDock A11y Bridge")
                .setContentText("Local bridge active on 127.0.0.1:19832")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();

            startForeground(19832, notification);
        } catch (Throwable t) {
            Log.w(TAG, "Failed to start foreground notification: " + t.getMessage());
        }
    }

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "agentdock:a11y_bridge");
                wakeLock.acquire();
            }
        } catch (Throwable t) {
            Log.w(TAG, "Failed to acquire wake lock: " + t.getMessage());
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                wakeLock = null;
            }
        } catch (Throwable ignored) {}
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        CharSequence pkg = event.getPackageName();
        if (pkg != null) lastPackage = pkg.toString();
        CharSequence cls = event.getClassName();
        if (cls != null) lastActivity = cls.toString();
    }

    @Override
    public void onInterrupt() {
        Log.w(TAG, "AgentDock Accessibility Service Interrupted");
    }

    public static class NodeItem {
        public AccessibilityNodeInfo node;
        public int index;
        public String text = "";
        public String desc = "";
        public String id = "";
        public String className = "";
        public Rect bounds = new Rect();
        public boolean clickable;
        public boolean editable;
        public boolean scrollable;
    }

    public String handleStatus() {
        try {
            JSONObject res = new JSONObject();
            res.put("ok", true);
            res.put("version", "1.0.0");
            res.put("serviceEnabled", true);
            res.put("currentPackage", lastPackage);
            res.put("currentActivity", lastActivity);

            DisplayMetrics dm = getResources().getDisplayMetrics();
            res.put("screenWidth", dm.widthPixels);
            res.put("screenHeight", dm.heightPixels);
            return res.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + escapeJson(e.getMessage()) + "\"}";
        }
    }

    public String handleDump(boolean interactiveOnly) {
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) {
                return "{\"ok\":false,\"error\":\"No active window found (screen may be locked or off)\"}";
            }

            List<NodeItem> items = new ArrayList<>();
            collectNodes(root, items, interactiveOnly, 0);

            // Spatial Reading Order Line Bucketing
            int bucketSize = 40; // px
            Collections.sort(items, (a, b) -> {
                int bucketA = a.bounds.top / bucketSize;
                int bucketB = b.bounds.top / bucketSize;
                if (bucketA != bucketB) {
                    return Integer.compare(bucketA, bucketB);
                }
                return Integer.compare(a.bounds.left, b.bounds.left);
            });

            JSONObject rootObj = new JSONObject();
            rootObj.put("ok", true);
            rootObj.put("package", lastPackage);
            rootObj.put("activity", lastActivity);
            DisplayMetrics dm = getResources().getDisplayMetrics();
            rootObj.put("screenWidth", dm.widthPixels);
            rootObj.put("screenHeight", dm.heightPixels);
            rootObj.put("count", items.size());

            JSONArray array = new JSONArray();
            int idx = 1;
            for (NodeItem item : items) {
                item.index = idx++;
                JSONObject el = new JSONObject();
                el.put("index", item.index);
                el.put("text", item.text);
                if (!item.desc.isEmpty()) el.put("desc", item.desc);
                if (!item.id.isEmpty()) el.put("id", item.id);
                el.put("className", item.className);

                JSONArray boundsArr = new JSONArray();
                boundsArr.put(item.bounds.left);
                boundsArr.put(item.bounds.top);
                boundsArr.put(item.bounds.right);
                boundsArr.put(item.bounds.bottom);
                el.put("bounds", boundsArr);

                JSONArray centerArr = new JSONArray();
                centerArr.put(item.bounds.centerX());
                centerArr.put(item.bounds.centerY());
                el.put("center", centerArr);

                el.put("clickable", item.clickable);
                el.put("editable", item.editable);
                el.put("scrollable", item.scrollable);
                array.put(el);
            }
            rootObj.put("elements", array);
            return rootObj.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + escapeJson(e.getMessage()) + "\"}";
        }
    }

    private void collectNodes(AccessibilityNodeInfo node, List<NodeItem> out, boolean interactiveOnly, int depth) {
        if (node == null || depth > 20 || out.size() >= 400) return;
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);

        if (bounds.width() > 0 && bounds.height() > 0) {
            CharSequence textCs = node.getText();
            CharSequence descCs = node.getContentDescription();
            CharSequence idCs = node.getViewIdResourceName();
            CharSequence clsCs = node.getClassName();

            String text = textCs != null ? textCs.toString().trim() : "";
            String desc = descCs != null ? descCs.toString().trim() : "";
            String id = idCs != null ? idCs.toString().trim() : "";
            String cls = clsCs != null ? clsCs.toString().trim() : "";

            boolean clickable = node.isClickable();
            boolean editable = node.isEditable();
            boolean scrollable = node.isScrollable();

            boolean keep = !interactiveOnly || clickable || editable || scrollable || !text.isEmpty() || !desc.isEmpty();
            if (keep) {
                NodeItem item = new NodeItem();
                item.node = node;
                item.text = text;
                item.desc = desc;
                item.id = id;
                item.className = cls;
                item.bounds = bounds;
                item.clickable = clickable;
                item.editable = editable;
                item.scrollable = scrollable;
                out.add(item);
            }
        }

        int childCount = node.getChildCount();
        for (int i = 0; i < childCount; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectNodes(child, out, interactiveOnly, depth + 1);
            }
        }
    }

    public String handleClick(String body) {
        try {
            JSONObject json = new JSONObject(body.isEmpty() ? "{}" : body);
            if (json.has("point")) {
                JSONArray pt = json.getJSONArray("point");
                int x = pt.getInt(0);
                int y = pt.getInt(1);
                boolean success = dispatchTap(x, y);
                return "{\"ok\":" + success + ",\"method\":\"gesture_tap\",\"point\":[" + x + "," + y + "]}";
            }

            int targetIndex = json.optInt("index", -1);
            String targetText = json.optString("text", "");
            String targetId = json.optString("id", "");

            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return "{\"ok\":false,\"error\":\"No active window\"}";

            List<NodeItem> items = new ArrayList<>();
            collectNodes(root, items, false, 0);

            int bucketSize = 40;
            Collections.sort(items, (a, b) -> {
                int bucketA = a.bounds.top / bucketSize;
                int bucketB = b.bounds.top / bucketSize;
                if (bucketA != bucketB) return Integer.compare(bucketA, bucketB);
                return Integer.compare(a.bounds.left, b.bounds.left);
            });

            NodeItem matched = null;
            if (targetIndex > 0 && targetIndex <= items.size()) {
                matched = items.get(targetIndex - 1);
            } else if (!targetText.isEmpty()) {
                for (NodeItem item : items) {
                    if (item.text.contains(targetText) || item.desc.contains(targetText)) {
                        matched = item;
                        break;
                    }
                }
            } else if (!targetId.isEmpty()) {
                for (NodeItem item : items) {
                    if (item.id.contains(targetId)) {
                        matched = item;
                        break;
                    }
                }
            }

            if (matched == null) {
                return "{\"ok\":false,\"error\":\"Element not found matching target criteria\"}";
            }

            boolean performed = matched.node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            String method = "action_click";
            if (!performed) {
                // Dual-action fallback: dispatch physical tap gesture
                performed = dispatchTap(matched.bounds.centerX(), matched.bounds.centerY());
                method = "gesture_tap_fallback";
            }

            JSONObject res = new JSONObject();
            res.put("ok", performed);
            res.put("method", method);
            JSONObject targetObj = new JSONObject();
            if (targetIndex > 0) targetObj.put("index", targetIndex);
            if (!targetText.isEmpty()) targetObj.put("text", targetText);
            targetObj.put("bounds", "[" + matched.bounds.left + "," + matched.bounds.top + "," + matched.bounds.right + "," + matched.bounds.bottom + "]");
            res.put("target", targetObj);
            return res.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + escapeJson(e.getMessage()) + "\"}";
        }
    }

    public String handleInput(String body) {
        try {
            JSONObject json = new JSONObject(body.isEmpty() ? "{}" : body);
            String text = json.getString("text");
            int targetIndex = json.optInt("index", -1);
            boolean clear = json.optBoolean("clear", true);

            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return "{\"ok\":false,\"error\":\"No active window\"}";

            AccessibilityNodeInfo targetNode = null;
            if (targetIndex > 0) {
                List<NodeItem> items = new ArrayList<>();
                collectNodes(root, items, false, 0);
                int bucketSize = 40;
                Collections.sort(items, (a, b) -> {
                    int bucketA = a.bounds.top / bucketSize;
                    int bucketB = b.bounds.top / bucketSize;
                    if (bucketA != bucketB) return Integer.compare(bucketA, bucketB);
                    return Integer.compare(a.bounds.left, b.bounds.left);
                });
                if (targetIndex <= items.size()) {
                    targetNode = items.get(targetIndex - 1).node;
                }
            }

            if (targetNode == null) {
                targetNode = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            }

            if (targetNode == null) {
                return "{\"ok\":false,\"error\":\"No editable input element found\"}";
            }

            if (clear) {
                Bundle emptyArgs = new Bundle();
                emptyArgs.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "");
                targetNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, emptyArgs);
            }

            Bundle textArgs = new Bundle();
            textArgs.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
            boolean ok = targetNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, textArgs);

            JSONObject res = new JSONObject();
            res.put("ok", ok);
            res.put("inputText", text);
            if (targetIndex > 0) res.put("targetIndex", targetIndex);
            return res.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + escapeJson(e.getMessage()) + "\"}";
        }
    }

    public String handleScroll(String body) {
        try {
            JSONObject json = new JSONObject(body.isEmpty() ? "{}" : body);
            String direction = json.optString("direction", "down").toLowerCase();
            DisplayMetrics dm = getResources().getDisplayMetrics();
            int w = dm.widthPixels;
            int h = dm.heightPixels;

            int startX = w / 2;
            int endX = w / 2;
            int startY = h / 2;
            int endY = h / 2;

            if ("down".equals(direction)) {
                startY = (int) (h * 0.75);
                endY = (int) (h * 0.25);
            } else if ("up".equals(direction)) {
                startY = (int) (h * 0.25);
                endY = (int) (h * 0.75);
            } else if ("left".equals(direction)) {
                startX = (int) (w * 0.8);
                endX = (int) (w * 0.2);
            } else if ("right".equals(direction)) {
                startX = (int) (w * 0.2);
                endX = (int) (w * 0.8);
            }

            boolean ok = dispatchSwipe(startX, startY, endX, endY, 300);
            return "{\"ok\":" + ok + ",\"direction\":\"" + direction + "\"}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + escapeJson(e.getMessage()) + "\"}";
        }
    }

    public String handleAction(String body) {
        try {
            JSONObject json = new JSONObject(body.isEmpty() ? "{}" : body);
            String action = json.optString("action", "back").toLowerCase();
            boolean ok = false;
            if ("back".equals(action)) {
                ok = performGlobalAction(GLOBAL_ACTION_BACK);
            } else if ("home".equals(action)) {
                ok = performGlobalAction(GLOBAL_ACTION_HOME);
            } else if ("recents".equals(action)) {
                ok = performGlobalAction(GLOBAL_ACTION_RECENTS);
            }
            return "{\"ok\":" + ok + ",\"action\":\"" + action + "\"}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + escapeJson(e.getMessage()) + "\"}";
        }
    }

    private boolean dispatchTap(int x, int y) {
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription.StrokeDescription stroke = new GestureDescription.StrokeDescription(path, 0, 50);
        GestureDescription gesture = new GestureDescription.Builder().addStroke(stroke).build();
        return dispatchGesture(gesture, null, null);
    }

    private boolean dispatchSwipe(int startX, int startY, int endX, int endY, long durationMs) {
        Path path = new Path();
        path.moveTo(startX, startY);
        path.lineTo(endX, endY);
        GestureDescription.StrokeDescription stroke = new GestureDescription.StrokeDescription(path, 0, durationMs);
        GestureDescription gesture = new GestureDescription.Builder().addStroke(stroke).build();
        return dispatchGesture(gesture, null, null);
    }

    private String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
