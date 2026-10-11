# Implementation Plan: Manifest-Based Skill Mount GC (#202) and Remote Mesh Workspace Skills Mounting (#201)

## 1. Plan Overview
- **Branch**: `codex/2026-10-11-issue-201-202-skills-mesh-mount-gc`
- **Worktree**: `.worktrees/2026-10-11-issue-201-202-skills-mesh-mount-gc`
- **Approach**: TDD in two sequential phases:
  - **Phase 1 (Issue #202)**: Manifest-based mount GC in `skill-mounter.ts`.
  - **Phase 2 (Issue #201)**: Mesh workspace persistent storage, launch mounting, and mutation shadow remounting in `remote-mesh-backend.ts`, `workspace-skills-resolver.ts`, and `skills-handler.ts`.

---

## 2. Phase 1: Issue #202 — Manifest-Based Mount GC

### Step 1.1: Write Failing Unit Tests for Issue #202
- **File**: `tests/contracts/skill-mount-manifest-gc.test.ts`
- **Test Scenarios**:
  - Test A: Unmanaged real directory in `targetDir` survives remount while a managed-then-removed skill is deleted.
  - Test B: `.mount-manifest.json` is generated on mount with `version: 1` and `entries: [...]`.
  - Test C: A skill mounted via `cpSync` fallback (simulated copy) recorded in manifest is deleted when skill becomes inactive.
  - Test D: Legacy migration (no manifest present): symlinks for inactive skills are removed, real unmanaged directories are kept, and `.mount-manifest.json` is written after mount.
  - Test E: Unparseable/corrupted `.mount-manifest.json` falls back safely without deleting unmanaged content.
  - Test F: `.mount-manifest.json` itself is never removed as a "stale skill".

### Step 1.2: Implement Manifest-Based GC in `skill-mounter.ts`
- **File**: `services/local-ai-core/src/runtime/skill-mounter.ts`
- **Changes**:
  - Define `MountManifest` schema (`{ version: number; entries: string[] }`).
  - Read `.mount-manifest.json` if exists; parse JSON safely.
  - In stale removal loop:
    - Never delete `.mount-manifest.json`.
    - If manifest exists: only delete if `manifest.entries.includes(file)` AND `!activeIdSet.has(file)`.
    - If manifest does NOT exist: only delete if `lstatSync(filePath).isSymbolicLink()` AND `!activeIdSet.has(file)`.
  - In active skills mount loop:
    - Collect `mountedIds: string[]`.
    - Write `.mount-manifest.json` with `{ version: 1, entries: mountedIds }`.
- **Verify**: Run `pnpm test` on `tests/contracts/skill-mount-manifest-gc.test.ts` and ensure all tests pass.

---

## 3. Phase 2: Issue #201 — Remote Mesh Workspace Skills Mounting & Remount

### Step 2.1: Write Failing Unit & Integration Tests for Issue #201
- **File**: `tests/contracts/remote-mesh-workspace-skills.test.ts`
- **Test Scenarios**:
  - Test A: `RemoteMeshExecutionBackend.prepareLaunch` mounts workspace-scoped skills (`.agentdock/skills`, `.agents/skills`) from persistent `{baseDir}/workspace-skills/<safeWorkspaceId>/` into shadow `.claude/skills/` and `.agents/skills/`.
  - Test B: Platform filtering on mesh node: skills with `platforms: ['linux']` mount on Linux mesh node, excluded on Darwin mesh node.
  - Test C: Post-mutation remount: `refreshMeshShadowSkillMounts` updates shadow directories under `{baseDir}/remote-shadow/<safeWorkspaceId>/` when skills are saved, deleted, or toggled.
  - Test D: Restart durability: a workspace skill saved in persistent workspace directory survives across `prepareLaunch` invocations.
  - Test E: Agent-created foreign skills inside shadow `.claude/skills/` survive subsequent `prepareLaunch` mounts (cross-issue integration).

### Step 2.2: Implement Workspace Skills Resolver & Mesh Shadow Provisioning
- **File**: `services/local-ai-core/src/runtime/workspace-skills-resolver.ts`
  - Implement `resolveMeshWorkspaceSkillsPath(baseDir: string, safeWorkspaceId: string, configuredWorkDir?: string): string`.
  - Implement `refreshMeshShadowSkillMounts(options: { baseDir: string; workspaceId?: string; workspacePath?: string; catalog?: ManagedSkillCatalog }): void`.
- **File**: `services/local-ai-core/src/execution/remote-mesh/remote-mesh-backend.ts`
  - In `prepareLaunch`:
    - Resolve `workspaceSkillsDir = resolveMeshWorkspaceSkillsPath(input.configState.baseDir, safeWorkspaceId, input.launchConfig.workDir)`.
    - Pass `workspaceSkillsDir` and `safeWorkspaceId` into `provisionShadowDirectory`.
  - In `provisionShadowDirectory`:
    - Persist `.mesh-shadow.json` metadata in `shadowDir` (`{ nodeId, platform, workspaceId, workspacePath }`).
    - Call `mountActiveSkillsSync` with `workspacePath: workspaceSkillsDir` for both `.agents/skills` and `.claude/skills`.
- **File**: `services/local-ai-core/src/runtime/handlers/skills-handler.ts`
  - In `registerSkillMutationHandlers` and distribution handlers (`skills.save`, `skills.delete`, `skills.toggle`, `skills.install`, `skills.installBundle`, `skills.add`, `skills.update`):
    - Resolve `workspacePath` if `scope === 'workspace'` and `body.workspacePath` is omitted (derive from `workspaceId` using resolver).
    - Trigger `refreshMeshShadowSkillMounts` with `baseDir`, `workspaceId`, `workspacePath`, and `catalog`.
- **File**: `services/local-ai-core/src/runtime/server.ts`
  - Pass `{ baseDir: b.store.readRuntimeConfig().baseDir, workspaceRouter: b.workspaceRouter, store: b.store }` into `registerSkillsHandlers`.

---

## 4. Phase 3: Verification & Quality Gates

- Run `pnpm typecheck`
- Run `pnpm lint:gates` (complexity, circular, duplicate, dead-code, function-length, file-size)
- Run `pnpm lint:arch`
- Run `pnpm test`
- Run `pnpm coverage`
- Perform independent subagent code review
- Push branch and open Pull Request
