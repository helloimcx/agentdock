# 2026-10-13 — Butler manages channel bot identities

- Architecture Impact: Required.
- Base revision: `ab7c192` (`origin/main`). This correction is implemented in the isolated worktree branch `codex/2026-10-12-butler-orchestration` before the Butler feature is merged or released.
- Prior semantic record: [2026-10-12 workspace-target Butler proposal](2026-10-12-butler-orchestration.md). This record corrects its user-facing target model; the older record remains append-only history.
- Active provider: Archify. Current sources are `docs/architecture/system-architecture.json` and `docs/architecture/butler-orchestration.workflow.json`.

## Semantic delta

- The Butler is itself one configured Lark bot identity. Its managed roster contains other concrete bot identities (`appId` + `botOpenId`); neither a workspace, private conversation, nor group chat is a task target.
- Each managed bot is bound to a specific Local AI Core workspace and channel instance for execution. Each roster entry must also configure a shared Lark group ID containing that bot and the Butler. The group ID is only a delivery route, and one group can host multiple bots. The owner's Butler conversation is kept separate from this route.
- Core sends the selected bot a bounded protocol message with a native Lark mention. Only the configured sender, recipient runtime, shared group, task, delegation, operation and unique inbound platform message can start or update work.
- A target bot runs the task in its own ordinary WorkspaceRouter thread with its existing Agent and permission policy. Core observes exact thread/run and approval state, returns progress and results through the target bot's channel credentials, and reports meaningful changes to the owner.
- Cancellation, ambiguous delivery, run completion and user acceptance remain separate durable states. A completed run is not accepted until the user reviews and accepts the outcome.
- Lark/Feishu is the v1 bot-to-bot channel. Weixin Work iLink remains an ordinary conversation gateway and is not used as a Butler bot transport. The Butler manager runtime must have local Core CLI access.

## Rationale and compatibility

The user clarified that the product being managed is a set of channel bots, with the Butler acting as one of those bots and able to message its roster. This replaces the earlier workspace-assignment interpretation before release. Bot identity, workspace runtime binding, owner conversation, worker thread/run, operation ID and delivery-group ID remain distinct domains. The group is explicitly configured because a channel binding does not reliably distinguish a direct conversation from a group using the chat ID alone. Existing workspace permissions remain authoritative; no Butler privilege is copied to a managed bot.

## Evidence

- Contracts and Lark message envelope: `packages/contracts/src/butler.ts`, `services/local-ai-core/src/channel/lark/inbound.ts`, `services/local-ai-core/src/channel/lark/inbound-handler.ts`, `services/local-ai-core/src/channel/lark/outbound-transport.ts`, and `services/local-ai-core/src/channel/lark/local-core-lark-gateway.ts`.
- Runtime and persistence: `services/local-ai-core/src/runtime/channel-service.ts`, `services/local-ai-core/src/butler/butler-service.ts`, `services/local-ai-core/src/butler/butler-dispatcher.ts`, and `services/local-ai-core/src/acp/store/butler-store.ts`.
- API, client, CLI and user surface: `services/local-ai-core/src/runtime/butler-routes.ts`, `packages/core-sdk/src/butler.ts`, `services/local-ai-core/src/cli/butler-cli-handlers.ts`, `src/pages/Butler/`, and `services/local-ai-core/src/skills/builtin/butler/SKILL.md`.
- Tests: `tests/integration/lark-butler-bot.test.ts`, `tests/integration/butler-service.test.ts`, `tests/integration/butler-http.test.ts`, `tests/electron/lac-cli-butler.test.ts`, `tests/contracts/core-sdk-butler.test.ts`, and `tests/contracts/butler-page-model.test.ts`.
- Channel workflow and setup: [current Butler HTML](../butler-orchestration.html), [typed workflow source](../butler-orchestration.workflow.json), [module/API notes](../butler-orchestration.md), and [current specification](../../specs/2026-10-13-butler-channel-bot-management.md).
- Lark setup requirements: [Lark SDK bot-to-bot notes](https://github.com/larksuite/channel-sdk-node#bot-at-bot) and [Feishu custom bot mention guide](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot). Bot-authored group event delivery must be enabled (`im:message.group_at_msg` / `include_bot`).

## Validation

- `[PASS]` Focused Butler, Lark protocol, HTTP/ACP, CLI, SDK and page-model tests: 41/41; `pnpm typecheck` passed.
- `[PASS]` `pnpm lint:arch`: 9 specifications passed, 0 failed. Archify delivered the current L1 architecture and L2 Butler workflow HTML at 9/9 showcase checks, with 0 errors and warnings. Automated visual checks passed at 1440×900, 1600×1000, 1920×1080 and 2048×1320; both themes were visually reviewed.
- `[PASS]` `pnpm verify` exited 0 on the final PR commit: typecheck, lint gates, `pnpm lint:arch` (9 specifications), renderer/backend builds, 1,075 Node tests, 80 BDD scenarios / 286 steps, and coverage (75.11% statements/lines, 73.39% branches, 82.05% functions).
- `[PASS]` Final documentation/link review and `git diff --check`; README and overview point to the current Butler HTML instead of the earlier workspace-target PNG preview.
- `[BLOCKED]` Fresh stable light/dark PNG exports were not generated. The local browser-use policy rejected opening the generated `file://` artifact for export; no alternate browser route was used. README retains its configured inline Mermaid fallback, and the architecture matrix links only the current HTML for the updated L1 and Butler L2 diagrams rather than the old workspace-target PNG previews. Archify visual-check screenshots remain beside the HTML artifacts.
- Synthetic Lark/ACP fixtures verify message delivery and callback identity. No real Lark app credentials or live Lark delivery were available for this validation.
