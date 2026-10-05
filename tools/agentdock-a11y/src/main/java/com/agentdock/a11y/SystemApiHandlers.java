package com.agentdock.a11y;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.camera2.CameraManager;
import android.location.Location;
import android.location.LocationManager;
import android.media.AudioManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.Locale;

public class SystemApiHandlers {
    private static volatile TextToSpeech ttsInstance;
    private static volatile boolean ttsReady = false;

    public static synchronized void initTts(Context context) {
        if (ttsInstance == null) {
            ttsInstance = new TextToSpeech(context.getApplicationContext(), status -> {
                if (status == TextToSpeech.SUCCESS) {
                    ttsReady = true;
                    ttsInstance.setLanguage(Locale.CHINESE);
                }
            });
        }
    }

    public static synchronized void ttsSpeak(Context context, String text) {
        initTts(context);
        if (ttsInstance != null && text != null && !text.isEmpty()) {
            ttsInstance.speak(text, TextToSpeech.QUEUE_FLUSH, null, "agentdock_tts");
        }
    }

    public static JSONObject getBatteryStatus(Context context) {
        JSONObject res = new JSONObject();
        try {
            Intent intent = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (intent == null) {
                res.put("status", "UNKNOWN");
                return res;
            }

            int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            int percent = (scale > 0 && level >= 0) ? (int) ((level / (float) scale) * 100) : 0;
            int statusInt = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            int pluggedInt = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1);
            int healthInt = intent.getIntExtra(BatteryManager.EXTRA_HEALTH, -1);
            int temp = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1);

            String status = "UNKNOWN";
            if (statusInt == BatteryManager.BATTERY_STATUS_CHARGING) status = "CHARGING";
            else if (statusInt == BatteryManager.BATTERY_STATUS_DISCHARGING) status = "DISCHARGING";
            else if (statusInt == BatteryManager.BATTERY_STATUS_FULL) status = "FULL";
            else if (statusInt == BatteryManager.BATTERY_STATUS_NOT_CHARGING) status = "NOT_CHARGING";

            String plugged = "UNPLUGGED";
            if (pluggedInt == BatteryManager.BATTERY_PLUGGED_AC) plugged = "AC";
            else if (pluggedInt == BatteryManager.BATTERY_PLUGGED_USB) plugged = "USB";
            else if (pluggedInt == BatteryManager.BATTERY_PLUGGED_WIRELESS) plugged = "WIRELESS";

            String health = "GOOD";
            if (healthInt == BatteryManager.BATTERY_HEALTH_OVERHEAT) health = "OVERHEAT";
            else if (healthInt == BatteryManager.BATTERY_HEALTH_DEAD) health = "DEAD";
            else if (healthInt == BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE) health = "OVER_VOLTAGE";
            else if (healthInt == BatteryManager.BATTERY_HEALTH_COLD) health = "COLD";

            res.put("percentage", percent);
            res.put("status", status);
            res.put("plugged", plugged);
            res.put("health", health);
            res.put("temperature", temp > 0 ? (temp / 10.0) : 0.0);
        } catch (Exception ignored) {}
        return res;
    }

    public static String getClipboard(Context context) {
        try {
            ClipboardManager cm = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null && cm.hasPrimaryClip()) {
                ClipData data = cm.getPrimaryClip();
                if (data != null && data.getItemCount() > 0) {
                    CharSequence text = data.getItemAt(0).getText();
                    return text != null ? text.toString() : "";
                }
            }
        } catch (Exception ignored) {}
        return "";
    }

    public static void setClipboard(Context context, String text) {
        try {
            ClipboardManager cm = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                ClipData clip = ClipData.newPlainText("agentdock", text != null ? text : "");
                cm.setPrimaryClip(clip);
            }
        } catch (Exception ignored) {}
    }

    public static void vibrate(Context context, long durationMs) {
        try {
            Vibrator v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(durationMs > 0 ? durationMs : 200, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(durationMs > 0 ? durationMs : 200);
                }
            }
        } catch (Exception ignored) {}
    }

    public static void setTorch(Context context, boolean enabled) {
        try {
            CameraManager cm = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
            if (cm != null) {
                String[] ids = cm.getCameraIdList();
                if (ids.length > 0) {
                    cm.setTorchMode(ids[0], enabled);
                }
            }
        } catch (Exception ignored) {}
    }

    public static void showToast(Context context, String text) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                Toast.makeText(context.getApplicationContext(), text, Toast.LENGTH_SHORT).show();
            } catch (Exception ignored) {}
        });
    }

    public static JSONObject handleVolume(Context context, String streamName, Integer volumeLevel) {
        JSONObject res = new JSONObject();
        try {
            AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                int streamType = AudioManager.STREAM_MUSIC;
                if ("ring".equalsIgnoreCase(streamName) || "call".equalsIgnoreCase(streamName)) {
                    streamType = AudioManager.STREAM_RING;
                } else if ("notification".equalsIgnoreCase(streamName)) {
                    streamType = AudioManager.STREAM_NOTIFICATION;
                } else if ("alarm".equalsIgnoreCase(streamName)) {
                    streamType = AudioManager.STREAM_ALARM;
                }

                int max = am.getStreamMaxVolume(streamType);
                if (volumeLevel != null) {
                    int clamped = Math.max(0, Math.min(volumeLevel, max));
                    am.setStreamVolume(streamType, clamped, 0);
                }
                int current = am.getStreamVolume(streamType);
                res.put("stream", streamName != null ? streamName : "music");
                res.put("volume", current);
                res.put("max_volume", max);
            }
        } catch (Exception ignored) {}
        return res;
    }

    public static JSONObject getLocation(Context context) {
        JSONObject res = new JSONObject();
        try {
            LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            if (lm != null) {
                Location loc = null;
                try {
                    loc = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                } catch (SecurityException ignored) {}
                if (loc == null) {
                    try {
                        loc = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                    } catch (SecurityException ignored) {}
                }

                if (loc != null) {
                    res.put("latitude", loc.getLatitude());
                    res.put("longitude", loc.getLongitude());
                    res.put("altitude", loc.getAltitude());
                    res.put("accuracy", (double) loc.getAccuracy());
                    res.put("speed", (double) loc.getSpeed());
                    res.put("provider", loc.getProvider());
                    res.put("elapsedMs", System.currentTimeMillis() - loc.getTime());
                    return res;
                }
            }
            res.put("error", "No location fix available");
        } catch (Exception e) {
            try { res.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) {}
        }
        return res;
    }
}
