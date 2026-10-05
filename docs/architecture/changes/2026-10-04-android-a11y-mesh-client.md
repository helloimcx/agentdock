# 2026-10-04 — Android All-in-One Native A11y Mesh Client & Zero-Listening-Port Architecture

- Architecture Impact: Required.
- Base revision: `codex/2026-10-04-android-a11y-mesh-client` branch, based on `main` (v0.1.89).
- Active provider: Archify; architecture specs validated via `pnpm lint:arch`.

## Semantic delta

Evolve Android mobile integration from a split Termux Node + Loopback HTTP architecture into an **All-in-One Outbound WebSocket Native Mesh Node**:
1. **Zero-Listening-Port Outbound-Only Architecture**: Completely removed `HttpServerBridge` and the local HTTP server listening on `127.0.0.1:19832`. The Android APK (`agentdock-a11y`) now establishes an authenticated outbound RFC 6455 WebSocket connection directly to the Mesh Gateway (`/api/local/v1/mesh/connect`), eliminating local attack surfaces and port conflict risks.
2. **Virtual Shell Command Interceptor (`CommandDispatcher.java`)**: Intercepts shell execution (`shell.exec`) from the cloud Agent and transparently routes commands in-memory:
   - `mobile-ui`: Dispatches directly to `AgentDockAccessibilityService` with MainLooper thread isolation and `cliProtocol: 2` support;
   - `mobile-apps`: Dispatches directly to `IntentEngine` for native Android Intent deep links (WeChat, Alipay, Amap, Meituan, Taobao, System Settings);
   - `termux-*`: Native clean-room implementation of high-frequency hardware APIs (TTS, battery status JSON, clipboard, vibrator, flashlight, toast, volume, GPS location);
   - General Linux shell commands fallback to `/system/bin/sh -c` with process timeout protection and path traversal guards.
3. **Native Credential Enrollment & Management**: `MainActivity` and `MeshPreferences` provide UI pairing, one-click enrollment via `/api/local/v1/mesh/enroll`, connection lifecycle management, 10s heartbeat keepalive, and automatic reconnect with exponential backoff.
4. **Preservation of Cross-Platform npm Client**: The existing `agentdock-node` client is retained without regression, continuing to support Linux, macOS, Windows, and Termux geek mode.

## Compatibility and evidence

Existing cloud Mesh protocol, SQLite tables, and execution semantics remain 100% backward-compatible.
Evidence:
- `tools/agentdock-a11y/src/main/java/com/agentdock/a11y/MeshClient.java`
- `tools/agentdock-a11y/src/main/java/com/agentdock/a11y/CommandDispatcher.java`
- `tools/agentdock-a11y/src/main/java/com/agentdock/a11y/IntentEngine.java`
- `tools/agentdock-a11y/src/main/java/com/agentdock/a11y/SystemApiHandlers.java`
- `tools/agentdock-a11y/src/main/java/com/agentdock/a11y/MeshPreferences.java`
- `tools/agentdock-a11y/src/main/java/com/agentdock/a11y/AgentDockAccessibilityService.java`
- `tools/agentdock-a11y/src/main/java/com/agentdock/a11y/MainActivity.java`
- `tests/contracts/android-a11y-mesh.test.ts`
- `docs/specs/2026-10-04-android-a11y-mesh-client.md`
- `docs/plans/2026-10-04-android-a11y-mesh-client.md`
