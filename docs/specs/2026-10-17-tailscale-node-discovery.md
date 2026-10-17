# Tailscale 节点自动发现与免配置绑定规范 (Spec)

## 1. 目标 (Goal)

通过集成 Tailscale 状态检测与 LocalAPI/CLI 节点探测，让 AgentDock 具备原生 Tailnet 设备发现能力：
- 用户无需手动记忆或输入 100.x IP 地址。
- 在 Mesh 节点管理页面和 Workspace 工作区创建/编辑对话框中，可直接列出当前 Tailnet 中的在线设备。
- 用户点击即可将选中的在线设备一键绑定为 `MeshNode`，并将其作为工作区的执行设备（`deviceId: node:ts:...`）。

## 2. 范围 (Scope)

- **Contracts (`packages/contracts`)**：
  - 定义 `TailscalePeer`、`TailscaleStatusResponse`、`TailscaleBindInput` 等契约接口。
- **Local AI Core (`services/local-ai-core`)**：
  - 新增 `TailscaleService`：负责寻找 tailscale 可执行文件、执行 `tailscale status --json`、安全解析设备列表并与当前已注册的 `mesh_nodes` 进行比对标注。
  - 新增 `MeshGateway` 端点：
    - `GET /api/local/v1/mesh/tailscale/status`：获取本机 Tailscale 运行状态、本机信息及对端设备列表。
    - `POST /api/local/v1/mesh/tailscale/bind`：将指定的 Tailscale 设备一键登记为 `mesh_nodes` 中的可调度节点（`node:ts:<name>`）。
- **Core SDK (`packages/core-sdk`)**：
  - 在 `createMeshClient` 及 runtime client 中暴露 `getTailscaleStatus` 和 `bindTailscaleNode` 方法。
- **前端 UI (`src/pages/`)**：
  - `src/pages/Mesh/Devices.tsx` / `DevicePairing.tsx`：增加“Tailscale 局域网设备”展示卡片，展示在线/离线状态、OS、IP，并支持一键导入为 Mesh 节点。
  - `src/pages/Desktop/workspace-components.tsx` / `workspace-sections.tsx`：在“Execution device”下拉列表中，展示发现的 Tailscale 在线设备，选中即可无缝绑定为当前工作区的执行设备。

## 3. 非目标 (Non-goals)

- 不接管 Tailscale 本身的安装与登录进程（用户依然通过 Tailscale 官方客户端或命令行登录）。
- 不绕过 Tailscale 的 ACL 或安全策略。
- 不修改现有的 `node-agent` 内部协议；为 Tailscale 设备创建的 MeshNode 依然遵循现有的 `RemoteMeshBackend` 任务分发结构。

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
```

### 4.2 REST API
- `GET /api/local/v1/mesh/tailscale/status`
  - 返回状态：`200 OK`，返回 `{ ok: true, data: TailscaleStatusResponse }`
  - 当 Tailscale 未运行或 CLI 不存在时，返回 `200 OK`，且 `data.available = false`，不抛异常崩溃。
- `POST /api/local/v1/mesh/tailscale/bind`
  - 请求体：`TailscaleBindInput`
  - 逻辑：以 `node:ts:<safe-name>` 形式在 `mesh_nodes` 中插入或更新节点，返回已绑定的 `MeshNode`。

## 5. 约束与兼容性 (Constraints / Compatibility)

- **跨平台兼容**：适配 macOS、Linux 与 Windows 下 tailscale 二进制的常见路径（`/usr/local/bin/tailscale`, `/usr/bin/tailscale`, `/Applications/Tailscale.app/...`, 或环境变量 `PATH`）。
- **容错防挂**：超时限制（默认 3 秒），执行失败时优雅降级为 `available: false`，避免阻塞整个 MeshGateway 或 UI 首屏加载。
- **向下兼容**：完全保留原有的手动 Token 模式（`agentdock-node connect`），Tailscale 发现仅作为增强功能。

## 6. 验收标准 (Acceptance Criteria)

1. **服务探测验证**：在未安装/未启动 Tailscale 的环境下，调用探测接口返回 `available: false` 并带有清晰说明，系统平稳运行不报错。
2. **状态解析验证**：在已安装 Tailscale 的环境下，能够正确解析本机 `Self` 节点及所有对端 `Peer` 节点（包含主机名、OS、100.x IP、在线状态）。
3. **节点绑定验证**：调用 `bind` 接口后，在 `mesh_nodes` 中生成标准的 `node:ts:<name>` 记录，状态正确映射。
4. **前端交互验证**：
   - Mesh 设备页面显示 Tailscale 设备卡片，在线设备支持一键绑定为 Mesh 节点。
   - 工作区配置对话框在设备选择下拉框中支持直接选择发现的 Tailscale 在线设备，并在保存后正确写入 `device_id: "node:ts:..."`。
5. **门禁与测试验证**：`pnpm typecheck`、相关单元与集成测试均 100% 通过。
