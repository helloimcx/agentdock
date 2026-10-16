# 2026-10-16 — Resolve Butler mentions within each Lark app scope

- Architecture Impact: Required.
- Base revision: `cc05269` (`chore(release): v0.1.93`); implementation began in managed worktree branch `codex/butler-app-scoped-mentions`.
- Approved UI prototype: `design/index.html`, confirmed by the user on 2026-10-16 before renderer implementation.
- Prior semantic record: [2026-10-13 Butler channel bot management](2026-10-13-butler-channel-bot-management.md).
- Active provider: Archify. Updated source: `docs/architecture/butler-orchestration.workflow.json`.

## Semantic delta

- A Lark `open_id` belongs to the app credentials that obtained it. Persisted bot IDs from each endpoint can identify the bots to AgentDock, but cannot be reused as the recipient or sender ID from a different bot app.
- Butler profile entries now include the exact managed-bot name as visible to the Butler app and the Butler name as visible to the managed app. Configuration validates both names in the shared group using each app's own runtime credentials.
- Lark outbound delivery resolves the exact unique visible name from `GET /open-apis/im/v1/chats/{chat_id}/members/bots` under the sending runtime. The 30-second cache is scoped to `(appId, chatId)`; missing, ambiguous, malformed, or failed lookups do not send a message.
- Worker command validation resolves the Butler under the worker app's credentials. Butler callback validation resolves the worker under the Butler app's credentials. Both compare that scoped result to the inbound event sender identity before accepting work or progress.
- No workspace selection, task ownership, execution permission, group-routing, or retry behavior changes. Existing profiles that predate the visible-name fields require the names to be completed in the setup page (or CLI) before new delegation can succeed.

## Evidence

- Contracts and transport: `packages/contracts/src/butler.ts`, `packages/contracts/src/local-core.ts`, `packages/plugin-sdk/src/channels.ts`, `services/local-ai-core/src/runtime/channel-service.ts`, `services/local-ai-core/src/channel/lark/outbound-transport.ts`, `services/local-ai-core/src/channel/lark/local-core-lark-gateway.ts`.
- Setup and callback checks: `services/local-ai-core/src/butler/butler-service.ts`, `services/local-ai-core/src/butler/butler-dispatcher.ts`, `services/local-ai-core/src/runtime/handlers/butler-handler.ts`.
- User and CLI surfaces: `src/pages/Butler/ButlerSetupCard.tsx`, `src/i18n/locales/`, `services/local-ai-core/src/cli/butler-cli-handlers.ts`, `services/local-ai-core/src/skills/builtin/butler/SKILL.md`.
- Focused cross-layer evidence: `tests/integration/lark-butler-bot.test.ts`, `tests/integration/butler-service.test.ts`, `tests/integration/butler-http.test.ts`, `tests/contracts/core-sdk-butler.test.ts`, `tests/electron/lac-cli-butler.test.ts`.
- Architecture: [updated Butler workflow](../butler-orchestration.html), [typed workflow source](../butler-orchestration.workflow.json), and [Butler orchestration facts](../butler-orchestration.md).

## Validation

- `[PASS]` Focused Lark, Butler service/HTTP, SDK and CLI tests: 38/38; `pnpm typecheck` passed.
- `[PASS]` Archify showcase validation/delivery and multi-viewport visual checks; `pnpm lint:arch` passed within `pnpm verify`.
- `[PASS]` `pnpm verify` passed, including all quality gates, 1,083 Node tests, 80 BDD scenarios, and coverage thresholds.
- `[PASS]` Documentation, prototype checklist, and final diff review passed; `git diff --check` is clean.
- `[PENDING]` Live group verification after release.
