# Message And Channel Contracts

This document defines the intended ownership boundaries for message blocks and channel content. It is a stabilization guide for future contract and implementation work.

## Ownership Rules

- Local AI Core owns durable thread, run, message, permission, attachment, and channel delivery state.
- Renderer owns transient view state only: draft text, selected thread, loading flags, filters, and layout choices.
- Channel runtimes adapt platform payloads into shared core contracts and adapt shared outbound content back to platform APIs.
- ACP adapters translate runtime protocol events into Local AI Core message, run, permission, and bridge state. They should not leak raw protocol details into renderer code.

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
- Platform adapters may degrade gracefully, but unsupported part types should fail with a clear error or fallback text.

## Test Expectations

Add regression or contract tests when changing:

- Permission lifecycle and pending permission rendering.
- Thinking, tool, and final answer streaming updates.
- Inbound text/image/file normalization.
- Outbound file or future image delivery.
- Slash command parsing or scheduler execution mode parsing.
- Shared enum parsing for form values and persisted rows.
