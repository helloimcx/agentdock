# Plan: 工作区常驻编码规范层实施计划 (Workspace Standards Layer)

## 1. 架构方案图 (Workflow Diagram)

本方案的端到端架构与处理时序已通过 Archify 生成交互式 HTML 画布并经 Showcase 质量门禁校验：
- **方案交互式 HTML 画布**：[`docs/architecture/changes/2026-09-12-workspace-standards-layer.html`](../architecture/changes/2026-09-12-workspace-standards-layer.html)
- **Archify DSL 规范定义**：`docs/architecture/changes/2026-09-12-workspace-standards-layer.workflow.json`

全流程包含四阶段与三大泳道：
1. **规则源与技术栈感知 (Packs & Detection)**：内置规则包（JetBrains Go、VoltAgent 设计规范、Ponytail 阶梯）与工作区语言特征嗅探（TS/React/Python/Go）；
2. **控制面安全与决策阶梯 (Governance & Safety)**：#93 提示词注入扫描门禁（T01 劫持拦截）+ Ponytail 5 级决策阶梯与四档强度过滤；
3. **锚点保护与无损写入 (Materialization)**：Marker 定界符隔离、`<important if>` 动静两阶段剪枝、原子写入与幂等落盘；
4. **多 Agent 原生遵循 (Agent Execution)**：`AGENTS.md`、`CLAUDE.md`、`.cursorrules` 直接被外部与受管 Agent 零开销消费。

---

## 2. 详细实施步骤 (TDD 顺序)

### 阶段一：契约层与桌面共享模型扩展 (Contracts & Shared Types)
1. **`packages/contracts/src/standards.ts` [NEW]**
   - 定义 `RuleIntensityLevel`、`StandardRule`、`StandardPackMetadata`、`WorkspaceStandardsConfig`、`MaterializeStandardsResult`、`RulePackScanReport`。
2. **`packages/contracts/src/index.ts` [MODIFY]**
   - 导出 `standards` 契约定义。
3. **`shared/desktop.ts` [MODIFY]**
   - 在 `DesktopProjectConfig.agent.options` 中增加可选字段 `standards?: WorkspaceStandardsConfig`。

### 阶段二：规则解析、决策阶梯与条件剪枝引擎 (TDD: `standards-parser.test.ts`)
1. **编写单测**：验证 YAML Frontmatter 解析、`<important if ...>` 提取与静态剔除、Ponytail 阶梯与安全豁免条款（Safety Carve-Out）保留。
2. **`services/local-ai-core/src/standards/standards-types.ts` [NEW]**
   - 声明内部模型与默认强度常量。
3. **`services/local-ai-core/src/standards/standards-rule-parser.ts` [NEW]**
   - 实现 Frontmatter 提取、Markdown 规则块分段；
   - 实现条件解析器（区分静态语言/强度与运行时语义标签）；
   - 实现 Ponytail 5 级阶梯渲染格式化。
4. **`services/local-ai-core/src/standards/curated-standards.ts` [NEW]**
   - 内置精选包：`general`（防腐与契约）、`design-system`（awesome-design-md 与 #42ff9c）、`typescript`、`golang`（JetBrains 官方规范）、`python`。

### 阶段三：锚点无损材料化引擎与原子写入 (TDD: `standards-materializer.test.ts`)
1. **编写单测**：
   - 新建文件材料化测试；
   - 包含用户前缀/后缀手写内容文件的无损替换测试（验证手写内容 100% 字节不变）；
   - 连续两次材料化的幂等性测试（哈希一致跳过磁盘写入）；
   - `intensity: 'off'` 时的定界符块卸载与空文件清理；
   - 损坏标记的容错与自愈测试。
2. **`services/local-ai-core/src/standards/standards-materializer.ts` [NEW]**
   - 实现 `applyMaterializationToFile`（定界符匹配、原子重命名写入 `atomicWriteFileSync`、哈希比较）；
   - 实现 `materializeWorkspaceStandards`（遍历工作区目标文件 `AGENTS.md`、`CLAUDE.md` 等）。
3. **`services/local-ai-core/src/standards/standards-detector.ts` [NEW]**
   - 扫描工作区根目录关键特征文件，推断匹配的技术栈并返回推荐规则包。

### 阶段四：安全扫描门禁与服务聚合 (TDD: `standards-security-scan.test.ts`)
1. **编写单测**：注入含有 `ignore all previous instructions` 或外部恶意载荷的规则包，验证安全拦截与 `--force` 豁免。
2. **`services/local-ai-core/src/standards/standards-service.ts` [NEW]**
   - 聚合规则包检索、安全扫描过滤、技术栈探测、配置读写与材料化触发。
3. **`services/local-ai-core/src/router/workspace-route-config.ts` [MODIFY]**
   - 在 `toLocalCoreProjectConfig` 中挂载轻量材料化保证，确保会话启动前规范文件处于最新状态。

### 阶段五：REST API、Core SDK 与 CLI 命令行套件
1. **`services/local-ai-core/src/runtime/server-routes.ts` & `handlers/standards-handler.ts` [NEW]**
   - 实现 `standards.packs.list`、`workspaces.standards.get`、`workspaces.standards.update`、`workspaces.standards.materialize`、`standards.scan` 路由。
2. **`packages/core-sdk/src/standards.ts` [NEW] & `packages/core-sdk/src/index.ts` [MODIFY]**
   - 暴露 `getWorkspaceStandards`、`updateWorkspaceStandards`、`materializeWorkspaceStandards`、`scanStandardPack` 等 SDK 方法。
3. **`services/local-ai-core/src/cli/standards-cli-handlers.ts` [NEW] & `lac.ts` [MODIFY]**
   - 实现 `lac rules list/add/remove/update/materialize/scan` 子命令（同时支持 `lac standards` 别名）。
4. **编写 CLI 测试 (`tests/electron/lac-cli-rules.test.ts`)**。

### 阶段六：Desktop UI 工作区设置面板 (Workspace UI)
1. **`src/pages/Desktop/workspace-model.ts` [MODIFY]**
   - 在 `ProjectTab` 中增加 `'standards'`，在表单模型中增加 `standards` 状态映射。
2. **`src/pages/Desktop/workspace-sections.tsx` [MODIFY]**
   - 实现 `StandardsSection` 组件：展示已检测技术栈徽标、强度单选卡片（Off / Lite / Full / Ultra）、精选规则包复选框、Ponytail 阶梯折叠预览、立即材料化按钮与同步状态指示。
3. **`src/pages/Desktop/Workspace.tsx` [MODIFY]**
   - 注册并渲染 `Standards` Tab。

---

## 3. 测试与质量门禁策略

1. **单元测试 (Unit Tests)**：
   - `tests/contracts/standards-parser.test.ts`：Frontmatter 解析、阶梯分级、`<important if>` 过滤；
   - `tests/contracts/standards-materializer.test.ts`：定界符锚点保护、无损追加、幂等性、off 清理；
   - `tests/contracts/standards-security-scan.test.ts`：T01-T04 安全规则拦截。
2. **集成测试 (Integration Tests)**：
   - `tests/integration/workspace-standards-lifecycle.test.ts`：端到端工作区创建 -> 技术栈嗅探 -> 规则配置 -> 材料化生成 `AGENTS.md` 与 `CLAUDE.md` -> ACP 准备。
3. **命令行测试 (CLI Tests)**：
   - `tests/electron/lac-cli-rules.test.ts`：`lac rules add/list/materialize` 命令行调用与输出断言。
4. **全量门禁保障**：
   - `pnpm typecheck` (0 Errors)
   - `pnpm lint:circular` (0 循环依赖)
   - `pnpm lint:duplicate` (0 代码重复超标)
   - `pnpm lint:dead-code` (无新增无效符号)
   - `pnpm lint:arch` (全量规范及变更通过 9 项 Showcase 校验)
   - `pnpm test` (全量单元/契约/集成/BDD 测试全部通过)
