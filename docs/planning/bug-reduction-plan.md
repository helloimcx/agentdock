# Bug Reduction Checklist

Use this checklist to reduce repeated regressions in Thread Chat, Local AI Core, ACP runtime handling, channel integrations, scheduler behavior, and release packaging.

## Problem Patterns To Watch

- [x] Permission UI state is owned by Local AI Core, not inferred from message actions.
- [x] Thinking, tool progress, tool results, and final answers cannot overwrite each other.
- [x] Lark-first work is checked for shared channel impact before implementation.
- [x] Form values, API enums, persisted values, and shared contracts use one parsing path.
  - [x] Scheduler execution mode, trigger type, and channel platform values normalize through shared contract helpers.
  - [x] Permission response, approval state, content type, task state, run state, and scheduled run state normalize through shared helpers.
- [x] Release fixes are separated from broad feature or refactor work when possible.
  - [x] CI main-branch artifacts are validation-only and are prevented from publishing formal releases.
  - [x] Formal release publishing stays behind version-tag release workflow checks.
- [x] Production build behavior is verified, not assumed from dev mode.
  - [x] Production renderer assets are checked after `pnpm build:renderer`.
  - [x] Production smoke launches the built Electron entry and verifies runtime capabilities plus plugin diagnostics.

## Phase 1: Freeze Core Contracts

Owner area: `shared/`, `packages/contracts/`, `packages/core-sdk/`, `services/local-ai-core/src/router/`

- [x] Define canonical contracts for `Thread`, `Run`, `Task`, `PermissionRequest`, `MessageBlock`, `Attachment`, `ChannelInboundContent`, and `ChannelOutboundContent`.
- [x] Document which fields are persisted, streamed, rendered, and platform-specific.
- [x] Remove duplicated ad hoc types for the same concept across renderer, Local AI Core, plugins, and shared packages.
  - [x] Renderer pending permission state aliases the shared `ThreadPendingPermissionRequest` contract.
  - [x] Thread Chat task-state helpers reuse the canonical `ChatTaskState` type instead of redeclaring it.
  - [x] Architecture tests guard these hotspot type boundaries against new ad hoc duplicates.
- [x] Add parser or validation helpers for enum-like values: execution mode, trigger type, platform, content type, permission outcome, task state, and run state.
  - [x] Scheduler execution mode.
  - [x] Scheduler trigger type.
  - [x] Channel platform id.
  - [x] Content type.
  - [x] Permission outcome.
  - [x] Task state.
  - [x] Run state.
- [x] Confirm renderer code does not infer durable permission or run state from message text/actions.
- [x] Confirm channel adapters convert to and from shared content contracts.
- [x] Confirm a developer can answer "where does this state live?" from one contract and one owner document.

## Phase 2: Lock Golden Path Tests

Owner area: `electron/*.test.ts`, feature-local tests, and focused renderer state tests.

- [x] Permission request appears, survives refresh, accepts a choice, and updates style after submission.
  - [x] ACP pending permission requests are projected back into refreshed thread detail payloads.
  - [x] Renderer permission prompts map to composer cards after refresh.
  - [x] Permission submission styling is handled by a focused renderer projection helper.
- [x] Thinking, tool progress, tool result, and final response render as separate blocks.
- [x] Final response does not delete or overwrite prior thinking/tool blocks.
- [x] Lark and Weixin inbound text/image/file inputs normalize into the same core content model.
  - [x] Shared channel thread message helper keeps text wrapping and non-text attachments consistent across Lark and Weixin.
  - [x] Weixin downloaded image and file attachments become structured inbound content parts.
  - [x] Lark file messages become structured inbound file content parts.
- [x] File return supports current workspace paths and allowed absolute paths through one outbound content path.
- [x] Scheduler commands resolve short job ids, thread scope, execution mode, and side-thread behavior consistently.
- [x] Production build contains renderer assets.
- [x] Packaged app can open without blank page.
- [x] Every repeated historical bug has a regression test or a written reason why it is not automated yet.
  - [x] Permission lifecycle, streaming block separation, route parsing, channel normalization, scheduler behavior, and production packaging have focused regression coverage.
  - [x] Full release-candidate smoke remains documented as `pnpm e2e:smoke` because it launches packaged Electron scenarios.
- [x] `pnpm test` remains the fast local gate.
- [x] `pnpm e2e:smoke` remains the release candidate gate.

## Phase 3: Reduce Hotspot File Risk

Priority files:

- `src/pages/Threads/ThreadChat.tsx`
- `services/local-ai-core/src/acp/local-core-acp-store.ts`
- `services/local-ai-core/src/runtime/server.ts`
- `services/local-ai-core/src/runtime/local-core-controller.ts`

Checklist:

- [x] Page components orchestrate UI and data flow only.
  - [x] Thread Chat page-level knowledge, session, project, and composer derivations live in focused pure helpers.
  - [x] Thread Chat message visibility decisions live outside the page shell and are covered by direct tests.
- [x] Message-block rendering decisions live in focused presentation components.
- [x] State transitions are extracted into pure functions with tests.
- [x] Runtime server route registration is split from request handlers.
  - [x] Runtime and scheduler job routes parse through a focused route descriptor before handler dispatch.
  - [x] Thread and run interrupt routes parse through the same focused route descriptor.
  - [x] Workspace, security, approval, audit, and task routes parse through the same focused route descriptor.
  - [x] Knowledge routes parse through the same focused route descriptor.
  - [x] Capability, plugin diagnostics, event stream, and workspace probe routes parse through the same focused route descriptor.
  - [x] Platform gateway and pairing routes parse through the same focused route descriptor.
- [x] ACP persistence is separated from streaming event processing.
  - [x] ACP progress message formatting and filtering live in focused pure projection helpers.
  - [x] ACP tool call payload key parsing lives in the same pure projection helper.
  - [x] ACP assistant and thought chunk streaming projections live in focused pure helpers.
  - [x] ACP pending tool call registration lives in focused pure helpers.
- [x] Permission lifecycle handling is separated from generic message processing.
  - [x] ACP permission option parsing and fallback prompt construction live in focused lifecycle helpers.
  - [x] ACP running permission request and approval input construction live in focused lifecycle helpers.
  - [x] ACP pending permission state writes live in focused lifecycle helpers.
- [x] Common bug fixes touch fewer layers than before.
  - [x] Runtime route matching fixes can touch parser tests and dispatch without editing unrelated handlers.
  - [x] ACP permission/progress fixes can touch lifecycle or projection helpers without editing persistence stores.
  - [x] Thread Chat page projection fixes can touch page-state helpers and focused tests without editing controller hooks.
- [x] State transitions can be tested without launching Electron or a full Local AI Core server.
  - [x] ACP streaming, tool-call, and permission transitions are covered through direct helper tests.
  - [x] Runtime route selection is covered through direct parser tests.

## Phase 4: Bug Triage Checklist

Before fixing a bug:

- [ ] Reproduction path is written down.
- [ ] Owner layer is identified: renderer, Local AI Core, ACP, channel adapter, scheduler, packaging, or shared contract.
- [ ] Broken invariant is written down.
- [ ] Bug is categorized with one or more labels:
  - [ ] `state-owner`: wrong layer owns or derives the state.
  - [ ] `event-order`: events arrive in a valid but unexpected order.
  - [ ] `contract-drift`: types or payloads differ across layers.
  - [ ] `channel-adapter`: platform parsing/delivery differs from shared behavior.
  - [ ] `streaming-block`: message identity or block identity is wrong.
  - [ ] `release-packaging`: built artifact differs from dev behavior.
  - [ ] `ui-projection`: renderer display is wrong even though core state is correct.
- [ ] Smallest failing regression test is added, unless the bug truly requires a real third-party platform.
- [ ] If no automated test is added, the reason is written down.

After fixing a bug:

- [ ] Test passes for the restored invariant.
- [ ] Validation command is recorded.
- [ ] Fix does not move durable state into renderer or platform adapter code.
- [ ] Fix does not add a second representation of an existing contract.
- [ ] Edge cases are listed for follow-up coverage.

## Phase 5: Feature Entry Checklist

Before implementing a feature:

- [ ] Decide whether this is core behavior or platform-specific adapter behavior.
- [ ] Identify the shared contract that should change first.
- [ ] Identify which owner stores durable state.
- [ ] Identify which renderer state is transient only.
- [ ] Check whether this affects desktop, web, mobile H5, Lark, Weixin, or future channels.
- [ ] Treat Lark-only feature requests as shared channel contract requests unless explicitly platform-only.
- [ ] Define the smallest golden path test.

After implementing a feature:

- [ ] Contract is updated.
- [ ] Tests cover the shared behavior.
- [ ] Platform adapters remain thin.
- [ ] `README.md` `New` section is updated if user-visible.
- [ ] Relevant edge cases are listed in the final note or PR.

## Phase 6: Release Guardrails

Before tagging a release:

- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Run `pnpm e2e:smoke` for release candidates.
- [ ] Verify renderer assets exist in the packaged app.
- [ ] Verify at least one thread chat flow can open.
- [ ] Verify one permission flow if ACP permission behavior changed.
- [ ] Verify one channel flow if Lark, Weixin, or shared channel content changed.
- [ ] Record validation commands in the release commit or PR.
- [ ] Avoid mixing broad refactors and release-only fixes in the same final release commit.
- [ ] Prefer small stabilization commits after large feature work.

## Immediate Next Checklist

- [x] Add a message block contract note to the ACP protocol documentation.
- [x] Add a channel content contract note covering text, image, file, and permission-card delivery.
- [x] Add regression tests for permission lifecycle.
- [x] Add regression tests for thinking/final answer separation.
- [x] Split the next Thread Chat fix by first extracting pure state transitions, then changing UI.
- [x] Extract shared Lark/Weixin channel thread message input construction.
- [x] Preserve Weixin downloaded file attachments as structured inbound content parts.
- [x] Add Lark inbound file download and structured file content coverage.
- [x] Add shared normalization helpers for scheduler execution mode, trigger type, and channel platform id.
- [x] Reuse shared permission response normalization for ACP permission actions.
- [x] Add shared normalization helpers for approval state, content type, task state, run state, and scheduled run state.
