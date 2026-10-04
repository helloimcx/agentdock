# Spec: 内置 Managed Skills 体系重构与远程工作区动态注入

## 1. 目标与背景 (Goal & Context)

### 1.1 现状与问题
- **架构依赖倒置**：AgentDock 拥有桌面模式（Desktop Mode）和独立服务端/容器模式（Web Admin / Docker / Headless Standalone）。目前所有内置技能（`agent-browser`、`condition-trigger`、`knowledge-base`、`memory`、`stock-monitor`）均存放在 `electron/managed-skills` 中，`ManagedSkillCatalog` 强行读取 Electron 桌面外壳目录，导致纯服务端模式因缺失 `electron/` 目录而无法自包含运行内置技能。
- **与 Builtin Plugins 不对称**：内置插件位于 `services/local-ai-core/src/plugins/builtin/`，而内置技能却散落在 `electron/`，未遵循统一的扩展归宿规范。
- **缺乏平台感知与全局污染隐患**：移动端自动化能力（`mobile-apps` 与 `mobile-ui`）此前通过硬编码字符串堆积在 `device-environment.ts` 的 System Prompt 中；且易误被当作宿主机全局技能向全局目录（`~/.claude/skills` 或 `~/.gemini/config/skills`）做软链接，污染宿主环境。

### 1.2 目标 (Goals)
1. 将内置技能统一收归至 Local AI Core 服务域：`services/local-ai-core/src/skills/builtin/`，与插件体系完全对称。
2. 切断对 Electron 外壳的倒挂依赖，`ManagedSkillCatalog` 实现多级智能探测（环境变量 -> 编译内置目录 -> 源码内置目录 -> 历史回退路径）。
3. 构建打包流水线升级，实现双向双写输出，保持 100% 历史向后兼容。
4. 新增移动端标准内置技能 `mobile-automation`（标注 `platforms: ["android"]`、`requiresTools: ["mobile-apps", "mobile-ui"]`）。
5. 远程工作区（如 Android Mesh 节点）启动时，由系统根据平台元数据自动将适用的技能挂载到影子工作区（`shadowDir/.agents/skills/`），彻底消除全局软链接与长篇硬编码 Prompt。

### 1.3 非目标 (Non-Goals)
- 不改变技能格式标准（依然遵循包含 YAML Frontmatter 的 `SKILL.md` 规范）。
- 不破坏已有存量外部脚本和测试对 `electron/managed-skills` 的引用（通过构建双写镜像和多级回退保持兼容）。

---

## 2. 详细设计与契约变更 (Detailed Design & Contracts)

### 2.1 契约层扩展 (`packages/contracts/src/skills.ts`)
在 `SkillMetadata` 中增加可选属性 `platforms?: string[]`：
```typescript
export interface SkillMetadata {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  homepage?: string;
  triggers?: string[];
  domains?: string[];
  priority?: number;
  requiresTools?: string[];
  rules?: SkillRoutingRule[];
  /** 适用的操作系统/设备平台 (如 ['android'], ['linux'])，缺省表示通用全平台 */
  platforms?: string[];
  [key: string]: unknown;
}
```

### 2.2 目录结构归宿
```text
services/local-ai-core/src/skills/
├── builtin/
│   ├── agent-browser/
│   │   ├── SKILL.md
│   │   └── ...
│   ├── condition-trigger/
│   │   ├── SKILL.md
│   │   └── ...
│   ├── knowledge-base/
│   │   ├── SKILL.md
│   │   └── ...
│   ├── memory/
│   │   ├── SKILL.md
│   │   └── ...
│   ├── mobile-automation/       # [NEW] 移动端自动化一等公民内置技能
│   │   ├── SKILL.md
│   │   └── references/
│   └── stock-monitor/
│       └── SKILL.md
├── builtin-rules.ts
├── skill-router.ts
└── tool-index.ts
```

### 2.3 根路径多级探测 (`ManagedSkillCatalog.ts`)
```typescript
export function resolveManagedSkillsRoot(explicitDir?: string): string {
  if (explicitDir && existsSync(explicitDir)) return explicitDir;
  if (process.env.AGENTDOCK_BUILTIN_SKILLS_DIR && existsSync(process.env.AGENTDOCK_BUILTIN_SKILLS_DIR)) {
    return resolve(process.env.AGENTDOCK_BUILTIN_SKILLS_DIR);
  }
  const runtimeRelative = resolve(__dirname, '..', 'skills', 'builtin');
  if (existsSync(runtimeRelative)) return runtimeRelative;
  const coreSource = resolve(process.cwd(), 'services', 'local-ai-core', 'src', 'skills', 'builtin');
  if (existsSync(coreSource)) return coreSource;
  const corePackaged = resolve(process.cwd(), 'dist-electron', 'services', 'local-ai-core', 'src', 'skills', 'builtin');
  if (existsSync(corePackaged)) return corePackaged;
  const legacyPackaged = resolve(process.cwd(), 'dist-electron', 'electron', 'managed-skills');
  if (existsSync(legacyPackaged)) return legacyPackaged;
  const legacySource = resolve(process.cwd(), 'electron', 'managed-skills');
  if (existsSync(legacySource)) return legacySource;
  return coreSource;
}
```

### 2.4 远程工作区动态平台感知与挂载 (`skill-mounter.ts` + `remote-mesh-backend.ts`)
- `ManagedSkillCatalog.listSkills({ platform?: string })` 增加平台过滤逻辑。
- `skill-mounter.ts` 提供 `mountActiveSkillsForAgent({ workspacePath, platform, catalog, targetDir })`。
- `remote-mesh-backend.ts` 在 `provisionShadowDirectory` 阶段：
  - 检测远程节点平台（如 `platform === 'android'`）；
  - 将匹配平台的技能挂载到 `shadowDir/.agents/skills/` 与 `shadowDir/.claude/skills/`；
  - 精简 `device-environment.ts`，由 Agent 原生感知并消费技能。

---

## 3. 验收标准 (Acceptance Criteria)

- **AC-1**: 内置技能物理目录迁移至 `services/local-ai-core/src/skills/builtin/`，`ManagedSkillCatalog` 默认加载该目录，无需 Electron 即可独立加载全部技能。
- **AC-2**: 构建脚本 `scripts/copy-managed-skills.mjs` 支持双向输出，编译产物同时存在于 Core 输出目录与兼容镜像目录 `dist-electron/electron/managed-skills`。
- **AC-3**: 新增 `mobile-automation` 技能，声明 `platforms: ["android"]` 与完整 SOP。
- **AC-4**: 远程 Android 节点连接启动时，影子工作区自动挂载 `mobile-automation` 技能；非 Android 环境不挂载该技能。
- **AC-5**: 严禁向全局目录创建软链接，所有挂载严格受限于工作区目录内部。
- **AC-6**: 全项目通过 `pnpm typecheck`, `pnpm lint:gates`, `pnpm test`。
