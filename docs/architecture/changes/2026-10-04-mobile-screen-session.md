# Task-owned Android display sessions — 2026-10-04

Base: PR182 commit a3b8647b937f64b6045e949b6c535c75092a8e82. Architecture Impact: Required.

Changed: ACP runPrompt now owns screen acquisition/renewal/final release through RemoteMeshScreenSessionManager and existing executeMesh. Cancellation, session teardown and shutdown stop renewal. Core sends 30-second heartbeat; device keeps an independent 120-second monotonic owner lease. Android owner acquire/renew/release protocol replaces the single shared lease; ordinary UI calls check screen rather than renew manual holds. Expired or cleared sessions cannot be renewed.

Added: self-drawn visible accessibility overlay status/edge feedback and target ripples. Animation creates no input and does not drive keep-awake. Owner expiration/release removes only that owner, physical screen-off/local user stop removes all. Screenshots may include feedback. No new persistent state, credential, external dependency, ADB requirement or automatic device deployment.

Rationale: actual task lifecycle spans thinking and page waiting; per-operation renewal and best-effort prompt cleanup could expire mid-task or linger after completion. Device expiry remains necessary because Core cannot deliver release over a lost connection. Owner separation prevents old cleanup removing another task; this does not solve concurrent UI execution.

Evidence: ACP backend/session coordinator hooks, execution/remote-mesh/screen-session-manager.ts, mobile-ui client/CLI, ScreenLease/ScreenController/AutomationOverlay and contract/Java tests. Active provider: Archify. [Approved diagram](2026-10-04-mobile-screen-session.html); current workflow is docs/architecture/mobile-screen.workflow.json. Final checks and physical-device limits recorded in the task QA document.
