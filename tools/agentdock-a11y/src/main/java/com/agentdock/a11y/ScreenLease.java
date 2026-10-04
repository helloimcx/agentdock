package com.agentdock.a11y;

/** Ephemeral device-wide lease. All calls are serialized by the Android main thread. */
final class ScreenLease {
    interface Clock { long now(); }
    interface Hold { void install(); void remove(); }
    private final Clock clock;
    private final Hold hold;
    private long deadline;
    private boolean installed;

    ScreenLease(Clock clock, Hold hold) { this.clock = clock; this.hold = hold; }

    void acquire(int seconds) {
        if (seconds < 1 || seconds > 600) throw new IllegalArgumentException("durationSeconds must be 1..600");
        if (!installed) {
            hold.install();
            installed = true;
        }
        deadline = clock.now() + seconds * 1000L;
    }

    long remainingMs() { return installed ? Math.max(0, deadline - clock.now()) : 0; }

    void expire() { if (installed && remainingMs() == 0) release(); }

    void release() {
        if (!installed) return;
        hold.remove();
        installed = false;
        deadline = 0;
    }
}
