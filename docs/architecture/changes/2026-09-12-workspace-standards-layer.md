# Architecture Change Record: 2026-09-12 Workspace Standards Layer

## Metadata

- **Date**: 2026-09-12
- **Task**: Issue #117 — Workspace coding-standards layer: per-language rule packs materialized into every managed agent instruction file
- **Architecture Impact**: `Required` (Introduces Always-Loaded Standards model, Ponytail Decision Ladder, Marker-Protected Materializer Engine, Stack Detection, and Security Gate integration)
- **Active Provider**: Archify (validated via `node .agents/skills/archify/bin/archify.mjs deliver workflow docs/architecture/changes/2026-09-12-workspace-standards-layer.workflow.json docs/architecture/changes/2026-09-12-workspace-standards-layer.html --quality showcase`)
- **Status**: Proposed / Awaiting Approval

## Context & Rationale

AgentDock currently supports on-demand skills (`SKILL.md`), but lacks an "Always-Loaded Standards" mechanism to establish unified engineering practices, architecture invariants, and design system rules across diverse coding agents (Claude Code, Zed Codex, Pi, OpenCode, Hermes, Cursor).

This change introduces:
1. **Always-Loaded Standards Model**: Workspace-level rule packs covering JetBrains Go modern guidelines, VoltAgent awesome-design-md, and core architecture boundary principles.
2. **Ponytail Decision Ladder & Intensity Dial**: 5-level decision hierarchy (Safety & Security > Correctness & Contracts > Simplicity & YAGNI > Performance > Style) with 4 intensity levels (`off` / `lite` / `full` / `ultra`) and non-negotiable Safety Carve-Outs.
3. **Delimiter-Protected Materializer**: Non-destructive materialization into agent-native files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`) using `<!-- agentdock:standards:start/end -->`, 100% preserving user custom instructions outside markers with atomic write safety and idempotent SHA-256 checks.
4. **Conditional Syntax (`<important if ...>`)**: Two-stage evaluation pruning static language/intensity mismatches while preserving task-level semantic tags.
5. **Security Gate (#93)**: Enforces fail-closed prompt-injection and malicious payload scanning on rule pack installation.
6. **Unified Management**: CLI (`lac rules`), REST API, Core SDK, and Desktop Workspace UI settings.

## Artifacts Generated

- Workflow Spec DSL: `docs/architecture/changes/2026-09-12-workspace-standards-layer.workflow.json`
- Showcase HTML: `docs/architecture/changes/2026-09-12-workspace-standards-layer.html` (9/9 showcase checks passed)
- Technical Spec: `docs/specs/2026-09-12-workspace-standards-layer.md`
- Implementation Plan: `docs/plans/2026-09-12-workspace-standards-layer.md`
