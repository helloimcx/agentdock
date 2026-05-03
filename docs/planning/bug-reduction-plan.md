# Bug Reduction Plan

This plan turns recent repeated bug patterns into concrete engineering guardrails. It focuses on reducing cross-layer rework in Thread Chat, Local AI Core, ACP runtime handling, and channel integrations.

## Current Diagnosis

Recent sessions and commits show the same areas causing repeated fixes:

- Permission UI state: buttons briefly appeared, disappeared after refresh, or were inferred from message actions instead of durable permission state.
- Streaming message updates: thinking, tool progress, and final answers could overwrite each other because message identity and block ownership were not explicit enough.
- Channel features: Lark-specific work for cards, images, files, and commands often needed to be generalized later for Weixin and future channels.
- Runtime and release paths: production packaging, blank page failures, runtime detection, and build output checks were caught late.
- Type and form drift: API values such as execution mode and trigger type required small follow-up fixes because UI forms, shared contracts, and persisted values were not validated through one path.

The broad cause is not a single bad module. AgentDock is evolving through multiple boundaries at once: renderer state, Local AI Core state, ACP events, channel gateways, scheduler tasks, and shared contracts. Bugs become expensive when those boundaries each keep a partial version of the same concept.

## Root Causes

### 1. State Ownership Drift

The architecture says durable product state belongs to Local AI Core, but some renderer code has historically derived long-lived behavior from transient message content. Permission state is the clearest example.

Target rule:

- Local AI Core owns durable run, thread, task, permission, attachment, and channel delivery state.
- Renderer owns only transient view state such as selected tab, draft text, loading flags, and layout choices.
- Channel gateways adapt platform events into core contracts and adapt core outbound messages back to platform payloads. They do not own product state.

### 2. Message Block Model Is Too Easy To Misuse

Thinking, tool updates, final text, permission prompts, and attachments are different semantic blocks. If they are represented as plain message text too early, later updates can overwrite useful intermediate context.

Target rule:

- Every streamed update must map to a stable message id and block id.
- Thinking, tool calls, tool results, final text, permission requests, images, and files must be distinguishable in the core model.
- UI rendering should be a pure projection of message blocks, not a place where protocol meaning is reconstructed.

### 3. Channel Abstractions Arrive After Feature Work

Several features start in Lark because it is the active channel, then later need to become generic. That creates repeated patches across Lark, Weixin, ACP, stores, and shared types.

Target rule:

- New channel capabilities start with a shared inbound or outbound contract first.
- Platform-specific code only handles parsing, upload/download, and delivery.
- Tests cover the shared behavior before platform adapters are expanded.

### 4. Tests Catch Bugs Too Late

The existing `pnpm test` path is useful, but the most repeated failures involve event order, UI state transitions, streaming updates, and channel normalization. These need smaller contract and state-machine tests so bugs fail close to their source.

Target rule:

- A bug fix starts with a failing regression test when practical.
- Cross-layer features include at least one contract test at the lowest stable boundary.
- Production release checks include build output validation for renderer assets and app startup.

### 5. Release Pace Mixes Feature, Refactor, And Stabilization

Recent releases landed many feature, refactor, and fix commits close together. That is productive, but it makes regressions harder to isolate.

Target rule:

- Feature commits should be separated from stabilization commits.
- Each release should have an explicit validation note listing the core flows tested.
- Risky boundary changes should ship behind a small compatibility layer or with focused migration tests.

## Target Outcomes

- Fewer repeated permission, streaming, and channel regressions.
- Faster bug localization: UI issue, core state issue, channel adapter issue, or protocol issue.
- Less feature rework when adding Weixin, Lark, app, web, and future channel support.
- Smaller files with clearer ownership and fewer "one more patch here" fixes.
- A predictable release checklist that catches blank pages and packaging issues before tagging.

## Phase 1: Freeze Core Contracts

Owner area: `shared/`, `packages/contracts/`, `packages/core-sdk/`, `services/local-ai-core/src/router/`

Actions:

- Define canonical contracts for `Thread`, `Run`, `Task`, `PermissionRequest`, `MessageBlock`, `Attachment`, `ChannelInboundContent`, and `ChannelOutboundContent`.
- Document which fields are persisted, streamed, rendered, and platform-specific.
- Remove duplicate ad hoc type definitions where renderer, Local AI Core, and plugins represent the same concept differently.
- Add runtime validation or parser helpers at API boundaries for enum-like values such as execution mode, trigger type, platform, content type, and permission outcome.

Exit criteria:

- A developer can answer "where does this state live?" by checking one contract and one owner document.
- Renderer code does not infer durable permission or run state from message text/actions.
- Channel adapters convert to and from shared content contracts.

## Phase 2: Lock Golden Path Tests

Owner area: `electron/*.test.ts`, feature-local tests, and focused renderer state tests.

Golden paths:

- Permission request appears, survives refresh, accepts a choice, and updates style after submission.
- Thinking, tool progress, tool result, and final response render as separate blocks and do not overwrite each other.
- Lark and Weixin inbound text/image/file inputs normalize into the same core content model.
- File return supports current workspace paths and allowed absolute paths through one outbound content path.
- Scheduler commands resolve short job ids, thread scope, execution mode, and side-thread behavior consistently.
- Production build contains renderer assets and can open without blank page.

Exit criteria:

- Every repeated historical bug has a regression test or a documented reason why it cannot be automated yet.
- `pnpm test` remains the fast local gate.
- `pnpm e2e:smoke` remains the release gate for packaged behavior.

## Phase 3: Reduce Hotspot File Risk

Owner area: Thread Chat, ACP store, runtime server, local core controller.

Priority files:

- `src/pages/Threads/ThreadChat.tsx`
- `services/local-ai-core/src/acp/local-core-acp-store.ts`
- `services/local-ai-core/src/runtime/server.ts`
- `services/local-ai-core/src/runtime/local-core-controller.ts`

Actions:

- Keep page components focused on orchestration and rendering.
- Move message-block rendering decisions into focused presentation components.
- Move state transitions into pure functions with tests.
- Split HTTP route registration from request handlers in runtime server code.
- Split ACP persistence, streaming event processing, and permission lifecycle responsibilities.

Exit criteria:

- Hotspot files shrink or stop accumulating unrelated responsibilities.
- Common bug fixes touch fewer layers.
- State transitions can be tested without launching Electron or a full Local AI Core server.

## Phase 4: Establish Bug Triage Ritual

Every bug should be classified before fixing:

- `state-owner`: wrong layer owns or derives the state.
- `event-order`: events arrive in a valid but unexpected order.
- `contract-drift`: types or payloads differ across layers.
- `channel-adapter`: platform parsing/delivery differs from shared behavior.
- `streaming-block`: message identity or block identity is wrong.
- `release-packaging`: built artifact differs from dev behavior.
- `ui-projection`: renderer display is wrong even though core state is correct.

Required bug note:

- Reproduction path.
- Owner layer.
- Broken invariant.
- Regression test added or reason omitted.
- Validation command.

Exit criteria:

- Repeated bugs are searchable by category.
- Fixes explain the invariant they restored.
- Future agents have enough context to avoid local patches that reintroduce old behavior.

## Phase 5: Release Guardrails

Before a release tag:

- Run `pnpm test`.
- Run `pnpm build`.
- Run `pnpm e2e:smoke` for release candidates.
- Verify renderer assets exist in the packaged app.
- Verify at least one thread chat flow can open.
- Verify one permission flow if ACP permission behavior changed.
- Verify one channel flow if Lark, Weixin, or shared channel content changed.
- Record validation commands in the release commit or PR.

Release discipline:

- Avoid mixing broad refactors and release-only fixes in the same final release commit.
- Prefer small stabilization commits after large feature work.
- Keep `README.md` `New` updates concise and user-visible.

## Feature Entry Checklist

Before implementing a feature:

- Is this feature core behavior or platform-specific adapter behavior?
- Which shared contract changes first?
- Which owner stores durable state?
- Which renderer state is only transient?
- Does this affect desktop, web, mobile H5, Lark, Weixin, or future channels?
- What is the smallest golden path test?

After implementing a feature:

- Contract updated.
- Tests cover the shared behavior.
- Platform adapters remain thin.
- README `New` section updated if user-visible.
- Edge cases listed in the final note.

## Immediate Next Steps

1. Add a message block contract note to the ACP protocol documentation.
2. Add a channel content contract note covering text, image, file, and permission-card delivery.
3. Add regression tests for permission lifecycle and thinking/final answer separation.
4. Split the next Thread Chat fix by first extracting pure state transitions, then changing UI.
5. Treat any Lark-only feature request as a shared channel contract request unless explicitly platform-only.
