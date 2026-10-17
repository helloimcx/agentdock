# 管家 LAC 委派与持续跟踪实施计划

- 状态：Core/LAC 功能、身份凭证、取消修复、owner 会话恢复、架构文档和 Butler renderer 已实现；完整原型已于 2026-10-17 获用户确认；自动化验证与独立审查通过，真实 Ubuntu/飞书/fnOS 闭环仍待执行。
- 日期：2026-10-17（Asia/Shanghai）。
- 基线：`46a60fb`；分支 `codex/2026-10-17-butler-lac-orchestration`。
- Architecture Impact: Required：改变跨工作区调用、回报协议、任务状态与工具授权边界。
- [完整规格](../specs/2026-10-17-butler-lac-orchestration.md) · [当前交互流程图](../architecture/butler-orchestration.html) · [图源](../architecture/butler-orchestration.workflow.json) · [变更记录](../architecture/changes/2026-10-17-butler-lac-orchestration.md)。

## 当前交付状态

| 范围 | 状态 | 证据 / 剩余工作 |
| --- | --- | --- |
| Core 内部委派、运行范围 worker 报告、追加委派与依赖 | 已实现 | Source 与 integration/CLI/remote-dispatch tests；真实 Channel 短任务 smoke 尚未执行 |
| 持久 checkpoint、只读跟踪计划、预算/期限/租约、重启恢复、报告验收 | 已实现 | 使用 fnOS 下载器替身覆盖创建一次、多轮读取和恢复；真实 fnOS 任务未执行 |
| 可信 worker 权限边界与 owner 会话通知 | 已实现 | Core 签发并校验 thread/run capability；工作区 Agent 使用受限 CLI；新任务按 Lark 用户 / 本地 workspace principal 恢复，异步解析后重验用户身份与 Butler 配置快照；旧任务只有仍绑定渠道身份时才迁移，来源不明的旧任务 fail closed；单任务通知迁移与迟到发送 CAS 有回归覆盖 |
| 完整 AgentDock 原型 | 已确认并实现（2026-10-17） | [`design/index.html`](../../design/index.html)；对应入口为 [`src/pages/Butler`](../../src/pages/Butler/index.tsx)，更新 i18n |
| Architecture-as-Code 与自动化门禁 | 已验证 | 当前 L1/L2 图源与稳定 HTML 已更新；架构检查 9 项通过，类型检查、静态门禁、构建、全量测试、BDD 与覆盖率通过；独立审查无遗留发现 |
| Ubuntu、飞书及真实 fnOS 下载闭环 | 未执行 | 需在目标环境验证，不以替身测试代替生产事实 |

## 方案结论

保留 Channel Bot 的产品身份，把机器人之间的协调改为 Core 内部委派。沿用 Butler 账本与 WorkspaceRouter，补上结构化结果、独立业务状态、持久检查及静默决策。lac 是提交和查询接口，不是必须一直存活的后台进程。

三个独立方案均支持复用既有核心结构。集中裁决的关键选择是：

1. 保留 Bot 名单作为授权与用户认知对象；显式解析运行绑定，不开放任意 workspace 调用。
2. 使用现有 Butler reconcile 扫描持久到期项，不把每个目标变成用户 cron，也不重建 scheduler。
3. 使用显式 report 与准确 operation/run 关联；普通 final 文本只供复核。最终报告在 run 终结后生效，checkpoint 可提前保存外部引用。
4. 管家登记检查计划后，普通 waiting_external 回报确定性续排，减少模型调用；首轮和重要事件唤醒管家。缺少计划时保留决策义务，不执行 worker 自带指令。
5. 普通目标允许管家基于证据验收，用户验收成为显式策略。业务验收不替代执行权限审批。
6. 增加明确内部投递模式与固定原会话通知能力，避免“每轮模型 final 自动发群”的副作用。

## 实施顺序

### P1：可靠内部委派与结果交还 — 实现完成，真实 Channel 验证未执行

先以最小失败测试证明：单次运行成功不等于用户任务完成；然后实现最小内部闭环。

1. 定义版本化 transport、业务状态、执行绑定、结构化 report、checkpoint、manager/worker 调用者上下文及错误契约。
2. 扩展现有 Butler 表和迁移读取：保留 v1 数据，记录 v2 Operation/报告/状态版本与 owner origin。Task、Delegation 与 Operation 的 ID 语义分别校验。
3. 从 dispatcher 抽出内部 worker 提交器，复用 createThread/sendThreadMessage、submission requestId 去重及准确 runId。保留旧 Channel transport 为兼容实现；不先建设通用 transport 插件框架。
4. 增加 Bot 执行绑定解析器：区分配置身份、实例映射、运行配置与在线状态；明确工作区默认与显式设置，不使用任意聊天偏好。派发与恢复时核验重要身份。
5. Agent 工具调用引入服务端可信运行上下文；区分 manager 与 worker 权限。按角色扩展 Mesh lac allowlist 与 host dispatcher，报告不能自行指定其他任务。
6. 新增 report、内部管家决策事件与显式 notify；扩展 delegate 给现有 Task 追加委派，新增 accept 验收子目标。manager 内部唤醒不默认 Channel 投递。权限请求仍按准确 approval/run 持久交回原用户会话，用户决定经既有权限生命周期恢复原 worker；管家不能代批或复用过期授权。
7. 更新内置 butler skill/消息策略及 worker 指令。修正当前提示中不存在的 `lac butler workspaces`，统一使用实际 bots 命令，说明新增接口均以真实实现 help 为准。
8. 用真实 Channel 指令委派一个只读短任务，验证目标工作区/Agent/provider、准确报告与原会话回送；此阶段不能宣称长任务已交付。

### P2：持续跟踪、恢复与真正完成 — 实现完成，生产下载闭环未执行

1. 增加 watch、只读 check 操作、持久 `nextCheckAt`、原子领取/租约、操作序号及默认间隔/退避/预算/截止策略。
2. 实现 waiting_external 与待管家决策的原子登记，确保管家没有在一轮中安排检查时仍留下恢复义务；忙碌 owner 的事件合批且不丢。
3. 回报结算只影响其准确 Operation；正常等待续排，完成候选进入 reviewing，必须 manager accept 才释放依赖，最终 complete 才关闭 Task。
4. 对读取型 check 做有限恢复；submit 结果不明时先核对外部引用，不自动重放非幂等副作用。恢复也检查现有 submission，拒绝失效领取的写回。
5. 区分停止跟踪和取消外部工作；处理 cancel 与 report/验收竞争。external cancel 先终止活动 worker，再通过独立 cancel Operation 请求实际系统取消并验证结果。
6. owner 会话删除时保留目标，停止追踪并等待 `orphans` / `reattach` 管理命令；按 Lark workspace/实例/用户或本地 workspace principal 隔离恢复范围。新任务持久记录 principal，旧任务只从当前平台绑定回填 Lark 身份，来源不明的旧数据保持 fail closed；通知按 Task 关联，重新关联时只迁移该目标的待发通知并保持终态。
7. 事务登记最终业务结论与用户通知，复用 delivery outbox 的领取、确认及不确定结果语义；内部唤醒与用户通知分开去重。
8. 用可控下载器替身实现“创建一次 → 12% → 80% → 完成且文件存在”，在派发前、提交后、checkpoint 后、回报后、通知前分别注入重启/中断。测试必须观察外部创建次数，不能只检查内部状态字符串。

### P3：配置迁移、完整产品验证与正式交付 — Butler renderer 已实现，真实验证与发布未开始

1. 更新完整 AgentDock `design/index.html` 原型：配置仍优先，展示管家 Bot、多受管 Bot、绑定工作区及执行配置、跟踪策略；core 模式隐藏共享群必填项，历史 channel 信息可查看。
2. 已按确认原型实现 renderer/i18n：配置支持 channel/core 委派、受管工作区 Agent、持续跟踪策略；任务详情展示外部引用、下次检查、阻塞原因与准确执行入口。完整应用原型继续作为 UI 对照基准。
3. 对旧 profile 提供明确启用 core 模式的迁移；旧活跃任务固定旧路径，不自动重发。对不具备可信工具上下文的 runtime 显示不支持，不虚报可用。
4. 已按实现代码更新当前架构事实、Butler/L1-L2 图源、稳定 HTML、overview 与 README New 区；架构检查 9 项通过。
5. 完成独立代码审查；随后在 Ubuntu 环境与 fnOS 执行真实多轮测试。以可控的小型测试下载验证“创建后保持未完成、重启后仍追问、真正完成后通知”。
6. 用户已确认实现。完成门禁与真实验证后，再按项目流程提交 PR、检查 CI/review，并依用户的发布授权合并部署。

P1/P2 与 renderer 闭环不等同于已在真实环境验证下载完成；真实 Ubuntu/飞书/fnOS 验证和正式发布仍是独立交付项。

## 主要模块

| 模块 | 计划变更 |
| --- | --- |
| `packages/contracts/src/butler.ts` | v2 任务/委派/操作、绑定、报告、watch 与验收契约 |
| `services/local-ai-core/src/acp/store/butler-store.ts` | 兼容读取、报告/检查点、可索引到期项、领取、状态版本和通知事务 |
| `services/local-ai-core/src/butler/` | 内部提交器、业务观察、watch、报告结算、管家决策与通知；拆小文件避免扩张现有 dispatcher |
| `services/local-ai-core/src/runtime/channel-service.ts` 与 router | Bot 配置身份与运行绑定解析、内部投递语义、准确 Agent/provider 选择 |
| `services/local-ai-core/src/runtime/handlers/butler-handler.ts`、`runtime/butler-routes.ts` | 管理 API 与运行范围 Agent 调用校验，新增命令对应路由 |
| `services/local-ai-core/src/cli/butler-cli-handlers.ts` 与 `packages/core-sdk/src/butler.ts` | 新接口、稳定请求标识、help、异步结果与类型 |
| `services/local-ai-core/src/execution/remote-mesh/` | 最小 lac 命令授权、可信上下文传递及无 admin token 继承 |
| `services/local-ai-core/src/thread/butler-message-policy.ts`、`skills/builtin/butler/SKILL.md` | 正确命令、三层语义、持续跟踪、静默与证据验收策略 |
| `design/`、`src/pages/Butler/`、`src/i18n/` | 已确认并实现管家配置、委派和长任务跟踪视图 |

## 文档影响

`Docs Impact: Required`。本改动扩展 Butler 的公共契约、Core/LAC 调用边界、持久状态和消息流，因此已同步更新 `docs/architecture.md`、L1/L2 Architecture-as-Code、Butler 架构事实、全景 overview、README New 区、Spec、Plan 与语义变更记录。`node scripts/lint-architecture.mjs` 对 9 个架构规范完成 Showcase 校验且 0 项失败。

## 数据与 API 约束

- 在现有表基础上迁移，不另造第二份任务状态。到期时间、状态版本及领取字段应可直接索引，避免长期全量解析 JSON。
- 管理 HTTP 请求维持现有鉴权；Agent 调用必须带可信运行范围授权，不相信请求体内的 ownerThreadId。
- 所有派发/检查/回报/验收/通知操作有幂等键。序号与 CAS 防旧操作改新结论；run 状态仍由 submission/runtime 层所有。
- 工具授权只约束本编排 API 与 host dispatcher；不能宣称本机拥有 Shell 的 Agent 因此被整体沙箱化。
- Channel 成功连通、Agent 能启动、业务已完成、用户通知已投递，是四个独立验证结论。

## 测试与 QA 顺序

1. 合同与状态机单测：waiting_external、checkpoint/最终报告结算、证据不足、验收版本、依赖释放、cancel 竞争及默认检查策略。
2. Store/服务集成：新旧数据、事务恢复、重复请求、失效租约、迟到报告、同 Bot 多目标、忙碌 owner 合批、缺少 watch 的恢复义务。
3. CLI/HTTP/SDK：新增接口、身份验证、越权、scope 伪造、结构化输入、准确 ID 域及错误信息。
4. Mesh：普通 Shell 仍远端、受控 lac 主机派发、worker 仅报告自己的操作、管理员 token 未进入子环境；不支持适配器失败关闭。
5. Channel/ACP：内部 worker/manager 运行不被 bridge 自动发到群；仅显式 notify 返回原会话。内部 worker 权限请求经原会话交给用户后准确续跑，并验证拒绝、过期、重复回复和重启后失效场景。
6. BDD：用户交代下载、worker 创建、持久等待、多轮检查、Core 重启、最终验收与通知；增加停滞、离线及外部取消分支。
7. 原型一致性检查与真实页面操作。按仓库要求执行 `pnpm verify`、`git diff --check`；它们在实现完成时执行，不拿规划文档代替测试通过证据。
8. 真实 CLI 测量提交响应、事件交还、到期偏差和无变化检查的模型调用次数。CLI 必须快速返回；目标运行忙碌造成的延迟单独记录，不能混为派发响应时间。
9. 生产 fnOS 测试记录用户原消息、Task/Delegation/Operation/run 与外部下载 ID、创建次数、实际查询状态、文件证据、重启前后检查时间、原会话最终回复。

## 验证记录

本轮验证结果：

- `[PASS]` `tsc -p tsconfig.json --noEmit`、BDD TypeScript 检查、Electron/Core TypeScript 构建。
- `[PASS]` `eslint . --max-warnings 108`（正好 108 条既有复杂度告警；Butler 改动新增 0 条）、循环依赖、重复代码、死代码阈值 172、文件大小、函数长度门禁。
- `[PASS]` renderer production build（因 worktree 的 `node_modules` 复用主工作区链接，使用 `/private/tmp` 临时 Vite 配置把 Butler SDK 子路径明确指向本 worktree；未改依赖或项目构建配置）。
- `[PASS]` Electron/Core production build；完整 Node 测试 1103 项通过；BDD 80/80 场景；覆盖率 75.52% lines、75.52% statements、82.19% functions、73.67% branches，均高于仓库门槛。
- `[PASS]` `git diff --check`。
- `[PASS]` `node scripts/lint-architecture.mjs`：9 个正式架构规范通过，0 失败；交互式 as-built 流程图在 [`butler-orchestration.html`](../architecture/butler-orchestration.html)。独立审查确认身份恢复、通知竞态与创建期间绑定/配置变化均有保护。
- `[PASS]` 原型页面人工确认：用户于 2026-10-17 确认 `design/index.html`；Butler 配置与任务跟踪 renderer 已按原型实现，并运行 prototype checklist。
- `[BLOCKED]` Ubuntu/飞书/fnOS 真实闭环与生产时延测量：本轮未连接或操作生产环境。下载器替身覆盖创建一次、checkpoint、重复只读检查、Core 重启恢复和验收，不代表生产证据。

不得把下载器替身测试写成 Ubuntu/fnOS 真实闭环，也不得把 schema/showcase 检查写成完整人工视觉审阅。当前没有提交、推送、PR 或生产变更。
