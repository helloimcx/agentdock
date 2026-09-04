# Spec: Artifact Surface (Agent 产物渲染与沙箱预览)

- **Date**: 2026-08-30
- **Status**: Approved
- **Issue**: [#114](https://github.com/helloimcx/agentdock/issues/114)
- **Author**: Antigravity

---

## 1. Goal

为 AgentDock 引入完整的 **Artifact 产物呈现体系（Artifact Surface）**：
1. 让 Agent 在运行期间生成的自包含 HTML 架构图/时序图、Markdown 报告、交互式 Diff 补丁、图片和文本交付物，能在桌面工作台内被直观呈现与安全预览。
2. 实现 Run 收尾阶段的产物目录（`.agentdock/artifacts/<runId>/`）自动扫描与登记入册。
3. 保证不可信内容的安全沙箱隔离（iframe sandbox 禁 same-origin、防 XSS/Token 窃取），并提供外部浏览器打开与复制等操作。
4. 深度联动 ThreadChat 会话与 Run Trace 轨迹抽屉。

---

## 2. Scope & Non-Goals

### In-Scope
- **Contracts & Core SDK**：
  - 扩展 `AgentTaskArtifact` 类型与辅助工具（识别 HTML、Markdown、Image、Diff、Text）。
  - 在 `@cc/core-sdk` 中提供 `getTaskArtifactContent(taskId, artifactId)` 与 `listTaskArtifacts(taskId)`。
- **Local AI Core Runtime**：
  - 在 `LocalCoreAcpBackend` 的 run 收尾阶段自动扫描工作区 `.agentdock/artifacts/<runId>` 产物文件并更新 Task 的 `artifacts_json`。
  - 新增 API 路由 `GET /api/local/v1/tasks/:taskId/artifacts` 与 `GET /api/local/v1/tasks/:taskId/artifacts/:artifactId/content`。
  - 安全文件访问控制（防止路径穿越 `..`，仅限工作区/产物目录）。
- **Desktop Renderer UI**：
  - `ArtifactViewerDrawer`：全局/会话级产物浏览抽屉。
  - `ArtifactViewer`：多类型沙箱渲染器（HTML Sandboxed iframe、Markdown、Diff、Image、Code/Text）。
  - 在 `ThreadChat` 顶部状态栏和 `RunTimelineDrawer` / `RunTimelineView` 中集成产物入口。

### Non-Goals
- 阶段二的跨工作区全局画廊（Gallery）视图（后续独立 Issue 推进）。
- 产物版本历史 Diff 比较引擎（当前仅展示单次生成的产物）。

---

## 3. Behavior & Interface Contracts

### 3.1 Data Model (`@cc/superai-contracts`)

```typescript
export interface AgentTaskArtifact {
  id: string;
  kind: 'file' | 'diff' | 'url' | 'text' | 'html' | 'image' | 'markdown' | (string & {});
  title: string;
  path?: string;
  url?: string;
  summary?: string;
  metadata?: {
    mimeType?: string;
    sizeBytes?: number;
    extension?: string;
    [key: string]: unknown;
  };
}

export interface AgentTaskArtifactContent {
  id: string;
  taskId: string;
  title: string;
  kind: string;
  mimeType: string;
  content: string; // UTF-8 text or Base64 for binary
  isBinary: boolean;
  sizeBytes: number;
}
```

### 3.2 HTTP API (`services/local-ai-core`)

- `GET /api/local/v1/tasks/:taskId/artifacts`
  - 返回 `{ artifacts: AgentTaskArtifact[] }`
- `GET /api/local/v1/tasks/:taskId/artifacts/:artifactId/content`
  - 返回 `AgentTaskArtifactContent`
  - 校验 `taskId` 对应 Task，校验 artifact 对应 path，验证属于工作区目录或应用产物目录，禁止非法越权。

---

## 4. Acceptance Criteria

1. **自动登记**：当工作区 `.agentdock/artifacts/<runId>/` 目录下存在生成的文件时，Run 完成后 Task `artifacts` 数组中自动包含对应条目，并正确识别 `kind` 和 `metadata.mimeType`。
2. **安全读取**：`GET /api/local/v1/tasks/:taskId/artifacts/:artifactId/content` 能正确读取并返回文本/HTML/图片(Base64)内容；若请求非法路径或不存在文件，返回清晰错误且无路径泄露。
3. **沙箱预览**：
   - HTML 产物在具有安全沙箱（`sandbox="allow-scripts"`，无 `allow-same-origin`）的 iframe 中渲染，支持 JS 动画/图表渲染，同时隔离 Cookie 和 LocalStorage。
   - Markdown 产物使用富文本渲染。
   - Diff 产物清晰展示增删改行。
   - 图片产物显示预览。
4. **UI 联动**：
   - `ThreadChat` 头部在有产物时显示「Artifacts 产物 (N)」按钮，点击唤起抽屉。
   - `RunTimelineDrawer` 中显示关联产物列表并可预览。
5. **质量门禁**：通过完整测试套件 `pnpm test`、`pnpm typecheck`、`pnpm lint:circular`。
