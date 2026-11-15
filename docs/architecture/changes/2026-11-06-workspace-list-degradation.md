# 2026-11-06 — Degrade workspace listing per workspace instead of failing the whole list

- Architecture Impact: Required (public protocol: `WorkspaceSummary` gains optional fields; `GET /api/local/v1/workspaces` failure mode changes from all-or-nothing 500 to per-workspace degradation).
- Original implementation base: `b513f1e`. Architecture repair baseline: `58578f722bb6ea9386cdbe80fd21d01c4b7d08b6` (`origin/main`, 2026-11-14).
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

## Diagram provider

Archify, as declared in [the provider manifest](../diagram-provider.yaml). The [system diagram source](../system-architecture.json) records per-entry degradation under the existing Daemon core. Components, relationships and boundaries are unchanged. The [overview](../overview.md) and the README architecture block describe the same listing contract. The [Archify comparison receipt](2026-11-06-workspace-list-degradation.delta.receipt.json) confirms that only the API node description and supporting presentation changed; no nodes moved and no relationships or boundaries changed.

## Validation

- `[PASS]` `pnpm build:electron`.
- `[PASS]` `node --test` compiled: workspace-list-unavailable 1/1, butler-page-model 4/4.
- `[PASS]` `tsc --noEmit -p tsconfig.electron.json` (results recorded in PR body).
- `[PASS]` Full compiled Node suite and static gates (results recorded in PR body).
- `[PASS]` Archify showcase finalization and browser checks; [interactive diagram](../system-architecture.html), [light](../system-architecture.light.png) and [dark](../system-architecture.dark.png) outputs match the candidate.
- `[PASS]` 2026-11-14: pinned Archify `pnpm lint:arch` (12 specs), README block and local documentation links, and complete `pnpm verify` (1,219 compiled tests passed, 1 optional skip; 80 BDD scenarios passed).
