# Scheduled delivery deduplication

## Goal and scope
Register each automation execution as outbox-owned before its bridge can deliver the final report, while preserving other runs' messages and ordinary progress events.

## Behavior and constraints
Keep the existing channel route, message format, durable outbox, and failure handling. Register the run ID synchronously during admission before exposing the submission to the dispatcher, including an already active dispatcher. Do not suppress unrelated runs. No public protocol or data migration changes.

## Acceptance criteria
- Run ownership is registered before completion polling can observe a final result, including immediately completed runs.
- The scheduled final is sent once through the outbox; neighboring ordinary runs and progress remain available.
- Failed runs close their bridge, and successful execution IDs are recorded using the existing completion path.
