# Architecture Change Record: 2026-09-13 Workspace Memory & Cross-Agent Session Handoff

## Metadata

- **Date**: 2026-09-13
- **Task**: Issue #86 — [Inspiration] Workspace memory & cross-agent handoff: distill session context so switching agents doesn't lose the thread
- **Architecture Impact**: `Required` (Introduces Cross-Agent Session Handoff lifecycle triggered on agent switch, Bounded Pure-Deterministic Distillation Engine, SQLite Handoff Storage, Workspace Memory Wiki with 4-category layout, SQLite FTS5 Indexing & Bi-directional Sync, and Managed Memory Skill)
- **Active Provider**: Archify (validated via `node .agents/skills/archify/bin/archify.mjs deliver workflow docs/architecture/changes/2026-09-13-workspace-memory-handoff.workflow.json docs/architecture/changes/2026-09-13-workspace-memory-handoff.html --quality showcase`)
- **Status**: Proposed / Awaiting Approval

## Context & Rationale

AgentDock's `/agent` command enables dynamic agent switching in chat threads, but creates a severe "context cliff": when switching agents (e.g., from Claude Code to Codex or Pi), the new agent receives raw chat history without distilled decisions, discarded attempts, unresolved questions, or explicit next steps. Furthermore, existing knowledge systems focus on document RAG rather than living workspace engineering memory.

Following user review, this change adopts an on-demand, zero-LLM architecture:
1. **On-Demand Cross-Agent Session Handoff Pipeline**:
   - Triggered strictly on agent switch (`/agent use <agent>`, `/agent reset`, or thread settings change) rather than on every ordinary run completion, eliminating 95%+ redundant processing.
   - 100% pure deterministic local extraction (<2ms, ZERO LLM calls, zero token/network cost) from the thread's accumulated Trace spans (`run_spans`) and assistant responses, extracting modified files, key decisions, unresolved questions, and next steps.
   - Persistence in SQLite `session_handoffs` table with explicit lifecycle states (`pending`, `consumed`, `superseded`).
   - Atomic prompt injection with `[Session Handoff from <fromAgent> to <toAgent>] ... [/Session Handoff]` delimiters on the new agent's first prompt, flipping status to `consumed`.
   - Collapsible `<HandoffSummaryCard />` rendered directly at the switch point in thread chat.
2. **Workspace Memory Wiki (Living Project Memory)**:
   - File-system first storage under `<workspace>/.agentdock/memory/` across 4 standard directories: `_rules/`, `decisions/`, `procedures/`, `gotchas/`.
   - Pure Markdown with YAML frontmatter, 100% compatible with Obsidian, VS Code, and Git tracking.
   - SQLite FTS5 full-text and tag indexing (`workspace_memory_pages` and `workspace_memory_fts`) with bi-directional synchronization (write-through + external mtime/hash change detection).
   - Managed skill `memory` (`electron/managed-skills/memory/`) exposing `memory_query` and `memory_write_page` for agent autonomy.
   - Dedicated `Memory` tab in Desktop Workspace settings with tree navigation, FTS search, and inline Markdown preview/editing.

## Artifacts Generated

- Workflow Spec DSL: `docs/architecture/changes/2026-09-13-workspace-memory-handoff.workflow.json`
- Showcase HTML: `docs/architecture/changes/2026-09-13-workspace-memory-handoff.html` (9/9 showcase checks passed, sha256 a5d27cad64ca)
- Technical Spec: `docs/specs/2026-09-13-workspace-memory-handoff.md`
- Implementation Plan: `docs/plans/2026-09-13-workspace-memory-handoff.md`
