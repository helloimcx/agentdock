# 2026-10-17 — Monorepo peer topology normalization and daemon rename

- Architecture Impact: Required.
- Base revision: `46a60fb` (`origin/main`); implementation executed on branch `codex/2026-10-17-agentdock-daemon-refactor`.
- Prior semantic record: [2026-10-16 Resolve Butler mentions within each Lark app scope](2026-10-16-butler-app-scoped-lark-mentions.md).
- Active provider: Archify.

## Semantic delta

- Monorepo directory topology normalized into a pure two-tier peer layout:
  - `apps/`: Application entrypoints and shells:
    - `daemon/`: Backend Node.js daemon runtime (`@agentdock/daemon`, historically `local-ai-core`).
    - `desktop/`: Electron desktop shell (`@agentdock/desktop`).
    - `web/`: React 19 web and desktop renderer (`@agentdock/web`).
  - `packages/`: Shared reusable workspace packages:
    - `contracts/`: Cross-process data shapes, desktop state contracts, and protocol interfaces (`@agentdock/contracts`, alias `@cc/superai-contracts`).
    - `sdk/`: Client SDK for AgentDock Daemon REST, WebSocket, and SSE APIs (`@agentdock/sdk`, alias `@cc/core-sdk`).
    - `knowledge/`: Knowledge base SQLite store, indexing, and vector search abstractions (`@agentdock/knowledge`, alias `@cc/knowledge-api`).
    - `plugin-sdk/`: Plugin interfaces and contracts (`@agentdock/plugin-sdk`, alias `@cc/plugin-sdk`).
- Service rename: `local-ai-core` renamed to `agentdock-daemon`.
  - Health check handler returns `{ name: 'agentdock-daemon', legacyName: 'local-ai-core', version: '0.1.0' }`.
  - SDK client and desktop launcher support both names for resilient health detection and process bootstrap.
  - CLI `agentdock daemon` added with `agentdock core` preserved as an alias.
  - Dist shims provided in `dist-electron/electron/main.js` and `dist-electron/services/local-ai-core/src/runtime/standalone.js` to ensure backward compatibility for build artifacts.
- Zero boundary leakage:
  - Renderer (`apps/web`) communicates with Daemon exclusively via `@agentdock/sdk` and `@agentdock/contracts`.
  - Desktop (`apps/desktop`) launches Daemon via child process without IPC bridge (`preload.ts` remains empty).
  - Low-level packages have zero upward imports to application shells.

## Evidence

- Manifests and workspace: `pnpm-workspace.yaml`, `package.json`, `apps/*/package.json`, `packages/*/package.json`.
- Compilation and tool configs: `tsconfig.json`, `tsconfig.electron.json`, `apps/web/vite.config.ts`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.js`, `knip.json`, `.c8rc.json`, `eslint.config.mjs`.
- Launchers and shims: `scripts/launch-daemon.mjs`, `scripts/launch-core.mjs`, `scripts/write-electron-package.mjs`, `bin/agentdock.mjs`.
- Contracts and SDK: `packages/contracts/src/desktop.ts`, `packages/sdk/src/client.ts`.
- Subsystems: `apps/daemon/src/`, `apps/desktop/src/`, `apps/web/src/`.
- Tests: `tests/contracts/`, `tests/electron/`, `tests/integration/`, `tests/bdd/`.

## Validation

- `[PASS]` `pnpm typecheck` passed (0 errors across `tsconfig.json` and `tests/bdd/tsconfig.json`).
- `[PASS]` `pnpm build:renderer` and `pnpm build:electron` passed.
- `[PASS]` `node --test` (1084 tests: 1083 passed, 0 failed, 1 skipped).
- `[PASS]` `pnpm test:bdd` (80 scenarios passed, 286 steps passed).
- `[PASS]` `pnpm coverage` passed (all C8 line, function, branch thresholds satisfied).
- `[PASS]` `pnpm lint:gates` passed (0 circular deps, 0 duplicate violations, Knip <= 172, ESLint complexity <= 108).
- `[PASS]` `pnpm lint:arch` passed (9/9 showcase checks).
- `[PASS]` `pnpm e2e:smoke` passed (launches Electron shell, verifies default/degraded/error scenes, clean shutdown).
