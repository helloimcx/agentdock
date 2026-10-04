# Android screen keep-awake verification

Date: 2026-10-04 (Asia/Shanghai). Verification uses the isolated task worktree. PR submission requested on 2026-10-04. No APK install or phone settings change performed.

## Executed checks

All pnpm commands use --config.manage-package-manager-versions=false --config.verify-deps-before-run=false to reuse the host's existing dependencies via a worktree-local ignored symlink. The first unconfigured pnpm invocation refused to remove an external modules symlink; no host dependencies were removed. Tests requiring local sockets were run with sandbox escalation.

- [PASS] RED: new mobile-screen contract suite failed 5/5 before implementation (missing screen commands/renewal/guard).
- [PASS] TypeScript source tests: pnpm exec tsx --test tests/contracts/mobile-screen.test.ts tests/contracts/mobile-ui.test.ts, 19/19.
- [PASS] pnpm typecheck (both renderer and BDD TypeScript configurations).
- [PASS] pnpm build:electron (backend/Electron TypeScript and alias/managed-skill copy pipeline).
- [PASS] compiled mobile-screen and mobile-ui Node suites, 19/19.
- [PASS] compiled transparent-remote-mesh-shell integration suite, 8/8.
- [PASS] pnpm lint:gates: 0 circular clusters, 0 duplicate code, 169 dead-symbol baseline <=172, 0 oversized files, 45 long-functions baseline <=45, 108 existing complexity warnings <=108; no new warnings. This is not a claim of zero existing warnings.
- [PASS] pnpm lint:arch: 6 specs, each 9 showcase checks, 0 failed.
- [PASS] Archify deliver for system architecture and mobile-screen workflow: 9/9 checks, 0 composition errors/warnings.
- [PASS] mobile-screen HTML browser containment checks at 1440x900, 1600x1000, 1920x1080 and 2048x1320, light/dark captures; artifact-bound visual-check receipt retained under ignored test-results/architecture/. Large light screenshot inspected: labels/routes readable, no overlap or clipping. This screenshot review does not validate Android UI.
- [PASS] formal compiled bin/mobile-ui.mjs against a loopback HTTP QA fixture: screen keep-awake 54ms, status 47ms, release 48ms, locked click 49ms. First three exit 0; locked click exits 1 with Unlock the phone and sends no /api/click. These timings include Node process startup and do not represent remote-network/device latency.
- [PASS] After initial missing-runtime failure, downloaded checksum-verified official Temurin 17 and SDK 34 into a task-specific temporary directory (no global installation). With temporary PATH, bash tools/agentdock-a11y/test.sh passes ScreenLease lifecycle and NodeCatalog filtered/full-index regression programs.
- [PASS] With temporary JAVA_HOME/PATH/ANDROID_HOME, bash tools/agentdock-a11y/build.sh completes aapt2, javac, d8, zipalign and apksigner. Existing accessibility APIs emit deprecation notes, not compile errors. Produced ignored development APK and a separate agentdock-a11y-update.apk signed using the host existing debug keystore without copying it. Update APK v2/v3 signatures verified; signer digest matches host existing APK. This has not been checked against the installed phone package.
- [BLOCKED] Android window/keyguard/screen-off main path: adb devices -l sees the connected Xiaomi 2210132C (nuwa), the APK now builds, but the approved scope excludes automatic deployment, so it has not been installed. Existing APK does not establish new behavior.
- [PASS] Pre-commit full pnpm verify on 2026-10-04: typecheck, lint:gates, lint:arch, test and coverage all exit 0. Node suite 909/909; BDD 80/80 scenarios and 286/286 steps. Coverage statements/lines 73.27%, branches 71.69%, functions 79.86%; configured thresholds passed. Coverage reran the 909 Node tests successfully.
- [N/A] desktop e2e:smoke: no renderer UI or desktop startup path changed. Android UI screenshots and device-effect QA remain pending APK installation; architecture diagrams are not phone screenshots.

## Acceptance evidence

1. Acquisition/renewal/expiry/window count: client ordering contract PASS; Java lifecycle PASS; actual Android window effect BLOCKED pending installation.
2. Operation renewal, status/dry-run behavior, legacy bridge/error handling: contract tests PASS.
3. Locked/off-screen stop and racing lock error: client and formal CLI fixture PASS; actual keyguard/gesture behavior BLOCKED.
4. Release/expiry/teardown/manual off: Java implementation + harness reviewed and pure lifecycle executed PASS; Android OS effects BLOCKED pending installation.
5. Android instruction injection and no global skill install: existing Mesh integration PASS; source diff inspected.
6. Contract tests/builds for TypeScript PASS; Android harness and APK build PASS after temporary toolchain bootstrap.
7. HyperOS >60-second hold, touch/focus and normal sleep after release: BLOCKED pending APK installation.

## Independent review

Independent Spec Verifier + Cleaner review completed. One High in imported bridge source was validated and fixed: filtered dump renumbering disagreed with click/input full-node numbering. NodeCatalog now assigns full indices before filtering and action lookup uses the same catalog; explicit input index cannot fall back to another focused field. Follow-up read-only review reports no unresolved Critical/High findings. Review covered 47 files before QA sidecars were moved under ignored test-results/architecture/. Final source-control diff contains 35 files: 30 reviewed source/docs and 5 generated HTML/PNG skipped with explicit reason. 100% explicit coverage.

Reviewer covered all source/resource/build/test and documentation changes, including NodeCatalog and its Java regression. Generated artifacts skipped from source review in the final diff: system-architecture {html,light.png,dark.png,png} and mobile-screen.workflow HTML. Temporary screenshot/contact-sheet/receipt sidecars are preserved in ignored test-results/architecture/; they were inspected before moving and are not source specifications. Main agent inspected the large light workflow screenshot and system static light diagram; automated browser checks passed independently of these visual observations.

Implementation, Java/TypeScript build, contract/integration checks and review are complete. Device effectiveness remains unverified, so this is not a completed real-phone installation/delivery.

## Final artifacts and edge cases

Update APK: tools/agentdock-a11y/agentdock-a11y-update.apk (ignored build output). The standard build's separate fresh debug-key APK must not be assumed compatible with the installed app. No signing material copied into source control. System light/dark/png were regenerated from the delivered SVG in temporary standalone wrappers and visually checked; README retains configured inline Mermaid. L1 and L2 HTML visual-check receipts have artifact hashes and all required viewport checks. git diff --check passes. Generated APK v4 idsig files are ignored along with APK/build/signing output.

Remaining real-device checks: stay on another app longer than 60 seconds with a 30-second configured timeout; verify hold release and lease expiry return normal sleep; manual power-key lock stops subsequent operations; overlay neither intercepts touches nor changes focus; test HyperOS background restrictions and long thinking pauses. Device policies can override hold behavior. Legacy APK compatibility only preserves legacy behavior, not new lock/screen guarantees. Concurrent callers share one screen hold.

Official toolchain metadata: https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=aarch64&image_type=jdk&os=mac&vendor=eclipse and https://dl.google.com/android/repository/repository2-1.xml. Downloads were hash-verified against returned metadata before extraction. This temporary build setup is not part of repository/global configuration.
