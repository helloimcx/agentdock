# Architecture Baseline Record: 2026-09-05 Bootstrap

## Metadata

- **Date**: 2026-09-05
- **Revision / State**: Baseline alignment of existing repository `@kafca/agentdock` (v0.1.81)
- **Architecture Impact**: `Required` (Establishing formal Architecture Governance and baseline entry points)
- **Active Provider**: Archify (validated via `node scripts/lint-architecture.mjs`)
- **Status**: Verified

## Context & Rationale

AgentDock is an existing production-oriented Electron + React desktop application with a Local AI Core daemon. This change establishes the formal Architecture-as-Code governance baseline required by the `project-setup` contract:

1. Unified `docs/architecture.md` system facts entry.
2. Architecture maintenance policy at `docs/architecture/maintenance.md`.
3. Diagram provider manifest at `docs/architecture/diagram-provider.yaml`.
4. Append-only architecture change history under `docs/architecture/changes/`.
5. Managed agent routing blocks in `AGENTS.md` and `CLAUDE.md`.
6. Managed architecture diagram block in `README.md`.
7. Aggregated `pnpm verify` / `pnpm qa` quality gate commands in `package.json`.

## Implemented Architecture Facts

### Component & Process Boundaries

1. **Electron Shell** (`electron/`): Thin desktop lifecycle host. Spawns Local AI Core (`services/local-ai-core/`) as a child process using `ELECTRON_RUN_AS_NODE=1`. Exposes no IPC bridge to the renderer; all communication is pure HTTP / WebSocket.
2. **React Renderer** (`src/`): Web UI orchestrated with React 19, Zustand stores, and TailwindCSS. Communicates with Local AI Core over `http://127.0.0.1:9831/api/local/v1/*`.
3. **Local AI Core** (`services/local-ai-core/`): Node.js HTTP/WebSocket server owning workspace management, thread sessions, ACP (Agent Client Protocol) bridging, background task scheduler, channel gateways (Lark, WeChat), and knowledge storage.
4. **Sandbox Runtime**: Docker / OpenSandbox execution environments spawned on demand for secure agent runs, communicating via HTTP NDJSON ACP bridge.
5. **Shared Contracts & SDKs** (`packages/`, `shared/`): Type-safe boundaries defining cross-process types (`shared/desktop.ts`), plugin SDK (`@cc/plugin-sdk`), and core contracts (`@cc/superai-contracts`).

### Quality Gates & Invariants

- **Static Quality Gates**: Zero circular dependencies, copy-paste duplicate rate `<= 5%`, knip dead-code ceiling `<= 171`, max file size `<= 1000` lines, max function length `<= 45` lines, ESLint cyclomatic complexity `<= 108` warnings.
- **Architecture Gate**: `pnpm lint:arch` runs Archify showcase validation across all 5 JSON specifications in `docs/architecture/`.
- **Test Invariants**: Unit, contracts, integration, and Cucumber BDD tests pass 100%.

## Evidence & Validation

- `pnpm typecheck`: Exit code 0 (zero TypeScript errors)
- `pnpm lint:gates`: Exit code 0 (zero circular dependencies, duplicates, dead code, file size, or function length violations)
- `pnpm lint:arch`: Exit code 0 (5/5 specifications passed 9 showcase checks)
- `pnpm test`: Exit code 0 (729 unit/integration/contract tests passed, 80/80 BDD scenarios passed)
- `pnpm coverage`: Exit code 0 (meets `.c8rc.json` thresholds: lines >= 68, statements >= 68, functions >= 72, branches >= 66)
