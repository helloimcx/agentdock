# Chat thread selection and snapshot delivery

Date: 2026-10-31. Base revision: `abafe15` (`origin/main`). Implemented in isolated worktree `codex/2026-10-31-chat-detail-flicker`.

## Changed architecture facts

- The renderer reads thread history in `limit` / `before_seq` pages and requests an optional 50-message window on the versioned runtime SSE watch. The watch endpoint still returns complete snapshots when older clients omit `limit`.
- The renderer treats URL changes and sidebar selections as separate navigation intents. It drops stale GET/SSE results, merges current snapshots with already loaded history, and fetches pages to fill a missing sequence window after reconnect.
- The daemon SSE writer waits for response `drain` when its write buffer is full. While blocked, the snapshot watcher coalesces new revisions; response close/error removes the drain listeners and watcher.

## Affected components and boundaries

Renderer chat/session browser, Core SDK runtime watch, daemon thread runtime handler, snapshot projection store, and SQLite-backed thread history. The renderer-to-daemon HTTP/SSE boundary gains an optional query parameter; message persistence and ownership do not change. No migration, new process, external integration, trust boundary, or service was added.

## Rationale and compatibility

Large thread histories made each runtime snapshot expensive and whole-detail replacement could discard paged history or restore an older selection. An opt-in window keeps the legacy complete-snapshot behavior for callers that do not pass `limit`. REST history uses the existing `before_seq` pagination contract. The renderer also trims full snapshots from older daemons to the recent window while preserving any sequence-less live partial.

## Code and test evidence

- `apps/web/src/pages/Threads/useThreadChatSessionBrowser.ts`: selection intent, stale response, bounded watch, and snapshot revision guards.
- `apps/web/src/pages/Threads/useThreadChatConversationState.ts` and `thread-chat-snapshot.ts`: ordered history merge, recent-window normalization, and sequence-gap backfill.
- `apps/daemon/src/runtime/handlers/thread-runtime-handler.ts` and `thread-snapshot-watch.ts`: optional window and drain-aware revision delivery.
- `apps/daemon/src/acp/store/local-core-acp-store.ts`: windowed atomic snapshot projection.
- `tests/integration/thread-runtime-snapshot.test.ts` and `apps/web/src/pages/Threads/thread-chat-snapshot.test.ts`: bounded compatibility, URL selection, history merge/gap, slow consumer coalescing, and disconnect cleanup.
- Approved expected flow: [Plan](../../plans/2026-10-31-chat-detail-flicker.md).

## Provider and validation

Provider: Archify; source: [durable execution workflow](../durable-execution.workflow.json). On 2026-11-01, Archify 3.2.0 finalized the workflow with all gates passing and no diagnostics. The spec SHA-256 is `9f1011547c5778a9a0edc977da6ca31b815ceee73c7c55d2d1204ce325a67e78` (4,900 bytes); the HTML SHA-256 is `e22d48da3eece96f17ad8560d858b581f976b94dab45383fd6a834bec5a39c76` (829,806 bytes). Finalize, browser-check, and visual-check receipts are under [the 2026-11-01 review evidence](../durable-execution-workflow.review-2026-11-01/). Automated visual checks passed in light and dark themes at 1440×900 and 2048×1320. Manual inspection found the workflow readable and contained at all four sizes.

Validation on the final code:

- `pnpm typecheck` — passed.
- `pnpm lint:complexity:gate` — passed at the configured 108-warning cap; no errors.
- `ARCHIFY_BIN=… pnpm lint:arch` using the repository-pinned Archify 3.2.0 renderer — 9 specifications passed, 0 failed.
- `pnpm exec tsx --test apps/web/src/pages/Threads/thread-chat-snapshot.test.ts tests/integration/thread-runtime-snapshot.test.ts` — 13 tests passed.
- `pnpm verify` with Archify 3.2.0 — passed, including typecheck, all static gates, architecture lint, and the CI test pipeline. The dead-code report is 165 symbols against a maximum of 172; complexity is at the configured 108-warning cap with no errors.
- CI coverage — 1,154 compiled Node tests passed; coverage thresholds passed (75.77% lines, 73.85% branches, 82.62% functions); all 80 BDD scenarios / 286 steps passed.
- Local browser QA against the updated renderer and an isolated daemon: clicked between two blank test threads in both directions and verified the selected heading and `session` URL stayed aligned; also checked direct thread links and browser navigation. The temporary test workspace was cleaned after QA.

The hosted AgentDock page still serves the prior renderer, so it cannot validate this unmerged worktree. The regression was verified against the local build containing the fix.
