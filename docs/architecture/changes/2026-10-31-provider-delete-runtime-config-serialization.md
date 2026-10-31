# 2026-10-31 — Serialize provider deletion with runtime-config writes

- Architecture Impact: Required.
- Base revision: `abafe155ae14fc9200ad6cfbb1765ca07326c3f7` (`origin/main` at repair start).
- Implementation: PR #266, fix commit `4576a84d3a730af2747e7854354c7b928ccb69b3`; synchronized branch at merge commit `c05eaf5054cc21b0a8d0a15ae65417dbc7f9dbc2`.
- Prior semantic record: [Provider deletion reference guard with compensating repoint](2026-10-30-provider-delete-reference-guard.md).
- Active provider: Archify 3.2.0.

## Semantic delta

- Provider deletion now holds the controller-owned runtime-config mutation queue from the dependent-reference read through replacement persistence and provider-row deletion. Ordinary runtime-config saves, external project setup, and WorkspaceRouter standards saves use the same queue in production, so those writes cannot interleave inside the delete critical section.
- The lock is an in-process promise chain, not a SQLite transaction. `runtime_config` and `model_providers` remain distinct tables in the same daemon database. Replacement persistence still runs the normal controller pipeline: workspace ID normalization, registry synchronization, channel-binding refresh, and runtime-state emission.
- The compensation semantics are narrower than database atomicity: a failed replacement save skips provider deletion; a provider-row delete error triggers restoration of the captured config before rethrow. A process crash after the replacement config is saved but before the provider row is deleted can leave the old row unused while all workspace references point to the valid replacement. A stale whole-config snapshot written after the critical section can still overwrite newer config under the repository's existing last-writer-wins behavior; that general config-versioning/CAS concern is unchanged.
- The provider-delete JSON response is written after a successful row deletion and outside the compensation catch, so a response-write failure cannot restore references to a provider that has already been deleted.
- No API contract changed in this synchronization delta; the earlier additive optional `replacement_provider_id` request field is recorded in the prior semantic record.

## Evidence

- Lock and serialized provider-delete path: `apps/daemon/src/runtime/local-core-controller.ts` (`saveRuntimeConfig`, `applyRuntimeConfig`, `runExclusiveRuntimeConfigWrite`) and `apps/daemon/src/runtime/handlers/provider-handler.ts` (`provider.delete`).
- Production WorkspaceRouter save injection: `apps/daemon/src/runtime/local-core-controller.ts` and `apps/daemon/src/router/workspace-router.ts` (`setRuntimeConfigSaver`, `saveWorkspaceStandards`).
- Runtime config storage and provider row deletion: `apps/daemon/src/acp/store/runtime-config-store.ts` and `apps/daemon/src/acp/store/model-provider-store.ts`.
- Error mapping: `apps/daemon/src/runtime/server.ts` maps `ProviderInUseError` to HTTP 409.
- Regression coverage: `tests/electron/provider-delete-guard.test.ts` covers provider-delete interleaving; `tests/electron/runtime-config-store.test.ts` directly exercises the real controller lock by queueing `saveRuntimeConfig` behind a held provider-delete critical section.

## Provider artifacts

- L2 source: [provider-deletion-workflow.json](../provider-deletion-workflow.json).
- Interactive canvas: [provider-deletion-workflow.html](../provider-deletion-workflow.html).
- Static exports: [light](../provider-deletion-workflow.light.png) · [dark](../provider-deletion-workflow.dark.png) · [default](../provider-deletion-workflow.png).
- Matrix index: [architecture overview](../overview.md); manifest source list: [diagram-provider.yaml](../diagram-provider.yaml).
- README entry: the managed architecture block links the interactive workflow and both theme images; its system Mermaid fallback remains the configured README mode.

## Validation

- `[PASS]` Archify `finalize workflow` with the repository root: validation, delivery, strict artifact check, and browser-check passed with zero diagnostics.
- `[PASS]` Archify visual-check at 1440×900 and 2048×1320 in light and dark themes; captures were visually inspected.
- `[PASS]` `pnpm lint:arch`: 10 source specifications passed all showcase checks; generated evidence sidecars without `diagram_type` were skipped.
- `[PASS]` `pnpm test:ci`: build, compiled tests, coverage, and BDD completed successfully; 80 BDD scenarios / 286 steps passed.
- `[FAIL]` `pnpm verify`: `lint:complexity:gate` stopped the command at 109 warnings against the configured 108 limit. This matches the current `main` baseline identified by the latest PR review; the change adds no complexity warnings. Since verify stopped before architecture lint and `test:ci`, those stages were run separately and passed as listed above.
- `[PASS]` `git diff --check`.
