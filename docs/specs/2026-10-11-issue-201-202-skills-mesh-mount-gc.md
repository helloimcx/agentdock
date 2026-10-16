# Specification: Manifest-Based Skill Mount GC (#202) and Remote Mesh Workspace Skills Mounting (#201)

## 1. Background & Problems

### Issue #202: Skills mount GC deletes unmanaged content in skills directories
The stale-mount reconciliation loop in `mountActiveSkillsSync` (`services/local-ai-core/src/runtime/skill-mounter.ts:49-59`) recursively deletes any file or directory in `targetSkillsDir` that is not part of the active skill set:
```ts
for (const file of existingFiles) {
  if (!activeIdSet.has(file)) {
    const filePath = join(targetSkillsDir, file);
    try {
      rmSync(filePath, { recursive: true, force: true });
    } catch {}
  }
}
```
Because the mounter cannot distinguish projection artifacts it created from foreign content written by agents or users, unmanaged real directories (such as agent-created skills in `.claude/skills/` or user notes) are unconditionally deleted on subsequent mounts or session launches.

### Issue #201: Workspace-scoped skills never mount in remote mesh sessions
When launching a remote mesh session, `RemoteMeshExecutionBackend.prepareLaunch` invokes `mountActiveSkillsSync` targeting `.agents/skills` and `.claude/skills` in the shadow directory (`services/local-ai-core/src/execution/remote-mesh/remote-mesh-backend.ts:88-100`), but does not provide `workspacePath`.
Without `workspacePath`, `ManagedSkillCatalog.listSkills` skips all workspace roots (`.agents`, `.agents/skills`, `.agentdock/skills`), mounting only builtin and user-scoped skills.
Furthermore, mutations in `skills-handler.ts` (`skills.save`, `skills.toggle`, `skills.delete`, `skills.install`, `skills.update`) only trigger remounting against the default agent skills directory (`~/.agent-skills`), leaving active or prepared mesh shadow mounts unrefreshed.

---

## 2. Goals & Non-Goals

### Goals
- **G-1 (Manifest-based GC)**: Record all entries created by `mountActiveSkillsSync` in a `.mount-manifest.json` in `targetSkillsDir`. On reconciliation, delete ONLY entries that are both recorded in `.mount-manifest.json` and absent from the active skill set.
- **G-2 (Foreign Content Preservation)**: Unmanaged real directories, files, or agent-created skills placed in `targetSkillsDir` without a manifest record must never be deleted.
- **G-3 (Legacy Mount Migration)**: If `.mount-manifest.json` is absent (pre-manifest mounts), delete only symlinks (`lstatSync().isSymbolicLink()`), leaving real directories untouched, then persist the manifest going forward.
- **G-4 (Fallback cpSync Cleanup)**: Skills mounted via `cpSync` fallback are recorded in `.mount-manifest.json` and cleaned up correctly when deleted, disabled, or filtered by platform.
- **G-5 (Mesh Persistent Workspace Skills Root)**: Establish durable workspace skills storage on the core host at `{baseDir}/workspace-skills/<safeWorkspaceId>/` (with fallback to configured host workspace directory if existent).
- **G-6 (Mesh Launch Workspace Skills Mounting)**: In `RemoteMeshExecutionBackend.prepareLaunch`, pass the resolved persistent workspace path into `mountActiveSkillsSync` for both `.agents/skills` and `.claude/skills`.
- **G-7 (Mesh Shadow Remount on Skill Mutation)**: On skill save/delete/toggle/install/update, refresh the affected mesh shadow mounts in `{baseDir}/remote-shadow/<safeWorkspaceId>/`.
- **G-8 (Platform Filtering)**: Skills with `platforms` frontmatter constraints must respect the mesh node's target platform for workspace-scoped skills just as they do for builtin/user skills.

### Non-Goals
- Altering the public `@cc/superai-contracts` API signatures or protocol wire formats.
- Rewriting the ACP transport layer or remote mesh agent execution protocols.
- Migrating local desktop session execution models (local mode ACP uses direct workspace paths).

---

## 3. Architecture & Data Flow

```
+-----------------------------------------------------------------------------------------+
|                                    Local AI Core Host                                   |
|                                                                                         |
|  Durable Storage:                                                                       |
|    - User Skills:        ~/.agentdock/skills/                                           |
|    - Workspace Skills:   {baseDir}/workspace-skills/{safeWorkspaceId}/.agentdock/skills |
|                          (or host-configured workDir)                                   |
|                                                                                         |
|  API Mutations (skills.save / toggle / delete / install):                               |
|    1. Update durable storage (ManagedSkillCatalog)                                      |
|    2. Remount local agent skills (mountActiveSkillsForAgent)                            |
|    3. Remount affected mesh shadow directories (refreshMeshShadowSkillMounts)           |
|                                                                                         |
|  Mesh Session Launch (prepareLaunch):                                                   |
|    1. Resolve safeWorkspaceId & persistent workspaceSkillsDir                           |
|    2. Provision shadowDir: {baseDir}/remote-shadow/{safeWorkspaceId}/                   |
|       - Write .mesh-shadow.json (node metadata, platform, workspacePath)                |
|       - Mount active skills to .agents/skills & .claude/skills via mountActiveSkillsSync|
|         with workspacePath & platform                                                   |
+-----------------------------------------------------------------------------------------+
                                            |
                                            v
+-----------------------------------------------------------------------------------------+
|                  Target Skills Directory (Shadow Dir or Agent Native Dir)               |
|                                                                                         |
|    .mount-manifest.json  <-- { "version": 1, "entries": ["skill-a", "skill-b"] }         |
|    skill-a/              <-- Symlink or cpSync fallback (managed)                       |
|    skill-b/              <-- Symlink or cpSync fallback (managed)                       |
|    agent-custom-skill/   <-- Real directory created by agent/user (UNMANAGED -> KEPT!)  |
+-----------------------------------------------------------------------------------------+
```

---

## 4. Acceptance Criteria

- **[AC-1] Manifest Persistence**: Every invocation of `mountActiveSkillsSync` writes/updates `.mount-manifest.json` in `targetSkillsDir` recording `entries: string[]` of successfully mounted skill IDs.
- **[AC-2] Unmanaged Content Preservation**: Any real directory, file, or agent-created skill in `targetSkillsDir` not recorded in `.mount-manifest.json` is never deleted during reconciliation.
- **[AC-3] Managed Skill Deletion & Toggle**: Removing or disabling a skill in the catalog cleans it up from `targetSkillsDir` if it was recorded in `.mount-manifest.json`.
- **[AC-4] cpSync Fallback GC**: A skill directory created via `cpSync` fallback (non-symlink) that was recorded in `.mount-manifest.json` is cleanly deleted upon skill removal.
- **[AC-5] Pre-Manifest Migration**: When `.mount-manifest.json` is missing, reconciliation only deletes symlinks (`isSymbolicLink() == true`), preserving real directories, and writes `.mount-manifest.json` after mounting.
- **[AC-6] Remote Mesh Workspace Skills Mounting**: Remote mesh sessions mount workspace-scoped skills (`.agentdock/skills`, `.agents/skills`) from `{baseDir}/workspace-skills/<safeWorkspaceId>/` into shadow `.claude/skills/` and `.agents/skills/`.
- **[AC-7] Mesh Shadow Remount on Mutation**: Calling `skills.save`, `skills.toggle`, `skills.delete`, or install/update APIs refreshes affected shadow mounts under `{baseDir}/remote-shadow/<safeWorkspaceId>/`.
- **[AC-8] Mesh Node Platform Filtering**: Skills with `platforms` frontmatter (e.g. `platforms: ['linux']`) are filtered based on the mesh node's target platform, mounting on matching nodes and excluding non-matching nodes.
- **[AC-9] Restart Durability**: A workspace skill saved for a mesh workspace persists on the core host and remounts automatically upon subsequent session launch without manual symlinking.
