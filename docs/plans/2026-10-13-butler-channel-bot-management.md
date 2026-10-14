# Butler Channel Bot Management Plan

Date: 2026-10-13. Base revision: `ab7c192` (`origin/main`); implementation branch: `codex/2026-10-12-butler-orchestration` in the isolated managed worktree.

Architecture Impact: Required — changes Butler's public task target from workspace assignments to channel bot identities and adds a real asynchronous bot-to-bot channel protocol with identity-checked callbacks.

## Decisions

- The Butler is a configured Lark bot identity and manages other configured Lark bot identities. Workspace/instance is the runtime binding for a bot; a group ID is only a message route.
- Use Lark bot-authored group messages with explicit mentions and a bounded typed protocol envelope. Require the configured bot sender, recipient runtime, group and operation identity on callbacks.
- After a target bot receives the command, use its ordinary `WorkspaceRouter` thread and existing permission policy. The manager does not invoke the worker agent directly or copy its own privileges.
- Preserve durable task and operation records, exact thread/run identities, user acceptance, and fail-closed behavior for ambiguous message delivery or execution outcomes.
- Lark/Feishu is the v1 bot-to-bot channel. Weixin Work iLink remains an ordinary conversation connector.

## Implementation steps

1. Add shared bot endpoint/profile/protocol contracts and a Lark bot-message transport; test message normalization, explicit mentions, envelope bounds and malformed protocol rejection.
2. Route bot-authored Lark group events separately from human ACP messages; emit a typed internal event with recipient runtime and sender bot identity.
3. Extend Butler SQLite state and APIs for manager/managed bot identity snapshots, delivery groups, bot operations and inbound message deduplication.
4. Implement manager-to-target dispatch, target-to-manager acceptance/progress/result callbacks, worker-thread creation, follow-up, cancellation, reconciliation and owner notifications.
5. Update renderer setup and task display, Core SDK, REST validation, CLI commands, and the Butler managed skill to select `botId` values.
6. Update README, current architecture facts, semantic correction record, typed Archify source, overview and L1 diagram. Keep the earlier workspace-target architecture record as history and link the correction.
7. Run focused protocol/service/HTTP/CLI tests, both TypeScript checks, `pnpm lint:arch`, and `pnpm verify`; report synthetic versus live Lark evidence separately.

## Data and trust boundaries

The Butler task/delegation/operation IDs, platform message IDs, bot identity IDs, worker thread IDs and ACP run IDs remain distinct. Protocol payloads and target bot results are untrusted task data. The Core checks the exact configured runtime and platform identities before creating or updating executions. Ordinary workspace permissions remain authoritative.

## Verification status

- `[PASS]` Focused Butler, Lark protocol, HTTP/ACP, CLI, SDK and page-model tests: 41/41; `pnpm typecheck` passed.
- `[PASS]` `pnpm lint:arch`: 9 specifications passed, 0 failed. Archify delivered the current L1 architecture and L2 Butler workflow HTML at 9/9 showcase checks, with 0 errors and warnings. Automated visual checks passed for both artifacts at the configured desktop viewports; light/dark screenshots were also visually reviewed.
- `[PASS]` `pnpm verify` exited 0 on the final PR commit: typecheck, lint gates, `pnpm lint:arch` (9 specifications), renderer/backend builds, 1,075 Node tests, 80 BDD scenarios / 286 steps, and coverage (75.11% statements/lines, 73.39% branches, 82.05% functions).
- `[PASS]` `git diff --check`; README/overview point to the current Butler HTML and no longer link the workspace-target Butler PNG preview.
- `[BLOCKED]` Current standalone light/dark PNG exports were not regenerated. The local browser-use policy rejected opening the generated `file://` artifact for export, and no alternate browser route was used. The README keeps its configured inline Mermaid fallback; the architecture matrix no longer links the old workspace-target Butler PNGs or unverified system PNGs. The current interactive HTML and its visual-check screenshots remain available.
- Synthetic channel/ACP fixtures validate message flow and callback identity. No real Lark app credentials or live Lark delivery were available for this validation.
