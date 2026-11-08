# Automation execution and delivery correlation — specification

Status: implemented; the revised UI prototype was confirmed on 2026-11-08. Issue #279 is intentionally narrowed to the automation slice and remains partially addressed. Base: f80ada7956e6d45e9f9f193a2d622ba7d0bdd677. Prototype: `design/index.html`.

## Goal

Let a user inspect an automation run in its existing detail view and see its actual agent execution and delivery outcome together, including an execution that succeeded while delivery failed.

## Scope and non-goals

Use the existing `AutomationRun.id` as the identity for one automation activation, with its existing `threadId`, `acpRunId` and delivery records. Preserve distinct identifier domains. Add an optional server-owned owner marker to thread submissions with an additive local schema migration and write it in the admission transaction; make the execution association durable as soon as submission is admitted and recover only submissions carrying that exact owner after interruption. Correlate deliveries by the server-owned `ownerKind = automation`, `ownerRunId`, and workspace. Show status, available error and a link to the specific existing execution trace in Automation details. Reuse existing APIs, SDK types and delivery recovery controls; add no new aggregate endpoint or public contract unless needed to repair a demonstrated gap.

Do not add a generic Task identity or state machine, Butler or chat task association, a new dashboard, access tokens, a desktop IPC bridge, per-run cost aggregation, or a new retry mechanism. Separate AutomationRun records are distinct activations; do not group them as execution attempts of a single task. This slice does not complete #279's cross-source or multiple-attempt acceptance criteria.

## Behavior

Each recent run shows execution and delivery separately, including pending, in-progress, failed, unknown, skipped and not-applicable cases; no absent fact is presented as delivered. Show the original available error without exposing new raw payload data. An execution trace link targets the `acpRunId` only when a reliable association exists; otherwise indicate that the association is unavailable. If an outbox row exists it takes precedence over the mirrored `AutomationRun.deliveryStatus`; otherwise show the persisted run summary when present, and show unknown/unrecorded when both are absent. Reflect local/no-external-delivery semantics explicitly.

Persist a server-owned submission owner (`automation`, `AutomationRun.id`) in the same admission transaction, and persist the Automation-to-ACP relationship immediately after admission returns, rather than after waiting for final completion. For the crash window between admission and saving the run fields, recover only the submission carrying that exact owner; also verify request ID, operation kind, thread and workspace and reject conflicts with any delivery owner record. An ambiguous or missing association remains unavailable. A caller reusing the request ID cannot be mistaken for the Automation's submission. Recovery must never re-execute an Agent solely to reconstruct a link. Delivery rows must match the exact automation ownership domain, run ID and workspace, not merely an unqualified string ID.

The submission owner is populated only by trusted server-side execution code; request handlers do not accept it from payloads. Existing automation REST routes continue under the daemon's existing trust model and do not establish a per-user principal. This change must not advertise or create new cross-principal isolation, extend access to new callers, or add a new ID-based aggregation endpoint. Existing cross-user isolation and the wider issue's authenticated aggregation remain outside this slice; verify workspace scoping and avoid mixing records across workspaces.

## Acceptance criteria

1. Existing automation details show the correct execution and delivery for each recent activation. ACP success plus failed delivery is shown as two distinct outcomes; other states are not mislabeled as delivered.
2. The trace link uses `AutomationRun.acpRunId` or the ACP run ID from that run's owner-bound delivery record. When neither proves an association, it is unavailable and no other run is substituted.
3. Association is persisted before waiting for execution completion, and is retained or safely recovered after failure or restart. Reusing the request ID from another source, ambiguous/missing ownership, and unrelated threads/workspaces cannot create false links; no automatic re-execution is introduced.
4. Tests cover successful and failed delivery, no delivery, local delivery, running/interrupted or missing execution, workspace isolation, correct ownership domain, restart and submission crash window, and compatibility with existing clients and recovery controls.
5. The user confirms the updated `design/index.html` prototype before any product UI implementation. Run affected tests, typecheck and architecture maintenance checks; record blocked verification honestly.
