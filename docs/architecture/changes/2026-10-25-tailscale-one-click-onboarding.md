# 2026-10-25 — Secure one-click Tailscale onboarding

- Architecture Impact: Required.
- Implementation base: `origin/main` `486473e257014207215b50dccbede06eac9f18ec`; latest main `34db1201b43185fe15cbc4ed64fe51c3a2037ca2` was integrated before updating PR #222. Original PR head `c5f457dc081bb1fa2b9b68c61820fc57c9c15d00` remains in branch ancestry.
- Prior semantic record: [Tailscale discovery and inventory binding](2026-10-17-tailscale-node-discovery.md).
- Active provider: Archify.

## Semantic delta

- Replaced inventory-only Tailscale binding with a supervised onboarding path. `/mesh/tailscale/bind` now returns `410`; a discovered peer does not become an execution node until it has a stable `Peer.ID`, a canonical Mesh UUID, a one-time enrollment and a live authenticated WebSocket.
- Added persistent per-peer connection and operation state, idempotency, restart recovery, explicit cancel/disconnect/revoke/reauthorize transitions, and a consent gate for changes to SSH account, approved root or command permission.
- Added a Node 22 bootstrap runtime bundle and standard OpenSSH transport. The controller uses only a currently discovered Tailscale address, strict host-key verification and loopback-only remote forwarding. It does not accept unknown host keys or collect SSH credentials in the browser.
- Added an expected-node enrollment bridge that admits only the exact enrollment and authenticated connection routes. Pairing credentials travel over supervised SSH stdin; they are not written into operation responses or durable connection state. Existing Mesh credentials remain hash-only at the controller.
- Added Mesh and Workspace onboarding UI. A new workspace target can be saved only when the server-owned connection is `ready`, desired `active`, and the node is online with `shell.exec`. Shell access requires an explicit opt-in and remains governed by the remote account's operating-system permissions; the approved root is not a shell sandbox.
- Compatibility: legacy `node:ts:<name>` records remain legacy inventory. They are not silently promoted to authenticated execution targets; users must select a successfully onboarded canonical node.

## Evidence

- Identity and peer discovery: `apps/daemon/src/mesh/tailscale-service.ts`, `packages/contracts/src/mesh.ts`.
- Persistence and state transitions: `apps/daemon/src/mesh/tailscale-onboarding-store.ts`, `apps/daemon/src/mesh/tailscale-onboarding.ts`.
- SSH and bootstrap boundaries: `apps/daemon/src/mesh/ssh-bootstrap.ts`, `apps/daemon/src/mesh/mesh-enrollment-bridge.ts`, `apps/daemon/src/mesh/bootstrap-runtime.ts`, `scripts/build-mesh-runtime.mjs`.
- Administrator API and SDK: `apps/daemon/src/mesh/tailscale-onboarding-api.ts`, `apps/daemon/src/mesh/mesh-gateway.ts`, `packages/sdk/src/mesh.ts`.
- Selection and save safeguards: `apps/web/src/pages/Mesh/onboarding-model.ts`, `apps/web/src/pages/Desktop/Workspace.tsx`.
- Focused tests: `tests/integration/tailscale-onboarding.test.ts`, `tests/integration/mesh-enrollment-bridge.test.ts`, `tests/integration/ssh-bootstrap-transport.test.ts`, `tests/electron/tailscale-onboarding-store.test.ts`, `tests/integration/tailscale-onboarding-ui.test.ts`.
- Code-backed request and enrollment order: [peer discovery and SSH preflight](../tailscale-onboarding-discovery.sequence.json), [bridge deployment and authentication](../tailscale-onboarding-enrollment.sequence.json), and [capability verification and workspace target](../tailscale-onboarding-readiness.sequence.json).

## Validation

- [PASS] `pnpm typecheck`; renderer, Electron/runtime, and Node 22 bootstrap bundle builds.
- [PASS] On implementation base `486473e`, complete Node suite: 1,160 passed, 1 skipped; BDD: 80 scenarios and 286 steps passed; `pnpm coverage`: 75.6% statements/lines, 74.02% branches, 82.38% functions.
- [PASS] After integrating latest main `34db120`, `pnpm run lint:gates`: all configured structural gates passed (dead symbols 172, function length 45, ESLint complexity 108); GitHub Typecheck also passed.
- [PASS] `pnpm lint:arch`: 12 architecture specifications passed, including all three source-backed Tailscale sequences.
- [PASS] All three Archify sequences passed validate, deliver, strict provenance, and Chrome browser checks. Light/dark captures at 1440×900 and 2048×1320 were inspected.
- [N/A] Provider compare: there was no previous Tailscale onboarding sequence source to compare.
- [BLOCKED] Real two-device installation remains unverified. The isolated OpenSSH integration is opt-in and skipped in the default suite; the intended MacBook Pro was offline in the last environment check and its SSH host key has not been trusted by the controller. No unknown key was accepted and no remote installation was attempted.
- Latest-main GitHub lint/typecheck/Archify checks pass. One test fixture initially failed on Ubuntu because it invoked `/bin/zsh`; the fixture now uses `/bin/sh`, which matches the POSIX deployment script. A final CI rerun is pending.
