# Spec: 工作区常驻编码规范层与多 Agent 指令材料化 (Workspace Standards Layer)

## 1. 目标与背景 (Goal & Context)

当前 AgentDock 具备完善的按需技能（Skills，基于 `SKILL.md` 触发式路由与动态调度），但在工程规范领域存在结构性缺失：
1. **跨 Agent 格式碎片化**：不同 Agent 消费不同的指令文件约定（Claude Code 读取 `CLAUDE.md`，Pi、OpenCode、Zed Codex、Hermes、LocalCore ACP 等现代 Agent 读取 `AGENTS.md`，Cursor 读取 `.cursorrules` / `.cursor/rules`）。开发者为了保持规范一致，被迫在多个文件之间手工复制，导致版本漂移与冲突；
2. **缺乏“常驻规范 (Always-Loaded Standards)”概念**：编码规范与按需技能不同，必须每次都进入 Agent 上下文，直接影响代码生成行为、架构边界与防御底线；
3. **Prompt Token 膨胀与长会话稀释**：盲目全量注入所有规范会迅速消耗上下文窗口并降低指令遵循率；需要引入科学的 **Ponytail 决策阶梯** 与 **强度分级 (`lite` / `full` / `ultra` / `off`)**，以及 **`<important if ...>` 条件激活语法**；
4. **对用户已有手写指令的破坏风险**：必须保证 100% 绝对非破坏性共存，通过定界符锚点保护用户自定义内容；
5. **提示词注入安全风险**：规则包是直接的提示词注入攻击面（恶意 rules = T01 指令劫持），必须强制通过 #93 静态安全审计门禁。

本规范（对应 Issue #117）旨在为 AgentDock 构建统一的工作区常驻编码规范层：
- **数据模型**：工作区级 standards（语言/主题维度的规则包），存储在 `.agentdock/standards/<lang>/<topic>.md`，支持从 Git 仓库或精选推荐包安装；
- **材料化注入**：workspace 注册/更新/启动会话时由材料化器无损生成各 Agent 指令文件（`AGENTS.md`、`CLAUDE.md`、`.cursorrules` 等），采用定界符锚点（`<!-- agentdock:standards:start -->` ... `<!-- agentdock:standards:end -->`）追加与更新，绝对不覆盖用户手写内容；
- **Ponytail 决策阶梯与安全豁免 (Safety Carve-Out)**：5 级决策阶梯优先解决冲突权衡，严格内建输入校验与安全底线不可削减条款；
- **条件激活语法 (`<important if ...>`)**：静态条件在材料化期剪枝（节省 Token），运行时场景保留为 XML 语义标签以增强注意力；
- **CLI、API、UI 与安全门禁**：`lac rules` 命令行套件、REST API、Desktop 工作区设置 UI，以及基于 `skill-content-scan` 的 Fail-Closed 安全拦截。

---

## 2. 需求范围 (Scope)

- **公共契约扩展 (`packages/contracts/src/standards.ts`)**：
  - 定义 `RuleIntensityLevel` (`'off' | 'lite' | 'full' | 'ultra'`)；
  - 定义 `StandardRule`、`StandardPackMetadata`、`WorkspaceStandardsConfig`、`MaterializeStandardsResult`、`RulePackScanReport`；
  - 扩展 `shared/desktop.ts` 中的 `DesktopProjectConfig.agent.options.standards`。
- **核心规范引擎 (`services/local-ai-core/src/standards/`)**：
  - `standards-types.ts`：内部领域模型；
  - `standards-rule-parser.ts`：Markdown YAML Frontmatter 解析、`<important if ...>` 提取与强度分级过滤；
  - `standards-materializer.ts`：定界符锚点管理、内容哈希对比、原子重命名写入（`atomicWriteFileSync`）、`off` 强度清理与空文件安全自愈；
  - `standards-detector.ts`：工作区语言特征与技术栈自动探测（识别 `tsconfig.json`、`package.json`、`go.mod`、`Cargo.toml`、`pyproject.toml` 等）；
  - `curated-standards.ts`：内置精选规则包（`general` 通用架构与防腐、`design-system` 响应式与设计系统、`typescript` 严格模式与契约、`golang` JetBrains 官方指南、`python` 类型提示与规范）；
  - `standards-service.ts`：聚合工作区规范状态、生命周期材料化与探测逻辑。
- **安全前置门禁集成 (`services/local-ai-core/src/security/`)**：
  - 接入 `skill-content-scan.ts`，对规则包内容执行 `T01_INSTRUCTION_HIJACK`、`T02_MEMORY_POISONING`、`T03_REMOTE_PAYLOAD`、`T04_MALICIOUS_CODE` 扫描，非 `--force` 时拦截 High/Critical 违规。
- **ACP 会话前置钩子 (`services/local-ai-core/src/acp/` & `router/`)**：
  - 在 `workspace-route-config.ts` (`toLocalCoreProjectConfig`) 与 `local-core-acp-session-coordinator.ts` 启动前，无缝保障目标规范文件处于最新同步状态。
- **REST 路由与 SDK (`packages/core-sdk/src/standards.ts`)**：
  - 暴露 `GET /api/local/v1/standards/packs`、`GET /api/local/v1/workspaces/:id/standards`、`PUT /api/local/v1/workspaces/:id/standards`、`POST /api/local/v1/workspaces/:id/standards/materialize`、`POST /api/local/v1/standards/scan`；
  - 在 `@cc/core-sdk` 挂载 `standards` 客户端。
- **CLI 命令行套件 (`lac rules` / `lac standards`)**：
  - `lac rules list`、`lac rules add`、`lac rules remove`、`lac rules update`、`lac rules materialize`、`lac rules scan`。
- **Desktop UI 工作区设置 (`src/pages/Desktop/`)**：
  - 在 `Workspace.tsx` 与 `workspace-sections.tsx` 新增 `Standards` 设置面板，展示技术栈感知结果、强度档位切换、精选包一键启用与材料化状态徽章。

---

## 3. 非目标 (Non-Goals)

- 不替代现有的按需加载 Skills 体系（二者正交，Skills 负责工具执行与特定流程，Standards 负责全局编码准则）；
- 不在运行时动态劫持外部已启动的 Agent 内存；
- 不在宿主环境硬性安装语言编译器或 Linter（由 Agent 自主在任务中遵循规范并调用项目构建命令）。

---

## 4. 核心接口与数据模型 (Interfaces & Data Models)

```typescript
export type RuleIntensityLevel = 'off' | 'lite' | 'full' | 'ultra';

export interface StandardRule {
  id: string;
  title: string;
  condition?: string; // 提取自 <important if <expr>>
  content: string;
  minIntensity: RuleIntensityLevel;
  isSafetyCarveOut: boolean;
}

export interface StandardPackMetadata {
  id: string;
  name: string;
  language: string;
  description: string;
  version: string;
  author?: string;
  source?: 'builtin' | 'workspace' | 'remote';
  tags?: string[];
  rules?: StandardRule[];
}

export interface WorkspaceStandardsConfig {
  enabled: boolean;
  intensity: RuleIntensityLevel; // 'off' | 'lite' | 'full' | 'ultra'
  activePacks: string[];         // 激活的规则包 ID 列表
  autoDetectStack: boolean;      // 是否自动探测技术栈推荐
  customRules?: string;          // 用户追加的自定义规则
  targetFiles?: string[];        // 目标文件：默认 ['AGENTS.md', 'CLAUDE.md']
  lastMaterializedAt?: string;
  lastContentHash?: string;
}

export interface MaterializeStandardsResult {
  workspaceId: string;
  workspacePath: string;
  intensity: RuleIntensityLevel;
  appliedPacks: string[];
  files: Array<{
    filePath: string;
    action: 'created' | 'updated' | 'unchanged' | 'cleaned';
    error?: string;
  }>;
  totalRules: number;
  tokenEstimate: number;
}
```

---

## 5. 约束与兼容性 (Constraints & Compatibility)

1. **绝对非破坏性锚点原则**：
   - 托管标记：`<!-- agentdock:standards:start -->` 与 `<!-- agentdock:standards:end -->`；
   - 凡位于锚点外的任何内容，无论位于前缀还是后缀，材料化前后逐字节保留；
   - 若原文件无锚点，以双换行安全追加在文件末尾；
   - 若强度设为 `off`，仅精准清除锚点块，保留全部用户手写文本。
2. **幂等写入与 Git 干净性**：
   - 每次材料化前计算新内容与旧内容的 SHA-256 哈希；若哈希完全相同，跳过磁盘写操作，不修改文件修改时间（`mtime`），不产生无意义的 Git dirty 变更。
3. **原子安全写入**：
   - 先写入同目录临时文件 `.tmp.<pid>.<timestamp>`，后调用 `fs.renameSync` 原子重命名，防止进程意外中止损坏文件。
4. **向后兼容**：
   - 未配置 `standards` 的老工作区保持 `enabled: false`，完全不触碰任何磁盘文件。

---

## 6. 验收标准 (Acceptance Criteria)

1. **[AC-1: 锚点无损共存]**：在包含用户手写指令的 `AGENTS.md` / `CLAUDE.md` 执行材料化，原有手写内容 100% 保持字节不变，仅锚点内部被精准填充。
2. **[AC-2: 幂等写入]**：对同一工作区连续调用材料化，第二次调用结果报告为 `unchanged`，不触发磁盘写操作与 Git 状态变化。
3. **[AC-3: 决策阶梯与强度分级]**：
   - `lite` 模式输出精炼原则与核心阶梯，不可削减的安全豁免条款（输入校验、凭据安全、可访问性）完整保留；
   - `full` / `ultra` 输出完整指南与严格检查清单；
   - `off` 模式移除定界符块并清理纯系统生成的空文件。
4. **[AC-4: 条件激活 `<important if>`]**：
   - 静态语言/强度不满足时在材料化阶段剥离，节省上下文 Token；
   - 运行时任务条件（如 `touching_auth`、`unattended`）保留为 XML 语义标签。
5. **[AC-5: 安全扫描门禁]**：安装或扫描包含提示词注入或越狱指令（T01）的规则包时，默认被安全门禁拦截拒绝，除非显式提供 `--force`。
6. **[AC-6: CLI 与 API 完备性]**：`lac rules list/add/remove/materialize` 命令正常执行，退出码符合规范；REST API 与 Core SDK 正常工作。
7. **[AC-7: 质量与架构门禁]**：`pnpm typecheck`、`pnpm lint:gates`、`pnpm lint:arch` 及全部自动化测试 100% 通过。
