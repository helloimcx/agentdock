# Android screen session QA — 2026-10-04

| Acceptance area | Result | Evidence |
|---|---|---|
| ACP task ownership and lifecycle | PASS | `RemoteMeshScreenSessionManager`; Core run/session hooks; run/session contract tests |
| Old CLI/APK protocol safety | PASS | CLI and screen protocol preflight plus exact owner echo; old protocol rejected before acquire |
| Cancel during protocol preflight/acquire/renew | PASS | Deferred request tests; stop waits and does not acquire after preflight cancellation |
| Java owner lease and overlay lifecycle | PASS | `bash tools/agentdock-a11y/test.sh`; main-thread ScreenLease lifecycle checks |
| Backend/mobile contracts | PASS | 32 focused mobile screen/session/UI tests |
| Android build and in-place update | PASS | Built with temporary JDK 17 / Android SDK 34; signed update APK with the installed app's existing certificate and installed via `adb install -r`, preserving app data and accessibility authorization |
| TypeScript | PASS | `pnpm typecheck`; Electron tsc also completed in full verify |
| Repository verification | PASS | `pnpm verify`: 922/922 Node tests, 80/80 BDD scenarios (286/286 steps), coverage thresholds met; lint gates 108 warnings, matching repository baseline; 6/6 Archify specs pass |
| Workflow artifact | PASS | Archify 9/9 showcase checks, zero warnings; visual-check passes in both themes at required viewports |
| L1 architecture viewport | PASS WITH EXISTING LIMIT | Archify 9/9 showcase checks. Browser visual-check reports 1440x900 height 915px (15px overflow) for both baseline and updated diagrams; 1600x1000, 1920x1080 and 2048x1320 contain. This is present in the PR base HTML too. 2048x1320 light/dark screenshots were visually reviewed. |
| Physical HyperOS keep-awake | PASS | Xiaomi 2210132C, Android 16, screen timeout 60,000 ms. With owner `codex-qa-run-2`, renewed every 25 seconds for about 150 seconds, `/api/screen` consistently reported `interactive=true`, `locked=false`, `keepAwake=true`, and Android `dumpsys power` reported `mWakefulness=Awake`; the screen did not sleep. |
| Physical overlay and cleanup | PASS | Captured the active device screen locally: the green edge glow and “AgentDock active” owner badge were visible over WeChat without covering its content. Releasing only the test owner returned `ownerCount=0`, `keepAwake=false`, and `overlayVisible=false`. The system timeout remained 60,000 ms and the accessibility service remained enabled. |
| Physical lock, touch passthrough and app-tree behavior | NOT VERIFIED | Did not manually lock the phone because regaining access may require the user's biometric/PIN, and avoided tapping inside the user's active WeChat conversation. Physical touch passthrough/ripple and a non-empty accessibility dump were not verified. |

The visible state/ripple layer may appear in OS or agent screenshots. Ripples report the selected target or that a fallback tap was queued; they are not evidence that the destination app completed the action. The overlay was visible in a locally captured device screenshot; physical touch and app-tree behavior remain subject to the unverified cases above.
