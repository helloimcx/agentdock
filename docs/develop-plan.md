# 逐步去除 `cc-connect` 聊天依赖、保留其 IM Gateway 角色的架构优化方案

## Summary

目标不是“整体移除 `cc-connect`”，而是把它从**本地聊天/线程/流式/runtime 中枢**降级成**IM platforms gateway**。也就是说：

- `cc-connect` 继续负责 Telegram / Slack / Discord / Feishu 等平台接入
- `Local AI Core` 成为本地桌面应用唯一的聊天与线程中枢
- Electron 退化为桌面壳与系统权限入口
- 远程 Web 模式继续保留，但作为远程 backend，而不是本地架构的中心模型

这意味着系统要从“`cc-connect` 是一切的中心”改成“双层结构”：

- 控制面和本地会话面：`Local AI Core`
- 外部消息入口面：`cc-connect` 作为 platform ingress adapter

## Key Changes

### 1. 重新定义 `cc-connect` 的职责边界
- 将 `cc-connect` 明确限定为 `Platform Gateway`，职责只保留：
  - IM 平台连接与 webhook/websocket 生命周期
  - 平台账号/频道/群组的接入配置
  - 外部消息 ingress 和外发消息 delivery
- 不再让 `cc-connect` 作为本地桌面线程、session、streaming、UI runtime 的主事实来源。
- 本地桌面模式下，`cc-connect` 输出的外部消息应被视为“平台事件输入”，而不是“线程系统本体”。

### 2. 让 `Local AI Core` 成为本地线程与消息的唯一真相
- 线程列表、详情、消息历史、run 状态、streaming 状态全部收口到 Local AI Core。
- `WorkspaceRouter` 升级为统一 `Conversation Router`：
  - `localcore-acp` 继续走本地 ACP adapter
  - 新增 `cc-connect-platform-ingress` 适配能力，把来自 IM 的消息映射进 Local AI Core 线程
- 本地 UI 不再直接依赖：
  - `management /projects/:id/sessions`
  - `api/sessions`
  - desktop bridge fallback
- 前端 Threads 页统一只消费 `core-sdk` 的 thread/run/event 模型。

### 3. 将平台接入从“会话系统”改造成“消息入口适配器”
- 新增平台事件抽象层，例如 `PlatformIngressAdapter`，由 Local AI Core 持有统一接口，`cc-connect` 只是其中一个实现。
- `cc-connect` adapter 负责：
  - 接收平台侧消息
  - 解析 platform user/channel/thread identity
  - 将其映射成 Local AI Core 的 `workspace + thread + inbound message`
  - 接收 Local AI Core 的 outbound reply，再转发回 IM 平台
- 线程归属、assistant state、审批状态、流式消息拼接都由 Local AI Core 负责，不再交给 `cc-connect` session 模型。
- 平台侧“共享会话”“线程隔离”“群聊归属”这些策略迁移到 Local AI Core 的 thread identity policy 中统一定义。

### 4. 本地聊天链路彻底去 `cc-connect`
- 删除本地桌面 Threads 对 `bridgeSendMessage/createSession/listSessions/getSession` 的依赖与 fallback。
- 桌面聊天发送统一走：
  - Renderer -> `core-sdk`
  - Local AI Core -> agent adapter
- 流式协议统一由 Local AI Core SSE 提供，禁止再让 `cc-connect` bridge 成为本地聊天主链路。
- `reply/preview/update_message/typing_*` 的统一事件语义由 Local AI Core 维护，`cc-connect` 只在 IM gateway 场景中产出/消费平台消息，不再主导桌面 UI 的流式协议。

### 5. 运行时层拆分为两个本地服务角色
- 将当前 `ServiceManager` 的“启动一个 `cc-connect` 并等待 management API”模式拆成两个运行时角色：
  - `Conversation Runtime`: Local AI Core，必须存在
  - `Platform Gateway Runtime`: cc-connect，可选启用
- Electron 只负责启动和监控这两个 runtime，不再让 `cc-connect` 决定整个桌面运行时状态。
- Dashboard / Workspace 需要区分：
  - Core status
  - Platform gateway status
- 即使 `cc-connect` 不在线，本地桌面对话和知识库仍必须可用；只是 IM 平台入口不可用。

### 6. 配置模型重构：把平台配置与聊天配置分离
- 现有 `DesktopConnectConfig` 需要拆为逻辑上两块：
  - `conversation` 配置：workspace、agent、knowledge、thread policy
  - `platform gateways` 配置：Telegram/Slack/Discord 等接入参数
- Workspace UI 不再默认“项目 = cc-connect project”。
- `platforms` 字段保留，但语义变成“该 workspace 绑定的 ingress adapters”，不再隐含“由 cc-connect 原生执行会话”。
- 兼容期内：
  - Local AI Core 维护逻辑配置
  - `CcConnectGatewayAdapter` 从逻辑配置投影出 `cc-connect` 所需运行时配置
- `generated-config.toml` 只应包含 platform ingress 所需部分，不再承载本地聊天/runtime 的主配置语义。

### 7. 远程 Web 模式保留，但视为远程 backend
- 远程模式继续保留，以兼容远程 `cc-connect`/平台网关场景。
- 但本地桌面架构不再围绕远程 management API 建模。
- 远程模式应被封装为 `RemoteBackendAdapter`，把远程对象映射成统一的 thread/run/message 模型。
- 本地模式和远程模式共享相同的前端页面，只在 backend adapter 层不同。

## Public Interfaces / Types

- 新增 `PlatformIngressAdapter` 抽象，用于描述 IM gateway 到 Local AI Core 的入站/出站消息桥接。
- 新增 `RuntimeStatus` 的角色化字段，至少区分：
  - `core`
  - `platform_gateways`
- `LocalCoreCapabilities` 增加：
  - `conversation_adapters`
  - `platform_ingress_adapters`
  - `runtime_roles`
- 线程模型增加稳定来源字段，例如：
  - `sourceAdapter`
  - `platformContext`
  - `ingressIdentity`
- `DesktopRuntimeStatus.managementBaseUrl` 不应继续作为本地模式核心字段；兼容远程 adapter 时可保留 adapter-specific diagnostics，但不再驱动主 UI 架构。

## Test Plan

- 本地聊天回归：
  - `cc-connect` 关闭时，本地桌面对话、流式、停止、审批、知识库仍可正常工作
  - Threads 页不再调用 `api/sessions` 和 desktop bridge send fallback
- 平台入口回归：
  - `cc-connect` 接到 Telegram/Slack/Discord 消息后，能够映射到 Local AI Core 线程
  - Local AI Core 回复后，能够通过 `cc-connect` 正确回发到平台
- 线程一致性测试：
  - 同一平台对话在 Local AI Core 中只对应一套线程真相
  - 平台入站消息、桌面本地消息、历史重载不会产生重复 assistant/user message
- 运行时分离测试：
  - Core runtime 单独启动成功
  - Platform gateway runtime 单独失败时，UI 仅展示平台不可用，不影响本地聊天
- 配置投影测试：
  - 逻辑配置变更后，Local AI Core 正确加载 conversation 部分
  - `CcConnectGatewayAdapter` 正确投影出平台网关运行时配置
- 远程模式回归：
  - Web 远程仍能查看线程、发消息、读历史
  - 本地桌面不再因远程兼容而维持 `cc-connect` 中心模型

## Assumptions

- 长期目标是“仅去聊天依赖”，不是立即移除 `cc-connect`。
- `cc-connect` 继续承担 IM platforms 接入，这是明确保留项。
- 本地桌面聊天与线程系统必须完全迁移到 Local AI Core。
- 平台消息的 session/thread 映射策略最终由 Local AI Core 统一定义，`cc-connect` 只负责接入和投递。
- 迁移期间允许存在 `CcConnectGatewayAdapter` 兼容层，但它不应继续决定桌面聊天架构。
