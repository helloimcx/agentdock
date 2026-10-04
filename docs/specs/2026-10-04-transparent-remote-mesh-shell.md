# Spec: 透明 Shell 代理与多设备自适应远程 Workspace 支持

## 1. 背景与目标（Background & Goal）

### 1.1 背景
在远程 Workspace 场景中，Agent 进程（如 Claude Code）运行在 Server 端，而实际受控靶机为通过 AgentDock Mesh 长连接接入的 Client 设备（如 Android 手机、树莓派、本地 Linux 服务器、macOS 或 Windows PC）。
在此前的实现中：
1. 依赖动态挂载的 `agentdock-remote-mesh` Stdio MCP Server 暴露工具。
2. Agent（如 Claude Code）优先选用自身内置的本地原生 `Bash` 工具，导致命令在 Server 宿主机执行并报错（如在 Ubuntu 上尝试执行 `adb devices`）；
3. Agent 无法感知当前工作区绑定了何种远程设备，存在严重的工具重叠与认知分裂；
4. MCP 依赖严格的 JSON-RPC 与 ACP Schema 格式，增大了协议维护成本。

### 1.2 核心目标
1. **透明 Shell 代理（Transparent Shell Proxy）**：
   通过环境变量 `SHELL` 注入无状态跨平台代理脚本 `agentdock-mesh-shell`。Agent 继续使用其最擅长、最习惯的原生 `Bash` 终端工具，任何终端执行命令透明通过 `/api/local/v1/mesh/execute`（`shell.exec`）打到远程目标设备，并原样返回 `stdout`、`stderr` 与 `exitCode`。
2. **彻底移除 MCP 依赖**：
   移除远程工作区中的 `agentdock-remote-mesh` MCP 工具注入，消除工具重叠与长前缀，消除 MCP Schema 脆弱性。
3. **多设备自适应（Multi-Device Dynamic Adaptation）**：
   拒绝任何设备名称或系统类型的硬编码。动态读取注册节点（`mesh_nodes`）中的 `label`（设备名称）与 `platform`（`android`、`linux`、`darwin`、`win32`），自适应生成环境描述与工作区规范（`CLAUDE.md` 与 ACP `_meta.systemPrompt`）。
4. **宿主机文件工具隔离**：
   在远程 Mesh 会话中禁用宿主机本地的 `FileEdit`、`GlobTool` 等工具，确保 Agent 所有的文件读写与系统交互全部通过远程 Shell 在目标设备上闭环。
5. **放宽终端输出缓冲区**：
   将 `maxShellBytes` 默认限制从 32 KiB 调整至 512 KiB，保证完整返回系统诊断输出（如 `df -h`、`ps`、`termux-*`）。

---

## 2. 详细设计与接口契约（Detailed Design & Contracts）

### 2.1 透明 Shell 代理：`agentdock-mesh-shell`
- **定位**：可执行脚本（Node.js），可被系统作为 `$SHELL` 调用。
- **命令行解析**：
  Agent 通常通过 `$SHELL -c "<cmd>"` 执行非交互命令。代理脚本解析 `-c` 后的完整命令字符串；若无 `-c` 则解析传入的所有参数。
- **通信流程**：
  1. 读取环境变量：`AGENTDOCK_LOCAL_CORE_URL`、`AGENTDOCK_MESH_NODE_ID`、`AGENTDOCK_MESH_ADMIN_TOKEN`；
  2. 向 `${AGENTDOCK_LOCAL_CORE_URL}/api/local/v1/mesh/execute` 发起 HTTP POST 请求：
     ```json
     {
       "nodeId": "node:<uuid>",
       "capability": "shell.exec",
       "args": {
         "program": "sh",
         "arguments": ["-c", command]
       },
       "timeoutMs": 120000
     }
     ```
  3. 接收结果，将 `stdout` 写入 `process.stdout`，`stderr` 写入 `process.stderr`；
  4. 以远端 `exitCode` 退出当前进程（`process.exit(exitCode ?? 0)`）。

### 2.2 多设备自适应环境生成（`buildDeviceEnvironment`）
根据绑定的 `MeshNode` 动态生成上下文描述：
- **`platform: 'android'`**：描述为 Android / Termux 环境，提示支持标准 Linux 工具与 `termux-*` 系列命令，说明无须 ADB。
- **`platform: 'linux'`**：描述为 Linux POSIX 环境，提示支持标准 Linux shell 与工具链。
- **`platform: 'darwin'`**：描述为 macOS 环境，提示支持 macOS / zsh 命令行。
- **`platform: 'win32'`**：描述为 Windows 环境，提示支持 PowerShell / CMD。
- **动态生成文件**：在工作区物理影子目录（`shadowDir`）生成 `CLAUDE.md`，并在 ACP `_meta.systemPrompt` 中注入提示词。

### 2.3 启动后端（`RemoteMeshExecutionBackend`）
1. 查找绑定的节点信息（从 `local-core.db` 或 Mesh 运行时中获取 `label` 与 `platform`）；
2. 准备 `shadowDir`，写入自适应的 `CLAUDE.md`；
3. 设置 `launchConfig.env`：
   - `SHELL = <path-to-agentdock-mesh-shell>`
   - `AGENTDOCK_MESH_NODE_ID = <nodeId>`
   - `AGENTDOCK_LOCAL_CORE_URL = <url>`
   - `AGENTDOCK_MESH_ADMIN_TOKEN = <token>`
4. 移除 `mcpServers` 中的 `agentdock-remote-mesh`；
5. 在 `launchConfig.options` 或 `_meta` 中配置 `disallowedTools: ['FileEdit', 'GlobTool']`。

---

## 3. 验收标准（Acceptance Criteria）

- **AC-1**：Agent 在远程工作区中调用原生 `Bash` 工具时，命令经由 `agentdock-mesh-shell` 透明转发至远程 Mesh 节点并在端侧执行，返回真实的端侧 `stdout`/`stderr`/`exitCode`。
- **AC-2**：彻底移除 `agentdock-remote-mesh` MCP 工具注入，Agent 不再感知到任何 `mcp__agentdock-remote-mesh__*` 工具，会话不再因为 MCP Schema 出现协议报错。
- **AC-3**：环境描述（`CLAUDE.md` 和 systemPrompt）根据节点 `label` 与 `platform` 动态生成，支持 Android/Termux、Linux、macOS、Windows，不硬编码特定厂商或系统名。
- **AC-4**：宿主机本地 `FileEdit` 等工具在远程 Mesh 会话中被禁用，防止云端服务器本地文件泄漏或误读。
- **AC-5**：`maxShellBytes` 提升至 512 KiB，保证较长的设备诊断输出不被提前截断。
- **AC-6**：现有本地工作区（`deviceId: 'local'`）行为 100% 保持不变，所有现有回归测试全通。
