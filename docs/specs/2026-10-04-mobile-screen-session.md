# Task-owned Android screen sessions

Approved: user said 开始 after the researched proposal on 2026-10-04. Supersedes per-operation renewal in mobile-screen-awake spec.

## Goal and Scope
Keep an unlocked Android Mesh device awake throughout the actual ACP run, including thinking and page waits; expose light visible feedback and click target ripples. Reuse PR182 worktree and existing executeMesh transport.

## Non-goals
Automatic secure unlock, global settings changes, fake input, ADB dependency, automatic APK deployment, screenshot capture redesign, or concurrent UI operation isolation.

## Behavior / Interfaces
Core acquires a lease keyed by actual ACP runId before sending prompt; renews every 30 seconds for 120 seconds. End, cancel, session close and shutdown stop renewal and release that owner. Device disconnect may prevent delivery; the device monotonic 120-second lease bounds recovery. Renewal never recreates an expired or manually cleared owner. Heartbeat failure stops the run rather than silently resuming after reconnection/unlock.

Android maintains multiple owner deadlines on its main thread, one overlay, independent owner release, and releaseAll for physical screen-off/service teardown/local user stop. POST /api/screen adds owner and renew; CLI adds --owner and renew. Default manual owner preserves explicit CLI acquisition. Ordinary UI commands check unlocked state without creating extra leases. An old bridge has clear compatibility reporting; it cannot claim managed keep-awake.

Canvas status/edge feedback is non-focusable/non-touchable and excluded from accessibility descendants. Successful semantic click feedback marks the target center; gesture feedback must represent acceptance/completion honestly. Animation has no keep-awake responsibility. System screenshots may include the overlay; physical-device behavior must be verified before claiming compatibility.

## Constraints
Preserve security and settings; no fake tap; no automatic installation. Release serialized after in-flight renew/acquire, timers do not revive after stop. Multiple screen owners do not authorize simultaneous UI automation.

## Acceptance Criteria
1. Android run acquires before prompt and renews through long thinking; non-Android runs do nothing.
2. Completion/error/cancel/transport close/shutdown stop timers and release owner, including in-flight requests.
3. Owner release/expiry is isolated; renew cannot revive expired/cleared lease.
4. Ordinary commands create no manual hold; CLI explicit manual acquire/release works.
5. Overlay displays status/target feedback, excludes accessibility descendants, creates no input and removes callbacks on stop.
6. Tests cover runtime races/errors and device clock/ownership; Java/APK and backend builds succeed.
7. Architecture documents/specs agree with code; independent review and required gates recorded truthfully.
8. Physical phone effects remain BLOCKED unless installation is separately authorized and performed.
