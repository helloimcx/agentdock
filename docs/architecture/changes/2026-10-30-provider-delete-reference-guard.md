# 2026-10-30 — Provider deletion reference guard with compensating repoint

- Architecture Impact: Required.
- Base revision: `ff910de` (`origin/main`); implementation executed on branch `fix/issue-237-provider-delete-guard` (PR #266).
- Prior semantic record: [2026-10-17 Monorepo peer topology normalization and daemon rename](2026-10-17-peer-topology-daemon-refactor.md).
- Active provider: Archify (unavailable in this environment — see Validation).

## Semantic delta

- `DELETE /api/local/v1/providers/:providerId` now enforces referential integrity against the runtime config before deleting a model provider. Workspace→provider references live in `project.agent.options.provider_id` inside the persisted runtime config (`DesktopConnectConfig.projects`), while provider rows live in the daemon SQLite store; until this change the delete path ignored the config side entirely, producing dangling references that made `GET /api/local/v1/workspaces` fail for the whole list (`withResolvedProjectProvider` throws on the first dangling provider).
- Guard behavior (new handler `provider.delete` in `apps/daemon/src/runtime/handlers/provider-handler.ts`):
  - No dependents: delete proceeds exactly as before (no config write).
  - Dependents and no `replacement_provider_id`: rejected with HTTP 409 (`ProviderInUseError`) listing every dependent workspace label; no store or config write occurs.
  - Dependents and a valid `replacement_provider_id`: the repoint is persisted first via `controller.saveRuntimeConfig` (the full normalize/refresh/emit pipeline), then the provider row is deleted. A delete failure is compensated by restoring the captured pre-call config, so workspaces keep referencing the surviving provider. Both failure directions are observationally atomic: any caller-visible error leaves the system in the exact pre-call state.
  - Validation of the replacement (must exist, must differ from the target) happens before any write.
- New cross-medium write ordering (JSON config file first, SQLite second) is owned entirely by the daemon runtime handler; the store and controller interfaces are unchanged. A process crash between the repoint save and the delete remains a documented residual window (provider row survives, workspaces reference the replacement) — repairable by re-deleting or re-creating the provider, and strictly narrower than the previous always-dangling failure mode.
- SDK surface: `deleteModelProvider(providerId, { replacementProviderId })` in `packages/sdk/src/runtime.ts` forwards the replacement opt-in.
- Diagram specs: no update required. The five Archify matrix specs under `docs/architecture/` (`system-architecture.json`, `scheduled-delivery-workflow.json`, `acp-session-flow.sequence.json`, `skill-router.workflow.json`, `agent-run.lifecycle.json`) contain zero provider-source references; the provider store is not a modeled component, so no node/edge changes apply.

## Evidence

- Handler and guard: `apps/daemon/src/runtime/handlers/provider-handler.ts` (`ProviderInUseError`, `provider.delete` repoint/compensation flow).
- HTTP error mapping: `apps/daemon/src/runtime/server.ts` (`ProviderInUseError` → 409 in the request catch chain).
- Dangling-reference consumer that motivates the guard: `apps/daemon/src/router/workspace-router.ts` (`withResolvedProjectProvider`).
- SDK: `packages/sdk/src/runtime.ts` (`deleteModelProvider`).
- Tests: `tests/electron/provider-delete-guard.test.ts` (conflict listing, repoint+delete persistence, rollback on delete failure, unknown replacement, self-replacement, unreferenced delete unaffected).

## Validation

- `[PASS]` `pnpm typecheck` (0 errors across `tsconfig.json` and `tests/bdd/tsconfig.json`).
- `[PASS]` `node --test dist-electron/tests/electron/provider-delete-guard.test.js` (6/6 passed; rollback case red-state validated by temporarily removing the compensation — only the rollback case failed, confirming the test discriminates).
- `[PASS]` `pnpm test` (tooling checks, typecheck, renderer + Electron builds, compiled Node suite, BDD).
- `[PASS]` `pnpm lint:circular` (0 cycles), `pnpm lint:duplicate`, `pnpm lint:file-size`, `pnpm lint:function-length --fail --max-count 45`.
- `[FAIL]` `pnpm lint:complexity:gate` reports 109 warnings against the 108 budget on a clean tree. Verified pre-existing on `main` via `git stash` roundtrip (clean `main` also reports 109); the three source files touched here contribute zero warnings. Threshold adjustment is a maintainer decision and is not addressed by this change.
- `[BLOCKED]` `pnpm lint:arch` — no Archify provider available in this environment (`ARCHIFY_BIN` unset; no bundled skill binary). CI runs `lint:arch` with a pinned upstream Archify revision. Because no diagram/provider-source spec changes are required (see Semantic delta), the last-known-good showcase artifacts remain valid for this change.
