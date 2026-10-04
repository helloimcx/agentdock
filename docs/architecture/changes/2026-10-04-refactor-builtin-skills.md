# Architecture Change Record: 内置 Managed Skills 体系重构与远程移动端自动注入

## 1. 概述与动因 (Context & Drivers)
- **消除架构倒挂**：原内置技能（`agent-browser`、`condition-trigger`、`knowledge-base`、`memory`、`stock-monitor`）存放在 `electron/managed-skills` 中，导致底层 Local AI Core 运行时跨层反向依赖桌面外壳目录。在纯服务端（Linux、Docker、Web Admin）模式下缺乏 `electron/` 目录导致内置技能不可用。
- **与 Builtin Plugins 对齐**：核心服务插件规范位于 `services/local-ai-core/src/plugins/builtin/`，内置技能应统一归属于 `services/local-ai-core/src/skills/builtin/`。
- **消除全局污染与长篇硬编码 Prompt**：移动自动化此前通过硬编码字符串强行拼接在 `device-environment.ts`，缺乏标准 `SKILL.md`，且易被误软链接至宿主全局目录。本次将其提升为一等公民内置技能 `mobile-automation`，并在远程工作区自适应注入。

## 2. 核心架构变更 (Key Architecture Changes)
1. **资产迁移与规范归宿**：
   - 内置技能从 `electron/managed-skills/` 整体迁移至 `services/local-ai-core/src/skills/builtin/`。
   - 新增 `mobile-automation` 内置技能，声明 `platforms: ["android"]`、`requiresTools: ["mobile-apps", "mobile-ui"]`。
2. **多级探测与双向向后兼容**：
   - `ManagedSkillCatalog.resolveManagedSkillsRoot` 实现四级智能探测：
     1) `AGENTDOCK_BUILTIN_SKILLS_DIR` 环境变量覆盖；
     2) 运行时相对目录 `dist-electron/services/local-ai-core/src/skills/builtin`；
     3) 源码目录 `services/local-ai-core/src/skills/builtin`；
     4) 历史镜像与回退目录 `dist-electron/electron/managed-skills`。
   - `scripts/copy-managed-skills.mjs` 构建脚本双向输出，确保存量测试与老脚本 100% 绿色兼容。
3. **平台感知契约与动态注入**：
   - `SkillMetadata` 扩展 `platforms?: string[]` 字段。
   - `ManagedSkillCatalog.listSkills({ platform })` 支持按平台自动过滤专属技能。
   - `RemoteMeshExecutionBackend` 在准备影子工作区（`shadowDir`）时，通过 `skill-mounter` 将匹配平台的技能（如 Android 节点的 `mobile-automation`）自动挂载到 `shadowDir/.agents/skills/` 与 `shadowDir/.claude/skills/`，杜绝宿主全局目录污染。
4. **意图路由增强**：
   - `builtin-rules.ts` 新增 `mobile-automation` 的中英文路由规则。

## 3. 验证与门禁 (Validation & Quality Gates)
- 全量自动化测试：907 个 Node.js 单元/集成/合约测试 100% 通过。
- BDD 测试：80 个场景（286 个步骤）100% 通过。
- 架构合规：`pnpm lint:arch` 5/5 通过。
- 静态门禁：`pnpm typecheck`、`pnpm lint:gates` 零错误通过。
- 测试覆盖率：`pnpm coverage` 达标通过。
