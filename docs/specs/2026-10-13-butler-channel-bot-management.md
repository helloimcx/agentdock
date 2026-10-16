# Butler Channel Bot Management

Date: 2026-10-13. Approved: the user confirmed implementation of the Lark manager-bot and managed-bot flow.

## Goal

The Butler is itself a concrete channel bot. The user primarily gives it commands. It sends work to selected channel bots that it manages, tracks their messages and execution state, and reports meaningful progress, blockers and results back through its own conversation.

## Identity model

- A channel bot identity is the managed entity. For Lark, its stable platform identity is `appId` plus `botOpenId`.
- The bot's `workspaceId` and `instanceId` identify the Local AI Core runtime bound to that bot; they are execution routing data, not substitutes for bot identity.
- A group chat ID is a delivery context only. A group may contain the Butler and multiple independently managed bots.
- A Butler profile contains one manager bot and one or more managed bots. A manager bot cannot appear in its own managed roster.
- Each managed bot has an explicit shared Lark group chat ID containing that bot and the Butler bot. Each task assignment names a managed `botId`; its bound workspace chooses the ordinary agent runtime and permissions used after the bot receives its message.

## Behavior

1. The Butler receives a user command in its own channel runtime, validates the owner conversation and persists a task, bot assignment, operation identity and delivery context.
2. Core sends the target bot a bounded typed protocol message in a shared Lark group and explicitly mentions that bot.
3. The target bot runtime accepts only a bot-authored group message that mentions it and comes from the configured manager bot. It starts or continues a normal thread through `WorkspaceRouter`; ordinary workspace permissions apply.
4. Core observes the exact worker run and approvals, then sends progress or a result through the target bot's channel credentials and mentions the Butler bot.
5. The Butler runtime accepts only callbacks addressed to its exact configured identity/runtime and validates sender bot, group, task, delegation and operation before persisting the result.
6. Important changes are delivered to the owner conversation. Completed agent runs remain `reviewing` until the user explicitly accepts the outcome.

Follow-ups and cancellation are durable operations. Ambiguous platform sends and uncertain worker outcomes are not automatically retried. Cancellation is complete only after the target bot confirms the state; already completed external effects cannot be undone.

## Scope and boundaries

- Lark/Feishu supports v1 bot-to-bot orchestration. Lark apps must receive bot-authored group message events and have `im:message.group_at_msg` permission enabled.
- Weixin Work iLink stays an ordinary channel conversation and is not eligible as a Butler manager or managed bot in v1.
- The manager bot must use a local workspace with Core CLI access. Managed bots use their own connected runtime/workspace and permission configuration.
- Renderer, Core SDK, shared contracts, Local AI Core API, SQLite persistence, `lac butler` CLI and the managed skill expose the same bot identity model.
- No arbitrary messaging between unconfigured bots, permission inheritance, automatic approval, model/provider escalation, or channel-wide search is introduced.

## Acceptance criteria

1. Setup discovers connected Lark bot endpoints, configures exactly one manager bot and multiple distinct managed bots, and rejects offline, duplicate or self-managed selections.
2. The user can issue a Butler task selecting bot IDs; workspace, private chat or group chat alone cannot identify the target.
3. Core sends an explicit Lark bot mention to the selected bot in that bot's explicitly configured shared Lark group. It never infers a delivery group from the user's owner conversation.
4. Only the exact configured bot runtime, expected sender identity and group can execute a task command; unrelated app or user messages cannot invoke the bot protocol.
5. A target bot starts work using its own workspace Agent and existing permissions, then returns durable progress, authorization needs and final results through the bot-message path.
6. Replay, wrong sender, wrong runtime, wrong recipient, wrong group, invalid envelope, duplicate request and uncertain delivery are handled without duplicate execution or false completion.
7. Follow-up, cancellation, direct child-thread updates and explicit user acceptance remain visible and use separate task, bot, operation, thread and run identities.
8. The renderer, API, SDK, CLI, managed skill, README and architecture assets describe bot identities consistently. Synthetic Lark/ACP HTTP integration and repository quality gates pass; live Lark app credentials are reported separately from synthetic validation.
