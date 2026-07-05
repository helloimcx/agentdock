# Conditional Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify scheduled jobs and event monitors behind an Automation engine, then add approved shebang condition scripts executed through Anthropic Sandbox Runtime on macOS and Linux.

**Architecture:** Persist one discriminated Automation definition with separate Activation, Condition, Action, and Delivery fields. A trigger engine creates Evaluations, a condition engine detects rising edges, and the existing ACP/channel path executes Actions; script conditions bind immutable, twice-approved script versions and can only run through a fail-closed SandboxRunner.

**Tech Stack:** TypeScript, Node.js 24, `node:sqlite`, Electron, React 19, Anthropic Sandbox Runtime 0.0.63, pnpm, Node test runner.

---

## Scope and file map

This is one dependency-ordered plan with four independently verifiable milestones. Do not start script execution before the unified engine is green, and do not start UI work before the API contracts are green.

Core files to create:

- `packages/contracts/src/automations.ts`: canonical Automation, Evaluation, Run, script-version, approval, and request types.
- `services/local-ai-core/src/acp/store/automation-store.ts`: definitions, evaluations, runs, migration, and retention.
- `services/local-ai-core/src/acp/store/automation-script-store.ts`: immutable script metadata and approval linkage.
- `services/local-ai-core/src/automation/automation-trigger-engine.ts`: due-time and missed-check calculation.
- `services/local-ai-core/src/automation/automation-condition-engine.ts`: condition evaluation and rising-edge decisions.
- `services/local-ai-core/src/automation/automation-action-executor.ts`: neutral ACP/channel action execution.
- `services/local-ai-core/src/automation/automation-service.ts`: orchestration and public application API.
- `services/local-ai-core/src/automation/scripts/script-package.ts`: manifest validation, safe extraction, and hashing.
- `services/local-ai-core/src/automation/scripts/sandbox-runner.ts`: platform-neutral sandbox contract.
- `services/local-ai-core/src/automation/scripts/anthropic-sandbox-runner.ts`: macOS/Linux adapter and capability probe.
- `services/local-ai-core/src/automation/scripts/script-protocol-runner.ts`: stdin/stdout protocol, limits, timeout, and redaction.
- `services/local-ai-core/src/automation/automation-script-service.ts`: two-stage approval state machine.
- `services/local-ai-core/src/runtime/handlers/automations-handler.ts`: unified HTTP handlers.
- `packages/core-sdk/src/automations.ts`: renderer/client API.
- `electron/managed-skills/condition-trigger/`: Agent authoring workflow and helper script.
- `src/pages/Automation/AutomationList.tsx`: unified management and approval surface.

Existing Scheduler and Monitor modules remain as compatibility facades until the final migration task. Avoid adding script-specific behavior to either legacy service.

## Milestone 1: Unified Automation core

### Task 1: Canonical Automation contracts

**Files:**
- Create: `packages/contracts/src/automations.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`
- Modify: `packages/plugin-sdk/src/runtime.ts`
- Test: `tests/contracts/automation-contracts.test.ts`

- [ ] **Step 1: Write the failing contract test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAutomationDefinition } from '../../packages/contracts/src/automations.js';

test('normalizes a cron automation with a script condition', () => {
  const result = normalizeAutomationDefinition({
    id: 'automation:1', workspaceId: 'ws', title: 'Check API', enabled: true,
    health: 'healthy', activation: { kind: 'cron', expression: '*/5 * * * *', timezone: 'Asia/Shanghai' },
    condition: { kind: 'approved-script', scriptId: 'script:1', approvedVersionId: 'version:1', edge: 'rising' },
    action: { kind: 'agent-prompt', promptTemplate: 'analyze {{summary}}', executionMode: 'side-thread' },
    delivery: { platform: 'local', route: { type: 'local.thread', channelId: 'ws' } },
    policies: { concurrency: 'skip-if-running', cooldownMs: 0 },
    consecutiveEvaluationFailures: 0, createdAt: '2026-07-05T00:00:00.000Z', updatedAt: '2026-07-05T00:00:00.000Z',
  });
  assert.equal(result.condition.kind, 'approved-script');
});
```

- [ ] **Step 2: Run the contract test and verify the missing module failure**

Run: `pnpm build:electron && node --test dist-electron/tests/contracts/automation-contracts.test.js`
Expected: FAIL because `packages/contracts/src/automations.ts` does not exist.

- [ ] **Step 3: Add discriminated types and strict normalizers**

Define `AutomationActivation`, `AutomationCondition`, `AutomationAction`, `AutomationDefinition`, `AutomationEvaluation`, `AutomationRun`, `AutomationScript`, `AutomationScriptVersion`, create/update inputs, and:

```ts
export function normalizeAutomationDefinition(value: unknown): AutomationDefinition {
  if (!value || typeof value !== 'object') throw new Error('Automation definition must be an object.');
  const input = value as Record<string, unknown>;
  const activation = normalizeAutomationActivation(input.activation);
  const condition = normalizeAutomationCondition(input.condition);
  if (!String(input.workspaceId || '').trim()) throw new Error('Automation workspaceId is required.');
  if (!String(input.title || '').trim()) throw new Error('Automation title is required.');
  return { ...input, activation, condition } as AutomationDefinition;
}
```

Export `./automations` from both the barrel and package exports. Add `automation.definition.updated`, `automation.evaluation.updated`, `automation.run.updated`, and `automation.script-version.updated` to `DomainEventPayloadMap`.

- [ ] **Step 4: Run contract and architecture tests**

Run: `pnpm build:electron && node --test dist-electron/tests/contracts/automation-contracts.test.js dist-electron/tests/contracts/architecture-docs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit the contracts**

```bash
git add packages/contracts packages/plugin-sdk/src/runtime.ts tests/contracts/automation-contracts.test.ts
git commit -m "Add unified automation contracts"
```

### Task 2: Unified SQLite persistence and legacy import

**Files:**
- Create: `services/local-ai-core/src/acp/store/automation-store.ts`
- Modify: `services/local-ai-core/src/acp/store/schema.ts`
- Modify: `services/local-ai-core/src/acp/store/local-core-acp-store.ts`
- Modify: `services/local-ai-core/src/router/workspace-router-types.ts`
- Test: `tests/electron/automation-store.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Cover create/read/update, Evaluation and Run separation, `lastSuccessfulMatch`, health blocking, 30-day/1000-row Evaluation retention, and idempotent imports from `scheduled_jobs` and `automation_monitors`. Assert imported records preserve legacy IDs and `originKind`.

- [ ] **Step 2: Verify the store test fails**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-store.test.js`
Expected: FAIL because `LocalAutomationStore` is missing.

- [ ] **Step 3: Add schema and focused store**

Create `automations`, `automation_evaluations`, and `automation_runs` tables. Store discriminated fields as validated JSON, keep indexed columns for workspace, enabled, health, next-check time, and origin, and add foreign keys with cascade deletion. Implement:

```ts
create(input: AutomationCreateInput): AutomationDefinition;
update(id: string, input: AutomationUpdateInput): AutomationDefinition;
createEvaluation(automationId: string, input: AutomationEvaluationCreateInput): AutomationEvaluation;
finishEvaluation(id: string, input: AutomationEvaluationFinishInput): AutomationEvaluation;
createRun(automationId: string, evaluationId: string): AutomationRun;
importLegacyRecords(): { scheduled: number; monitors: number };
pruneEvaluations(now: Date): number;
```

Run legacy import in one SQLite transaction and use `INSERT ... ON CONFLICT DO NOTHING` so every startup is safe.

- [ ] **Step 4: Run store and existing scheduler/monitor store tests**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-store.test.js dist-electron/tests/electron/workspace-task-store.test.js dist-electron/tests/electron/automation-monitor.test.js`
Expected: PASS.

- [ ] **Step 5: Commit persistence**

```bash
git add services/local-ai-core/src/acp services/local-ai-core/src/router/workspace-router-types.ts tests/electron/automation-store.test.ts
git commit -m "Persist unified automations"
```

### Task 3: Trigger and condition state machines

**Files:**
- Create: `services/local-ai-core/src/automation/automation-trigger-engine.ts`
- Create: `services/local-ai-core/src/automation/automation-condition-engine.ts`
- Modify: `services/local-ai-core/src/automation/condition-evaluator.ts`
- Test: `tests/electron/automation-engine.test.ts`

- [ ] **Step 1: Write table-driven failing tests**

Test cron/once/interval due decisions, one missed check after restart, first `true` trigger, sustained `true`, false re-arm, error state preservation, cooldown skip, Evaluation overlap, and action overlap.

```ts
assert.deepEqual(decideTrigger({ previous: false, matched: true, coolingDown: false, actionRunning: false }), { decision: 'triggered', nextMatch: true });
assert.deepEqual(decideTrigger({ previous: true, matched: true, coolingDown: false, actionRunning: false }), { decision: 'not_rising', nextMatch: true });
```

- [ ] **Step 2: Verify failures**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-engine.test.js`
Expected: FAIL because trigger and condition engines are missing.

- [ ] **Step 3: Implement pure state functions before timers**

Implement `nextActivationAt`, `isActivationDue`, `missedActivationAt`, and `decideTrigger`. Keep time input injectable and return decisions without persistence side effects. Adapt the existing expression evaluator behind the new condition union.

- [ ] **Step 4: Run focused tests**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-engine.test.js dist-electron/tests/electron/automation-monitor.test.js`
Expected: PASS.

- [ ] **Step 5: Commit state machines**

```bash
git add services/local-ai-core/src/automation tests/electron/automation-engine.test.ts
git commit -m "Add automation trigger state machine"
```

### Task 4: Neutral action executor and Automation service

**Files:**
- Create: `services/local-ai-core/src/automation/automation-action-executor.ts`
- Create: `services/local-ai-core/src/automation/automation-service.ts`
- Modify: `services/local-ai-core/src/automation/automation-conversation-executor.ts`
- Modify: `services/local-ai-core/src/scheduler/scheduled-conversation-executor.ts`
- Modify: `services/local-ai-core/src/kernel/bootstrap.ts`
- Modify: `services/local-ai-core/src/runtime/local-core-controller.ts`
- Test: `tests/electron/automation-service.test.ts`

- [ ] **Step 1: Write a failing orchestration test**

Use fake clock, fake condition evaluator, fake action executor, and in-memory temporary store. Assert one due check creates one Evaluation and one Run, emits three unified events, and keeps delivery route unchanged.

- [ ] **Step 2: Run and observe the missing service failure**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-service.test.js`
Expected: FAIL because `AutomationService` is missing.

- [ ] **Step 3: Extract neutral execution input**

```ts
export interface AutomationActionExecutionInput {
  automation: AutomationDefinition;
  evaluation: AutomationEvaluation;
  promptVariables: Record<string, unknown>;
}
```

Move common thread resolution, bridge session, prompt rendering, ACP send, and delivery result mapping behind `AutomationActionExecutor.execute`. Keep legacy executors as thin adapters during migration.

- [ ] **Step 4: Implement lifecycle orchestration**

`AutomationService.start()` performs legacy import, one catch-up check, then starts a 30-second due loop. `checkNow()` shares the exact Evaluation path. `stop()` clears timers and waits for in-flight checks. Register it in bootstrap and expose it from `LocalCoreController`.

Increment `consecutiveEvaluationFailures` on errors, reset it on success, and emit user-visible alerts on failure counts 1, 3, 7, 15, and 31. This is the concrete bounded exponential schedule; later failures remain visible in Evaluation history without producing an alert every tick.

- [ ] **Step 5: Run service and delivery regressions**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-service.test.js dist-electron/tests/electron/workspace-task-store.test.js`
Expected: PASS.

- [ ] **Step 6: Commit the service**

```bash
git add services/local-ai-core/src/automation services/local-ai-core/src/kernel/bootstrap.ts services/local-ai-core/src/runtime/local-core-controller.ts services/local-ai-core/src/scheduler/scheduled-conversation-executor.ts tests/electron/automation-service.test.ts
git commit -m "Run unified automation actions"
```

### Task 5: Convert legacy Scheduler and Monitor APIs to facades

**Files:**
- Modify: `services/local-ai-core/src/scheduler/scheduled-job-application-service.ts`
- Modify: `services/local-ai-core/src/scheduler/scheduler-service.ts`
- Modify: `services/local-ai-core/src/automation/automation-monitor-service.ts`
- Modify: `services/local-ai-core/src/runtime/handlers/scheduler-handler.ts`
- Modify: `services/local-ai-core/src/runtime/handlers/automation-handler.ts`
- Test: `tests/electron/automation-compatibility.test.ts`
- Test: `tests/electron/lac-cli.test.ts`

- [ ] **Step 1: Add failing compatibility tests**

Assert legacy scheduler create produces `cron + always`, legacy monitor create produces `provider-event + expression`, legacy IDs remain accepted, and list/update/delete/run operate on the unified store.

- [ ] **Step 2: Verify the new assertions fail**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-compatibility.test.js dist-electron/tests/electron/lac-cli.test.js`
Expected: FAIL because legacy services still own their tables and loops.

- [ ] **Step 3: Replace ownership with explicit mapping functions**

Add `scheduledJobToAutomationInput`, `automationToScheduledJob`, `monitorToAutomationInput`, and `automationToMonitor`. Disable legacy polling loops after the unified service starts; retain public methods and return shapes.

- [ ] **Step 4: Run all legacy scheduler and monitor tests**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-compatibility.test.js dist-electron/tests/electron/lac-cli.test.js dist-electron/tests/electron/workspace-task-store.test.js dist-electron/tests/electron/automation-monitor.test.js`
Expected: PASS with no duplicate executions.

- [ ] **Step 5: Commit compatibility facades**

```bash
git add services/local-ai-core/src/scheduler services/local-ai-core/src/automation services/local-ai-core/src/runtime/handlers tests/electron
git commit -m "Route scheduler and monitors through automations"
```

## Milestone 2: Script artifacts, approvals, and sandbox

### Task 6: Immutable script packages

**Files:**
- Create: `services/local-ai-core/src/automation/scripts/script-package.ts`
- Create: `services/local-ai-core/src/acp/store/automation-script-store.ts`
- Modify: `services/local-ai-core/src/acp/store/schema.ts`
- Modify: `services/local-ai-core/src/acp/store/local-core-acp-store.ts`
- Test: `tests/electron/automation-script-package.test.ts`

- [ ] **Step 1: Write failing package security tests**

Use temporary bundles to test deterministic SHA-256, manifest validation, missing/invalid shebang, symlinks, path traversal, modified files, and immutable destination layout `<userData>/automations/scripts/<scriptId>/<sha256>/`.

- [ ] **Step 2: Verify failures**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-script-package.test.js`
Expected: FAIL because package validation and storage do not exist.

- [ ] **Step 3: Implement safe staging and metadata persistence**

Reject symlinks and non-regular files, normalize relative POSIX paths, sort entries before hashing, copy to a temporary sibling, verify the copied hash, chmod files read-only, then atomically rename. Add `automation_scripts` and `automation_script_versions` tables.

- [ ] **Step 4: Run the security tests**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-script-package.test.js`
Expected: PASS.

- [ ] **Step 5: Commit script artifacts**

```bash
git add services/local-ai-core/src/automation/scripts services/local-ai-core/src/acp tests/electron/automation-script-package.test.ts
git commit -m "Store immutable automation scripts"
```

### Task 7: Two-stage approval service

**Files:**
- Create: `services/local-ai-core/src/automation/automation-script-service.ts`
- Modify: `packages/contracts/src/automations.ts`
- Modify: `packages/contracts/src/local-core.ts`
- Modify: `services/local-ai-core/src/acp/store/security-store.ts`
- Test: `tests/electron/automation-script-approval.test.ts`

- [ ] **Step 1: Write failing transition tests**

Cover `draft -> pending_test_approval -> test_authorized -> tested -> pending_approval -> approved`, rejection, revocation, one-shot test authorization, expired approval, hash mismatch, changed permissions, and changed `env://NAME` Secret references.

- [ ] **Step 2: Run and verify failures**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-script-approval.test.js`
Expected: FAIL because approval transitions are missing.

- [ ] **Step 3: Add automation-specific approval kinds and scopes**

Extend `ApprovalRequestKind` with `automation_script_test` and `automation_script_enable`; extend audit events with `automation.script.test_authorized`, `automation.script.approved`, and `automation.script.revoked`. Store version ID, hash, manifest digest, permission snapshot, and test plan digest in approval metadata.

- [ ] **Step 4: Implement guarded transition methods**

```ts
requestTestApproval(versionId: string, actor: string): ApprovalRequest;
authorizeTest(versionId: string, approvalId: string, actor: string): AutomationScriptVersion;
recordTestResult(versionId: string, result: AutomationScriptTestReport): AutomationScriptVersion;
requestEnableApproval(versionId: string, actor: string): ApprovalRequest;
approveVersion(versionId: string, approvalId: string, actor: string): AutomationScriptVersion;
revokeVersion(versionId: string, actor: string): AutomationScriptVersion;
```

- [ ] **Step 5: Run approval and existing security tests**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-script-approval.test.js dist-electron/tests/electron/security-approval-store.test.js`
Expected: PASS.

- [ ] **Step 6: Commit approvals**

```bash
git add packages/contracts services/local-ai-core/src/automation/automation-script-service.ts services/local-ai-core/src/acp/store/security-store.ts tests/electron/automation-script-approval.test.ts
git commit -m "Require two-stage script approval"
```

### Task 8: Anthropic Sandbox Runtime adapter and platform probe

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `services/local-ai-core/src/automation/scripts/sandbox-runner.ts`
- Create: `services/local-ai-core/src/automation/scripts/anthropic-sandbox-runner.ts`
- Modify: `services/local-ai-core/src/runtime/deployment-diagnostics.ts`
- Test: `tests/electron/automation-sandbox-runner.test.ts`
- Test: `tests/integration/automation-sandbox-runtime.test.ts`

- [ ] **Step 1: Add exact dependency**

Run: `pnpm add @anthropic-ai/sandbox-runtime@0.0.63 --save-exact`
Expected: `package.json` and `pnpm-lock.yaml` record exactly `0.0.63`.

- [ ] **Step 2: Write failing fake-runner and capability tests**

Define the contract:

```ts
export interface SandboxRunner {
  probe(): Promise<{ available: boolean; platform: string; missing: string[] }>;
  run(input: SandboxRunInput): Promise<SandboxRunResult>;
}
```

Test macOS/Linux config generation, Windows fail-closed, missing `bwrap`/`socat`/`rg`, AppArmor userns failure, public egress mode, private-address deny rules, read-only package, and temp-only writes.

- [ ] **Step 3: Implement the adapter**

Use `SandboxManager.initialize(config)` and `SandboxManager.wrapWithSandbox(command)` behind one adapter instance. Generate public mode as wildcard public-domain access plus explicit private/local deny rules; generate restricted mode from manifest domains. Never expose the wrapped shell string outside the adapter.

- [ ] **Step 4: Add real tests guarded by platform prerequisites**

The real integration test must prove: write inside temp succeeds, read of a fixture secret outside allowed paths fails, an HTTPS request to `example.com` succeeds in public mode, and direct localhost/private access fails. Keep public-network behavior covered by deterministic fake-runner tests as well; skip the real test only when capability probe reports a named system dependency or the CI job explicitly declares outbound networking unavailable.

- [ ] **Step 5: Run fake and real tests**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-sandbox-runner.test.js dist-electron/tests/integration/automation-sandbox-runtime.test.js`
Expected: PASS on supported macOS/Linux hosts; Windows assertions PASS with `sandbox_unavailable`.

- [ ] **Step 6: Commit sandbox integration**

```bash
git add package.json pnpm-lock.yaml services/local-ai-core/src/automation/scripts services/local-ai-core/src/runtime/deployment-diagnostics.ts tests/electron/automation-sandbox-runner.test.ts tests/integration/automation-sandbox-runtime.test.ts
git commit -m "Run automation scripts in sandbox"
```

### Task 9: Script protocol and script-backed conditions

**Files:**
- Create: `services/local-ai-core/src/automation/scripts/script-protocol-runner.ts`
- Create: `services/local-ai-core/src/automation/scripts/secret-resolver.ts`
- Modify: `services/local-ai-core/src/automation/automation-condition-engine.ts`
- Modify: `services/local-ai-core/src/automation/automation-service.ts`
- Test: `tests/electron/automation-script-runner.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Cover strict single-JSON stdout, stderr diagnostics, exit errors, 30-second default/5-minute maximum, process-tree kill, output limits, control-character removal, Secret redaction, successful `nextState`, failed state preservation, interpreter path/version mismatch, and unapproved version blocking.

- [ ] **Step 2: Verify failures**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-script-runner.test.js`
Expected: FAIL because the protocol runner is missing.

- [ ] **Step 3: Implement environment-only Secret references**

Support `env://SOURCE_NAME` references in the first release. Resolve only names declared in the approved manifest, inject them under the declared target names for one process, and return `secret_unavailable` without logging values.

- [ ] **Step 4: Implement protocol execution and condition integration**

Serialize `{ protocolVersion: 1, evaluationId, triggeredAt, config, previousState }` to stdin. Accept exactly `{ protocolVersion: 1, matched: boolean, summary?, payload?, nextState? }`. Bind the approved hash and interpreter facts immediately before every run; mark Automation blocked on mismatch or unavailable sandbox.

Persist only destination host, port, allow/deny decision, and timestamp from Sandbox Runtime network events. Redact URL credentials and query strings, and never persist request bodies or headers.

- [ ] **Step 5: Run protocol and engine tests**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-script-runner.test.js dist-electron/tests/electron/automation-engine.test.js dist-electron/tests/electron/automation-service.test.js`
Expected: PASS.

- [ ] **Step 6: Commit condition scripts**

```bash
git add services/local-ai-core/src/automation tests/electron/automation-script-runner.test.ts tests/electron/automation-engine.test.ts tests/electron/automation-service.test.ts
git commit -m "Evaluate approved script conditions"
```

## Milestone 3: API, CLI, and Agent Skill

### Task 10: Unified routes, SDK, and SSE events

**Files:**
- Create: `services/local-ai-core/src/runtime/handlers/automations-handler.ts`
- Modify: `services/local-ai-core/src/runtime/server-routes.ts`
- Modify: `services/local-ai-core/src/runtime/server.ts`
- Create: `packages/core-sdk/src/automations.ts`
- Modify: `packages/core-sdk/src/index.ts`
- Modify: `packages/core-sdk/package.json`
- Modify: `packages/core-sdk/src/client.ts`
- Test: `tests/integration/automation-routes.test.ts`
- Test: `tests/electron/core-client.test.ts`

- [ ] **Step 1: Write failing route and event decoder tests**

Cover Automation CRUD/check, Evaluation/Run lists, script create/version submit, test approval/execute, enable approval/approve/reject/revoke, invalid bodies, cross-workspace access, and all four unified SSE events.

- [ ] **Step 2: Verify route failures**

Run: `pnpm build:electron && node --test dist-electron/tests/integration/automation-routes.test.js dist-electron/tests/electron/core-client.test.js`
Expected: FAIL because unified routes and decoders are missing.

- [ ] **Step 3: Register explicit routes and handlers**

Add `/automations`, `/automations/:id/check`, `/automations/:id/evaluations`, `/automations/:id/runs`, `/automation-scripts`, and version transition routes. Validate every request with shared contract normalizers; do not accept arbitrary script paths, approval state, health, or hash from clients.

- [ ] **Step 4: Add SDK methods and strict SSE guards**

Expose typed methods from `@cc/core-sdk/automations`. Reject partial event payloads in `client.ts` instead of casting.

- [ ] **Step 5: Run API tests**

Run: `pnpm build:electron && node --test dist-electron/tests/integration/automation-routes.test.js dist-electron/tests/electron/core-client.test.js dist-electron/tests/integration/local-core-routes.test.js`
Expected: PASS.

- [ ] **Step 6: Commit API surface**

```bash
git add services/local-ai-core/src/runtime packages/core-sdk tests/integration/automation-routes.test.ts tests/electron/core-client.test.ts
git commit -m "Expose unified automation API"
```

### Task 11: LAC commands and Condition Trigger Skill

**Files:**
- Modify: `services/local-ai-core/src/cli/lac.ts`
- Modify: `services/local-ai-core/src/thread/agent-message-policy.ts`
- Create: `services/local-ai-core/src/runtime/managed-skill-catalog.ts`
- Create: `electron/managed-skills/condition-trigger/SKILL.md`
- Create: `electron/managed-skills/condition-trigger/scripts/register-condition-trigger.sh`
- Create: `scripts/copy-managed-skills.mjs`
- Modify: `package.json`
- Test: `tests/electron/lac-cli.test.ts`
- Test: `tests/electron/condition-trigger-skill.test.ts`

- [ ] **Step 1: Add failing CLI and skill tests**

Test `lac automation list/info/check/edit`, `lac automation script stage`, approval request/status, test, approve status, and the helper's exact HTTP bodies. Assert the Skill requires staging, test approval, sandbox test, final approval, then Automation creation in that order.

- [ ] **Step 2: Verify failures**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/lac-cli.test.js dist-electron/tests/electron/condition-trigger-skill.test.js`
Expected: FAIL because commands and managed Skill are absent.

- [ ] **Step 3: Implement CLI commands without approval bypasses**

Every command derives workspace/thread/channel context from the existing `LOCAL_AI_*` variables. `script test` must fail unless the server reports an unconsumed test authorization; `automation add --script-version` must fail unless the version is approved.

- [ ] **Step 4: Write the Skill and helper**

The Skill must instruct the Agent to generate `manifest.json`, entrypoint, fixtures, and tests in a temporary directory; call the helper to stage; stop for test authorization; execute tests; stop for formal approval; then create the Automation. The helper uses `lac` and never writes the managed script directory.

`copy-managed-skills.mjs` copies the source tree into `dist-electron/electron/managed-skills` during `build:electron`. `ManagedSkillCatalog` loads the packaged `SKILL.md`, and `composeAgentMessage` injects that exact content when a message asks for condition-based automation. The packaging test must run against both source and compiled layouts so the Skill cannot become an inert repository-only file.

- [ ] **Step 5: Run CLI and policy regressions**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/lac-cli.test.js dist-electron/tests/electron/condition-trigger-skill.test.js dist-electron/tests/contracts/agent-message-policy.test.js`
Expected: PASS.

- [ ] **Step 6: Commit Agent workflow**

```bash
git add services/local-ai-core/src/cli/lac.ts services/local-ai-core/src/thread/agent-message-policy.ts services/local-ai-core/src/runtime/managed-skill-catalog.ts electron/managed-skills/condition-trigger scripts/copy-managed-skills.mjs package.json tests/electron/lac-cli.test.ts tests/electron/condition-trigger-skill.test.ts tests/contracts/agent-message-policy.test.ts
git commit -m "Add condition trigger authoring skill"
```

## Milestone 4: Desktop management and release validation

### Task 12: Unified Automation page and approvals

**Files:**
- Create: `src/pages/Automation/AutomationList.tsx`
- Create: `src/pages/Automation/AutomationDetailModal.tsx`
- Create: `src/pages/Automation/ScriptApprovalModal.tsx`
- Create: `src/pages/Automation/automation-page-model.ts`
- Modify: `src/app/ui-contributions.tsx`
- Modify: `src/pages/Cron/CronList.tsx`
- Modify: `src/pages/Automation/MonitorList.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh.json`
- Modify: `src/i18n/locales/zh-TW.json`
- Modify: `src/i18n/locales/ja.json`
- Modify: `src/i18n/locales/es.json`
- Test: `tests/contracts/automation-renderer-model.test.ts`

- [ ] **Step 1: Extract and test a pure renderer model**

Create `src/pages/Automation/automation-page-model.ts` with `deriveAutomationDisplayStatus`, grouping/filtering, approval action availability, and Evaluation/Run formatting. Write tests for active/paused/blocked, script approval stages, legacy origin badges, and redacted Secret names.

- [ ] **Step 2: Verify model tests fail**

Run: `pnpm build:electron && node --test dist-electron/tests/contracts/automation-renderer-model.test.js`
Expected: FAIL because the renderer model is missing.

- [ ] **Step 3: Build the unified page**

Replace separate Cron and Monitor navigation entries with one `/automations` route. List Activation, Condition, workspace, health, last Evaluation, last Run, and origin. Provide enable/pause/check/detail actions. Keep script source read-only and show hash, interpreter, permissions, Secret names, public-network warning, test plan, and test report.

- [ ] **Step 4: Add approval actions**

Render only server-authorized transitions: authorize test, reject test, approve enable, reject enable, revoke. Refresh on all unified SSE events. Surface `sandbox_unavailable`, missing Linux dependencies, and blocked reason without offering an unsafe fallback.

- [ ] **Step 5: Preserve legacy deep links and translations**

Redirect `/cron` and `/monitors` to `/automations` with an origin filter. Add complete keys to all five locale files; use English fallback text only where the locale already lacks monitor strings.

- [ ] **Step 6: Run renderer and contract validation**

Run: `pnpm typecheck && pnpm build:renderer && pnpm build:electron && node --test dist-electron/tests/contracts/automation-renderer-model.test.js`
Expected: PASS.

- [ ] **Step 7: Commit UI**

```bash
git add src/pages/Automation src/pages/Cron/CronList.tsx src/app/ui-contributions.tsx src/i18n tests/contracts/automation-renderer-model.test.ts
git commit -m "Unify automation management UI"
```

### Task 13: Linux/macOS deployment diagnostics and documentation

**Files:**
- Modify: `docs/architecture/automation-monitor.md`
- Modify: `docs/architecture/scheduled-delivery.md`
- Create: `docs/architecture/conditional-automation.md`
- Modify: `docs/operations/release-workflow.md`
- Modify: `README.md`
- Modify: `docker/agentdock/core.Dockerfile`
- Test: `tests/contracts/architecture-docs.test.ts`
- Test: `tests/electron/automation-deployment.test.ts`

- [ ] **Step 1: Write failing deployment assertions**

Assert Linux diagnostics report `bwrap`, `socat`, `rg`, userns, network namespace, and seccomp independently; macOS reports Sandbox Runtime, `sandbox-exec`, and `rg`; Windows reports unsupported. Assert the core image installs required Linux packages.

- [ ] **Step 2: Verify failures**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-deployment.test.js dist-electron/tests/contracts/architecture-docs.test.js`
Expected: FAIL until diagnostics, image, and docs agree.

- [ ] **Step 3: Add deployment support**

Install `bubblewrap`, `socat`, and `ripgrep` in the Linux core image. Document the dedicated Ubuntu 24.04+ AppArmor profile and explicitly prohibit globally disabling `kernel.apparmor_restrict_unprivileged_userns` as the default setup.

- [ ] **Step 4: Update architecture and README New section**

Document ownership, state machine, script protocol, two-stage approval, public-egress/private-deny policy, macOS/Linux support, Windows fail-closed behavior, retention, and compatibility facades. Add a concise user-visible entry under README `New`.

- [ ] **Step 5: Run documentation and deployment tests**

Run: `pnpm build:electron && node --test dist-electron/tests/electron/automation-deployment.test.js dist-electron/tests/contracts/architecture-docs.test.js`
Expected: PASS.

- [ ] **Step 6: Commit deployment support**

```bash
git add docs README.md docker/agentdock/core.Dockerfile tests/contracts/architecture-docs.test.ts tests/electron/automation-deployment.test.ts
git commit -m "Document conditional automation deployment"
```

### Task 14: Full verification and release gate

**Files:**
- Modify only files required by failures found in this task.

- [ ] **Step 1: Run the complete fast suite**

Run: `pnpm test`
Expected: typecheck, renderer build, Electron build, and all Node tests PASS.

- [ ] **Step 2: Run packaged smoke coverage**

Run: `pnpm e2e:smoke`
Expected: production build launches, capability/plugin diagnostics load, and smoke output reports `ok: true`.

- [ ] **Step 3: Run a real macOS or Linux script scenario**

Stage a fixture script that calls a public HTTPS endpoint, requests test approval, runs its sandbox test, requests formal approval, creates a one-minute Automation, observes `false -> true`, and confirms exactly one Action Run. Also verify attempts to read a fixture Secret outside the approved environment and connect to localhost are denied.

- [ ] **Step 4: Inspect repository state**

Run: `git status --short && git diff --check`
Expected: only intentional tracked changes remain; no generated `dist`, database, script package, Secret, or test artifact is staged.

- [ ] **Step 5: Route any failure back to its owning task**

Do not create a catch-all verification commit. Add the smallest reproducing test to the owning task, fix that component, rerun its focused command, commit with that task's subject, then repeat Steps 1–4 of this task.
