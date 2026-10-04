package com.agentdock.a11y;

public final class ScreenLeaseTest {
    private static long now;
    private static int installs;
    private static int removals;
    private static boolean failInstall;

    public static void main(String[] args) {
        ScreenLease lease = new ScreenLease(() -> now, new ScreenLease.Hold() {
            public void install() { if (failInstall) throw new IllegalStateException("overlay denied"); installs++; }
            public void remove() { removals++; }
        });
        lease.acquire(120);
        check(installs == 1 && lease.remainingMs() == 120000, "initial acquire");
        now = 100000;
        lease.acquire(120);
        check(installs == 1 && lease.remainingMs() == 120000, "renew one window");
        now = 120000;
        lease.expire();
        check(lease.remainingMs() == 100000 && removals == 0, "stale timeout must not release renewed lease");
        for (int duration : new int[] { 0, -1, 601 }) {
            try { lease.acquire(duration); throw new AssertionError("accepted invalid duration"); }
            catch (IllegalArgumentException expected) {}
        }
        check(lease.remainingMs() == 100000, "validation must leave lease unchanged");
        now = 220000;
        lease.expire();
        check(lease.remainingMs() == 0 && removals == 1, "expiry removes window");
        lease.release();
        check(removals == 1, "release is idempotent");
        lease.acquire(1);
        lease.release();
        check(removals == 2 && lease.remainingMs() == 0, "explicit release");
        failInstall = true;
        try { lease.acquire(120); throw new AssertionError("accepted failed install"); }
        catch (IllegalStateException expected) {}
        check(lease.remainingMs() == 0, "install failure does not create a hold");
        System.out.println("ScreenLease lifecycle checks passed");
    }

    private static void check(boolean condition, String label) {
        if (!condition) throw new AssertionError(label);
    }
}
