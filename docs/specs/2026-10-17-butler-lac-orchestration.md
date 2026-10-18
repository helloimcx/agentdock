# 管家通过 LAC 委派与持续跟踪

- 状态：方案与完整 UI 原型已确认；Core/LAC 和 Butler renderer/i18n 实现及自动化验证完成；生产配置未变更。
- 日期：2026-10-17（Asia/Shanghai）。
- 基线：`46a60fb`，在 `codex/2026-10-17-butler-lac-orchestration` 隔离工作区规划。
- Architecture Impact: Required。改变跨工作区调用方式、任务完成语义、结果回报协议和 Agent 工具授权边界。
- [实施计划](../plans/2026-10-17-butler-lac-orchestration.md) · [当前流程图](../architecture/butler-orchestration.html) · [变更记录](../architecture/changes/2026-10-17-butler-lac-orchestration.md)。

## Implementation snapshot

Core transport, trusted worker reports, durable checkpoints, due checks, profile tracking defaults, manager acceptance, cancellation modes, and the scoped remote LAC route are implemented in this branch. The full AgentDock prototype was confirmed on 2026-10-17; the Butler renderer and i18n now expose channel/core transport, workspace-agent bindings, tracking policy, and task references/check status. Unit/integration and CLI/remote-dispatch checks are recorded in the plan; real Feishu, Ubuntu server, and fnOS download verification are not claimed here.

Current implementation boundary: a `checkpoint` persists external references before a worker run ends; the final report is settled only after the matching run completes. A worker run that fails after a checkpoint is left blocked with the reference retained, and the manager may explicitly register a read-only watch. The runtime prompt constrains check instructions and historic worker output as untrusted data, but existing workspace tools and permission policy remain authoritative.

## Goal

用户只需向管家 Bot 交代目标。管家通过 `lac butler` 请求 Core 调用受管 Bot 绑定的工作区 Agent；根据回报继续分工、定时检查、处理阻塞并交付最终结论。外部工作耗时数小时也不需要用户自己催问。

关键不变量：**一次 Agent 运行结束，不等于用户目标完成。** 创建下载任务后，必须持续跟踪实际下载，直到完成条件被核验，才能结束用户任务。

## Scope

1. 管家仍是一个具体 Channel Bot，受管对象仍是明确配置的 Bot 身份；将内部委派改为 Core 内部调用其绑定 Agent。
2. 支持一个目标的多个委派、同一委派的多轮执行、现有 `dependsOn`，以及管家根据结果给原任务追加委派。
3. 持久任务账本、结构化回报、到期查询、内部唤醒、证据验收、原会话通知、取消与重启恢复。
4. 使用已有 `WorkspaceRouter`、submission 去重、权限生命周期、Butler 表、通知和投递 outbox；复用本地及经验证的 Mesh 执行路径。
5. 新任务不要求共享群聊、双方群内显示名或机器人互相 @ 权限。受管 Bot 的 Channel 断开与其工作区是否可执行分别判断。

## Non-goals

- 不实现跨多个 Core 的联邦任务总线、任意 Agent 自由互调、worker 递归委派、可视化工作流编辑器或新的通用 scheduler。
- 不替 fnOS 实现下载器；执行者使用其已有工具与工作区配置。
- 不承诺外部系统副作用 exactly-once、Core 停机期间仍执行检查、或普通 Shell 因本功能而获得操作系统级沙箱。
- 首期管家运行在 Core 本机且具备受支持的 CLI 工具上下文；不顺带取消现有管理端运行位置限制。

## Baseline evidence (revision `46a60fb`)

- `butler-service.ts` 的配置与任务创建要求 connected Bot、共享 `oc_…` 群及双方显示名。
- `butler-dispatcher.ts` 先发飞书 Bot 协议；收到事件后，`executeManagedBotCommand()` 才创建工作区 thread、以 operation 派生 requestId 提交并保存准确 runId。
- `butler-observation.ts` 的 `terminalResult()` 当前将 `submission.completed` 直接映射为委派 completed。
- `ButlerService.complete()` 当前要求全部子任务完成后再由用户验收；`ButlerNotifications` 已能持久合批唤醒 owner thread，但会携带 Channel 回送上下文。
- `butler-store.ts` 已有 Task、Delegation、Operation、Notification、Bot inbox 表；service 已有默认两秒 reconcile。
- `lac-control.ts` 目前不允许 `butler`，且从可信 Mesh session 绑定原工作区与会话。不能简单开放自由 `--workspace`。

## Behavior / Interfaces

### 1. 身份、绑定与会话

管家以配置名单中的 `botId` 选择执行者。Core 解析该 Bot 的明确执行绑定：`workspaceId / deviceId / runtimeId / agentType / providerId`，保存语义快照；不复制密钥。一个 Bot 有多个注册绑定时必须选明，不能由发现列表的第一项决定。没有 Bot 专用 Agent 设置时，配置页明确显示并选用工作区默认设置；不借用某个日常聊天的临时 provider/agent 偏好。

每个 Delegation 独占一个 worker thread，多次 `submit/check/followup/verify` 复用它；不同目标不混入 Bot 的日常聊天。worker 使用目标工作区的工具、技能和现有权限，不继承管家完整聊天历史或管理权限。传入最小任务说明、完成条件、必要依赖结果和外部引用。Channel 入口身份与执行身份分离，内部执行不伪造群聊地址。

新路径使用 `transport=core`，旧路径为 `transport=channel`，模式在任务创建后固定。名单显示 Channel 状态及 runtime 可用性两个信号；已验证注册身份的 Channel 离线不阻止内部执行，runtime 不可用则保留待处理任务并退避。

### 2. 三层任务与独立 ID 域

| 对象 | 职责 | 持久信息 |
| --- | --- | --- |
| Task | 用户最终目标 | 原始需求、owner 与原始 Channel 路由、完成条件、完成策略、期限、最终结论 |
| Delegation | 交给一个 Bot 的持续子目标 | Bot/执行绑定快照、独立 thread、业务状态、外部引用、进度、检查计划 |
| Operation | 单次 submit/check/followup/verify/cancel | 稳定 requestId、序号、确切 submission/runId、回报、执行状态 |

TaskId、delegationId、operationId、threadId、runId、下载器外部 taskId 分属不同域，接口禁止混用。Task/Delegation 的 `status` 表达业务状态，单轮运行状态只由 Operation/Submission 表达，不能以本轮成功覆盖业务等待。

业务状态包含 `queued/running/waiting_external/reviewing/waiting_for_user/blocked/completed/failed/cancellation_requested/cancelled`。`blocked` 保存原因，如 runtime 离线、结果不明、缺少有效回报、预算耗尽或绑定已改变；不伪装 completed。`reviewing` 表示管家正在核验；要求人工验收的任务进入 `waiting_for_user`。

### 3. 回报与检查点

worker 可用 `lac butler report` 提交当前操作的结构化报告。其身份由 Core 签发并校验的短期 HMAC capability 给出，绑定 thread/run 与当前角色；worker 另绑定 Task/Delegation/Operation，报告正文不能选择任意 owner、task 或 run。会话新 run 会刷新凭证；Mesh 用户环境不能覆盖凭证。该机制保护受支持的 Butler CLI/API 调用，不是阻止同用户任意 Shell 或 raw localhost HTTP 的 OS 沙箱。

```json
{
  "schemaVersion": 1,
  "outcome": "waiting_external",
  "summary": "下载已创建，目前 12%",
  "externalRefs": [{"kind": "download", "system": "configured-downloader", "id": "actual-download-id"}],
  "progress": {"percent": 12},
  "evidence": [{"source": "downloader.query", "observedAt": "2026-10-17T03:00:00Z", "value": {"state": "downloading"}}],
  "suggestedCheckAfterSeconds": 600
}
```

`outcome` 取 `succeeded/waiting_external/needs_input/failed`。`succeeded` 是 worker 的完成声明，先进入管家核验，不直接关闭子目标。

创建外部副作用后尽早保存 checkpoint（同一 report 接口的 checkpoint 类型），以免外部任务已创建但上下文丢失。最终报告先暂存，只有对应 run 成功终结后才结算；提前报告后继续运行、失败或中断不能触发验收。checkpoint 中的外部引用在 run 失败时仍保留，供恢复查询。

相同报告幂等，冲突版本拒绝；迟到旧 run 的报告保留审计但不能覆盖新一轮。无结构化报告或无效报告时保存原始 final 供管家复核，不根据自然语言“已完成”推断业务成功。报告和证据都是待核实数据，不能授权新目标或改变执行权限。

### 4. 持久跟踪与管家决策

首次 waiting_external 报告唤醒管家，由管家登记检查计划：只读检查说明、外部引用、间隔、截止时间和预算。worker 只建议时间，不提供可以直接执行的任意下一步命令。

检查计划保存在 Core 的委派记录和可索引到期字段中。沿用 reconcile 扫描到期项，以事务/CAS 原子领取并生成唯一 check operation；两秒扫描不等于两秒调用模型。不为每个目标创建一条用户 cron，也不保持 lac 或 worker 进程长时间等待。

默认检查间隔十分钟、最短一分钟；允许按任务设置。连续无变化或临时失败采用有上限退避，最长一小时。检查预算与期限耗尽时转为 blocked；连续失败达到阈值后不再自动调用并唤醒管家。当前实现不配置 token 成本上限，也不提供独立的进度停滞阈值。

同一委派同时最多一个有效执行或到期检查；不同工作区可并行，同一工作区默认串行。外部等待不占运行槽位；繁忙延迟过长产生管家事件。中断恢复后错过多次检查只补一次，不补齐所有历史 tick。

Core 在持久状态转为 waiting_external 时必须同时留下“待管家决策”或下一次安全检查义务。管家本轮没调用 watch、异常退出或正在忙，事件仍在队列，按有界策略重新唤醒；不能留下没有后续动作的无人认领目标。只有管家登记过的检查计划可确定性续排；不存在计划时不擅自执行 worker 建议的指令。

正常无变化的检查结果入库并续排，默认不每次唤醒管家模型。首次回报、完成候选、重要变化、阻塞、失败或停滞唤醒管家；它可继续同一委派、向原 Task 追加其他 Bot 委派、调整计划、核验验收或请求用户决策。每次唤醒附任务摘要和最新报告，模型需重新查询账本后行动。

### 5. 静默执行与用户通知

worker 执行与管家内部唤醒明确使用内部投递模式。仅省略 `channelRoute` 不足以构成保证，必须检查并约束 ACP、bridge 和 runtimeEnv 的继承行为，确保日常 Bot 对话路由不会被误用。

用户默认收到接单/开始执行、重要异常或需决定事项、最终结论；不逐次收到轮询日志。管家通过显式 notify 能力向 Task 固定的原始会话发送信息，不能由 worker 或报告指定新收件人。结果关闭与最终通知入队同事务；通知失败独立重试，不重新执行下载。外部 Channel 发送结果不明按 outbox 现有不确定语义处理，不宣称绝对 exactly-once。

静默模式不能隐藏执行权限请求。Core 将权限请求按 Task/Delegation/Operation/准确 runId/approvalId 关联并持久通知原会话，提供该请求的可操作入口；用户可通过原会话支持的交互或链接处理，不需要自行寻找 worker。用户决定交回既有 permission 生命周期，只恢复准确的原请求与运行；管家不能代批。拒绝、过期、重复回复与重启后已失效请求分别处理，不能凭过期授权启动新一轮；等待期间暂停无意义进度检查。

账本是未完成任务的事实来源，不依赖模型上下文或页面是否打开。任务归属原用户/原会话，保留 owner thread 与 Channel 路由；不默认跨会话披露私有任务。owner thread 被删时保留任务并标明需重新关联，不能丢弃目标。

### 6. 完成、依赖与取消

普通任务采用 `completionPolicy=butler`：worker 提交完成候选 → 管家对照条件核验证据，必要时追加只读 verify → 验收 Delegation → 所有必要子目标验收后 complete Task，并回复用户。只有配置 `completionPolicy=user` 或需要新的授权/信息时才等待用户，不强迫普通任务手动收尾。

依赖仅在上游业务验收完成后释放，不在下载已创建或 worker run 完成时释放。验收记录关联报告版本和证据；检查期间出现更新结果则重新核验。通用 Core 不硬编码影片下载逻辑，也不把非空 evidence 当作充分证明。

下载例的完成条件：下载器处于完成终态，目标文件已落到约定目录，实际路径及大小可查询，且不再是临时下载文件；可获得预期大小时核对。是否播放成功仅在需求包含播放验证时追加检查。

区分 `cancel --mode tracking`（停止管家跟踪）与 `cancel --mode external`（请求取消外部任务）。中断 agent 不等于取消下载器任务；external 模式需运行取消并核实结果，未确认保持 cancellation_requested/blocked，并向用户交代。cancel 与完成报告竞争由状态版本控制，关闭后旧回报不能重新激活任务。

### 7. CLI 和受信授权

Implemented CLI/API surface:

- `profile/bots/setup/create/delegate/list/info/orphans/reattach/followup/cancel/complete/accept/watch/report` are implemented. `delegate <task-id>` appends work to an existing goal; `report --phase checkpoint` stores an external reference early, and final reports are run-scoped.
- Management API routes are owner-scoped within Local AI Core's existing same-user local API trust model. Agent commands use `POST /butler/agent` with a Core-issued, expiring capability plus thread/run context; the server checks role, current submission and exact task/delegation/operation. Internal state changes trigger durable notices associated with one goal and its owner thread; a deleted owner pauses the goal until explicit reattachment, and there is no arbitrary-recipient `notify` command.
- The manager can create, list, extend, follow up, watch, accept, and cancel its own goals. Through the supported capability-protected `lac butler`/`/butler/agent` interface, a worker can only report against its current operation; it cannot inspect profile/roster, create or extend goals, choose recipients, or approve permissions. This does not constrain arbitrary Shell or raw localhost API access available to a same-user local process.
- The `complete` API remains for legacy Channel tasks. Core goals close after the manager accepts all required delegation reports; worker completion alone does not close the goal.

现有 CLI 的 `--owner-thread` 与请求体字段不能证明身份。Agent 调用必须使用 Core 签发的运行范围 capability；thread/run header 单独不能通过 `/butler/agent`。经受支持的 capability-protected `lac butler`/`/butler/agent` 接口，worker 凭证只能提交其 Task/Delegation/Operation 当前 run 的报告，manager 凭证只在配置的 Butler 会话有效。管理 HTTP API 遵循 Core 既有本地 same-user 信任模型，不复用 Mesh admin token，也不宣称阻止同用户任意 Shell 直接访问本机 API。

Mesh 只扩展受控 lac 命令与可信上下文；不开放自由 `--workspace/--owner-thread/--base-url`，不将 Shell 文本在主机执行，也不向子进程继承 Mesh 管理 token。不支持可信工具上下文的 runtime 明确标记不支持，禁止静默放宽。

### 8. 恢复语义

先落 Operation，再提交 run；重启按稳定 requestId 找回 submission，避免重复内部提交。到期领取带版本/租约，过期领取者不能写回新状态。删除 owner thread 不删除 Task：系统暂停检查、保留回报与待发通知；只有匹配持久 owner principal 的 Butler conversation 可列出并重新关联孤儿目标。新任务在创建时记录 Lark 用户或本地 workspace principal；旧任务仅在仍有当前平台绑定时回填 Lark 身份，来源已丢失且无法证明归属的旧任务保持不可恢复，不能因“没有绑定”就归类为本地用户。通知按 Task 关联，重绑只迁移该目标的通知；终态目标也可恢复通知，且保持其最终状态。

Core 去重不保证下载器副作用去重。worker 优先按 externalRef 或业务幂等标签核对已有下载。创建请求发出后结果不明且无可靠引用时，进入 blocked 并先调查，不能自动重建。只有确认只读的 check 或明确幂等操作可自动重试。

## Constraints / Compatibility

- 使用既有 Node/SQLite 单 Core 架构；不引入消息中间件或另一套长任务框架。
- v1 channel 任务按旧语义完成/取消，v2 core 任务使用新协议；不在运行中转换或对同一委派双发，失败不自动降级群消息。
- 新配置保留旧群字段以读取历史，core 模式不再要求；已存在任务使用其绑定快照。工作区设备、默认 runtime、agent type 或 provider 与快照不匹配时阻塞并要求确认；常规凭据轮换不会作为绑定身份比较字段。
- 首期保证单 Core 已注册目标；具体 Agent 适配器和 Mesh 工具调用以实际能力探测及测试结果为准，不能宣称全部 runtime 已支持。
- UI 仍以配置为主；实施 UI 前按 prototype-first 更新完整可点击 `design/index.html` 并取得确认，不以独立管家 demo 代替真实站点原型。

## Acceptance Criteria

1. 从真实管家 Channel 委派一次，只经内部路径启动正确工作区/Agent/provider；不发送机器人互相 @ 的消息，不查询共享群。
2. 同时两个用户目标调用同一 Bot，worker thread、外部 ID、报告与结果互不串用；每个委派最多一个活动操作。
3. worker 创建下载并 run completed 后，目标仍为 waiting_external；只有后续完成核验才关闭。依赖此时不能提前运行。
4. 按计划经历多次进度查询及服务重启，无重复新建下载；Core 重新运行后继续跟踪并最终回复原会话。
5. 首轮管家未登记 watch、管家忙碌/退出时，持久决策事件仍可恢复；没有目标被静默遗忘。
6. 重复请求、重复/迟到/伪造报告、失效领取和取消竞争均不重复副作用或污染新状态。
7. 无效报告、临时离线、停滞、查询失败、预算/期限耗尽、权限等待和 owner thread 删除有可查询原因及通知策略，不虚报完成。
8. 内部检查不对外刷屏；任务完成和通知投递状态分开，Channel 离线不丢最终通知。
9. 经受支持的 capability-protected `lac butler`/`/butler/agent` 接口，未授权目标、伪造 workspace/owner/run、worker 递归委派与管理 token 继承被拒绝；孤儿目标仅对匹配原始渠道身份可见和可重新关联；普通 Mesh Shell 仍在远端。任意本机 Shell/raw localhost API 仍属于 same-user 信任边界。
10. 停止跟踪与实际取消下载分别验证，未确认外部取消时不宣称已停止下载。
11. 内部 worker 请求权限后，用户经管家原会话收到准确入口并处理，原 worker 按准确 approval/run 续跑；拒绝、过期和重复回复不扩大权限或误启动新操作。
