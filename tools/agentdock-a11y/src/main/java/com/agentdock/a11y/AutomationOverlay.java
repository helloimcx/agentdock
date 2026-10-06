package com.agentdock.a11y;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.SystemClock;
import android.view.View;

/** Visual feedback only: the window flag, not animation, keeps the display on. */
final class AutomationOverlay extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float density;
    private float targetX;
    private float targetY;
    private long targetAt;
    private boolean semanticTarget;
    private int owners = 1;
    private final Runnable frame = () -> { invalidate(); scheduleFrame(); };

    AutomationOverlay(Context context) {
        super(context);
        density = getResources().getDisplayMetrics().density;
        setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        setFocusable(false);
        setClickable(false);
    }

    void setOwners(int count) { owners = count; invalidate(); }

    void showTarget(int x, int y, boolean semantic) {
        targetX = x;
        targetY = y;
        semanticTarget = semantic;
        targetAt = SystemClock.elapsedRealtime();
        invalidate();
    }

    @Override protected void onAttachedToWindow() { super.onAttachedToWindow(); scheduleFrame(); }
    @Override protected void onDetachedFromWindow() { removeCallbacks(frame); super.onDetachedFromWindow(); }
    private void scheduleFrame() { if (isAttachedToWindow()) postDelayed(frame, 80); }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        long now = SystemClock.elapsedRealtime();
        int alpha = 95 + (int) (45 * (1 + Math.sin(now / 1100.0)));
        paint.setColor(Color.argb(alpha, 66, 255, 156));
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(2 * density);
        canvas.drawRoundRect(density, density, getWidth() - density, getHeight() - density, 12 * density, 12 * density, paint);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(Color.argb(210, 14, 29, 23));
        float left = Math.max(8 * density, getWidth() - 156 * density);
        canvas.drawRoundRect(left, 34 * density, getWidth() - 8 * density, 62 * density, 8 * density, 8 * density, paint);
        paint.setColor(Color.rgb(66, 255, 156));
        paint.setTextSize(11 * density);
        canvas.drawText("AgentDock active · " + owners, left + 9 * density, 52 * density, paint);
        long age = now - targetAt;
        if (targetAt > 0 && age < 650) {
            float progress = age / 650f;
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2 * density);
            paint.setColor(Color.argb((int) (230 * (1 - progress)), 66, 255, 156));
            canvas.drawCircle(targetX, targetY, (10 + 24 * progress) * density, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTextSize(10 * density);
            // Semantic ACTION_CLICK has a target, not a physical finger event.
            canvas.drawText(semanticTarget ? "Target" : "Tap queued", targetX + 12 * density, targetY - 12 * density, paint);
        }
    }
}
