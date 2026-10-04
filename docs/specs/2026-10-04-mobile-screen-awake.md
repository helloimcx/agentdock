# Android automation screen keep-awake

Status: Approved by user on 2026-10-04; implementation baseline. Date: 2026-10-04 (Asia/Shanghai).

## Goal
Prevent idle screen-off during mobile UI automation after the user unlocks the phone once.

## Scope
Extend the existing Android accessibility bridge, mobile-ui client/CLI and Android remote-workspace instructions. Bring the necessary existing, currently untracked Android Java/resource/build sources into this worktree as an explicitly reviewed prerequisite; do not copy APK, keystore, unrelated client edits or package store. No global skill installation or skill files in docs.

## Non-goals
Bypassing secure keyguard, storing credentials, changing global screen timeout, introducing ADB/root dependency, automatically deploying to the phone, or restructuring the skill catalog.

## Behavior / Interface
Use a small non-touchable, non-focusable TYPE_ACCESSIBILITY_OVERLAY window with FLAG_KEEP_SCREEN_ON while a bounded device-local lease is active. This is a proposed implementation requiring OEM validation, not a verified HyperOS guarantee.

Add GET /api/screen and POST /api/screen (actions acquire/release) and mobile-ui screen status|keep-awake|release. Status includes screen interactive/keyguard locked and active lease/expiry. Default lease 120 seconds, explicit duration 1–600 seconds, validated on device and CLI. All state/window/timer mutations execute on Android main thread. Acquire is idempotent, refreshes one device-wide lease, and cannot accumulate windows/timers. Device-local monotonic clock controls expiry.

mobile-ui dump/click/input/scroll/back/home/wait renew the lease before UI interaction on a supporting bridge; status/help/dry-run do not. Old bridges lacking the endpoint retain existing behavior with a clear warning that keep-awake is unavailable. Other failures are surfaced rather than mistaken for unsupported capability. On an updated bridge, screen-off or locked state prevents UI interaction and returns a user-unlock-required result without waking/unlocking the device. Manual screen-off removes the lease and prevents automatic reactivation until the screen is interactive and unlocked.

Android workspace instructions tell agents to acquire before navigation, release in final cleanup, and renew before long pauses. Completion cleanup through instructions is best effort; timeout is the reliable fallback. This task does not add a Core run-completion callback. Separate concurrent agents share one device/screen; this does not claim isolated ownership for simultaneous UI automation.

Explicit release, idle expiry, service destruction or screen-off removes the window. Process death removes OS-owned windows, so no persistent setting needs restoration. Effective screen hold can be limited by OEM/device policy; report uncertainty.

## Constraints / Compatibility
Android min SDK 26, current bridge target SDK 33. Existing no-ADB/no-root workflow and desktop/web behavior preserved. Existing accessibility authorization is used; no new write-settings authorization. Preserve original user lock-screen security and screen-timeout configuration. User can cancel locally from bridge UI; add a visible status/release affordance.

## Acceptance Criteria
1. Repeated acquisition leaves one hold, renews expiry and rejects invalid durations without side effects.
2. UI commands renew; read-only status and dry-run do not; unsupported old bridges degrade clearly.
3. Locked/off-screen devices do not receive clicks, input or automatic unlock attempts.
4. Release, expiry, service teardown and manual screen-off remove hold; reacquisition requires unlocked interactive screen.
5. Android workspace instructions describe acquisition, cleanup, long pauses and authentication handling; no global skills installed.
6. Tests cover lifecycle, invalid inputs, bridge errors, compatibility and CLI requests. APK build is attempted with available SDK; unavailable prerequisites are explicitly BLOCKED.
7. Real-device validation, if accessible: start with 30-second timeout; remain on another app >60 seconds during hold; verify no focus/touch interference, manual lock respected and release allows normal timeout. Otherwise report this as BLOCKED, never PASS.

## Review Clarification

The imported bridge must use the same full-node index domain for dump, click and input. Filtered dumps retain their exact indices (possibly with gaps); agents must not renumber them. This fixes the imported source's confirmed index mismatch without changing screen-lease scope.
