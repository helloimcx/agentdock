# Plan: 透明 Shell 代理与多设备自适应远程 Workspace 支持

## 1. 架构影响分析（Architecture Impact Analysis）
- **分类**：`Required`（调整远程工作区执行与代理通道，从 MCP Stdio 管道重构为透明 Shell 代理与动态环境自适应）。
- **受影响模块**：
  - `services/local-ai-core/src/execution/remote-mesh/`: 增加 `agentdock-mesh-shell.ts`，重构 `remote-mesh-backend.ts`，移除/弃用 `remote-mesh-mcp-server.ts`。
  - `services/local-ai-core/src/mesh/`: `node-capabilities.ts` 调整 `DEFAULT_MAX_SHELL_BYTES` 至 512 KiB。
  - `services/local-ai-core/src/acp/`: `local-core-acp-session-coordinator.ts` 注入多设备动态 `systemPrompt` 与 `disallowedTools`。
  - `docs/architecture/`: 更新架构规范与变更记录。

---

## 2. 实施步骤（Implementation Steps）

### 阶段一：编写通用透明 Shell 代理 (`agentdock-mesh-shell`)
1. 在 `services/local-ai-core/src/execution/remote-mesh/agentdock-mesh-shell.ts` 中实现：
   - 提取命令行中的 `-c` 之后的命令主体；
   - 读取环境变量 `AGENTDOCK_LOCAL_CORE_URL`, `AGENTDOCK_MESH_NODE_ID`, `AGENTDOCK_MESH_ADMIN_TOKEN`；
   - 通过 HTTP 同步调用 `/api/local/v1/mesh/execute`，向目标设备发送 `shell.exec`；
   - 将远程设备的 `stdout`/`stderr` 写入当前进程流，并透传返回 `exitCode`。
2. 在构建流程或启动脚本中确保该代理在 Node.js 环境下具备可执行权限（`#!/usr/bin/env node`）。

### 阶段二：多设备动态自适应与描述生成
1. 在 `services/local-ai-core/src/execution/remote-mesh/device-environment.ts` 中封装环境解析逻辑：
   - 根据 `node.platform` 与 `node.label` 动态生成上下文描述；
   - 支持 `android`（Termux、免 ADB）、`linux`、`darwin`、`win32` 及通用 fallback。
2. 在影子目录 `shadowDir` 中自动写入 `CLAUDE.md` 与 `AGENTS.md`。

### 阶段三：重构远程执行后端 (`RemoteMeshExecutionBackend`)
1. 移除 `prepareLaunch` 中对 `agentdock-remote-mesh` MCP 服务的注入；
2. 注入 `env.SHELL` 指向编译后的 `agentdock-mesh-shell.js`；
3. 将设备节点信息（`nodeId`, `label`, `platform`）附加至返回的 `launchConfig.execution` 中。

### 阶段四：ACP 会话协调层对齐与工具约束
1. 在 `LocalCoreAcpSessionCoordinator.buildSessionMeta` 中识别远程 Mesh 工作区：
   - 动态追加 `systemPrompt.append` 携带设备规范；
   - 在 `_meta.claudeCode.options.disallowedTools` 中添加 `["FileEdit", "GlobTool"]`，屏蔽本地服务器文件工具。

### 阶段五：调优 Mesh 终端输出缓冲区
1. 将 `node-capabilities.ts` 的 `DEFAULT_MAX_SHELL_BYTES` 提升至 `512 * 1024`（512 KiB）。

### 阶段六：测试验证与质量门禁（TDD）
1. 编写集成测试覆盖：
   - `agentdock-mesh-shell` 命令行解析与远程转发；
   - 多设备平台提示词动态生成；
   - 远程工作区启动配置（无 MCP，包含 `SHELL` 注入与工具屏蔽）。
2. 执行全量门禁：`pnpm typecheck`、`pnpm lint:gates`、`pnpm lint:arch`、`pnpm test`。
3. 部署并验证端到端（飞书与 Web 对话）。
