# Architecture Maintenance

This policy is loaded on demand after the repository's root Agent instructions classify a proposed change as `Architecture Impact: Required`. Code and provider-neutral architecture facts are the sources of truth. A diagram provider is a replaceable renderer, not the owner of architecture semantics.

## Architecture Impact

Classify a change as `Required` when it alters any of the following:

- a runtime component, service, or major module responsibility;
- dependency direction or a public protocol;
- data ownership, storage, or a primary data flow;
- a trust, deployment, process, or network boundary;
- an external integration or synchronous/asynchronous communication mode;
- addition, removal, split, or merge of an architectural component.

File count and changed-line count do not decide architectural impact. Use `None` for an internal refactor that preserves responsibilities, boundaries, dependencies, protocols, and data flow. Do not rewrite diagrams for `None` merely to create documentation churn.

## Durable Records

Maintain three separate concerns:

1. `docs/architecture.md` describes the current provider-neutral system facts and repository evidence. `docs/architecture/overview.md` provides the unified L1-L3 Architecture Matrix index, linking typed specs, interactive canvases, and detailed documentation.
2. `docs/architecture/changes/YYYY-MM-DD-<slug>.md` records one semantic architecture delta and its evidence. The record is append-only after the change is accepted; later corrections use a new record that links back.
3. `docs/architecture/` typed specifications (`system-architecture.json`, `*.workflow.json`, `*.sequence.json`, `*.lifecycle.json`) contain replaceable provider source, dual-theme images (`.light.png`, `.dark.png`, `.png`), standalone interactive HTML canvases (`.html`), and receipts. Provider files never replace current facts or semantic history.

Each change record states the base revision or working-tree state, affected components and boundaries, added/removed/changed/rerouted facts, rationale or ADR, compatibility or migration consequences when real, code evidence, active provider, and validation result. Do not claim inferred runtime impact, risk, ownership, or merge safety without evidence.

Git retains prior provider source revisions. When the active provider supports comparison, compare the last verified base source with the candidate and retain the checked delta artifact or receipt with the change record. Comparison is supporting evidence, not the history source of truth.

## Diagram Provider Contract

Read `docs/architecture/diagram-provider.yaml` before editing provider files. It declares the active provider, fallback, capabilities, stable public outputs, provider-specific source, receipt paths, and README mode.

Every active provider must:

- render only architecture facts supported by the repository and `docs/architecture.md`;
- preserve stable component identities across revisions when semantics are unchanged;
- validate its candidate before replacing the last-known-good artifact;
- support automated validation via `pnpm lint:arch` (`node scripts/lint-architecture.mjs`, running Archify showcase checks);
- produce either the stable README image declared by the manifest (PNG/SVG, or dual-theme `<picture>` source) or an explicitly configured inline Mermaid fallback;
- keep standard matrix specs and rendered assets under `docs/architecture/`;
- report a non-zero command, failed validation, missing tool, stale output, or unresolved source evidence truthfully.

Archify is the preferred and active provider. Use its typed JSON source, validation, trusted delivery, static export, and interactive HTML generation. Archify remains replaceable: do not encode its internal JSON fields in `docs/architecture.md`, semantic change records, root Agent routing, or the stable README contract.

If no declared provider can produce a current valid README diagram, preserve the last-known-good output, mark the step `[BLOCKED]`, and do not report architecture synchronization as complete.

## Required Workflow

For `Architecture Impact: Required`:

1. Capture the base revision and read current facts, latest relevant change record, provider manifest, and active provider source.
2. Inspect the changed code and tests. Update `docs/architecture.md` from evidence, not from requested design alone.
3. Add one change record under `docs/architecture/changes/` describing the semantic delta and evidence.
4. Update the active provider's source in the L1-L3 Architecture Matrix (`system-architecture.json`, `*.workflow.json`, `*.sequence.json`, `*.lifecycle.json`). Preserve stable component identities and layout where semantics did not change.
5. Run the provider's required validation via `pnpm lint:arch`.
6. Publish the validated current artifacts atomically (including `.html` interactive canvas and dual-theme `.light.png` / `.dark.png` / `.png`). A failed candidate must not replace the last-known-good diagram.
7. Update `docs/architecture/overview.md` to keep the Architecture Matrix synchronized.
8. Update exactly one managed README block so it directly shows the latest valid static diagram (using dual-theme `<picture>` block) or inline Mermaid fallback.
9. Run repository documentation/link checks, `pnpm lint:arch`, and the ordinary complete quality suite (`pnpm verify`). Recheck the final diff for agreement among code, current facts, history, provider source, overview matrix, and README.

## README Contract

The root README contains exactly one block bounded by:

```text
<!-- project-setup:architecture-diagram:start -->
<!-- project-setup:architecture-diagram:end -->
```

Inside the block:

- show one current system architecture diagram directly (using `<picture>` tag for dark/light themes);
- use the manifest's `outputs.readme` and `outputs.readme_dark` paths and confirm the declared image files exist;
- link readers to `docs/architecture.md`, `docs/architecture/overview.md`, `docs/architecture/changes/`, and the interactive HTML artifact;
- preserve every README section outside the markers.

Do not add timestamp-only changes. Diagram and README changes must follow a real architecture fact change or correction.

## Completion Evidence

Architecture synchronization is complete only when all applicable checks are true:

- current facts match the implemented code and boundaries;
- exactly one new semantic change record exists;
- provider source and stable output describe the same component identities and relationships;
- required provider validation and `pnpm lint:arch` succeeded (0 errors, 0 warnings);
- the L1-L3 Architecture Matrix and `docs/architecture/overview.md` match the current codebase;
- the README block is unique and renders the current valid diagram;
- local links resolve and no stale provider artifact is presented as current.

Record unavailable external capabilities as `[BLOCKED]`, inapplicable optional capabilities as `[N/A]`, and executed failures as `[FAIL]`. Never convert them to `[PASS]` to finish the task.
