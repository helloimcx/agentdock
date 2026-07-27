# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AgentDock is a pnpm monorepo — an Electron + React desktop shell that spawns and manages a **Local AI Core** backend (a Node.js HTTP server). The renderer communicates with Local AI Core via standard HTTP/WebSocket APIs, not Electron IPC.

Two runtime modes:
- **Desktop mode**: Electron spawns Local AI Core as a child process, renderer talks to `127.0.0.1:9831` via HTTP/WS
- **Web admin mode**: Connects to a remote Local AI Core instance via API token + server URL

The `desktopManaged` flag in the auth store (`src/store/auth.ts`) and `managedBy` (`none` | `electron` | `local_core` | `remote`) control which mode is active, affecting routing and available features.

## Build & Dev Commands

All commands use `pnpm`.

| Command | Purpose |
|---|---|
| `pnpm dev` | Start Vite renderer + tsc watch + Electron (via `scripts/dev.mjs`) |
| `pnpm dev:web` | Vite renderer only at `127.0.0.1:5173` |
| `pnpm dev:core` | Build Electron + launch Local AI Core standalone |
| `pnpm build` | Full production build (renderer + Electron) |
| `pnpm build:renderer` | Build only the React frontend to `dist/renderer/` |
| `pnpm build:electron` | Build only Electron main process to `dist-electron/` |
| `pnpm start:prod` | Run the built Electron app |
| `pnpm test` | Run tests via Node.js built-in test runner (Electron + knowledge-api + thread-permission tests) |
| `pnpm e2e:smoke` | Full build + E2E smoke test |
| `pnpm dist:mac` | Build + package macOS DMG/ZIP (arm64 only) |

## Architecture

### Monorepo Structure

```
packages/        Shared packages (contracts, core-sdk, knowledge-api, plugin-sdk)
services/        Local AI Core runtime service
apps/            Future shell directories (shell-desktop, shell-web — stubs)
shared/          Cross-process shared types (desktop.ts)
electron/        Electron main process + preload + managed skills + tests
src/             React renderer
tests/           Cross-layer tests (electron, contracts, integration)
public/          Static assets
```

### Two Separate TypeScript Compilations
1. **Renderer** (`src/`): Compiled by Vite with ESM/react-jsx, outputs to `dist/renderer/`
2. **Electron main + services + packages** (`electron/`, `services/`, `packages/`): Compiled by `tsc` with CommonJS, outputs to `dist-electron/`

Both share types from `shared/` — the single source of truth for interfaces crossing the process boundary.

### Electron Shell

`electron/main.ts` is intentionally thin (~170 lines): it spawns Local AI Core as a child process (`ELECTRON_RUN_AS_NODE=1`), waits for health at `http://127.0.0.1:9831/api/local/v1/health`, then loads the renderer in a BrowserWindow. `electron/preload.ts` is empty — there is no Electron IPC bridge. All renderer-to-backend communication uses HTTP/WebSocket through `src/api/`.

`electron/managed-skills/` contains agent skill definitions (browser automation, knowledge base search) used by the Local AI Core runtime.

### Local AI Core (`services/local-ai-core/`)

The core backend runtime with these subsystems:
- **ACP** (`src/acp/`): Agent Client Protocol integration — session coordination, transport, turn management, permissions, response processing
- **CLI** (`src/cli/`): Command-line entry point
- **Channel** (`src/channel/`): shared channel contracts plus isolated Lark/Feishu and WeChat gateway implementations
- **Kernel** (`src/kernel/`): Bootstrap, event bus, lifecycle, plugin registry, capability registry
- **Plugins** (`src/plugins/builtin/`): Built-in plugins with lowercase dotted IDs (e.g., `channel.lark`, `scheduler.cron`, `knowledge.ai-vector`)
- **Router** (`src/router/`): Workspace routing and route configuration
- **Runtime** (`src/runtime/`): Core controller (lifecycle/config/events), HTTP server with per-domain route handlers, channel service, external service, runtime state and detection
- **Scheduler** (`src/scheduler/`): Cron-based task scheduling with platform-specific adapters (Lark, WeChat)
- **Thread** (`src/thread/`): Workspace thread ID and mapper utilities

### Shared Packages (`packages/`)

- **contracts**: Local Core type definitions
- **core-sdk**: Client SDK for Local AI Core APIs
- **knowledge-api**: AI vector provider, SQLite store, thread knowledge store
- **plugin-sdk**: Plugin contracts and runtime types

### Renderer Structure (`src/`)

- **Pages** (`src/pages/`): Feature-organized — Dashboard, Login, Desktop/Workspace, Threads/ThreadChat, Knowledge, Projects, Sessions, Cron, System, Web/Chat
- **UI components** (`src/components/ui/`): Custom component library using Radix UI primitives (Button, Card, Badge, Modal, Input/Select/Textarea, Page)
- **API clients** (`src/api/`): `client.ts` has the base `ApiClient` singleton; feature modules wrap specific endpoints
- **State** (`src/store/`): Zustand stores — `auth.ts` (auth + runtime mode), `theme.ts`
- **App registry** (`src/app/`): UI contribution registry — routes and nav items registered dynamically, visibility controlled by runtime feature detection
- **Routing**: `HashRouter` in desktop mode, `BrowserRouter` in web mode
- **i18n** (`src/i18n/`): 5 languages (en, zh, zh-TW, ja, es)

### Shared types (`shared/desktop.ts`)

Central type definitions including: agent type constants (`opencode`, `claudecode`, `cursor`, `gemini`, `localcore-acp`, etc.), platform types (`telegram`, `feishu`, `lark`, `discord`, `slack`, `weixin`, etc.), provider presets, and interfaces for desktop settings, service state, runtime status, plugin config, bridge events, and config file state.

### Tech Stack

React 19, Electron 35, Vite 6.3, TypeScript 5.8 (strict), Tailwind CSS 3.4, Zustand 5, react-router-dom 7.5, Radix UI, i18next, react-markdown + highlight.js, Node.js built-in test runner

## Architecture Boundaries

Keep the directory structure intentional with clear ownership and single-purpose modules. Page components orchestrate UI and data flow, shared components stay presentation-focused, stores own state transitions, API modules isolate transport concerns, and Local AI Core logic does not leak into renderer code except through shared contracts. Prefer small, cohesive files over broad utility modules, and move reusable behavior to the nearest appropriate shared layer only after a real second use appears. When a file exceeds 1000 lines, consider splitting it. Keep agent runtime quirks in `services/local-ai-core/src/agents/<agent-id>/` first, and only move behavior into shared ACP/router/storage/renderer layers when the invariant truly applies across agents.

When changing chat UI styles, consider all chat surfaces together: desktop app, web, mobile H5, and the different channel/session entry points.

## Plugin Development

Plugin contracts and runtime types belong in `packages/plugin-sdk/`; keep cross-process data shapes in shared contracts instead of duplicating them in plugins. Built-in plugins live under `services/local-ai-core/src/plugins/builtin/`, one focused file per plugin with lowercase dotted IDs (e.g., `channel.lark`, `scheduler.cron`). Register plugins through the local core registry and declare dependencies in the manifest rather than relying on implicit load order. Put reusable kernel behavior in `services/local-ai-core/src/kernel/`, not inside individual plugins, and avoid adding dynamic plugin loading until the static registration path is stable.

## Conventions

- 2-space indentation, semicolons in renderer code
- `@/` path alias maps to `src/`
- `PascalCase` for components and page folders, `camelCase` for functions/helpers, lowercase filenames for stores and API modules
- Accent color `#42ff9c` (bright green) throughout the UI
- Tailwind class-based dark mode with `@tailwindcss/typography`
- Keep shared contracts in `shared/` so renderer and backend stay type-aligned
- Environment variables: `AI_WORKSTATION_USER_DATA_DIR`, `AI_WORKSTATION_SMOKE_OUTPUT`, `AI_WORKSTATION_DEV_SERVER_URL`

## Testing

`pnpm test` builds renderer and Electron outputs, then runs the compiled Node test suite. `pnpm e2e:smoke` exercises the full built Electron app end to end.

When adding tests, keep single-module renderer tests near the feature they cover, put cross-layer Electron/contract/integration tests under `tests/electron/`, `tests/contracts/`, or `tests/integration/`, and keep package-private tests under `packages/<name>/test/`.

Gherkin behavior specs (`.feature` files) live under `tests/bdd/features/` with step definitions in `tests/bdd/step-definitions/` and per-scenario state in `tests/bdd/support/world.ts`. They run via Cucumber against TypeScript source (registered through the `tsx` loader, not the compiled `dist-electron` output) with `pnpm test:bdd`, which is also appended to `pnpm test`. Reach for a `.feature` when a behavior reads naturally as Given/When/Then scenarios; keep step definitions thin and delegate the real work to the same pure functions the unit tests exercise.

Use TDD selectively where it prevents repeated regressions. Bug fixes should start with the smallest failing test that reproduces the issue. Cross-layer features should add contract or state-machine coverage first, especially for ACP streaming, permission lifecycle, thread/task state, channel content normalization, scheduler behavior, and shared enum parsing. Pure UI polish, copy changes, and exploratory product work do not require strict TDD; validate them with focused manual checks, screenshots when useful, or smoke/e2e coverage.

## Quality metrics

`pnpm lint:complexity` reports cyclomatic complexity per function across the TS source (`src/`, `services/`, `packages/`, `electron/`, `shared/`) via ESLint's `complexity` rule. It is an informational report — the rule is `warn`, so it exits 0 and does not gate CI. Tune the threshold in [eslint.config.mjs](eslint.config.mjs) (`complexity: ['warn', { max }]`); the project default is 15.

`pnpm lint:circular` reports **circular (cyclic) import dependencies** across the same source roots, using [madge](https://github.com/pahen/madge) to build the import graph (honoring the `@cc/*` and `@/*` aliases from the root tsconfig) and collapsing it into **strongly-connected components** via Tarjan's algorithm — so one tangled cluster shows up once instead of as N overlapping paths. Each SCC of size > 1 is a genuine directed cycle and is printed with its files, largest first. It is an informational report — the script always exits 0 and does not gate CI. The script lives in `scripts/lint-circular.mjs`.

`pnpm lint:duplicate` reports the **copy/paste (duplicate code) rate** across the same source roots using [jscpd](https://github.com/kucherenko/jscpd). It prints total files/lines scanned, duplicated lines and tokens, the **duplicate rate** as both a line percentage and a token percentage, a per-format breakdown (typescript vs tsx), and the ten largest duplicated blocks. It is an informational report — the script always exits 0 and does not gate CI. The script lives in `scripts/lint-duplicate.mjs`; tune detection with the `JSCPD_MIN_LINES` and `JSCPD_MIN_TOKENS` environment variables (defaults 5 lines / 25 tokens).

`pnpm lint:dead-code` reports **unused exports, unused types, and duplicate exports** across the same source roots using [knip](https://github.com/webpro/knip). It prints files analyzed, a per-type breakdown (exports / types / duplicates / …), and the top 15 offenders with sample symbol names. It is an informational report — the script always exits 0 and does not gate CI. The script lives in `scripts/lint-dead-code.mjs`. Accuracy improves once a `knip.json` declares the project's entry points (e.g. `electron/main.ts`, `services/local-ai-core`) — without it, knip may under-report symbols that entries consume.

`pnpm lint:function-length` reports **functions whose line span meets a threshold** across the same source roots by walking the TypeScript AST (via the `typescript` package). It covers function declarations, function expressions, arrow functions, methods, accessors, and constructors; prints files scanned, a count of long functions, and the 20 longest with name and line range. It is an informational report — the script always exits 0 and does not gate CI. The script lives in `scripts/lint-function-length.mjs`; tune the threshold with the `FUNC_MIN_LINES` environment variable (default 100).

`pnpm lint:file-size` reports **source files whose line count meets a threshold** across the same source roots. It prints files scanned, total and average line counts, and the largest files. It is an informational report — the script always exits 0 and does not gate CI. The script lives in `scripts/lint-file-size.mjs`; tune the threshold with the `FILE_MIN_LINES` environment variable (default 1000, matching the "consider splitting past 1000 lines" guidance).

Both `lint:function-length` and `lint:file-size` share their file discovery (source roots + ignore patterns) via `scripts/lint-metrics-common.mjs`, so the ignore set stays in lockstep with `eslint.config.mjs`.

`pnpm coverage` measures **branch/line/function coverage** of the Node test suite across the same source roots using [c8](https://github.com/bcoe/c8), which leverages V8's built-in coverage and remaps it back to TypeScript source via source maps. It prints a text summary to stdout and writes HTML + lcov reports to `coverage/` and `lcov.info`. It is an informational report — the script exits 0 unless tests themselves fail, and it never gates CI on a coverage threshold. The script lives in `scripts/coverage.mjs`; configure reporters and add `check-coverage` thresholds in [.c8rc.json](.c8rc.json) once you want gating. The production build stays source-map-free: coverage builds use a separate [tsconfig.coverage.json](tsconfig.coverage.json) that adds `sourceMap`.

## Agent Workflow

- Before writing any code, describe the intended approach and wait for approval
- If requirements are ambiguous, ask clarifying questions before writing code
- If a user request conflicts with best practices, briefly explain the concern and suggest a better approach
- When fixing a bug, start by writing a test that reproduces it, then fix the bug until the test passes. When investigating issues, reason from first principles about the data model, event flow, and ownership boundaries; locate whether the faulty state is in agent session storage, Local AI Core logs, SQLite thread records, bridge events, or live UI state before deciding on a fix
- When adding a new feature, update the `README.md` `New` section with a concise user-visible note
- When updating project progress, status notes, changelogs, or date-sensitive logs, verify the current date first and use concrete dates instead of stale relative dates
- After writing code, list relevant edge cases and suggest test cases to cover them
- Every time the user corrects you, reflect on what went wrong and provide a plan to avoid repeating the same mistake

## Commit & PR Guidelines

Use short, imperative commit subjects such as `Add bridge runtime retry` or `Fix smoke test startup timing`. Keep pull requests focused, describe user-visible changes, list validation commands you ran, and include screenshots for UI updates. Avoid committing machine-specific paths, secrets, or generated output.


## Configuration Notes

Development scripts honor Electron runtime overrides such as `AI_WORKSTATION_USER_DATA_DIR` and `AI_WORKSTATION_SMOKE_OUTPUT`. Avoid committing machine-specific paths, secrets, or generated output.
