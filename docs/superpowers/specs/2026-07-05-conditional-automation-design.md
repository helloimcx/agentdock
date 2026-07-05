# 条件自动化设计

日期：2026-07-05
状态：已确认

## 1. 背景

AgentDock 目前有两套相邻能力：Scheduler 使用 `cron` 或 `once` 启动 Agent，Automation Monitor 从插件 Provider 获取事件并用受限表达式判断是否启动 Agent。新需求是让用户通过对话描述条件，由 Agent 生成一个固定判断脚本；系统周期性执行脚本，在条件满足时启动 Agent，并将结果投递到原会话或指定频道。

条件脚本同时负责采集外部数据和作出判断。脚本可以使用任意有效 shebang 指定的解释器，但必须经过测试授权、沙箱测试和正式审批，才能注册到后台自动化。

## 2. 目标与非目标

### 2.1 目标

- 将 Scheduler 和 Automation Monitor 收敛到统一的 Automation 领域模型。
- 支持按 `cron`、一次性时间、固定间隔或 Provider 事件激活检查。
- 支持 `always`、受限表达式和已批准脚本三种条件。
- 支持任意有效 shebang 文本脚本，由脚本自行访问外部 API 并返回判断结果。
- 使用 Anthropic Sandbox Runtime 隔离脚本的文件、网络和进程访问。
- 首版在 macOS 和 Linux 上提供相同的条件脚本能力与安全语义。
- 实施一次性测试授权和正式启用审批，审批绑定不可变内容哈希。
- 只在条件从 `false` 变为 `true` 时启动 Agent。
- 保持现有 Scheduler、Monitor、频道投递和 CLI 调用兼容。
- 在桌面 Automation 页面提供审批、启停、检查历史和执行历史。

### 2.2 非目标

- 首版不提供可视化脚本编辑器。
- 首版不支持常驻脚本或脚本自行订阅事件。
- 首版不支持 Windows 条件脚本执行，也不允许无沙箱降级。
- 首版不把用户脚本动态加载成 Local AI Core 插件。
- 首版不承诺分布式 exactly-once；运行语义是本地单实例下的尽量一次执行。
- 首版不在运行阶段安装解释器或第三方依赖。

## 3. 核心设计决策

### 3.1 统一领域模型，不创建大而全的 Service

Scheduler 和 Monitor 在产品层统一为 Automation，但运行职责保持分离：

```text
Activation -> Condition -> Action -> Delivery
```

- Activation 决定何时检查。
- Condition 决定是否执行。
- Action 启动 Agent。
- Delivery 将过程和结果投递到本地、Lark 或 Weixin。

现有普通定时任务映射为 `cron + always`，条件定时任务映射为 `cron + approved-script`，现有股票监控映射为 `provider-event + expression`，一次性任务映射为 `once + always`。

### 3.2 Skill、脚本制品和运行时插件职责分离

内置 Condition Trigger Skill 负责指导 Agent 生成、测试和注册脚本。通用 Automation Script Runner 负责执行脚本。每个用户脚本是带版本和审批状态的制品，不是 Skill，也不是动态插件。

Provider 插件仍负责共享的、产品级事件源。只有当一种采集能力需要被多个自动化复用，并且拥有稳定契约时，才应实现为 Provider 插件。

### 3.3 渐进迁移

统一 Automation 模型成为新能力的唯一写入模型。现有 `/scheduler`、`/monitor` API 和 CLI 暂时作为兼容适配层保留。迁移稳定前不进行一次性删除旧 API 或破坏性数据迁移。

## 4. 组件边界

### 4.1 AutomationTriggerEngine

负责计算下一激活时间、产生检查候选和重启补检。支持 `cron`、`once`、`interval` 和 `provider-event`。它不执行条件脚本，也不启动 Agent。

### 4.2 AutomationConditionEngine

根据 Condition 类型调用 `always`、受限表达式求值器或 AutomationScriptRunner。它负责验证结果、保存 Evaluation、维护最近一次成功的布尔状态并检测上升沿。

### 4.3 AutomationScriptRunner

解析已批准版本、构造沙箱策略、注入 Secret、执行脚本协议、限制时间和输出，并返回结构化结果。任何条件脚本执行都必须经过该接口；业务代码不得直接 `spawn` 用户脚本。

### 4.4 AutomationActionExecutor

将已触发的 Automation 转为 ACP Agent run。它复用现有 scheduled/monitor conversation executor 中的线程解析、`same-thread`/`side-thread` 策略和权限模式。

### 4.5 AutomationDelivery

复用现有 `ScheduledBridgeSession` 和 Channel Runtime，保留 Local、Lark、Weixin 的过程流、权限卡片和最终回复行为。平台路由继续由 Local AI Core 解析，不能泄漏到 Renderer 或脚本。

### 4.6 SandboxRunner

定义平台无关接口。首版实现基于 [Anthropic Sandbox Runtime](https://github.com/anthropic-experimental/sandbox-runtime)，同时支持 macOS 和 Linux。macOS 使用 `sandbox-exec`，Linux 使用 Bubblewrap、网络 namespace 和代理桥接。Linux 是 Local AI Core 的正式部署目标，不能因为当前桌面包未提供 Linux target 而降级为次级支持。Anthropic Sandbox Runtime 的 Windows 支持仍是 alpha，且官方说明它不是针对恶意进程的安全边界，因此首版 Windows Runner 返回明确的 `sandbox_unavailable`，禁止测试和后台执行。

## 5. 数据模型

### 5.1 AutomationDefinition

```ts
interface AutomationDefinition {
  id: string;
  workspaceId: string;
  title: string;
  enabled: boolean;
  health: 'healthy' | 'blocked';
  blockedReason?: string;
  activation:
    | { kind: 'cron'; expression: string; timezone: string }
    | { kind: 'once'; runAt: string }
    | { kind: 'interval'; intervalMs: number }
    | { kind: 'provider-event'; sourceType: string; sourceConfig: Record<string, unknown> };
  condition:
    | { kind: 'always' }
    | { kind: 'expression'; expression: string }
    | { kind: 'approved-script'; scriptId: string; approvedVersionId: string; edge: 'rising' };
  action: {
    kind: 'agent-prompt';
    promptTemplate: string;
    executionMode: 'same-thread' | 'side-thread';
  };
  delivery: {
    platform: string;
    route: ScheduledJobRoute;
  };
  policies: {
    concurrency: 'skip-if-running';
    cooldownMs: number;
  };
  lastSuccessfulMatch?: boolean;
  lastEvaluationAt?: string;
  lastTriggeredAt?: string;
  consecutiveEvaluationFailures: number;
  createdAt: string;
  updatedAt: string;
}
```

`enabled` 表示用户是否启用，`health` 表示系统是否具备执行条件。界面状态由两者派生：`enabled=false` 为暂停，`enabled=true && health=blocked` 为阻塞，其余为活动。阻塞原因包括审批撤销、哈希不匹配、解释器变化或 Sandbox Runtime 不可用。这样用户行为和系统诊断不会形成互相矛盾的持久化状态。

### 5.2 AutomationScript 与版本

`AutomationScript` 提供稳定身份和 workspace 所有权。`AutomationScriptVersion` 是不可变版本，至少保存：

- 整包 SHA-256。
- Local AI Core 管理目录中的相对路径。
- shebang、审批时解析出的解释器绝对路径和版本。
- 能力声明、脚本配置模式和 Secret 引用。
- 静态检查结果、测试计划和测试报告。
- `draft`、`pending_test_approval`、`test_authorized`、`tested`、`pending_approval`、`approved`、`rejected`、`revoked` 状态。
- 测试授权、正式审批和撤销的审计主体与时间。

正式脚本存储在 Local AI Core 用户数据目录，不写入项目 workspace。数据库保存相对路径，避免持久化机器专属绝对路径。包内文件、manifest、测试或权限声明变化都会产生新哈希和新版本，旧审批不能继承。

### 5.3 AutomationEvaluation

每次条件检查都保存 Evaluation，包括：

- Automation、Activation 和脚本版本标识。
- 条件结果 `matched`、`not_matched`、`error` 或 `skipped`。
- 独立的触发决策 `triggered`、`not_rising`、`skipped_concurrent`、`skipped_cooldown` 或 `skipped_action_running`。
- 触发时间、开始/结束时间和耗时。
- 退出码、错误分类、截断和脱敏后的 stdout/stderr。
- 结果摘要、payload 和成功后的 nextState。
- 沙箱违规和网络目标审计摘要。

### 5.4 AutomationRun

只有 Condition 上升沿通过后才创建 Agent Action Run。它保存现有 scheduled/monitor run 已有的线程、ACP run、投递模式、投递状态、桥接活动和错误字段。Evaluation 成功不等于 Agent Run 成功，两类状态不能合并。

## 6. 脚本包与执行协议

### 6.1 包结构

```text
manifest.json
entrypoint
可选辅助文件
tests/
```

版本哈希覆盖整个包。入口必须是带有效 shebang 的文本文件。首版不接受无 shebang 入口或任意二进制入口。运行时不会安装依赖；解释器、系统命令和第三方库必须在测试阶段验证。

### 6.2 Manifest

Manifest 至少声明：

- 协议版本和入口文件。
- 脚本配置及其校验模式。
- 网络模式和内网访问需求。
- 允许读取的额外目录。
- Secret 引用与注入环境变量名。
- 超时、stdout、stderr、payload 和 state 大小限制。

Secret 只保存逻辑引用，脚本包、Automation 数据和数据库不得保存明文 Secret。

### 6.3 输入输出

Local AI Core 通过 stdin 传入单个 JSON 文档：

```json
{
  "protocolVersion": 1,
  "evaluationId": "evaluation-id",
  "triggeredAt": "2026-07-05T06:00:00.000Z",
  "config": {},
  "previousState": {}
}
```

stdout 必须只包含一个 JSON 文档：

```json
{
  "protocolVersion": 1,
  "matched": true,
  "summary": "发现目标状态",
  "payload": {},
  "nextState": {}
}
```

诊断日志必须写 stderr。非零退出、超时、非法 JSON、协议版本不支持或缺少布尔 `matched` 都是 Evaluation 错误。`nextState` 只在脚本成功时保存。脚本不能直接启动 Agent 或写 Automation 状态。

### 6.4 进程执行

- 审批时解析 shebang，并固定解释器路径和版本；变化后进入 `blocked`。
- 不通过 shell 拼接命令。
- 默认超时 30 秒，可在 manifest 中缩短或延长，硬上限 5 分钟。
- 超时后终止完整进程树。
- stdout、stderr、payload 和 state 必须设置上限；超限按协议错误处理或安全截断。
- 所有持久化和事件发射前执行 Secret 脱敏和终端控制字符净化。

## 7. 沙箱与网络策略

### 7.1 文件和进程

- 脚本包只读挂载。
- 单次 Evaluation 获得独立临时写目录，完成后清理。
- 默认禁止用户主目录、workspace、Local AI Core 数据目录和本地 Unix socket。
- 额外只读目录必须在 manifest 中声明并参与审批。
- Sandbox Runtime 的策略必须覆盖整个子进程树。
- 禁止在 Sandbox Runtime 不可用时回退到普通子进程。

### 7.2 网络

条件脚本默认允许出站公网 HTTP/HTTPS 和 DNS，以支持外部 API 检查。默认禁止：

- 入站监听。
- localhost 和回环地址。
- RFC 1918 等私网地址。
- 链路本地地址。
- 云实例元数据地址。
- 本地 Unix socket。

Manifest 可选择 `restricted` 网络模式，用域名白名单进一步收紧。访问内网需要显式高风险权限和重新审批。Evaluation 记录访问目标和沙箱拒绝事件，但不记录请求正文、Header 或 Secret。

### 7.3 平台前置检查

Local AI Core 启动时必须执行 SandboxRunner capability probe，结果进入运行时诊断和 Automation 健康状态：

- macOS 检查 Sandbox Runtime 初始化、`sandbox-exec` 和 `ripgrep`。
- Linux 检查 `bubblewrap`、`socat`、`ripgrep`、user namespace、network namespace 和 seccomp 支持。
- Ubuntu 24.04 及更高版本若启用限制非特权 user namespace 的 AppArmor 策略，部署文档必须提供专用 AppArmor profile；不能要求用户全局关闭该安全策略作为默认安装步骤。
- capability probe 失败时，脚本 Automation 进入 `blocked` 并报告缺失能力；普通 `always` 和表达式 Automation 继续运行。
- macOS 与 Linux 使用同一脚本协议、审批模型和网络策略，不允许平台特有的无沙箱兼容路径。

## 8. 两阶段审批

本机运行未批准代码与“测试后再正式审批”存在安全冲突，因此采用两阶段授权：

1. Agent 生成脚本包、manifest、测试和能力声明。
2. Local AI Core 完成静态检查并创建 `pending_test_approval` 版本。
3. 用户查看代码、哈希、权限和测试计划，批准一次性测试。
4. Agent 在与正式运行相同的沙箱策略内执行测试。
5. Local AI Core 保存不可修改的测试报告。
6. 用户根据同一哈希、权限快照和测试报告正式批准。
7. Automation 绑定该 `approvedVersionId` 后才能启用。

测试授权不能启动后台调度，不能重复使用，也不能自动升级为正式审批。代码、解释器、权限、Secret 引用或测试内容变化后必须创建新版本并重新走完整流程。

审批、拒绝和撤销复用现有安全审计体系，记录审批人、版本哈希、权限快照、时间和来源。

## 9. 状态机

### 9.1 Evaluation

1. Activation 到期。
2. 如果同一 Automation 已有 Evaluation 执行中，本次条件结果记录为 `skipped`，触发决策记录为 `skipped_concurrent`。
3. ConditionEngine 执行条件并验证结果。
4. 成功时保存 `nextState` 和新的 `matched`。
5. 首次成功结果为 `true` 时视为上升沿。
6. 后续只有 `false -> true` 创建 AutomationRun。
7. 条件保持 `true` 时继续记录 Evaluation，但不重复启动 Agent。
8. 必须成功检查到一次 `false` 才重新布防。

### 9.2 失败

- 脚本错误不改变最近一次成功的布尔状态或 previousState。
- 普通运行错误不自动禁用任务，下个计划点继续检查。
- 连续失败保存计数；首次、第三次以及之后按指数间隔发送告警，避免刷屏。
- 哈希不匹配、审批撤销、解释器变化或 Sandbox Runtime 不可用会将 Automation 标为 `blocked`。
- Local AI Core 重启后，每个 Automation 最多补做一次错过的检查，不追赶所有历史时间点。
- Action 已运行时的新上升沿将条件结果记录为 `matched`、触发决策记录为 `skipped_action_running`，并且不排队。
- 冷却期内的上升沿将条件结果记录为 `matched`、触发决策记录为 `skipped_cooldown`；最近成功状态仍更新为 `true`，冷却结束后不补触发。

## 10. API、CLI 与内置 Skill

### 10.1 API

新增统一资源：

- `/automations`：创建、查询、更新、启停和手动检查。
- `/automations/:id/evaluations`：检查历史。
- `/automations/:id/runs`：Agent 执行历史。
- `/automation-scripts`：脚本身份。
- `/automation-scripts/:id/versions`：不可变版本。
- 版本级静态检查、测试授权、测试执行、正式批准、拒绝和撤销操作。

跨进程数据形状进入 `packages/contracts`。Core SDK 和 Plugin SDK 引用共享契约，不复制类型。

### 10.2 兼容层

- `/scheduler` 将旧请求映射为时间 Activation 和 `always` Condition。
- `/monitor` 将旧请求映射为 Provider Activation 和表达式 Condition。
- 旧 CLI、Renderer 和 Agent 提示在迁移期保持行为不变。
- 新 Condition Trigger Skill 只调用统一 Automation API/CLI。

### 10.3 Condition Trigger Skill

Skill 的固定工作流是：理解需求、生成 staging 包、静态检查、提交版本、请求测试授权、执行测试、提交报告、请求正式审批、创建 Automation、返回 Automation ID 和管理入口。

Agent 不能直接写正式脚本目录，不能修改已提交版本，不能绕过 Local AI Core 审批状态，也不能通过旧 Scheduler API 注册条件脚本。

## 11. 桌面交互

Automation 页面统一展示旧 Scheduler、旧 Monitor 和新 Automation：

- 按 Activation、Condition、状态和 workspace 筛选。
- 展示最近检查、最近触发、连续失败和阻塞原因。
- 展示脚本代码、哈希、解释器、权限、Secret 名称和公网访问提示。
- 支持测试授权、测试报告查看、正式批准、拒绝和撤销。
- 支持启停、手动检查、Evaluation 历史和 Run 历史。
- 不提供代码编辑器；修改由 Agent 生成新版本。

Renderer 只调用 Core SDK，不拥有审批、路由、脚本文件或运行状态。

## 12. 测试策略

### 12.1 状态机与契约

- 覆盖全部 Activation 和 Condition 判别联合类型。
- 覆盖首次 `true`、持续 `true`、`false` 重新布防和脚本错误保持状态。
- 覆盖冷却、并发跳过、重启补检和 Action Run 生命周期。
- 断言 Evaluation 和 Run 的状态、事件和持久化相互独立。

### 12.2 脚本与安全

- shebang 解析、解释器缺失、解释器版本变化。
- 整包哈希、防篡改和符号链接逃逸。
- 未授权测试、测试授权重放和测试授权用于后台执行均被拒绝。
- 代码、权限或 Secret 引用变化导致重新审批。
- 公网 API 默认可访问；localhost、内网、链路本地、云元数据和 Unix socket 默认阻断。
- 脚本包只读，仅临时目录可写。
- Secret 不进入日志、事件、数据库或错误信息。
- 超时、进程树清理、超大输出、控制字符和非法 JSON。
- Windows 和 Sandbox Runtime 缺失时 fail-closed。

### 12.3 兼容与端到端

- 保持旧 Scheduler 和 Monitor API/CLI 测试。
- 验证 Local、Lark、Weixin 的同线程、侧线程和 bridge-stream 投递。
- `pnpm test` 覆盖共享契约、状态机、存储、API 和兼容层。
- `pnpm e2e:smoke` 覆盖打包后的基础操作。
- macOS 和 Linux CI 分别运行真实 Anthropic Sandbox Runtime 集成测试；状态机和错误注入测试使用受控 SandboxRunner fake，避免依赖公网稳定性。
- UI 使用聚焦手工检查和截图验证审批、详情及错误状态。

## 13. 实施里程碑

### 里程碑 1：统一 Automation 内核

建立共享契约、存储、Trigger/Condition/Action 状态机和旧 API 适配。普通 Scheduler 和现有 Monitor 在新内核上保持行为不变。

### 里程碑 2：脚本制品和沙箱

实现脚本版本、两阶段审批、Secret 引用、Anthropic Sandbox Runtime 适配、脚本协议和安全测试。

### 里程碑 3：Agent 工作流

实现统一 API/CLI 和内置 Condition Trigger Skill，完成从用户需求到待审批 Automation 的对话流程。

### 里程碑 4：桌面管理与发布验证

统一 Automation 页面，补充审计、Evaluation/Run 详情、macOS/Linux 集成测试和打包 smoke 验证。

每个里程碑必须保持 `pnpm test` 通过，并可独立验收。禁止通过临时无沙箱执行来提前打通后续流程。

## 14. 风险与应对

- Anthropic Sandbox Runtime 仍处于 Beta Research Preview：封装在 SandboxRunner 后面，固定兼容版本，提供启动自检，并保持 fail-closed。
- Linux 部署依赖 Bubblewrap、socat、ripgrep、user namespace 和 seccomp：提供启动 capability probe、发行版安装说明和最小 AppArmor profile，在 CI 覆盖支持的 x64/arm64 Linux 环境。
- 任意解释器导致环境差异：审批时固定路径和版本，测试阶段验证所有依赖，运行阶段不安装依赖。
- 默认公网访问可能造成数据外传：严格限制文件和 Secret，阻断本机/内网，记录网络目标，并允许用户切换域名白名单模式。
- 统一模型迁移影响面大：使用兼容适配层和分里程碑切换，不进行大爆炸替换。
- 高频 Evaluation 造成数据库膨胀：每个 Automation 的 Evaluation 默认最多保留 30 天且最多保留最近 1000 条，超出任一边界即可清理；最新成功状态、AutomationRun 和安全审计不随 Evaluation 清理。
