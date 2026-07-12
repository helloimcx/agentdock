---
name: condition-trigger
description: Author an approved, sandboxed script condition for a unified Automation.
---

Use this skill only when the user asks for a condition-based Automation or script-backed trigger.

Follow this sequence exactly:

1. Create a temporary source bundle outside managed script storage. It must contain `manifest.json`, one executable entrypoint with a valid shebang, fixtures, and tests. Do not write an immutable script package location or managed script directory.
2. Use `./scripts/register-condition-trigger.sh stage <script-id> <temporary-source-dir>` to stage the source through Local AI Core. The server derives the package hash and interpreter facts.
3. Request test authorization with the helper, then stop for test authorization: ask the user to approve that one sandbox test. Do not run the test before the authorization is granted.
4. After authorization, run the helper's sandbox test command. Review the server-recorded result.
5. Request final enable approval, then stop and ask the user to approve it. Do not create an Automation until the script version is server-reported as `approved`.
6. Use the helper to create the Automation with the approved version. Return the Automation ID and explain that `lac automation info <id>` is its management entry point.

Never manufacture a package hash, package path, interpreter path, approval ID, test result, or approval status. Keep secret values out of the bundle and logs; declare only permitted secret reference names in the manifest.
