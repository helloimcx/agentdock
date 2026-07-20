---
name: condition-trigger
description: Author an approved, sandboxed script condition for a unified Automation.
---

Use this skill only when the user asks for a condition-based Automation or script-backed trigger.

## References

- **Protocol spec**: `references/script-protocol.md` — manifest schema, stdin/stdout protocol, exit codes, error table, rising-edge semantics
- **Working example**: `templates/basic-monitor/` — HTTP health check with manifest.json, check.sh entrypoint, and test-check.sh self-tests

Read the protocol spec before writing the script. Use the working example as a starting point when the user's scenario is similar.

## Script Authoring Essentials

A script package is a flat directory containing:
1. `manifest.json` — declares the entrypoint, capabilities, limits, and config schema
2. One **executable entrypoint** with a valid shebang (`#!/bin/sh`, `#!/usr/bin/env python3`, etc.)
3. Optional self-tests (`test-*.sh`) and fixtures (`fixture-*.json`)

The script receives a JSON object on **stdin** (evaluation context) and must write exactly one JSON object to **stdout**:
- `matched: true` → condition met, action fires (on rising edge)
- `matched: false` → condition not met

Use `nextState` to persist data across evaluations (e.g., last alert timestamp for deduplication).

**Key constraints:**
- Max 64 files, 1 MiB total, no subdirectories or symlinks
- Exit code 0 on success; non-zero records a failure without triggering
- Keep stdout for protocol output only — diagnostics to stderr

See `references/script-protocol.md` for the complete field reference and `templates/basic-monitor/check.sh` for a concrete example.

## Registration Flow

The policy supplies an absolute helper path in `[Condition Trigger Helper]`. Use that path as `<condition-trigger-helper>` below; do not assume `./scripts` exists in the current workspace.

Follow this sequence exactly:

1. Create the Automation Script record first with `<condition-trigger-helper> create "<title>"`; retain the returned script ID.
2. Create a flat temporary source bundle outside managed script storage. It must contain `manifest.json`, one executable entrypoint with a valid shebang, fixtures, and tests (use filename prefixes instead of subdirectories). Do not write an immutable script package location or managed script directory.
3. Use `<condition-trigger-helper> stage <script-id> <temporary-source-dir>` to stage the source through Local AI Core. The server derives the package hash and interpreter facts.
4. Request test authorization with the helper, then stop for test authorization: ask the user to approve that one sandbox test. Do not run the test before the authorization is granted.
5. Once the user resolves the approval, apply that approved decision with `apply-approval <version-id> <approval-id> <actor>` before the sandbox test. Then run the helper's sandbox test command and review the server-recorded result.
6. Request final enable approval, then stop and ask the user to approve it.
7. Once the user resolves the final approval, apply that approved decision with `apply-approval <version-id> <approval-id> <actor>` before creating the Automation. Confirm the server reports the version as `approved`.
8. Use the helper to create the Automation with the approved version. Return the Automation ID and explain that `lac automation info <id>` is its management entry point.

Never manufacture a package hash, package path, interpreter path, approval ID, test result, or approval status. Keep secret values out of the bundle and logs; declare only permitted secret reference names in the manifest.
