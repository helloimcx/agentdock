# Plan: 内置 Managed Skills 体系重构与远程工作区动态注入实施计划

## 实施阶段与步骤

### Phase 1: 契约扩展与文件资产迁移 (Contracts & Assets)
1. 在 `packages/contracts/src/skills.ts` 中为 `SkillMetadata` 补充 `platforms?: string[]`。
2. 创建 `services/local-ai-core/src/skills/builtin/` 目录。
3. 将 `electron/managed-skills/` 中的 `agent-browser`、`condition-trigger`、`knowledge-base`、`memory`、`stock-monitor` 移动至 `services/local-ai-core/src/skills/builtin/`。
4. 新增 `services/local-ai-core/src/skills/builtin/mobile-automation/SKILL.md`，包含 `platforms: ["android"]`、`requiresTools: ["mobile-apps", "mobile-ui"]` 及完整 SOP。
5. 在 `electron/managed-skills/` 放置兼容说明 `README.md`。
6. 更新 `scripts/copy-managed-skills.mjs`，构建时双写输出至 Core 目录与兼容镜像目录。
7. 在 `package.json` 中添加 `"build:skills": "node scripts/copy-managed-skills.mjs"` 方便独立调用。

### Phase 2: Catalog 解析与平台感知过滤升级 (TDD)
1. 编写测试验证 `ManagedSkillCatalog` 的新默认路径与平台过滤能力（`tests/contracts/skills-multi-source.test.ts`）。
2. 在 `services/local-ai-core/src/runtime/managed-skill-catalog.ts` 中重构 `resolveManagedSkillsRoot`，并更新 `listSkills` 支持 `platform?: string` 过滤。
3. 更新 `services/local-ai-core/src/runtime/skill-mounter.ts`，支持 `mountActiveSkillsForAgent` 指定 `platform` 与自定义 `targetDir`。
4. 运行 `tests/contracts/skills-multi-source.test.ts` 确保通过。

### Phase 3: 远程 Mesh 动态注入闭环与 Prompt 精简
1. 更新 `services/local-ai-core/src/execution/remote-mesh/remote-mesh-backend.ts`，在 `provisionShadowDirectory` 中调用 `mountActiveSkillsForAgent` 将平台匹配技能挂载到 `shadowDir/.agents/skills/` 与 `shadowDir/.claude/skills/`。
2. 精简 `services/local-ai-core/src/execution/remote-mesh/device-environment.ts`，去除长篇硬编码文本，转为紧凑提示。
3. 更新 `services/local-ai-core/src/skills/builtin-rules.ts`，注册 `mobile-automation` 意图匹配规则。
4. 编写契约与集成测试 `tests/contracts/mobile-automation-skill.test.ts`。

### Phase 4: 全量回归与门禁验收
1. 更新/验证所有引用 `electron/managed-skills` 的存量测试（如 `tests/electron/*.test.ts`, `tests/contracts/skill-router.test.ts`）。
2. 运行 `pnpm build:skills`。
3. 运行 `pnpm typecheck`。
4. 运行 `pnpm lint:gates`。
5. 运行 `pnpm test`。
6. 更新 `README.md` 与变更日志 `docs/architecture/changes/2026-10-04-refactor-builtin-skills.md`。
