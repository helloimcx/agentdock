# Message And Channel Contracts

This document defines the intended ownership boundaries for message blocks and channel content. It is a stabilization guide for future contract and implementation work.

## Ownership Rules

- Local AI Core owns durable thread, run, message, permission, attachment, and channel delivery state.
- Renderer owns transient view state only: draft text, selected thread, loading flags, filters, and layout choices.
- Channel runtimes adapt platform payloads into shared core contracts and adapt shared outbound content back to platform APIs.
- ACP adapters translate runtime protocol events into Local AI Core message, run, permission, and bridge state. They should not leak raw protocol details into renderer code.

## Core Contract Index

| Concept | Current shared contract | Owner | Persisted fields | Streamed fields | Rendered fields | Platform-specific fields |
| --- | --- | --- | --- | --- | --- | --- |
| Thread | `ThreadSummary`, `ThreadDetail` | Local AI Core | id, workspace id, title, timestamps, selected knowledge bases | thread update events | title, excerpt, selected knowledge bases | none |
| Run | `RunSummary` | Local AI Core | run id, thread id, status, timestamps | run status events | status and interrupt affordance | none |
| Task | `AgentTask` | Local AI Core | task id, workspace, runtime, thread/run links, status, timeline, logs, artifacts | task status/log events | status, timeline, summary, logs, artifacts | runtime id only |
| PermissionRequest | `ThreadPendingPermissionRequest`, `ApprovalRequest` | Local AI Core | request id, run/thread links, tool/action, options, outcome | permission prompt and resolution events | pending prompt, choices, resolved state | channel card/message ids stay in adapters |
| MessageBlock | `ThreadMessage` compatibility plus future block contract | Local AI Core | message id, role, content, kind, sequence, timestamp | stable message/block updates | text, thinking, tool, permission, attachment, and system blocks | none |
| Attachment | `ChannelInboundContentPart`, `ChannelOutboundAttachmentResult` | Local AI Core | path/uri/data reference, filename, mime, size, metadata | attachment availability events when needed | file/image label and metadata | upload keys and platform message ids stay in adapters |
| ChannelInboundContent | `ChannelInboundMessageContent` | Channel adapters normalize into Local AI Core | display text and normalized parts | inbound message event | normalized text/image/file parts | source platform payload remains adapter-local |
| ChannelOutboundContent | `ChannelOutboundMessageInput`, `ChannelOutboundMessageResult` | Local AI Core routes to channel adapters | route, parts, result ids, attachments | outbound delivery status when needed | send result and attachment metadata | platform upload ids remain result metadata |
| ScheduledDeliveryTarget | `ScheduledJob.platform`, `ScheduledJob.route` | Local AI Core scheduler application service | platform base or instance-qualified id, route type, channel id, participant id, instance id | scheduled run status events | job list/detail and run status | platform message ids stay in channel adapters |

## Message Block Contract Direction

Current public thread messages use `ThreadMessage.content` plus `ThreadMessage.kind`. That is enough for simple text, but repeated regressions show that richer streaming state needs explicit block semantics.

Future message rendering should be based on stable message and block identity:

- `messageId`: stable id for the logical message.
- `blockId`: stable id for a semantic block inside the message.
- `block.type`: semantic kind such as `text`, `thinking`, `tool_call`, `tool_result`, `permission_request`, `image`, `file`, or `system`.
- `block.status`: lifecycle hint such as `streaming`, `complete`, `failed`, or `cancelled` when needed.
- `block.content`: type-specific payload.
- `sequence`: ordering key for deterministic rendering.

Invariants:

- Thinking blocks are not overwritten by final answer blocks.
- Tool progress and tool results are separate from final answer text.
- Permission requests are durable thread/run state, not inferred from assistant message button markup.
- Renderer projections are derived from blocks and pending permission state; renderer code should not reconstruct protocol meaning from plain text.
- Stream updates must target either an existing `messageId` and `blockId`, or append a new block with a stable id.

Migration guidance:

- Keep `ThreadMessage.content` as the compatibility display field until block-aware rendering is introduced.
- Add block-aware types in shared contracts before changing renderer behavior.
- Introduce tests for block merge/update behavior before wiring new runtime event handling.

## Channel Content Contract Direction

Current inbound content uses `ChannelInboundMessageContent` with `displayText` and `contentParts`. Current outbound content uses `ChannelOutboundMessageInput` with `parts`. These are the correct shared boundaries and should be expanded before adding platform-specific behavior.

Inbound content should normalize platform events into shared parts:

- `text`: user-visible text.
- `image`: image bytes, data URI, local URI, or downloaded file reference with mime metadata.
- `file`: file reference with path/uri, filename, mime type, and size when available.
- `command`: explicit slash or platform command when command handling becomes shared.

Outbound content should normalize core delivery requests into shared parts:

- `text`: platform-visible text.
- `file`: local file path plus optional filename and mime metadata.
- `image`: image path/data/uri when image send support is added.
- `permission_card`: permission choices when a channel can render interactive approval cards.

Invariants:

- Lark and Weixin adapters should parse into the same inbound contract for equivalent content.
- Channel-specific code handles authentication, download, upload, and platform message ids only.
- Core workflows should consume shared channel parts, not Lark or Weixin event payloads.
- Sending files through a channel uses one outbound path, whether triggered by scheduler, CLI, ACP instruction, or UI.
- Scheduled delivery uses the same outbound route contract as direct channel sends; scheduled jobs should not bypass channel runtimes to call platform APIs directly.
- Platform adapters may degrade gracefully, but unsupported part types should fail with a clear error or fallback text.

## Scheduled Channel Delivery

Scheduled jobs are created and delivered through Local AI Core, not through renderer or Electron route state. A scheduled job's platform may be instance-qualified, for example `lark:<instanceId>` or `weixin:<instanceId>`. Scheduler adapter selection should compare the platform base, while delivery should keep the instance id in `ScheduledJobRoute.instanceId`.

Invariants:

- `ScheduledJobApplicationService` owns create-time route resolution.
- `scheduled-job-route.ts` owns platform parsing and route derivation from `platform_thread_bindings`.
- A job created from a bound channel thread should persist the binding's platform, chat id, platform user id, and instance id.
- A scheduled ACP run should receive channel context through runtime environment variables.
- Lark/Weixin scheduled runs use `deliveryMode: 'bridge-stream'`: process updates, tool progress, permission cards, and final replies are delivered through channel gateway bridge events.
- Local scheduled runs use `deliveryMode: 'thread-only'` and do not send channel messages.
- `same-thread` and `side-thread` affect where the ACP conversation executes; they do not change the persisted platform delivery target.
- `scheduled_job_runs` delivery fields are diagnostics and may include `deliveryStatus`, `deliveryError`, `lastBridgeEventAt`, and platform message ids.

See [Scheduled Delivery Architecture](scheduled-delivery.md) for the end-to-end scheduler flow.

## Test Expectations

Add regression or contract tests when changing:

- Permission lifecycle and pending permission rendering.
- Thinking, tool, and final answer streaming updates.
- Inbound text/image/file normalization.
- Outbound file or future image delivery.
- Scheduled delivery route resolution, especially instance-qualified Lark/Weixin platforms.
- Slash command parsing or scheduler execution mode parsing.
- Shared enum parsing for form values and persisted rows.
