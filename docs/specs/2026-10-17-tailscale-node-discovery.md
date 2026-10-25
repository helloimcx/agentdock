# Tailscale 设备发现与一键接入

Status: 已批准（2026-10-24）；实现已完成，真实目标主机验证仍待完成。

本文件是 PR #222 的最终候选 Spec，取代此前“写入离线 inventory 即绑定成功”的验收口径。保留原文件名，避免同一 PR 出现两份冲突的需求基线。

## Goal

管理员在设备列表中选中 Tailscale 设备，首次确认 SSH 账户、共享目录和命令权限后，点击一次即可自动部署轻量 NodeAgent、完成安全配对、验证真实执行，并将真实 Mesh 节点用于工作区。

支持 macOS（含 GUI 版 Tailscale 的 MacBook Pro）和 Linux。对端不需要预先安装 AgentDock 或 npm。

## Scope

- Tailscale 发现、稳定设备身份关联和真实 Mesh 节点映射。
- 经 tailnet 的标准 OpenSSH：预检、运行包分发、反向转发、NodeAgent 启动与控制端监督恢复。
- 构建时生成包含现有 NodeAgent、能力执行、凭据工具及 ws 的独立 Node22 运行包。
- 复用 Mesh v1 `createPairing -> enroll -> authenticated WebSocket`；凭据经 SSH stdin 交付。
- 管理员 API、持久连接配置/接入任务、进度、失败、重试、取消、断开和明确的重新授权。
- Mesh 页面和工作区选择器共享接入流程；五语言文案；旧 synthetic 身份提示。
- 架构与运行说明、真实 macOS/Linux 验证。

## Non-goals

- 自动开启 SSH、修改 tailnet ACL、安装系统 Node.js、收集或保存 SSH 密码/私钥、自动接受主机密钥。
- Windows/Termux 的自动 bootstrap（原有手工 Mesh CLI 继续兼容）。
- 安装 launchd/systemd 系统服务、使用 sudo、自动配置 Tailscale Serve 或占用 HTTPS 443。
- 用 Tailscale 在线状态替代 Mesh 认证，或把共享目录宣传为 shell 沙箱。

## Behavior / Interfaces

### 首次准备与用户交互

1. 设备已加入同一 tailnet；对端 Node.js >=22，SSH 允许控制端 Daemon 账户使用现有密钥/ssh-agent登录；控制端已核验其 SSH 主机密钥。
2. SSH server 必须允许仅 loopback 的 remote forwarding。禁止转发、或强制 wildcard 监听时，接入明确失败。
3. SSH 配置属于运行 Daemon 的主机，与打开页面的浏览器所在设备分开说明。
4. 首次设置默认使用专用 `~/AgentDock` 目录，允许选择其他明确目录；不默认批准整个 home。缺少目录可经批准创建，对端 realpath 校验。
5. shell 默认关闭。开启时明确显示“以该账户的系统权限运行命令”；pairing policy 与 remote NodeAgent opt-in 同时传递。
6. 共享目录只读写能力可显示“已接入，文件能力”；工作区命令执行需 shell 能力，不得因文件探测成功显示为完整工作区可执行。
7. 保存后接入无需手工复制 token/配对文件、安装完整 AgentDock 或运行 connect 命令。

### 身份与兼容性

- `TailscalePeer.id` 使用原始 `Peer.ID`；PublicKey、DNS、hostname 和 IP 仅是可变属性。缺失稳定 ID 的发现结果可展示，但不能自动接入。
- 在当前 controller/tailnet 命名空间内，稳定 peer ID 唯一映射到一个普通 `node:<uuid>`。同名、清洗碰撞和 key rotation 不合并设备。
- 新流程停止创建 `node:ts:*`。工作区 `device_id`、WebSocket 认证、dispatch 使用同一个真实 node ID。
- 旧 synthetic 行与执行历史保留；旧工作区标注“需重新接入/选择设备”，不按名称自动迁移身份。用户选中明确 peer 并成功接入后才保存新目标。
- 已存在的普通节点、CLI pair/connect、HTTPS 校验、Mesh v1 消息与能力交集继续工作。

### 运行包与传输

- 控制端当前构建产生独立 CJS runtime 及 SHA-256 manifest；bundle 包含 ws，Node 内置模块 external，不包含 Electron/完整 Core。
- 通过已验证 SSH 上传至远端用户 0700 私有内容哈希目录，临时写入、校验、原子发布。匹配摘要可复用，不依赖 npm 上尚未发布的版本。
- SSH 使用 `BatchMode=yes`、`StrictHostKeyChecking=yes`、`ForwardAgent=no`、`PermitLocalCommand=no`、`ExitOnForwardFailure=yes`，配置连接/存活超时与输出上限。
- 目的地址由后端新鲜 Tailscale 状态解析，仅接受所选 peer 的 tailnet 地址；浏览器不能提供任意 host、SSH 参数、命令、密钥路径。
- 固定远端程序/脚本；用户值以有界 JSON stdin 传递，不拼接为 shell 源码；私密内容不进入 argv、URL、stderr、进度或数据库任务记录。
- OpenSSH ControlMaster 放在控制端 0700 短路径临时目录；`-O forward -R 127.0.0.1:0:127.0.0.1:<bridgePort>` 返回动态端口。远端实际监听必须被核实为 loopback。
- 控制端每连接创建仅 loopback 的窄 Mesh 接入桥，只接受精确 enroll 与 connect；不转发 Core、管理 API、shell API 或任意代理请求。
- 桥与同一个 MeshGateway 共享身份和会话，并强制 `expectedNodeId`：enroll 必须属于该节点，WS 认证为其他节点也拒绝。单纯按 URL 白名单不足以建立此约束。
- NodeAgent 使用远端 loopback HTTP/WS 回连，链路由 SSH 加密；不开放额外入站端口、不改变 `allowInsecure` 默认或依赖公网 HTTPS 地址。

### 配对、凭据与生命周期

- 控制端持久化随机 controllerId。对端在 `~/.agentdock/mesh/controllers/<controllerId>/` 保存凭据和锁，内容绑定 controllerId + expectedNodeId；不覆盖旧 CLI 的默认文件。
- pairing 在 SSH、运行时、目录和隧道就绪后签发；单次短效 token 仅经 SSH stdin 送到该对端。admin token 永不离开控制端。
- 对端保留现有 0600、O_EXCL、禁止 symlink/覆盖、限长和 fsync 纪律；enroll 返回值必须匹配 expectedNodeId。控制端仅存凭据哈希。
- SSH bootstrap 消费初始化帧后保持 stdin；EOF、信号、连接丢失停止 NodeAgent 并释放实例锁。由 Daemon 监督，避免 nohup 残留或重复进程。
- 已批准 `desiredState=active` 的配置在 Daemon 启动、目标机恢复或 SSH 中断后退避重连，使用同一 controllerId/真实 nodeId 和远端凭据。
- 同 peer 的重复提交返回当前任务；数据库唯一约束、任务租约和远端实例锁保证不会创建重复身份或重复运行 Agent。
- 凭据冲突、丢失、enroll 成功但保存失败进入 needs_repair；不得自动覆盖其他文件或不断创建新 UUID。
- 撤销使 token 失效、关闭会话与 SSH supervisor，清除自动连接意图。普通重试不能恢复已撤销授权；显式“重新授权”确认新的目录/权限后，才能安全重新配对该关联身份并作废旧凭据。
- 取消新任务会作废本轮未完成授权、停止本轮进程/桥；保留用户目录及无关文件。已完成连接使用单独的“断开/撤销”操作。

### 管理 API 和状态

- `POST /api/local/v1/mesh/tailscale/connections`：管理员认证；输入稳定 peerId、sshUser、approvedRoot、allowShell、幂等键；返回 202、connectionId/operationId。
- `GET /api/local/v1/mesh/tailscale/operations/:id`：返回安全进度、错误码和恢复提示。
- 取消操作、断开连接和重新授权分别使用显式管理员动作；连接配置查询不得返回任何凭据。
- 阶段：preflight -> deploying -> pairing -> connecting -> verifying -> ready；失败/取消/中断/撤销独立表达。
- ready 仅在预期 nodeId 的真实 authenticated session + `filesystem.list('.')` 成功后成立；允许 shell 时另外验证无副作用的命令执行。
- 区分未知/离线 peer、SSH 授权、host key、Node22、forwarding、runtime 摘要、凭据冲突、注册/会话和试执行失败。
- 新的工作区目标仅在 ready 且能力满足后保存；失败或取消不写入候选 peer/synthetic ID。既有真实离线节点可保留原选择并准确标注离线。

## Acceptance Criteria

1. 满足 SSH/Node22/forwarding 前提的真实 macOS 与 Linux 设备，无人工 pairing/connect 命令完成接入。
2. stable peer、创建节点、enroll、hello、试执行、workspace.device_id 与 dispatch 对应同一 `node:<uuid>`。
3. 真实列目录/读写测试文件成功；显式开启 shell 后，无副作用命令在目标机执行且结果可见。
4. 双击、并发、重试、改名、PublicKey 轮换不制造重复节点或身份碰撞；缺失稳定 ID 不自动接入。
5. SSH 中断、目标重启与 Daemon 重启后恢复相同身份；已撤销或 needs_repair 不自动越权恢复。
6. token 不出现在接口查询、作业表、argv、URL、日志、截图中；远端凭据与目录权限正确，既有文件不被覆盖。
7. 窄桥拒绝所有非接入路由和其他 nodeId；SSH reverse listener 不得监听 wildcard；主机密钥变化、token 重放/过期、路径越界和未经批准 shell 被拒。
8. 未 ready/未授权 shell 的 peer 不作为新工作区执行目标保存；原有 CLI 节点和历史数据不损坏。
9. design 原型和方案已确认；受影响架构事实/规范/产物一致，独立 Review 无阻塞项，`pnpm verify` 通过。
10. 真实双机主路径、断线恢复与撤销均记录证据；环境不具备时明确标记阻塞，不能用模拟 SSH 宣称真实 QA 通过。

## Approval / Evidence

- 交互原型：`design/index.html#/mesh`；配置、成功和失败截图位于 `design/screenshots/tailscale-onboarding-*.jpg`。
- 本阶段只完成候选方案与假数据原型，未实现或部署真实一键接入。
- macOS SSH 支持边界：[Tailscale SSH 官方文档](https://tailscale.com/kb/1193/tailscale-ssh)。
