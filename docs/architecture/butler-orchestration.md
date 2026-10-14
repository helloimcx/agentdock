# Butler Channel Bot Orchestration

The Butler is a concrete Lark bot identity managed by Local AI Core. It accepts user commands through its own channel conversation, addresses one or more configured Lark bots, tracks their replies, and reports progress or results back through the Butler bot. The managed object is a bot identity (`appId` + `botOpenId`); a workspace identifies the local runtime bound to that bot, and a group chat ID is only a delivery context. A group may contain multiple independent bots.

## Ownership and message flow

- `ChannelService` discovers connected Lark bot endpoints and sends an explicit bot mention through the selected bot runtime. `ButlerService` stores the manager bot identity and a roster of managed bot identities, each with its local workspace/instance binding and required shared group chat ID.
- Butler tasks and delegations are durable Core SQLite records. Each delegation snapshots the target bot, route chat, operation identity and worker thread/run references. A unique inbound message ledger prevents a platform message from being processed twice.
- The manager bot sends a bounded typed protocol envelope that identifies the task, delegation, operation, manager bot and target bot. The target bot gateway accepts only a group message that explicitly mentions that bot and came from the configured Butler identity. It then starts or follows up an ordinary `WorkspaceRouter` thread in the target bot's workspace.
- The target workspace keeps its configured Agent and ordinary permissions. Core observes the exact execution and approval state, then sends progress or the result through the target bot's channel credentials and mentions the Butler bot. The Butler gateway validates the sender bot, receiving bot runtime, group, operation and task before updating durable state.
- The Butler bot's owner thread is separate from each task's shared-group delivery address and the worker thread/run IDs. UI and CLI operate on exact owner threads; unrelated conversations cannot inspect or mutate another owner's tasks.
- Completed runs remain `reviewing` until the user accepts the result. Follow-ups and cancellation are durable operations. Ambiguous sends or execution outcomes are never blindly replayed; cancellation reports whether the target actually confirmed the stop.

## Channel support

Bot-to-bot orchestration is implemented for Lark/Feishu. Each managed bot must have a connected Lark runtime and be able to receive bot-authored group messages that mention it. The Lark application must subscribe to bot-to-bot group message events and enable bot-authored group event delivery (`im:message.group_at_msg` / `include_bot`); see the [Lark Channel SDK bot-to-bot setup notes](https://github.com/larksuite/channel-sdk-node#bot-at-bot). Outbound messages use Lark's native `<at user_id="ou_…">` mention format documented in the [Feishu custom bot mention guide](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot).

Weixin Work's current iLink runtime remains available for ordinary channel conversations; it is not a Butler manager or managed-bot transport in this version.

## Interfaces and implementation

The Core API exposes `GET /api/local/v1/butler/bots`, `GET/PUT /api/local/v1/butler/profile`, and owner-scoped task create/list/get, `followup`, `cancel` and `complete` endpoints. Cross-layer types live in `packages/contracts/src/butler.ts` and the SDK in `packages/core-sdk/src/butler.ts`. `lac butler bots|profile|setup|create|delegate|list|info|followup|cancel|complete` is the local CLI surface. The renderer configures one manager bot and multiple managed bots and tracks their tasks.

The manager bot must run in a local workspace with Core CLI access. Managed bots can use their own registered runtime workspaces. Each task selects managed bot IDs, not workspace IDs. Each managed bot must have a configured shared `oc_…` group chat ID containing both it and the Butler bot. The group is only a message route; one group can host several managed bots, and the user conversation can be a separate direct or group chat.

## Architecture artifacts

- [Bot message workflow](butler-orchestration.html) and [typed source](butler-orchestration.workflow.json)
- [Current specification](../specs/2026-10-13-butler-channel-bot-management.md) and [implementation plan](../plans/2026-10-13-butler-channel-bot-management.md)
- [Bot identity and message-loop sequence](changes/2026-10-13-butler-channel-bot-management.html)
- [Semantic change record](changes/2026-10-13-butler-channel-bot-management.md), which corrects the initial workspace-target model in [the 2026-10-12 Butler record](changes/2026-10-12-butler-orchestration.md)
