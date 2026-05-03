# Bug Reduction Checklist

Use this checklist to reduce repeated regressions in Thread Chat, Local AI Core, ACP runtime handling, channel integrations, scheduler behavior, and release packaging.

## Problem Patterns To Watch

- [ ] Permission UI state is owned by Local AI Core, not inferred from message actions.
- [ ] Thinking, tool progress, tool results, and final answers cannot overwrite each other.
- [ ] Lark-first work is checked for shared channel impact before implementation.
- [ ] Form values, API enums, persisted values, and shared contracts use one parsing path.
- [ ] Release fixes are separated from broad feature or refactor work when possible.
- [ ] Production build behavior is verified, not assumed from dev mode.

## Phase 1: Freeze Core Contracts

Owner area: `shared/`, `packages/contracts/`, `packages/core-sdk/`, `services/local-ai-core/src/router/`

- [ ] Define canonical contracts for `Thread`, `Run`, `Task`, `PermissionRequest`, `MessageBlock`, `Attachment`, `ChannelInboundContent`, and `ChannelOutboundContent`.
- [ ] Document which fields are persisted, streamed, rendered, and platform-specific.
- [ ] Remove duplicated ad hoc types for the same concept across renderer, Local AI Core, plugins, and shared packages.
- [ ] Add parser or validation helpers for enum-like values: execution mode, trigger type, platform, content type, permission outcome, task state, and run state.
- [ ] Confirm renderer code does not infer durable permission or run state from message text/actions.
- [ ] Confirm channel adapters convert to and from shared content contracts.
- [ ] Confirm a developer can answer "where does this state live?" from one contract and one owner document.

## Phase 2: Lock Golden Path Tests

Owner area: `electron/*.test.ts`, feature-local tests, and focused renderer state tests.

- [ ] Permission request appears, survives refresh, accepts a choice, and updates style after submission.
- [ ] Thinking, tool progress, tool result, and final response render as separate blocks.
- [ ] Final response does not delete or overwrite prior thinking/tool blocks.
- [ ] Lark and Weixin inbound text/image/file inputs normalize into the same core content model.
- [ ] File return supports current workspace paths and allowed absolute paths through one outbound content path.
- [ ] Scheduler commands resolve short job ids, thread scope, execution mode, and side-thread behavior consistently.
- [ ] Production build contains renderer assets.
- [ ] Packaged app can open without blank page.
- [ ] Every repeated historical bug has a regression test or a written reason why it is not automated yet.
- [ ] `pnpm test` remains the fast local gate.
- [ ] `pnpm e2e:smoke` remains the release candidate gate.

## Phase 3: Reduce Hotspot File Risk

Priority files:

- `src/pages/Threads/ThreadChat.tsx`
- `services/local-ai-core/src/acp/local-core-acp-store.ts`
- `services/local-ai-core/src/runtime/server.ts`
- `services/local-ai-core/src/runtime/local-core-controller.ts`

Checklist:

- [ ] Page components orchestrate UI and data flow only.
- [ ] Message-block rendering decisions live in focused presentation components.
- [ ] State transitions are extracted into pure functions with tests.
- [ ] Runtime server route registration is split from request handlers.
- [ ] ACP persistence is separated from streaming event processing.
- [ ] Permission lifecycle handling is separated from generic message processing.
- [ ] Common bug fixes touch fewer layers than before.
- [ ] State transitions can be tested without launching Electron or a full Local AI Core server.

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
