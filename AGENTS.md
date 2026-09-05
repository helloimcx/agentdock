# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the React renderer: page views in `src/pages/`, shared UI in `src/components/`, Zustand state in `src/store/`, API clients in `src/api/`, and i18n resources in `src/i18n/`. Electron-specific code lives in `electron/`, with shared desktop types in `shared/`. Cross-layer tests live in `tests/`, split into `tests/electron/`, `tests/contracts/`, and `tests/integration/`. Static assets belong in `public/`. Build outputs are generated in `dist/renderer/` and `dist-electron/`; do not edit them directly.

## Build, Test, and Development Commands
Use `pnpm` for all local work.

- `pnpm dev`: starts the Vite renderer and Electron app through `scripts/dev.mjs`.
- `pnpm build`: builds the renderer, writes the Electron package metadata, and compiles the Electron TypeScript entrypoints.
- `pnpm build:renderer`: builds only the web renderer into `dist/renderer/`.
- `pnpm build:electron`: rebuilds only the Electron side into `dist-electron/`.
- `pnpm test`: builds renderer and Electron outputs, then runs the compiled Node test suite.
- `pnpm start:prod`: launches the packaged app from the current build output.
- `pnpm e2e:smoke`: runs the bundled smoke test against a fresh production build.

## Quality Metrics
- `pnpm lint:complexity`: reports cyclomatic complexity per function across TS source via ESLint `complexity` rule (default max threshold 15). CI gate: `pnpm lint:complexity:gate` (ESLint `--max-warnings 108` baseline).
- `pnpm lint:circular`: reports circular import dependencies across source roots using `madge`. CI gate: `--fail` (zero-tolerance, baseline 0).
- `pnpm lint:duplicate`: reports copy/paste duplicate code rate using `jscpd`. CI gate: `--fail` with `JSCPD_MIN_LINES=10`/`JSCPD_MIN_TOKENS=60`; lark/weixin gateway files are ignored (deliberately parallel implementations).
- `pnpm lint:dead-code`: reports unused exports, unused types, and duplicate exports using `knip` (entry points declared in `knip.json`). CI gate: `--fail --max-count 171` (incremental over baseline).
- `pnpm lint:function-length`: reports functions whose line count exceeds threshold (default 100). CI gate: `--fail --max-count 45` (incremental over baseline).
- `pnpm lint:file-size`: reports source files whose line count exceeds threshold (default 1000). CI gate: `--fail` (zero-tolerance).
- `pnpm coverage`: measures test coverage using `c8`. CI gate: `check-coverage` thresholds in `.c8rc.json` (lines/statements 68, functions 72, branches 66).
- `pnpm lint:arch`: validates all architecture and workflow specifications in `docs/architecture/` via Archify showcase checks.
- All gates aggregate in `pnpm lint:gates`; CI runs it plus `typecheck`/`test`/`coverage` in `.github/workflows/ci.yml`.

## Coding Style & Naming Conventions
The codebase uses TypeScript with `strict` mode enabled and the `@` alias for `src/` imports. Follow the existing style: 2-space indentation, semicolons in renderer code, and clear ESM imports. Use `PascalCase` for React components and page folders (`src/pages/Projects/ProjectList.tsx`), `camelCase` for functions and helpers, and lowercase filenames for stores and API modules (`src/store/auth.ts`, `src/api/client.ts`). Keep shared desktop contracts in `shared/` so renderer and Electron stay aligned.

## Architecture Boundaries
Keep the directory structure intentional, with clear ownership and single-purpose modules. Page components should orchestrate UI and data flow, shared components should stay presentation-focused, stores should own state transitions, API modules should isolate transport concerns, and Electron or Local AI Core logic should not leak into renderer code except through shared contracts. Keep dependencies pointing from low level to high level: low-level modules (shared contracts, SDKs, kernel interfaces) must never depend on higher-level modules (UI pages, components, specific plugins, or desktop shell code), and lower renderer layers (stores/API) must not depend on UI page views. Prefer small, cohesive files over broad utility modules, and move reusable behavior to the nearest appropriate shared layer only after a real second use appears. When a code file exceeds 1000 lines, consider splitting it. Keep agent runtime quirks in `services/local-ai-core/src/agents/<agent-id>/` first, and only move behavior into shared ACP/router/storage/renderer layers when the invariant truly applies across agents.

<!-- project-setup:architecture-maintenance:start -->
## Architecture maintenance

Before implementation, classify Architecture Impact as `Required` or `None`.
Use `Required` when a change alters module or service responsibilities,
dependency direction or public protocols, data ownership or flow,
trust, deployment, process, or network boundaries, external integrations,
synchronous/asynchronous communication, or adds, removes, splits, or merges
an architectural component.

When `Required`, read and follow `docs/architecture/maintenance.md` before
implementation. Completion requires the current architecture facts, one
change record, provider artifacts and validation, and the README diagram to agree.
<!-- project-setup:architecture-maintenance:end -->

Architecture and flow diagrams live under `docs/architecture/` as typed Archify JSON specs (`system-architecture.json`, `*.workflow.json`, `*.sequence.json`, `*.lifecycle.json`). Update corresponding diagram specs alongside architectural or core workflow changes, validate via `pnpm lint:arch`, deliver showcase HTML/PNG artifacts, and keep `README.md` and `docs/architecture/overview.md` linked.

When designing or connecting multi-entity models (such as `AutomationRun` wrapping an underlying `acpRunId`, or channel sessions wrapping threads), maintain clear semantic separation between the outer wrapper ID and the inner execution ID. Avoid treating all identifiers as generic strings. Downstream APIs and UI components must explicitly document and consume the precise target ID domain, and backend lookup methods should implement defensive alias resolution where cross-entity lookups are plausible.

When changing chat UI styles, consider all chat surfaces together: desktop app, web, mobile H5, and the different channel/session entry points.

## Plugin Development
Plugin contracts and runtime types belong in `packages/plugin-sdk/`; keep cross-process data shapes in shared contracts instead of duplicating them in plugins. Built-in Local AI Core plugins live under `services/local-ai-core/src/plugins/builtin/`, with one focused file or folder per plugin and lowercase dotted ids such as `channel.lark` or `scheduler.cron`. Register plugins through the local core registry and declare dependencies in the manifest rather than relying on implicit load order. Put reusable kernel behavior in `services/local-ai-core/src/kernel/`, not inside individual plugins, and avoid adding dynamic plugin loading until the static registration path is stable.

## Agent Workflow
Before writing any code, describe the intended approach and wait for approval. If requirements are ambiguous, ask clarifying questions before writing any code. If a user request for code is not aligned with best practices, briefly explain the concern and suggest a better approach. When investigating issues, reason from first principles about the data model, event flow, and ownership boundaries; first locate whether the faulty state is in agent session storage, Local AI Core logs, SQLite thread records, bridge events, or live UI state, then decide whether the model or workflow needs improvement before applying localized patches. When bridging data across layers (e.g. from Automation lists to Run Trace drawers), trace the identifier from its origin table through SDK endpoints to backend SQL queries; never assume an outer entity's `.id` matches an inner execution runtime's `.id` without verification. When fixing a bug, start by writing a test that reproduces it, then fix the bug until the test passes. When adding a new feature, update the `README.md` `New` section with a concise user-visible note. After writing code, list relevant edge cases and suggest test cases to cover them. Every time the user corrects the agent, reflect on what went wrong and provide a plan to avoid repeating the same mistake.

When updating project progress, status notes, changelogs, or date-sensitive logs, verify the current date first and use concrete dates instead of stale relative dates.

## Testing Guidelines
There is no frontend unit-test runner configured in this snapshot. The main fast verification path is `pnpm test`, which builds renderer and Electron outputs and runs the Node test suite. Use `pnpm e2e:smoke` for packaged app smoke coverage. Keep single-module renderer tests near the feature they cover, put cross-layer Electron, contract, and integration tests under `tests/electron/`, `tests/contracts/`, or `tests/integration/`, and keep package-private tests under `packages/<name>/test/`.

Always use realistic, production-aligned ID formats in tests (e.g., `run:agentdock::<uuid>:<timestamp>`, `automation-run:<uuid>`, `thread:<workspace>::<uuid>`) instead of neutral placeholders like `'run-1'` or `'test-id'`. Synthetic placeholder IDs create a false sense of security by masking mismatches between wrapper and execution entity identifiers. Tests covering cross-module flows must verify the end-to-end lookup through both primary IDs and aliases.

Use TDD selectively where it prevents repeated regressions. Bug fixes should start with the smallest failing test that reproduces the issue, then pass by fixing the underlying invariant. Cross-layer features should add contract or state-machine coverage first, especially for ACP streaming, permission lifecycle, thread/task state, channel content normalization, scheduler behavior, and shared enum parsing. Pure UI polish, copy changes, and exploratory product work do not require strict TDD; validate them with focused manual checks, screenshots when useful, or smoke/e2e coverage. Release and packaging issues should be guarded with `pnpm build` and `pnpm e2e:smoke`.

## Commit & Pull Request Guidelines
Before committing or pushing code, run the same gates CI runs: `pnpm typecheck`, `pnpm lint:gates` (the CI-pinned gate variants with `--fail`/baseline args), and `pnpm test`, to ensure zero TS errors, zero circular dependencies, no new duplicate code blocks, no new dead symbols or long functions, no new ESLint warnings, and 100% test pass rate. Use short, imperative commit subjects such as `Add bridge runtime retry` or `Fix smoke test startup timing`. Keep pull requests focused, describe user-visible changes, list validation commands you ran, and include screenshots for UI updates.

## Configuration Notes
Development scripts honor Electron runtime overrides such as `AI_WORKSTATION_USER_DATA_DIR` and `AI_WORKSTATION_SMOKE_OUTPUT`. Avoid committing machine-specific paths, secrets, or generated output.
