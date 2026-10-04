# Android screen session QA — 2026-10-04

| Acceptance area | Result | Evidence |
|---|---|---|
| ACP task ownership and lifecycle | PASS | `RemoteMeshScreenSessionManager`; Core run/session hooks; run/session contract tests |
| Old CLI/APK protocol safety | PASS | CLI and screen protocol preflight plus exact owner echo; old protocol rejected before acquire |
| Cancel during protocol preflight/acquire/renew | PASS | Deferred request tests; stop waits and does not acquire after preflight cancellation |
| Java owner lease and overlay lifecycle | PASS | `bash tools/agentdock-a11y/test.sh`; main-thread ScreenLease lifecycle checks |
| Backend/mobile contracts | PASS | 32 focused mobile screen/session/UI tests |
| Android build | PASS | APK built with temporary JDK 17 / Android SDK 34; APK not installed |
| TypeScript | PASS | `pnpm typecheck`; Electron tsc also completed in full verify |
| Repository verification | PASS | `pnpm verify`: 922/922 Node tests, 80/80 BDD scenarios (286/286 steps), coverage thresholds met; lint gates 108 warnings, matching repository baseline; 6/6 Archify specs pass |
| Workflow artifact | PASS | Archify 9/9 showcase checks, zero warnings; visual-check passes in both themes at required viewports |
| L1 architecture viewport | PASS WITH EXISTING LIMIT | Archify 9/9 showcase checks. Browser visual-check reports 1440x900 height 915px (15px overflow) for both baseline and updated diagrams; 1600x1000, 1920x1080 and 2048x1320 contain. This is present in the PR base HTML too. 2048x1320 light/dark screenshots were visually reviewed. |
| Physical HyperOS behavior | BLOCKED | New APK was not installed: no device deployment was authorized. Screen timeout, task >2 minutes, lock interruption, overlay touch/focus, dump and screenshot impact remain unverified on device. |

The visible state/ripple layer may appear in OS or agent screenshots. Ripples report the selected target or that a fallback tap was queued; they are not evidence that the destination app completed the action.
