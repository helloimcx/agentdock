# DSH 与 AgentDock：Agent 运行循环 / 工具执行管线 / 权限与安全 对比

> 依据实际读到的源码与文档，未做编造。DSH 基于 `/tmp/dsh-src/deepseek-harness-master`，AgentDock 基于 `/Users/momo/code/agentdock`。

## 0. 一个根本性架构差异（决定后续一切）

| 维度 | DSH | AgentDock |
|---|---|---|
| 定位 | **单一集成 Agent 运行时**：在自身进程内拥有完整的 agent loop、工具注册与执行、LLM 适配、审批、沙箱、模型可见工具族 | **元控制面 / 编排器**：Local AI Core 把外部 agent（opencode/claudecode/cursor/gemini/localcore-acp）作为子进程/远程沙箱拉起，通过 ACP 协议**观察与转播**其输出 |
| 主循环在哪 | `packages/core/agent-loop` 进程内 | **外部 agent 进程内**；Local AI Core 只做会话协调 + 流式进度投影 |
| 工具执行管线在哪 | `packages/core/tools`：`pre-execute/execute/post-execute` 瀑布 + 单调守卫 | **外部 agent 内部**；Local AI Core 无自有工具注册与 execute 管线 |
| "模型可见工具" | goal/plan/todo/workflow/subagent/jobs/schedule 全套 | **无**（仅 scheduler 是面向渠道的 cron 任务，非 agent 自我管理工具） |

AgentDock 的"Agent 运行循环"实际是 **ACP 会话/回合的观测循环**（`services/local-ai-core/src/acp/`），而非自有推理循环。报告据此给出对照与改进建议。

---

## 1. DSH 循环与工具管线亮点（机制 + 路径引用）

**瀑布式事件（拦截/改写即挂监听）**，是 DSH 的核心扩展点，见 `docs/event-producer-consumer.md` 全表：

| 事件 | 模式 | 声明处 | 作用 |
|---|---|---|---|
| `agent/pre-step` | waterfall | `packages/core/agent/src/runtime-types.ts:231` | 回合进入前拦截/注入/改写，compaction/plan-mode/context 均挂在此 |
| `agent/request` + `llm/stream` | waterfall | `runtime-types.ts:244`、`packages/llm/llm/src/index.ts:64` | 模型请求构造与流式词表可被第三方观察/改写 |
| `tools/pre-execute` / `tools/execute` / `tools/post-execute` | waterfall | `packages/core/tools/src/index.ts:152/163/175` | 工具调用三阶段钩子，hooks/guard/sandbox/spill 全挂其上 |
| `approval/request` | waterfall | `packages/interaction/user-approval/src/index.ts:30` | 审批请求由监听者应答，`scope` 过滤到具体 agent |
| `system-prompt/assemble` | waterfall | `packages/core/system-prompt/src/index.ts:31` | 系统提示 + 工具 schema 拼装中心 |

**turn/step 模型 + 可回放会话日志**：`docs/agent-lifecycle.md` 给出 `turn/start → step/start → (assistant/chunk)* → tool/call → execute → tool/result → step/end → turn/end`。`session/event` 是可回放的可信日志（SDK/UI 消费），`agent/*` 是实时控制面——两边分离（`agent-lifecycle.md:80`）。`assistant/message` 记录每次调用含空内容与 max-tokens 结束（`:74`）。

**工具超时强制**：`packages/guard/timeout-policy/src/index.ts` 用 `deadline(exec.signal, timeoutMs, TOOL_TIMEOUT)` 包裹 `tools/execute`，超时替换为结构化 `{error.code:'TOOL_TIMEOUT'}` 结果，且用 scoped code 区分内层/外层 deadline（`:23-25,:73-75`）。工具需声明 `timeoutMs` 并尊重 `exec.signal`。

**审批 seam（fail-closed）**：`packages/interaction/user-approval/src`，缺席应答者→`'unavailable'`、`'never'` 策略确定性拒绝、`'ask'` 委托（`:312`），每个 ask/outcome 以 `approval/asked`+`approval/decided` 成对落日志（`:267-275`），且要求必须存在 open turn 才可问（`:259`）。策略经 `system-prompt` 注入模型（`:204-216`）。

**权限 preset**：`packages/interaction/permission-presets/src/index.ts` 把 `sandbox-mode` 与 `approval-policy` 两个独立旋钮捆绑为 `workspace-write`/`danger-full-access` 预设，一次切换双写。

**能力族 seam 化**：`docs/capability-seams.md` 表给出 `ctx.shell`(bash-local/bash-sandbox/pwsh-local)、`ctx.subprocess`、`ctx.terminal`(PTY)、`ctx.codeRuntime`、`ctx.sandbox`+`ctx.sandboxPolicy`、`ctx.web`——每个都是"接口+众多实现"，换实现不改循环（`:447-456`）。

**模型可见"agent 自我管理"工具族（AgentDock 最缺的）**——均在 `packages/` 中作为普通工具暴露：
- `goal/`（`goal/goal`, `goal/tool-goal`, `goal/goal-round-driver`）+ `agent/pre-step`/`agent/created` 驱动同会话连续轮
- `plan/`（`plan-mode` 折叠 plan/mode 状态，`:436`）、`todo/`（`tool-todo` + `session-projection`）、`workflow/`（`tool-workflow` 脚本引擎）、`subagent/`（`tool-subagent`/`tool-subagent-control`/`tool-ralph`）、`jobs/`（`ctx.jobs` + `tool-jobs` 后台任务注册/列表/kill）
- `schedule/` 的模型工具是对会话本地调度的持久化（`schedule/schedule/src/tools.ts`）

**防御模式**：`docs/defensive-patterns.md`——正交结果独立上报、双侧归一化公共契约、异步态≠同步态、dispose 须达静止、回调异常在 dispatcher 内吞、scrub env 防凭据泄漏、`lstat+unlink` 防符号链接穿越（`:7-33`）。

---

## 2. AgentDock 现状与差距

**现状（Local AI Core 实际拥有的）**：

| 关注点 | AgentDock 现状 | 关键文件 |
|---|---|---|
| 会话/回合协调 | 管理 ACP 会话生命周期、`session/new`/`loadSession`/`set_mode`、空闲关闭 | `acp/local-core-acp-session-coordinator.ts` |
| 流式进度投影 | 把外部 agent 的 message_chunk/thought_chunk/tool_call/tool_call_update/plan 映射成 UI bridge 事件 | `acp/local-core-acp-turn-coordinator.ts` |
| 权限转发 | 把外部 `session/request_permission` 转成按钮/审批，回放 `selected/cancelled`；有 `bypassPermissions` 模式 | `acp/local-core-acp-backend.ts:165-274`、`acp/local-core-acp-permission-lifecycle.ts` |
| 命令风险分类 | 正则分级 high/medium/low + scope 打标（git.modify/network.access/…） | `security/command-risk.ts` |
| 沙箱 | 通过 OpenSandbox 创建远程沙箱、卷挂载、stdio/http-ndjson 代理；也支持本地 stdio | `sandbox/sandbox-manager.ts`、`sandbox/sandbox-stdio-proxy.ts`、`execution/agent-execution-backend.ts` |
| 调度 | cron 轮询（`SCHEDULER_AUTO_DISABLE_THRESHOLD:5` 连败自动禁用），执行器把 prompt 发给外部 agent 并 `bypassPermissions`、轮询完成、回传回复；Lark/WeChat 渠道适配 | `scheduler/scheduler-service.ts`、`scheduler/scheduled-conversation-executor.ts` |
| 外部 API | `external/runs` 供外部队列创建 run 并读取快照/事件 | `runtime/external-service.ts` |
| 超时 | 业务 `BACKGROUND_AGENT_EXECUTION_TIMEOUT_MS=1h`，协议 `ACP_PROMPT_TIMEOUT_MS=3h`；外部 agent 不尊重时靠启发式 `interruptRun` | `agents/shared/execution-timeouts.ts` |

**核心差距**：

1. **无自有运行循环与工具执行管线**。ACL/Local AI Core 内**不存在**工具注册表、`pre/execute/post` 瀑布、`ctx.approval`、`fs/write-intent` 之类的守卫。`grep registerTool/execute.*tool` 在 `kernel/`、`runtime/` 无命中；`execution/agent-execution-backend.ts` 只是"本地 vs 沙箱"的**进程拉起**选择，不是循环。→ 相当于 DSH 的"循环、工具、审批、守卫"全部外置，Local AI Core 只能看见工具已发生（stream）而无法在**执行前**拦截。
2. **无模型可见自我管理工具**：无 goal/plan/todo/workflow/subagent/jobs/schedule(model-facing)。scheduler 是渠道 cron，非 agent 内建自我管理。
3. **审批是透传而非策略引擎**：本地只做 `classifyCommandRisk` 分级与展示，无 `ask/never` 会话策略、无 "allowed-once/确定性拒绝" 抽象、无成对审计日志（`approval/asked+decided`）。`bypassPermissions` 直接自动选 "allow all"（`turn-coordinator.ts:201-219`）——与 DSH 的 `'never'` fail-closed 语义相反且更激进。
4. **无统一超时强制**：超时是全局常量 + 外部 agent 启发的 `session/cancel`（`session-coordinator.ts:158-211`），工具级 timeout/死线取消无法由 Local AI Core 掐死。
5. **权限与安全较浅**：`command-risk.ts` 为纯正则启发，无沙箱文件写守卫联动（`fs/write-intent`）、无凭据 scrub 与符号链接穿越防御文档落地（DSH `defensive-patterns.md`）。
6. 测试覆盖偏"协调与投影"（`tests/contracts/local-core-contracts.test.ts`、`tests/integration/local-core-acp-progress.test.ts` 等），缺对"策略/守卫/超时"的覆盖——因为本地本无这些概念。

---

## 3. 可借鉴/可落地的改进建议

> 前提：AgentDock 不自建完整推理循环为务实取向；建议聚焦"在编排层补上决策与防御能力"，而非照搬整套 tool runtime。

### P0 — 权限决策从"透传"升为"会话策略引擎"
- **具体做法**：在 ACL/Local AI Core 层加 `approval` 服务抽象，支持 `ask | never | allow` 三态会话策略（借鉴 `user-approval`），并把每笔请求记成 `approval/asked`+`approval/decided` 成对审计事件；`bypassPermissions` 收敛为显式 `allow` 策略而不是无条件 allow-all；权限选项解析用白名单制（现 `turn-coordinator.ts:192-196` 直接 `allow all` 优先）。
- **改动范围**：`acp/`、`acp/store`（审计表）、`security/`、`kernel/event-bus.ts`（新事件类型）。
- **工作量**：M。**风险**：中——策略语义改动会影响现网默认行为，需 A/B 与缺省 `locale` 兼容。

### P0 — 超时从"启发式 interrupt"升级为"业务死线 + 可区分结果"
- **具体做法**：仿 `timeout-policy`，把 `BACKGROUND_AGENT_EXECUTION_TIMEOUT_MS` 变成"每个 run 的 deadline"，到点后既发 `session/cancel` 又在 run/task 状态上落一个结构化 `TIMEOUT` 原因（现 `interruptRun` 只置 `interrupted`/`cancelled`，无法区分超时/用户中断）。
- **改动范围**：`scheduler/run-polling.ts`、`acp/local-core-acp-session-coordinator.ts`、`acp/store/agent-task-store.ts`（状态字面量）。
- **工作量**：S-M。**风险**：低——仅为状态/语义增强，不改执行机制。

### P1 — 增加最小"模型可见自我管理工具"：todo + jobs
- **具体做法**：利用 Local AI Core 已能观测外部 agent 的 `tool_call/tool_call_update` 事实（`turn-coordinator.ts`），在 ACL 层新增两个**宿主注入**的模型工具 `todo_write/todo_list` 与 `job_status/job_cancel`，把状态落在 `acp/store`，让运行中的 run 被 agent 自查自改（对应 DSH `tool-todo`、`tool-jobs`）。
- **改动范围**：新 `execution/tools/` 目录 + ACP 工具注入（session/request 前预注入 schema）；涉及 ACP 协商工具清单的能力，需对齐外部 agent 支持。
- **工作量**：L。**风险**：高——外部 agent 工具注入点不统一，opencode/claudecode/cursor 各自 ACP 差异需各适配器；属能力增强非缺陷修复，建议按 agent 逐个落地。

### P1 — 权限分类联动沙箱写守卫 + 凭据 scrub
- **具体做法**：把 `command-risk.ts` 的 scope 打标与 OpenSandbox 卷/文件守卫联通（写入前经 `workspace-write` scope 判定）；对拉起的 agent 进程 env 做 `*KEY*/*SECRET*/*TOKEN*/*PASSWORD*` scrub（DSH `defensive-patterns.md:29`）；落一份 `docs/defensive-patterns.zh.md` 化为 AgentDock 自查清单。
- **改动范围**：`security/`、`sandbox/`、`execution/agent-execution-backend.ts`。
- **工作量**：M。**风险**：低-中——scrub 是纯防御增强；写守卫涉及取消逻辑，需回归。

### P2 — 撤销/回滚能力 + 防御文档化
- **具体做法**：补 `approval/cancelled`→把已发命令做幂等回滚指令（对 `git.modify` 等 scope）的钩子位；把 `interruptRun` 的各分支机时状态能重入（现 `markRunInterrupted` 幂等性较好，可参考扩展正交结果）。风险自评表可并入 AGENTS/CLAUDE 文档。
- **改动范围**：`acp/`、`scheduler/`、文档。
- **工作量**：S。**风险**：低。

### 优先级汇总表

| 优先级 | 建议 | 改动范围 | 工作量 | 风险 | 借鉴来源 |
|---|---|---|---|---|---|
| P0 | 会话审批策略引擎（ask/never/allow + 审计对） | acp/、store、kernel | M | 中 | `user-approval` |
| P0 | 业务死线 + 可区分超时结果 | scheduler/、acp/、store | S-M | 低 | `timeout-policy` |
| P1 | todo/jobs 宿主注入模型工具 | 新 execution/tools/ + 各 agent 适配 | L | 高 | `tool-todo`/`tool-jobs` |
| P1 | scope 联动沙箱写守卫 + env scrub | security/、sandbox/、execution | M | 低-中 | `capability-seams`、`defensive-patterns` |
| P2 | 撤销钩子 + 防御文档化 | acp/、scheduler/、docs | S | 低 | `defensive-patterns` |

**一句话结论**：DSH 是"自研全套运行循环 + 瀑布事件 + 审批/守卫/超时",AgentDock 是"ACP 编排 + 观测投影 + 权限透传 + 沙箱拉起 + cron 调度"。最短路径不是复制 DSH 的工具运行时，而是**在编排层补上审批策略引擎、可区分超时、env/写守卫防御、以及 agent 自我管理的最小 todo/jobs 工具**——这正是 AgentDock 当前与 DSH 差距最大、性价比最高的四项。
