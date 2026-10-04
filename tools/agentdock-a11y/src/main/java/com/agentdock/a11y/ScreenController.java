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
    private AutomationOverlay overlay;
    private final Runnable expiry = this::expire;

    private void expire() {
        lease.expire();
        if (overlay != null) overlay.setOwners(lease.ownerCount());
        if (lease.nextExpiryMs() > 0) handler.postDelayed(expiry, lease.nextExpiryMs());
    }

    ScreenController(AccessibilityService service) {
        power = (PowerManager) service.getSystemService(Context.POWER_SERVICE);
        keyguard = (KeyguardManager) service.getSystemService(Context.KEYGUARD_SERVICE);
        windows = (WindowManager) service.getSystemService(Context.WINDOW_SERVICE);
        lease = new ScreenLease(SystemClock::elapsedRealtime, new ScreenLease.Hold() {
            public void install() {
                AutomationOverlay candidate = new AutomationOverlay(service);
                WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
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
        String owner = "manual";
        try {
            JSONObject request = new JSONObject(body.isEmpty() ? "{}" : body);
            if (post) {
                String action = request.optString("action");
                Object ownerValue = request.has("owner") ? request.get("owner") : "manual";
                if (!(ownerValue instanceof String) || ((String) ownerValue).trim().isEmpty() || ((String) ownerValue).length() > 256) {
                    return error("INVALID_OWNER", "owner must contain 1..256 characters.");
                }
                owner = (String) ownerValue;
                if ("acquire".equals(action) || "renew".equals(action)) {
                    Object value = request.has("durationSeconds") ? request.get("durationSeconds") : Integer.valueOf(120);
                    if (!(value instanceof Number)) return error("INVALID_DURATION", "durationSeconds must be an integer from 1 to 600.", owner);
                    double seconds = ((Number) value).doubleValue();
                    if (seconds < 1 || seconds > 600 || seconds != Math.rint(seconds) || Double.isNaN(seconds)) {
                        return error("INVALID_DURATION", "durationSeconds must be an integer from 1 to 600.", owner);
                    }
                    String blocked = requireUnlocked();
                    if (blocked != null) return error("USER_UNLOCK_REQUIRED", "Unlock the phone before continuing mobile automation.", owner);
                    if ("renew".equals(action)) {
                        if (!lease.renew(owner, (int) seconds)) return error("SCREEN_LEASE_EXPIRED", "Screen session ended; start a new run after unlocking the phone.", owner);
                    } else lease.acquire(owner, (int) seconds);
                    handler.removeCallbacks(expiry);
                    handler.postDelayed(expiry, lease.nextExpiryMs());
                    if (overlay != null) overlay.setOwners(lease.ownerCount());
                } else if ("status".equals(action)) {
                    // Read the named lease without creating or extending it.
                } else if ("release".equals(action)) {
                    lease.release(owner);
                    handler.removeCallbacks(expiry);
                    if (lease.nextExpiryMs() > 0) handler.postDelayed(expiry, lease.nextExpiryMs());
                    if (overlay != null) overlay.setOwners(lease.ownerCount());
                } else return error("INVALID_ACTION", "action must be acquire, renew or release.", owner);
            }
            return status(owner).toString();
        } catch (Exception e) {
            return error("SCREEN_CONTROL_FAILED", e.getMessage(), owner);
        }
    }

    JSONObject status() throws Exception { return status("manual"); }

    private JSONObject status(String owner) throws Exception {
        if (!ready()) release();
        lease.expire();
        JSONObject result = new JSONObject();
        result.put("ok", true);
        result.put("screenProtocol", 2);
        result.put("owner", owner);
        result.put("interactive", power != null && power.isInteractive());
        result.put("locked", keyguard == null || keyguard.isKeyguardLocked());
        result.put("remainingMs", lease.remainingMs());
        result.put("ownerRemainingMs", lease.remainingMs(owner));
        result.put("keepAwake", lease.remainingMs() > 0);
        result.put("ownerCount", lease.ownerCount());
        result.put("overlayVisible", overlay != null);
        return result;
    }

    void release() {
        handler.removeCallbacks(expiry);
        lease.releaseAll();
    }

    void showTarget(int x, int y, boolean semantic) {
        if (overlay != null) overlay.showTarget(x, y, semantic);
    }

    private String error(String code, String message) { return error(code, message, "manual"); }

    private String error(String code, String message, String owner) {
        try {
            JSONObject result = status(owner);
            result.put("ok", false);
            result.put("code", code);
            result.put("error", message == null ? code : message);
            return result.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"code\":\"SCREEN_CONTROL_FAILED\",\"error\":\"Screen control unavailable\"}";
        }
    }
}
