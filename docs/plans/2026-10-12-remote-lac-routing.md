# Plan：远程工作区调用 LAC

## Architecture Impact: Required

新增主机侧能力分发路径，并在 Shell Proxy 中增加本地路由；这改变 ACP/runtime 工具调用、主机 Core 与远端设备之间的能力边界和数据流。

方案图：[远程工作区调用 LAC 工作流](../architecture/remote-lac-control.html)（源文件：`docs/architecture/remote-lac-control.workflow.json`）。

## 实施步骤

1. **锁定命令解析边界**：盘点现有 CLI domains 和 Shell Proxy 支持的 Bash 调用形式。实现保守词法解析器，只接受独立 `lac` simple command；识别其命令位置而非任意文本提及，并仅解开已知 Claude bootstrap/eval/pwd wrapper。任意前缀不得被丢弃，绝不在主机 eval 原始命令。
2. **抽取主机 dispatcher**：定义结构化 operation 注册表与 session-bound context；从当前启动配置捕获 workspace、thread、channel、node/run 绑定上下文。独立 MCP 控制工具和 Shell 兼容入口共用 dispatcher。去除或拒绝用户控制的 base URL 与上下文覆盖，并按操作注册表限制命令及目标范围。凭据留在主机进程内。
3. **接入 Mesh Shell Proxy**：将安全解析出的 lac argv 映射为结构化 operation，再交 dispatcher；普通 Bash 命令仍通过 `MeshGateway.executeAndWait()` 发往设备。维持 stdout、stderr、退出码和取消/超时语义。暂不处理包含多个命令的 Shell 字符串。
4. **新增 MCP 入口**：提供独立 host control MCP server，输入只接受注册过的结构化 operation 与业务参数，返回结构化数据和稳定错误；不把 Mesh admin token 或 Core 管理 token交给 Agent。MCP 与 CLI 兼容入口共享同一 allowlist/权限检查。
5. **首期命令白名单**：优先支持无文件输入的 memory、scheduler、monitor 和 automation 命令；写操作按现有业务授权保留。ACP、脚本审批、skill/rules 安装、渠道发文件逐项排除或单独设计，不因复用 CLI 而自动开放。
6. **同步 Agent 指引**：更新远程 workspace system prompt 与相关 Managed Skills，列出支持的命令，以及混合 Shell、脚本和文件参数的明确限制。
7. **架构文档**：更新当前事实、L1/L2 对应规范、一个 architecture change record、provider source/rendered artifacts、`docs/architecture/overview.md` 与 README managed block。

## 主要模块

- `services/local-ai-core/src/execution/remote-mesh/agentdock-mesh-shell.ts`
- `services/local-ai-core/src/execution/remote-mesh/remote-mesh-backend.ts`
- `services/local-ai-core/src/cli/lac.ts` 与 `cli-helpers.ts`
- 新增 host control MCP server 与 session-scoped dispatcher
- 远程 workspace prompt / Managed Skills
- Shell Proxy 单测、CLI 单测、Mesh 集成测试与架构文档

## 测试与 QA

- 单测：argv 保真、引号、空参数、Claude `eval` wrapper、任意条件前缀不被解开、退出码、标准流；命令位置识别、普通 Shell 参数/管道中的 `lac` 字样与复合 LAC 拒绝。
- 权限测试：workspace/thread/channel 由会话绑定；伪造参数、未授权命令、过期/撤销会话均拒绝；断言设备环境和 dispatcher 入参中不含管理 token。
- MCP 合约：有效 operation 成功，未知/越权 operation、伪造上下文、失效会话失败关闭。
- Mesh 集成：实际远程 node 同时运行 `lac scheduler list`、调用 control MCP 与运行 `git status`，确认前两者走主机 Core、后者走设备；离线、超时、断连明确失败。
- 按实际支持组合检查 Claude Code、OpenCode、Pi 的 Shell 路由和提示行为；将未验证组合列为不支持。
- 按仓库架构维护流程完成 `pnpm lint:arch`、provider 与链接检查及 `pnpm verify`；有真实设备时跑端到端冒烟。

## 后续阶段（不纳入首期）

1. 若需要在管道、复合命令或远端脚本内透明调用 `lac`，增加 Mesh 反向能力请求与远端轻量 shim；shim 只提交结构化 argv/内容引用，使用绑定 node/workspace 与 allowlist 的短期授权，不把主机 Shell 或管理凭据暴露给设备。由于当前 Mesh 是 Core 向节点派发执行，这会新增协议方向和安全边界，故等首期验证真实需求后再做。
2. 对 `memory --file` 等明确文件输入增加 `remoteFileRef(nodeId, relativePath)`，由 Mesh 文件接口按批准根目录读取、限制大小并清理主机临时文件。
3. 对渠道发文件增加远端到主机临时暂存，再调用现有发送处理器。
4. rules/skills 配置落盘与渠道/脚本能力分别建模授权和目标所有权。
