# 2026-11-06 — Degrade workspace listing per workspace instead of failing the whole list

- Architecture Impact: Required (public protocol: `WorkspaceSummary` gains optional fields; `GET /api/local/v1/workspaces` failure mode changes from all-or-nothing 500 to per-workspace degradation).
- Base revision: `b513f1e` (`origin/main`).
- Implementation: branch `fix/issue-236-butler-missing-provider` (PR: Closes #236).

## Semantic delta

- `WorkspaceRouter.listWorkspaces` no longer lets a single unroutable project fail the whole listing. Route resolution per project is isolated: a project whose route cannot be resolved (for example, its `agent.options.provider_id` no longer exists) stays in the response as a `WorkspaceSummary` with `unavailable: true` and `unavailableReason` naming the workspace and the missing dependency (the existing `withResolvedProjectProvider` error text). Healthy workspaces are unchanged.
- `WorkspaceSummary` (shared contract) gains optional display-only fields `unavailable?: boolean` and `unavailableReason?: string`. Additive and optional; consumers that do not know them are unaffected. Data ownership and flows are unchanged: the daemon still derives the summary from runtime config plus thread counts.
- `WorkspaceRouter.listLocalCoreProjects` (private, single caller) now returns per-project `{ project, route, error? }` entries instead of a filtered project array, which also removes the previous double route resolution (filter + loop each resolved routes).
- The Butler page (`useButlerPage.reload`) loads profile, workspaces, and bot discovery via `Promise.allSettled` through the pure `applyButlerReload` model function: fulfilled parts always render, failures are joined into the page error. A workspace-discovery failure can no longer blank the saved Butler profile and bot list.
- Failure semantics: the broken workspace remains visible with its cause (verifiable, user-actionable); any single-part reload failure in Butler shows partial data plus a scoped error string.

## Evidence

- Contract: `packages/contracts/src/workspace.ts` (`WorkspaceSummary.unavailable`, `.unavailableReason`).
- Degraded listing: `apps/daemon/src/router/workspace-router.ts` (`listWorkspaces`, `listLocalCoreProjects`).
- Independent Butler loading: `apps/web/src/pages/Butler/butler-page-model.ts` (`applyButlerReload`), `apps/web/src/pages/Butler/useButlerPage.ts` (`reload`).
- API fact: `docs/architecture.md` §3 (`/api/local/v1/workspaces/*`).
- Tests: `tests/integration/workspace-list-unavailable.test.ts` (broken workspace stays listed with identifying reason; healthy workspace untouched; red-state verified against `b513f1e` where the request threw); `apps/web/src/pages/Butler/butler-page-model.test.ts` (partial-failure aggregation, non-Error reasons).

## Compatibility

- Backward compatible: new contract fields are optional; response shape for healthy workspaces unchanged; no CLI/config/migration impact.

## Validation

- `[PASS]` `pnpm build:electron`.
- `[PASS]` `node --test` compiled: workspace-list-unavailable 1/1, butler-page-model 4/4.
- `[PASS]` `tsc --noEmit -p tsconfig.electron.json` (results recorded in PR body).
- `[PASS]` Full compiled Node suite and static gates (results recorded in PR body).
- Diagram provider: no L1–L3 update required — component identities, data flows, and trust boundaries are unchanged; the delta is a response-level degradation policy recorded here.
