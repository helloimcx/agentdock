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
        lease.acquire("manual", 120);
        check(installs == 1 && lease.remainingMs() == 120000, "initial acquire");
        now = 100000;
        lease.acquire("manual", 120);
        check(installs == 1 && lease.remainingMs() == 120000, "renew one window");
        now = 120000;
        lease.expire();
        check(lease.remainingMs() == 100000 && removals == 0, "stale timeout must not release renewed lease");
        for (int duration : new int[] { 0, -1, 601 }) {
            try { lease.acquire("manual", duration); throw new AssertionError("accepted invalid duration"); }
            catch (IllegalArgumentException expected) {}
        }
        check(lease.remainingMs() == 100000, "validation must leave lease unchanged");
        now = 220000;
        lease.expire();
        check(lease.remainingMs() == 0 && removals == 1, "expiry removes window");
        lease.release("manual");
        check(removals == 1, "release is idempotent");
        lease.acquire("manual", 1);
        lease.release("manual");
        check(removals == 2 && lease.remainingMs() == 0, "explicit release");
        lease.acquire("run:a", 120);
        lease.acquire("run:b", 60);
        check(lease.ownerCount() == 2, "owners share one overlay");
        lease.release("run:a");
        check(lease.ownerCount() == 1 && lease.remainingMs("run:b") == 60000, "release is owner scoped");
        now += 60000;
        check(!lease.renew("run:b", 120), "expired owner cannot be revived by heartbeat");
        check(!lease.renew("run:absent", 120), "unknown heartbeat does not acquire");
        lease.acquire("run:new", 120);
        lease.release("run:b");
        check(lease.ownerCount() == 1, "old release does not remove new owner");
        for (String invalid : new String[] { "", " ", null }) {
            try { lease.acquire(invalid, 120); throw new AssertionError("accepted invalid owner"); }
            catch (IllegalArgumentException expected) {}
        }
        lease.acquire("run:short", 1);
        now += 1000;
        lease.expire();
        check(lease.ownerCount() == 1 && lease.remainingMs("run:new") == 119000, "one expired owner leaves the other active");
        lease.releaseAll();
        check(lease.ownerCount() == 0, "manual lock removes all owners");
        check(!lease.renew("run:new", 120), "heartbeat cannot undo manual lock");
        failInstall = true;
        try { lease.acquire("manual", 120); throw new AssertionError("accepted failed install"); }
        catch (IllegalStateException expected) {}
        check(lease.remainingMs() == 0, "install failure does not create a hold");
        System.out.println("ScreenLease lifecycle checks passed");
    }

    private static void check(boolean condition, String label) {
        if (!condition) throw new AssertionError(label);
    }
}
