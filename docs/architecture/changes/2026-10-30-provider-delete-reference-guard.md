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
- **Serialization boundary (added 2026-10-31 after review finding):** the controller now owns a single runtime-config mutation lock (`LocalCoreController.runExclusiveRuntimeConfigWrite`, a promise-chain mutex). `saveRuntimeConfig` acquires it around the existing persist/normalize/refresh pipeline (now exposed as `applyRuntimeConfig`); `WorkspaceRouter`'s direct `store.saveRuntimeConfig` call (workspace standards save) is routed through the controller via an injected saver hook; and the `provider.delete` handler runs its whole read→check→repoint→delete sequence as one critical section. A concurrent config write therefore cannot land between the dependent check and the provider-row deletion. A deterministic regression test gates the repoint save and proves a queued concurrent config write only runs after `provider-deleted` (`tests/electron/provider-delete-guard.test.ts`).
- Residual limitation of the serialization: a config write that was captured *before* the delete and queued on the lock still lands *after* it; if that write introduces references to the deleted provider it leaves a dangling reference that workspace resolution then rejects at read time. That is the pre-existing last-writer-wins behavior shared by all runtime-config writers and is not introduced by this change; eliminating it would require compare-and-swap semantics across every config writer, which is out of scope for issue #237.
- SDK surface: `deleteModelProvider(providerId, { replacementProviderId })` in `packages/sdk/src/runtime.ts` forwards the replacement opt-in.
- Diagram specs: no provider component exists in the active Archify matrix (all five spec JSONs contain zero provider-source references), so no node/edge edits apply. Review finding (2026-10-29 22:04) requested adding an L2 provider-deletion flow and a matrix row; producing a new unvalidated spec plus generated artifacts without an Archify provider would risk failing `lint:arch` in CI, so that step is recorded as blocked below and `docs/architecture/overview.md` and `docs/architecture.md` carry the current facts instead.

## Evidence

- Handler and guard: `apps/daemon/src/runtime/handlers/provider-handler.ts` (`ProviderInUseError`, `provider.delete` exclusive critical section with repoint/compensation flow).
- Serialization boundary: `apps/daemon/src/runtime/local-core-controller.ts` (`saveRuntimeConfig` / `applyRuntimeConfig` / `runExclusiveRuntimeConfigWrite`, router saver injection), `apps/daemon/src/router/workspace-router.ts` (`setRuntimeConfigSaver`, standards save routed through the controller).
- HTTP error mapping: `apps/daemon/src/runtime/server.ts` (`ProviderInUseError` → 409 in the request catch chain).
- Dangling-reference consumer that motivates the guard: `apps/daemon/src/router/workspace-router.ts` (`withResolvedProjectProvider`).
- SDK: `packages/sdk/src/runtime.ts` (`deleteModelProvider`).
- Tests: `tests/electron/provider-delete-guard.test.ts` (conflict listing, repoint+delete persistence, rollback on delete failure, serialized concurrent-write ordering, unknown replacement, self-replacement, unreferenced delete unaffected).
- Current facts: `docs/architecture.md` §2 (`/api/local/v1/providers/*`), `docs/architecture/overview.md` (daemon responsibilities).

## Validation

- `[PASS]` `pnpm typecheck` (0 errors across `tsconfig.json` and `tests/bdd/tsconfig.json`).
- `[PASS]` `node --test dist-electron/tests/electron/provider-delete-guard.test.js` (7/7 passed; both the compensation rollback case and the concurrent-write serialization case were red-state validated by temporarily removing the respective guard — each removal failed exactly its corresponding test).
- `[PASS]` `pnpm test` (tooling checks, typecheck, renderer + Electron builds, compiled Node suite, BDD) — run 2026-10-30 for the guard; re-run for the serialization addition on 2026-10-31.
- `[PASS]` `pnpm lint:circular` (0 cycles), `pnpm lint:duplicate`, `pnpm lint:file-size`, `pnpm lint:function-length --fail --max-count 45`.
- `[FAIL]` `pnpm lint:complexity:gate` reports 109 warnings against the 108 budget on a clean tree. Verified pre-existing on `main` via `git stash` roundtrip (clean `main` also reports 109; still failing on main @ `6832be2` and @ `abafe15` after PRs #268/#269); the source files touched here contribute zero warnings. Threshold adjustment is a maintainer decision and is not addressed by this change.
- `[BLOCKED]` `pnpm lint:arch` — no Archify provider available in this environment (`ARCHIFY_BIN` unset; no bundled skill binary). CI runs `lint:arch` with a pinned upstream Archify revision. The requested L2 provider-deletion flow spec, its generated artifacts, and the README diagram block are deferred until an Archify provider can validate them; generated assets are preserved unchanged and no matrix row was added.
