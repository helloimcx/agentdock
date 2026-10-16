# Butler App-Scoped Lark Mentions Plan

Date: 2026-10-16. Base revision: `cc05269` (`chore(release): v0.1.93`). Implementation branch: `codex/butler-app-scoped-mentions` in the managed worktree.

Architecture Impact: Required — this changes shared channel message contracts, Lark identity lookup, Butler configuration and callback verification across app credentials.

## Approved design

The `design/index.html` Butler configuration increment was confirmed by the user on 2026-10-16 before renderer implementation. The form adds the managed bot's visible group name from the Butler app's perspective, the Butler's visible name from the managed app's perspective, and the shared group ID.

## Implementation steps

1. Add both visible-name fields to shared Butler and channel contracts and validate them in the Butler profile route/service.
2. Resolve exact group bot names using the selected Lark runtime's app credentials; cache by app ID and chat ID and reject missing/ambiguous results.
3. Use sender-app IDs for outbound mentions and receiver-app IDs for sender validation in both command and result directions.
4. Update the Butler setup UI, all locale strings, CLI guidance, and synthetic cross-layer fixtures.
5. Update current architecture facts, one semantic change record, the typed Butler workflow source and delivered HTML, overview matrix, and one managed README diagram block.
6. Run focused tests, `pnpm lint:arch`, documentation/link checks, `pnpm verify`, and diff review. Report synthetic versus live Feishu evidence separately.

## Verification status

- `[PASS]` Focused Lark, Butler service/HTTP, SDK and CLI tests: 38/38; `pnpm typecheck` passed.
- `[PASS]` Archify showcase validation/delivery and multi-viewport visual checks; `pnpm lint:arch` passed within `pnpm verify`.
- `[PASS]` `pnpm verify` passed, including all quality gates, 1,083 Node tests, 80 BDD scenarios, and coverage thresholds.
- `[PASS]` Documentation, prototype checklist, and final diff review passed; `git diff --check` is clean.
- `[PENDING]` Live group verification after release.
