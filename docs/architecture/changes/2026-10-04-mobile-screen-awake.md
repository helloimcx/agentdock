# Android mobile screen lease

Date: 2026-10-04 (Asia/Shanghai). Base: origin/main 9e29e53d1d54396adc048b56c4207420776d3b45.

## Delta and Evidence

The existing mobile-ui loopback bridge gains GET/POST /api/screen. Android owns an ephemeral device-wide monotonic lease and one non-touchable/non-focusable accessibility overlay; client UI calls renew it. Workspace instructions describe explicit cleanup and user-unlock handling. No schema migration, Core run callback, remote boundary or secure-unlock behavior is added. Legacy APKs preserve old operation with an explicit unavailable warning; other screen-control errors stop UI requests. Evidence: ScreenController.java, ScreenLease.java, AgentDockAccessibilityService.java and HttpServerBridge.java under tools/agentdock-a11y; client/types/cli in services/local-ai-core/src/mesh/mobile-ui; remote-mesh/device-environment.ts.

The base tracked only the Android bridge README. Necessary existing Java/resources/build script were copied from the host's concurrent untracked implementation on 2026-10-04, as approved in the Spec. Host client edits, APK, keystore and package store were excluded. The host worktree is not modified. Imported source now has ignored generated/signing output and a build-preflight check. This prerequisite is included in the review scope. Independent review caught and fixed filtered-dump versus click/input index mismatch: NodeCatalog now assigns one full-node index domain before filtering. Filtered indices can have gaps; page changes still require a new dump.

## Ownership / Compatibility

All window/state/UI guards are serialized on Android main thread. Manual screen-off and service teardown release the overlay. Process death removes its window; no system settings need restoration. Final instruction cleanup is best effort with bounded idle fallback; simultaneous callers share a device screen, not separate leases. An existing accessibility authorization is required. Supporting APK must be built/installed separately; no deployment has been performed.

## Provider / Validation

Active provider: Archify. README uses the manifest's inline Mermaid mode. L1 system source retains topology and gains device-screen responsibility in its execution card; new L2 mobile-screen workflow is indexed by overview and provider manifest. ACP session, agent-run lifecycle, scheduled delivery and skill-router semantics do not change and their sources are preserved. Expected design is the Mermaid in ../../plans/2026-10-04-mobile-screen-awake.md; actual flow is ../mobile-screen.workflow.html. Validation results and environment limitations are recorded in ../../plans/2026-10-04-mobile-screen-awake-qa.md.
