# Durable execution architecture delta

Date: 2026-10-03. Approved: 2026-10-03; implementation evidence recorded 2026-10-04.
Base: `c133018`; clean detached task worktree reused on `codex/2026-10-03-durable-execution`.

## Proposed added/changed facts

- Core gains atomic submission admission and per-thread dispatch ownership.
- Core gains durable final-report outbox and actual gateway receipt ownership; execution and delivery outcomes are independent.
- Thread runtime view becomes a persistent versioned projection, with snapshot-first watch synchronization; trace remains observability.
- A new opt-in global ESM Pi Durable worker owns one SQLite and one Harness for all independent thread Conversations and internal checkpoints. Core owns business identifiers/state; deterministic request keys reconcile two separate databases.
- Initial Durable trial exposes read-only local text tools and supports a compatible Node executor. Existing Pi/ACP behavior remains available.

## Rationale / compatibility

Recover the smallest operation whose outcome is known. Unknown external sends and traditional ACP execution are not blindly replayed. Additive contracts/migrations preserve legacy callers and history. At the user's request, the proposal now uses global SQLite per Core user-data instance, with a singleton multiplexed worker preventing multiple storage owners. Each thread remains an isolated Conversation; cancellation and credentials are scoped to it. Worker recovery is shared; traditional ACP processes remain unchanged. No PostgreSQL, multi-Core shared database, Electron upgrade or legacy JSONL migration.

## Proposed evidence / provider

See [Spec](../../specs/2026-10-03-durable-execution.md) and [Plan](../../plans/2026-10-03-durable-execution.md) for code evidence, identifiers, migration and executable acceptance criteria.

Provider: Archify workflow v2. [Expected flow HTML](2026-10-03-durable-execution.html) and [source](2026-10-03-durable-execution.workflow.json). This is a proposal artifact; official current architecture/README diagrams are deliberately unchanged before implementation.

Acceptance after implementation additionally requires current facts, formal L1–L3 source/artifacts, overview, README and `pnpm verify`/`pnpm lint:arch` to agree. Proposal diagram receipts do not establish implementation correctness.

## Proposal validation

Archify delivery: PASS, 9 showcase checks, 0 errors / 0 warnings.

- Specification SHA-256: `47facdc984b0fe6bae7cfe262dbbd8e8341c80757ba3271fdd871bc42b5da3f8`.
- HTML SHA-256: `d5c1c38a2f17aaf5a7e2c9f0fe3182c33314ec6bc5197f1eb9dcae594acee381` (717630 bytes).
- Automated browser evidence: PASS, receipt [visual-check.json](2026-10-03-durable-execution.visual-check.json).
- Implementation gates remain NOT RUN; awaiting approval of the complete plan.

## Approval and implementation evidence — 2026-10-03

The user approved the global SQLite baseline (one worker/Harness/database per Core user-data instance) and requested implementation to continue. Spec/Plan above remain the approved design baseline; proposed diagram validation is separate from implementation evidence.

- Architecture CLI lookup now supports `ARCHIFY_BIN`, repository-local installation and the user's standard skill installation; no machine-specific path is committed. Existing five formal specs passed `pnpm lint:arch` before implementation diagrams are synchronized.
- Permission ordering regression: a failed persisted approval decision previously sent an allow response and remembered allow-all. Regression test first failed; implementation now persists the decision before any transport release or grant. All six permission integration tests passed.

## Implemented facts and verification — 2026-10-04

- Submission admission now persists stable request identities, payload digests, user messages and reserved run IDs transactionally. Channel message IDs deduplicate both slash commands and ordinary inbound prompts across `/new` and restart. Traditional ACP uncertainty is retained as interrupted/unknown; Pi Durable reconciles with the original submission ID.
- Automation and Scheduler final reports use a persistent outbox with immutable destination and run-scoped content. Gateway adapters report confirmed receipts; ambiguous sends become `unknown` and are not blindly resent. The Automation detail view exposes recovery actions.
- Thread snapshot/watch now provides a persisted, monotonically versioned projection and snapshot-first SSE handshake. Chat clients consume baseline state on connect/reconnect; stale ACP permissions lose actionability.
- The opt-in `pi-durable` runtime runs in one ESM worker/Harness and one `runtime/pi-durable.sqlite` per Core user-data directory. All its threads share that DB while retaining independent Conversations. Core and Durable keep separate stores and reconcile using stable submission IDs; no cross-database transaction is claimed.
- Initial Durable support is restricted to text prompts, configured OpenAI-compatible providers and read-only workspace tools. Credentials are runtime configuration and are not persisted. Unsupported sandbox/MCP/write-tool settings fail closed. Electron's bundled Node 22.16 is below upstream's Node 22.19 minimum; the host probes a compatible configured/PATH Node and otherwise reports the capability as unavailable.
- Evidence: `pnpm verify` passed on 2026-10-04 (typecheck, all static gates, architecture lint, full test/BDD suite and coverage). The focused submission, permission, outbox and slash-command rerun passed 48/48 tests. `pnpm lint:arch` passed all 6 official specs × 9 showcase checks. Archify deterministic delivery and browser containment/readability checks passed for all 6 current diagrams after compacting the ACP sequence and lifecycle canvases. Real external channel and live-provider credentials were not exercised; controlled gateway/provider fixtures cover acknowledgement and model boundary behavior. The current app runtime still needs a compatible Node >=22.19 child executor for Pi Durable; Electron's bundled 22.16 is below that requirement.

Current artifacts: [system architecture](../system-architecture.html), [persistent execution workflow](../durable-execution-workflow.html), [ACP sequence](../acp-session-flow.html), [run lifecycle](../agent-run-lifecycle.html), and [architecture matrix](../overview.md).
