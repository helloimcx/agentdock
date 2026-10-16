# Butler App-Scoped Lark Bot Mentions

Date: 2026-10-16. The updated `design/index.html` prototype was approved by the user on 2026-10-16. Implementation updates the approved managed-bot configuration form and the Lark delivery/identity-validation path.

## Problem

Lark Open IDs are scoped to the app credentials that obtained them. The Butler currently persisted each bot's ID from its own app and reused that ID when another app sent or validated a group message. Cross-app bot mentions therefore fail, and callback sender comparisons use the wrong identity scope.

## Decisions

- Each managed-bot profile entry records the exact group-visible managed bot name as seen by the Butler app (`managedBotName`) and the exact Butler name as seen by that managed bot app (`managerBotName`), plus the shared `chat_id`.
- Profile configuration validates both names against the group roster using the matching bot runtime and app credentials.
- Lark group bot members are loaded from `GET /open-apis/im/v1/chats/{chat_id}/members/bots`; an exact unique name resolves to that app's mention ID. Cache entries are scoped by `(appId, chatId)` for 30 seconds. Missing, ambiguous, malformed, or unavailable roster results fail closed.
- Outbound transport accepts a visible name and resolves the ID under the sending app. Inbound validation resolves the expected sender under the receiving app before comparing it with the event's sender ID.
- Bot-to-bot messages remain on the explicitly configured group route; task IDs, workspaces, agent permissions, owner scoping, and delivery retry policy do not change.

## Prototype confirmation

`design/index.html` was updated to show both app-perspective group names and the shared group ID for each selected managed bot. The user confirmed this prototype before renderer implementation.

## Acceptance criteria

1. A manager app and managed-bot app can use different Open IDs for the same group bots without cross-app ID reuse.
2. Profile setup rejects missing names and aliases absent from either corresponding app's group roster.
3. Outbound messages use the sending app's app-scoped ID; callbacks accept only the expected sender as resolved by the receiving app.
4. Missing and duplicate visible names fail closed; cache entries do not cross app or group boundaries.
5. Renderer, REST, SDK, CLI, persisted profile, and architecture documentation expose the same name fields.
6. Focused tests and `pnpm verify` pass. Live Feishu delivery is reported separately from synthetic verification.
