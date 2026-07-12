---
name: condition-trigger
description: Author an approved, sandboxed script condition for a unified Automation.
---

Use this skill only when the user asks for a condition-based Automation or script-backed trigger.

Follow this sequence exactly:

1. Create the Automation Script record first with `./scripts/register-condition-trigger.sh create "<title>"`; retain the returned script ID.
2. Create a temporary source bundle outside managed script storage. It must contain `manifest.json`, one executable entrypoint with a valid shebang, fixtures, and tests. Do not write an immutable script package location or managed script directory.
3. Use `./scripts/register-condition-trigger.sh stage <script-id> <temporary-source-dir>` to stage the source through Local AI Core. The server derives the package hash and interpreter facts.
4. Request test authorization with the helper, then stop for test authorization: ask the user to approve that one sandbox test. Do not run the test before the authorization is granted.
5. Once the user resolves the approval, apply that approved decision with `apply-approval <version-id> <approval-id> <actor>` before the sandbox test. Then run the helper's sandbox test command and review the server-recorded result.
6. Request final enable approval, then stop and ask the user to approve it.
7. Once the user resolves the final approval, apply that approved decision with `apply-approval <version-id> <approval-id> <actor>` before creating the Automation. Confirm the server reports the version as `approved`.
8. Use the helper to create the Automation with the approved version. Return the Automation ID and explain that `lac automation info <id>` is its management entry point.

Never manufacture a package hash, package path, interpreter path, approval ID, test result, or approval status. Keep secret values out of the bundle and logs; declare only permitted secret reference names in the manifest.
