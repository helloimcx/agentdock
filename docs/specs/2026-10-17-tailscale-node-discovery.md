# Tailscale 节点自动发现与免配置绑定规范 (Spec)

## 1. 目标 (Goal)

通过集成 Tailscale 状态检测与 LocalAPI/CLI 节点探测，让 AgentDock 具备原生 Tailnet 设备发现能力：
- 用户无需手动记忆或输入 100.x IP 地址。
- 在 Mesh 节点管理页面和 Workspace 工作区创建/编辑对话框中，可直接列出当前 Tailnet 中的在线设备。
- 用户点击即可将选中的在线设备一键登记为 `MeshNode`（`node:ts:...`），并将其作为工作区的执行目标；初次绑定的节点初始处于 `offline` 状态，待对端节点代理连接后激活。

## 2. 范围 (Scope)

- **Contracts (`packages/contracts`)**：
  - 定义 `TailscalePeer`、`TailscaleStatusResponse`、`TailscaleBindInput` 契约，并导出统一的 `sanitizeTailscaleName` 与 `tailscaleNodeId` 命名工具。
- **AgentDock Daemon (`apps/daemon`)**：
  - 新增 `TailscaleService`：负责寻找 tailscale 可执行文件（支持 `TAILSCALE_CMD`，不存在时严格报错）、执行 `tailscale status --json`、以 5 秒 TTL 缓存避免子进程派生风暴，并安全解析设备列表与 `mesh_nodes` 记录进行比对标注。
  - 新增 `MeshGateway` 端点（位于管理鉴权保护下）：
    - `GET /api/local/v1/mesh/tailscale/status`：获取本机 Tailscale 运行状态、本机信息及对端设备列表（需管理员权限）。
    - `POST /api/local/v1/mesh/tailscale/bind`：将指定的 Tailscale 设备一键登记为 `mesh_nodes` 中的节点（`node:ts:<safe-name>`，`status: 'offline'`，需管理员权限）。
- **SDK (`packages/sdk`)**：
  - 在 `createMeshClient` 及 runtime client 中暴露 `getTailscaleStatus` 和 `bindTailscaleNode` 方法，支持从 `localStorage` 回退解析管理凭据。
- **前端 UI (`apps/web/src/pages/`)**：
  - `apps/web/src/pages/Mesh/Devices.tsx`：增加“Tailscale 局域网设备”展示卡片，展示在线/离线状态、OS、IP，并支持一键导入为 Mesh 节点；采用英文默认回退文本。
  - `apps/web/src/pages/Desktop/workspace-components.tsx` / `workspace-sections.tsx`：在“Execution device”下拉列表中，展示发现的 Tailscale 在线设备，捕获绑定异常并向用户呈现错误信息，避免错误状态静默持久化。

## 3. 非目标 (Non-goals)

- 不接管 Tailscale 本身的安装与登录进程（用户依然通过 Tailscale 官方客户端或命令行登录）。
- 不绕过 Tailscale 的 ACL 或安全策略。
- 不伪造 WebSocket 会话在线状态；新绑定的 Tailscale 节点明确保持 `status: 'offline'`，执行命令与调度需在对端通过标准的 `agentdock-node pair/connect` 流程配对建立 WebSocket 会话。

## 4. 行为与接口 (Behavior / Interface)

### 4.1 数据契约 (`@cc/superai-contracts`)
```ts
export interface TailscalePeer {
  id: string;
  name: string;
  dnsName: string;
  ips: string[];
  os: string;
  online: boolean;
  isSelf?: boolean;
  meshNodeId?: string;
}

export interface TailscaleStatusResponse {
  available: boolean;
  error?: string;
  self?: TailscalePeer;
  peers: TailscalePeer[];
}

export interface TailscaleBindInput {
  name: string;
  dnsName?: string;
  ips?: string[];
  os?: string;
  allowShell?: boolean;
}

export function sanitizeTailscaleName(rawName: string, dnsName?: string): string;
export function tailscaleNodeId(rawName: string, dnsName?: string): string;
```

### 4.2 REST API (需管理员权限)
- `GET /api/local/v1/mesh/tailscale/status`
  - 请求头：`Authorization: Bearer <AGENTDOCK_MESH_ADMIN_TOKEN>`
  - 返回状态：`200 OK`，返回 `{ ok: true, data: TailscaleStatusResponse }`
  - 未鉴权时返回 `401 Unauthorized`
  - 缓存策略：5 秒内重复请求复用缓存，防子进程派生风暴。
  - 当 Tailscale 未运行或 CLI 不存在时，返回 `200 OK`，且 `data.available = false`，不抛异常崩溃。
- `POST /api/local/v1/mesh/tailscale/bind`
  - 请求头：`Authorization: Bearer <AGENTDOCK_MESH_ADMIN_TOKEN>`
  - 请求体：`TailscaleBindInput`
  - 未鉴权时返回 `401 Unauthorized`
  - 逻辑：使用确定性命名工具 `tailscaleNodeId(name, dnsName)` 以 `node:ts:<safe-name>` 形式在 `mesh_nodes` 中插入或幂等更新节点（包括 label 中的 IP 标注、已知 platform 继承及 capabilities），初始状态为 `status: 'offline'`，`token_hash` 为 NULL；若符号清洗导致多台设备 ID 碰撞（如 `gpu--server` 与 `gpu-server`），则后绑定的设备将更新现有节点而非新建独立节点；若节点处于 `revoked` 状态则拒绝重新绑定（防止绕过吊销，对端列表显示 Revoked，恢复需删除记录或通过 CLI 重新配对）；执行派发操作需等待设备通过 `agentdock-node` 建立 WebSocket 连接，否则返回 409 Conflict。返回登记的 `MeshNode`。

## 5. 约束与兼容性 (Constraints / Compatibility)

- **跨平台兼容**：适配 macOS、Linux 与 Windows 下 tailscale 二进制的常见路径，支持 `TAILSCALE_CMD` 自定义路径覆盖（路径不存在时严格报错提示）。
- **容错防挂**：超时限制 3000ms，执行失败时优雅降级为 `available: false`，避免阻塞整个 MeshGateway 或 UI 首屏加载。
- **向下兼容**：完全保留原有的手动 Token 模式（`agentdock-node connect`），Tailscale 发现仅作为增强功能。

## 6. 验收标准 (Acceptance Criteria)

1. **鉴权防护验证**：未带有效管理 Token 请求 `/tailscale/status` 或 `/tailscale/bind` 必须返回 401。
2. **状态解析验证**：在已安装 Tailscale 的环境下，能够正确解析本机 `Self` 节点及所有对端 `Peer` 节点（包含主机名、OS、100.x IP、在线状态）。
3. **缓存防抖验证**：5 秒内的多次探测请求只调用一次底层命令行执行器。
4. **节点绑定与离线语义验证**：调用 `bind` 接口后在 `mesh_nodes` 中生成标准的 `node:ts:<name>` 记录，状态为 `status: 'offline'`；未建立 WS 会话向其 dispatch 调度任务时正确拒绝并返回 409。
5. **异常路径验证**：`TAILSCALE_CMD` 指向不存在文件时明确抛出配置异常。
6. **门禁与测试验证**：`pnpm typecheck`、相关单元与集成测试均 100% 通过。
