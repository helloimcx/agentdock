package com.agentdock.a11y;

import java.util.HashMap;
import java.util.Map;

/** Owner-scoped leases share one window. Calls are serialized by the main thread. */
final class ScreenLease {
    interface Clock { long now(); }
    interface Hold { void install(); void remove(); }
    private final Clock clock;
    private final Hold hold;
    private final Map<String, Long> deadlines = new HashMap<>();

    ScreenLease(Clock clock, Hold hold) { this.clock = clock; this.hold = hold; }

    void acquire(String owner, int seconds) {
        validate(owner, seconds);
        expire();
        if (deadlines.isEmpty()) hold.install();
        deadlines.put(owner, clock.now() + seconds * 1000L);
    }

    boolean renew(String owner, int seconds) {
        validate(owner, seconds);
        expire();
        if (!deadlines.containsKey(owner)) return false;
        deadlines.put(owner, clock.now() + seconds * 1000L);
        return true;
    }

    long remainingMs(String owner) { return Math.max(0, deadlines.getOrDefault(owner, 0L) - clock.now()); }

    long remainingMs() {
        long remaining = 0;
        for (long deadline : deadlines.values()) remaining = Math.max(remaining, deadline - clock.now());
        return remaining;
    }

    long nextExpiryMs() {
        long next = Long.MAX_VALUE;
        for (long deadline : deadlines.values()) next = Math.min(next, deadline - clock.now());
        return next == Long.MAX_VALUE ? 0 : Math.max(1, next);
    }

    int ownerCount() { expire(); return deadlines.size(); }

    void expire() {
        boolean hadOwners = !deadlines.isEmpty();
        long now = clock.now();
        deadlines.values().removeIf(deadline -> deadline <= now);
        if (hadOwners && deadlines.isEmpty()) hold.remove();
    }

    void release(String owner) {
        expire();
        if (deadlines.remove(owner) != null && deadlines.isEmpty()) hold.remove();
    }

    void releaseAll() {
        if (deadlines.isEmpty()) return;
        deadlines.clear();
        hold.remove();
    }

    private static void validate(String owner, int seconds) {
        if (owner == null || owner.trim().isEmpty() || owner.length() > 256) throw new IllegalArgumentException("owner must contain 1..256 characters");
        if (seconds < 1 || seconds > 600) throw new IllegalArgumentException("durationSeconds must be 1..600");
    }
}
