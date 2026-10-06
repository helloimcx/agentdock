---
name: memory
description: Query, record, and maintain persistent workspace memory across rules, decisions, procedures, and gotchas.
---

Use this skill when you need to consult or record durable project context:

- **Query memory**: Run `lac memory query "<keywords>"` to search across workspace memory, or `./scripts/query-memory.sh "<keywords>"`.
- **Get a page**: Run `lac memory get <category>/<slug>` to retrieve the full Markdown text of a specific page.
- **Record decisions**: After choosing an architectural direction, resolving a bug with non-obvious fixes, or agreeing on project rules, use `lac memory write --category <category> --slug <slug> --title "<title>" --content "<markdown>"` or `./scripts/write-memory.sh <category> <slug> "<title>" "<content>"`.
- **Categories**:
  - `_rules`: Invariants, repository conventions, and style requirements.
  - `decisions`: Architectural Decision Records (ADRs), tech choices, and trade-offs.
  - `procedures`: Step-by-step deploy, migration, test, or debugging runbooks.
  - `gotchas`: Non-obvious pitfalls, quirks, bugs solved, and framework caveats.
