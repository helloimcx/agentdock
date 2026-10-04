# Spec: 远程 Workspace 支持（Agent 运行在 Server，Toolcall 透明执行在 Client）

## 1. 目标（Goal）

支持在 AgentDock 中创建并运行“远程 Workspace”：
1. **Agent 进程运行在 Server**：Agent 守护进程、大模型提示词工程、会话上下文、SQLite 历史与知识库逻辑集中在 Server 端（Local AI Core 宿主机）运行；
2. **Toolcall 执行在 Client**：工作区绑定的 Client 设备（通过 AgentDock Mesh 长连接接入的节点，如 MacBook、本地 Linux 服务器等）作为执行靶机，承载实际文件读写、目录浏览与终端命令执行；
3. **对于 Agent 完全透明无感**：Agent 无需知道任何“远程”概念或专用前缀，在自然的本地工具认知（`read_file`, `write_file`, `list_directory`, `execute_command` 以及终端命令）下正常推理与调用，所有请求由底座透明桥接至 Client 端并返回真实结果。

---

## 2. 范围（Scope）

1. **Mesh 核心能力扩展**：
   - 契约扩展：在 `packages/contracts/src/mesh.ts` 中新增 `'filesystem.write'` capability 及对应输入/输出类型。
   - Client 实现：在 `services/local-ai-core/src/mesh/node-capabilities.ts` 实现安全原子写入、自动父目录递归创建、文件大小防爆限制（最大 1 MiB）与严格 `--root` 目录沙箱校验（`realpath` 防回溯与软链接逃逸）。
   - Client 广播：`NodeAgent` 握手时上报 `filesystem.write` 能力。
2. **MeshGateway 同步调用原语**：
   - 在 `MeshGateway` 中增加 `executeAndWait(input, timeoutMs, signal)` 内存等待机制，建立快速 Promise 状态映射，处理 Client 断连、超时与取消。
3. **Workspace 模型与持久化对齐**：
   - `WorkspaceRegistryEntry`、`WorkspaceRegistryCreateInput` 与 `DesktopProjectConfig` 正式支持 `deviceId: 'node:<uuid>'` 关联绑定。
   - 运行时配置持久化保障设备绑定信息无损落盘。
4. **远程执行后端（RemoteMeshExecutionBackend）与影子目录**：
   - 实现 `AgentExecutionBackend` 接口，提供 `RemoteMeshExecutionBackend`；
   - 为 Server 端的 Agent 进程提供合法物理影子目录（Anchor Dir），防止跨系统路径不存在导致 `spawn` 异常；
   - 注入动态内置的 Mesh MCP Server（暴露标准的 `read_file`、`write_file`、`list_directory`、`execute_command`），对 Agent 0 提示词污染。
5. **ACP 协议级能力增强与 Shell 拦截**：
   - `LocalCoreAcpTransport.initializeSession` 针对远程工作区向 Agent 宣告 `clientCapabilities.fs = { readTextFile: true, writeTextFile: true }`；
   - `LocalCoreAcpTurnCoordinator` 拦截 Agent 的 `fs/read_text_file` 与 `fs/write_text_file` 请求并透明转发到 Mesh；
   - 动态注入标准透明 MCP 工具（`bash`, `execute_command`, `read_file`, `write_file`, `list_directory`），统一桥接终端与工具调用至 Client 端，避免操作系统级 PATH 劫持污染 Node.js Agent 运行环境。
6. **前端 UI 与交互**：
   - 在创建/编辑 Workspace 弹窗中提供“运行设备（Device）”选项，支持选择“本机 (Local)”或已配对在线的 Mesh Client 设备。

---

## 3. 非目标（Non-goals）

1. **不在 Client 端运行 Agent 进程**：Agent 始终在 Server 上运行，Client 端仅维持轻量 `agentdock-node` 长连接，不增加端侧算力负担。
2. **不引入内核级远程挂载文件系统**：不依赖 FUSE、NFS、SSHFS 等需要 root 权限和特定网络端口的内核文件系统驱动。
3. **不破坏既有本地工作区**：未指定或 `deviceId: 'local'` 的工作区 100% 保持既有行为与性能。

---

## 4. 行为与接口契约（Behavior & Interfaces）

### 4.1 Mesh 写入契约（`packages/contracts/src/mesh.ts`）
```ts
export interface MeshWriteArgs {
  path: string;
  content: string; // UTF-8 text or Base64 string
  encoding?: 'utf8' | 'base64';
}

export interface MeshWriteResult {
  path: string;
  bytesWritten: number;
}
```

### 4.2 Workspace 绑定输入（`packages/contracts/src/workspace.ts`）
```ts
export interface WorkspaceRegistryCreateInput {
  displayName: string;
  path: string;
  deviceId?: string; // 'local' | 'external' | 'node:<uuid>'
  defaultRuntimeId?: string;
  metadata?: Record<string, unknown>;
}
```

### 4.3 动态 Mesh MCP 工具暴露（对 Agent 完全标准透明）
- `read_file({ path: string })`: 读取相对路径文件内容。
- `write_file({ path: string, content: string })`: 写入相对路径文件。
- `list_directory({ path?: string })`: 列出指定相对路径的文件与子目录。
- `execute_command({ command: string, arguments?: string[] })`: 在 Client 的工作区根目录执行指定程序。

---

## 5. 约束与边界条件（Constraints & Edge Cases）

1. **Client 端目录逃逸防护**：
   - Client 的 `--root` 沙箱绝对不可突破。任何解析后不在 `--root` 内的绝对路径、`..` 相对回溯或指向外部的软链接，均直接抛出 `Path is outside the approved root`。
2. **Client 设备意外断开**：
   - 若在 Toolcall 执行期间 Client 突发掉线或心跳超时，Server 端的 `executeAndWait` 在 300ms 内触发 reject，向 Agent 返回标准工具执行错误，会话与后台立即释放等待锁，不发生内存泄漏或无休止挂起。
3. **超时与孤儿进程**：
   - 默认执行超时限制（文件 30s，命令 120s）。超时自动触发 AbortSignal，向 Client 发送 `cancel` 中断其子进程组，避免客户端孤儿进程。
4. **大文件防爆**：
   - 单次读写限制在 1 MiB 以内，Shell 输出限制 32 KiB ~ 1 MiB 并进行安全截断标记，保护 WebSocket 控制帧。

---

## 6. 验收标准（Acceptance Criteria）

- [ ] **AC-1**：通过 API 或 UI 能够成功创建并保存绑定到已配对在线 Mesh 节点的远程 Workspace（`deviceId: 'node:<uuid>'`）。
- [ ] **AC-2**：Client 端 `NodeCapabilities` 正确支持 `filesystem.write`，成功在 `--root` 内写入并拦截一切非法路径穿越。
- [ ] **AC-3**：Server 端 Agent 发起的文件读取与写入调用被透明转发到 Client，在 Client 物理磁盘产生真实改动，Agent 对此无额外异常感知。
- [ ] **AC-4**：Server 端 Agent 发起的命令执行被透明转发至 Client 执行，能够获取 Client 真实的系统环境和命令输出（如 `uname`, `git` 等）。
- [ ] **AC-5**：Client 设备离线时，Server 端能够安全快速拦截请求并友好报错，不发生系统崩溃或请求挂死。
- [ ] **AC-6**：本地 Workspace（`deviceId: 'local'`）不受任何影响；既有测试、架构门禁（`pnpm lint:arch`）与类型检查 100% 保持绿灯。
