package com.agentdock.a11y;

import android.accessibilityservice.AccessibilityService;
import android.app.KeyguardManager;
import android.content.Context;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import org.json.JSONObject;

/** Android window effects and timer ownership remain in the accessibility service process. */
final class ScreenController {
    private final PowerManager power;
    private final KeyguardManager keyguard;
    private final WindowManager windows;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ScreenLease lease;
    private View overlay;
    private final Runnable expiry = this::expire;

    private void expire() {
        lease.expire();
        if (lease.remainingMs() > 0) handler.postDelayed(expiry, lease.remainingMs());
    }

    ScreenController(AccessibilityService service) {
        power = (PowerManager) service.getSystemService(Context.POWER_SERVICE);
        keyguard = (KeyguardManager) service.getSystemService(Context.KEYGUARD_SERVICE);
        windows = (WindowManager) service.getSystemService(Context.WINDOW_SERVICE);
        lease = new ScreenLease(SystemClock::elapsedRealtime, new ScreenLease.Hold() {
            public void install() {
                View candidate = new View(service);
                candidate.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                    1, 1, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                    PixelFormat.TRANSLUCENT);
                params.gravity = Gravity.TOP | Gravity.LEFT;
                // Keep window alpha at 1: fully hidden windows may not count as visible to power policy.
                try {
                    windows.addView(candidate, params);
                    overlay = candidate;
                } catch (RuntimeException error) {
                    try { windows.removeViewImmediate(candidate); }
                    catch (IllegalArgumentException ignored) { /* Not attached. */ }
                    throw error;
                }
            }
            public void remove() {
                if (overlay != null) {
                    try { windows.removeViewImmediate(overlay); }
                    catch (IllegalArgumentException ignored) { /* Already detached by the OS. */ }
                    overlay = null;
                }
            }
        });
    }

    boolean ready() { return power != null && power.isInteractive() && keyguard != null && !keyguard.isKeyguardLocked(); }

    String requireUnlocked() {
        if (ready()) return null;
        release();
        return error("USER_UNLOCK_REQUIRED", "Unlock the phone before continuing mobile automation.");
    }

    String handle(String body, boolean post) {
        try {
            JSONObject request = new JSONObject(body.isEmpty() ? "{}" : body);
            if (post) {
                String action = request.optString("action");
                if ("acquire".equals(action)) {
                    Object value = request.has("durationSeconds") ? request.get("durationSeconds") : Integer.valueOf(120);
                    if (!(value instanceof Number)) return error("INVALID_DURATION", "durationSeconds must be an integer from 1 to 600.");
                    double seconds = ((Number) value).doubleValue();
                    if (seconds < 1 || seconds > 600 || seconds != Math.rint(seconds) || Double.isNaN(seconds)) {
                        return error("INVALID_DURATION", "durationSeconds must be an integer from 1 to 600.");
                    }
                    String blocked = requireUnlocked();
                    if (blocked != null) return blocked;
                    lease.acquire((int) seconds);
                    handler.removeCallbacks(expiry);
                    handler.postDelayed(expiry, lease.remainingMs());
                } else if ("release".equals(action)) release();
                else return error("INVALID_ACTION", "action must be acquire or release.");
            }
            return status().toString();
        } catch (Exception e) {
            return error("SCREEN_CONTROL_FAILED", e.getMessage());
        }
    }

    JSONObject status() throws Exception {
        if (!ready()) release();
        lease.expire();
        JSONObject result = new JSONObject();
        result.put("ok", true);
        result.put("interactive", power != null && power.isInteractive());
        result.put("locked", keyguard == null || keyguard.isKeyguardLocked());
        result.put("remainingMs", lease.remainingMs());
        result.put("keepAwake", lease.remainingMs() > 0);
        return result;
    }

    void release() {
        handler.removeCallbacks(expiry);
        lease.release();
    }

    private String error(String code, String message) {
        try {
            JSONObject result = status();
            result.put("ok", false);
            result.put("code", code);
            result.put("error", message == null ? code : message);
            return result.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"code\":\"SCREEN_CONTROL_FAILED\",\"error\":\"Screen control unavailable\"}";
        }
    }
}
