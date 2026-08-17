# AgentDock × DeepSeek Harness：对比与借鉴报告

> 日期：2026-08-14。DSH 于 2026-08-13 发布（`deepseek-ai/deepseek-harness`，MIT，发布次日 9 万+ star），当前无 tag/release，以下分析基于 **master 源码**（`/tmp/dsh-src/deepseek-harness-master`）。
> 说明：本报告为研究性分析，不涉及代码改动。配套分领域报告：
> - [插件体系架构](./dsh-vs-agentdock-plugin-system.md)
> - [会话/事件数据层](./dsh-vs-agentdock-session-data.md)
> - [Agent 运行循环 / 工具执行管线 / 权限与安全](./dsh-vs-agentdock-loop-pipeline-security.md)
> - [前端 Web UI 架构](./dsh-vs-agentdock-frontend-architecture.md)
> - [工程实践与质量体系](./dsh-vs-agentdock-engineering.md)

## 一、为什么值得对标

DeepSeek Harness（`dsh`）是 DeepSeek AI 2026-08-13 开源的 agent harness，口号 **"Everything is a Plugin"**，核心是 **Cordis** 插件框架（可逆副作用、服务注入、类型化事件）。本项目（AgentDock）与 DSH 是同一赛道相邻的产品形态：都是「本地/桌面 + 本地 Agent 运行时 + Web UI + 通道/调度 + 知识库」的 agent 工作台。DSH 代表了开源社区对「agent 运行时到底该怎么设计」的最新答案，其设计决策对本项目有直接参考价值。

## 二、DSH 关键设计一览（一手源码依据）

| 设计 | 要点 | 源码/文档位置 |
|---|---|---|
| 插件即一切 | 模型适配器、工具注册表、会话日志、agent 主循环全部是插件，无特权核心，配置可替换 | `docs/architecture.md`、`docs/cordis-primer.md` |
| 可逆副作用 + fiber 状态机 | `ctx.effect/on/provide` 每个注册返回 disposer，卸载逆序回滚；插件依赖驱动装载，PENDING→ACTIVE→DISPOSED | `docs/cordis-api/fiber.md` |
| Profile/Bundle 分层组合 | 运行时 = bundle 分层 + 用户 patch 覆盖，`--dump-config` 可查看/覆盖完整装配树 | `packages/boot/app-boot`、`packages/bundle/` |
| 会话日志（append-only） | SessionEvent 追加日志是唯一事实源；**模型可见 ⟺ 已入日志**；fork/resume/replay/UI 全由日志派生 | `docs/subsystems/session.md`、`packages/core/session/` |
| Turn/Step 循环 + 瀑布事件 | `agent/pre-step`、`llm/stream`、`tools/pre-execute/execute/post-execute` 等瀑布可拦截/改写（洋葱 next 短路） | `docs/agent-lifecycle.md`、`docs/tool-execution-pipeline.md` |
| Capability Seam 三件套 | 每个能力 = Service Definition + Service Provider + Consumer；换 Provider 换整个产品行为 | `docs/capability-seams.md` |
| 模型可见自我管理工具族 | goal/plan/todo/workflow/subagent/jobs/schedule 全套普通工具，agent 可自查自改 | `packages/goal/`、`packages/plan/`、`packages/jobs/` 等 |
| 工程体系 | 145+ 脚本、7 套测试形态、逐文件 100% 覆盖门禁、文档 i18n 管线、自动生成目录、lefthook、依赖合规披露、postmortem 文化 | 见 `dsh-vs-agentdock-engineering.md` |

## 三、分领域对比结论（详文见各分报告）

### 1. 插件体系 — 静态一次性注册 vs 可逆副作用插件树

DSH 以 Cordis 为基座，插件拥有：可逆副作用注册（卸载自动回滚）、依赖驱动装载状态机、按 key 服务注入（`inject`）、五种事件派发（含 waterfall 拦截）、按 agent 隔离作用域（scope/isolate）、配置分层组合与运行时热装载。AgentDock 的 kernel 是**启动时一次性全局静态注册**：registry 只增不改、`dependsOn` 仅拓扑排序、event-bus 只有 emit 无拦截中间值、`configSchema` 只声明不校验、无启动审计（插件没起来无人知）。已有亮点：`channel/shared/plugin.ts` 自发的 dispose 收尾可作雏形。

### 2. 会话数据层 — 整条消息快照 vs 事件日志为唯一事实源

DSH 的会话是 append-only 事件日志：模型历史由 `deriveMessages()` 从日志派生（不另存）、持久化 seam（JSONL/SQLite 双后端 + 崩溃修复）、fork/resume/replay、SQLite FTS 全文检索、compaction 压缩带血缘。AgentDock 是 **SQLite 整条消息 + ACP 原生续聊**：`messages` 表存整条 final/progress 快照（无 chunk 级日志）、续聊靠 agent 的 `session/load`（依赖 agent 原生支持）、**无 fork、无压缩、无消息全文/语义检索**（`knowledge-api` 是知识库 RAG，与会话消息无关）。

### 3. 运行循环/工具/权限 — 自研集成运行时 vs ACP 编排器（根本差异）

DSH 是**单一集成 agent 运行时**：进程内拥有完整 agent-loop、工具瀑布管线、审批 seam（ask/never fail-closed + 成对审计日志）、工具超时强制、沙箱写守卫、凭据 scrub、以及 goal/plan/todo/workflow/subagent/jobs 全套模型可见工具。AgentDock 的 Local AI Core 是**元控制面/编排器**：用 ACP 拉起外部 agent 并转播其输出，本地无工具注册与执行管线。因此建议不是照搬整套工具运行时，而是在**编排层补决策与防御能力**：审批策略引擎、可区分超时、env scrub、最小 todo/jobs 工具。

### 4. 前端 — 事件日志投影不可变快照 vs 事件即通知写入内存可变状态

**根本差距在认知**：DSH 把事件当**持久日志投影出不可变快照**（mux/host WS 双流 → seq 去重 → Node 装配 → uSES 快照，引用纪律保证 token 流不重渲染无关行），聊天业务行是开放 registry 贡献的 keyed renderer；AgentDock 把事件当**即时通知写入内存可变状态**（useState 原地改 preview 消息、历史全量 `getThread` 无分页、`chat-event-gate` 全内存指纹去重无持久游标）。其余：扩展点半静态（有 API 无开放动态入口）、样式 Tailwind 无语义 token 层、i18n 手写 JSON 无键集校验。另外报告发现 **CLAUDE.md 已过期**：本快照无 `src/api/` 与 `src/store/auth.ts`（API 已迁到 `@cc/core-sdk/*`），且只有 HashRouter。

### 5. 工程实践 — 机制化、机器可校验 vs 工具齐备但无门禁

DSH 把质量与文档做成**生成 + 门禁 + 合规**：文档 i18n 三件套（blob 哈希校验）、module-graph/config-catalog 自动生成 + CI 新鲜度检查、7 套测试形态（unit/逐文件 100% 覆盖/真实 API e2e 自跳/ACP 快照回放/浏览器快照/perf/stress）、lefthook git hooks、THIRD_PARTY_NOTICES 依赖合规、包 README 强制 Model Experience + Known Limitations。AgentDock 已有 lint 六件套 + c8 + BDD + smoke，但 **CI 只有一个 `test` job，lint 全为 warn 不进 CI**——质量信号无人把关，这是首个值得合入的差距。

## 四、综合优先级路线图

> 汇总五份分报告的 P0/P1/P2 建议（去重合并）。工作量 S/M/L，风险低/中/高。

### P0 — 立即可做（低成本、独立落地、收益最大）

| # | 建议 | 来源 | 工作量/风险 |
|---|---|---|---|
| 1 | **CI 门禁链**：ci.yml 扩为 lint/circular/duplicate/dead-code/typecheck/coverage 多 job（复用既有 scripts），coverage 加阈值 ✅ **已完成（2026-08-15）**：`.github/workflows/ci.yml` 三 job（lint/test/coverage）、`pnpm lint:gates` 聚合、新增 `knip.json`、`.c8rc.json` check-coverage（lines/statements 68、functions 72、branches 66）；配套拆分 `automation-service.ts`→`automation-event-utils.ts`（998 行）、提取 security-store/Knowledge 重复代码 | 工程实践 | M / 低 |
| 2 | **会话审批策略引擎**：本地 `ask/never/allow` 三态策略 + `approval/asked`+`decided` 成对审计事件，`bypassPermissions` 收敛为显式 allow | 循环/安全 | M / 中 |
| 3 | **可区分超时结果**：业务死线取代启发式 interrupt，run/task 状态落结构化 `TIMEOUT` 原因 | 循环/安全 | S-M / 低 |
| 4 | **插件配置校验 + 启动审计**：configSchema 编译成校验器，启动后断言 enabled 插件已 init | 插件体系 | S / 低 |
| 5 | **消息 FTS 全文检索**：`messages_fts` 虚拟表 + `/search` 与侧栏搜索消息内容 | 会话数据 | S / 低 |
| 6 | **事件游标 + 幂等上收**：chat-event-gate 加 seq 游标，下沉到 core-sdk 复用 | 前端 | M / 低 |
| 7 | **可逆副作用注册**（ctx.effect 语义 + unregister + 逆序 dispose） | 插件体系 | M / 中 |

### P1 — 中期（M 工作量，多为结构性改善）

| # | 建议 | 来源 | 工作量/风险 |
|---|---|---|---|
| 8 | lefthook git hooks（pre-commit/pre-push） | 工程实践 | S / 中 |
| 9 | event-bus 加 waterfall/serial 拦截点（为策略/审计插拔） | 插件体系 | M / 中 |
| 10 | 服务注入 inject（按 provides 注册 ctx key，dependsOn 升级） | 插件体系 | L / 高 |
| 11 | 会话级不可变快照 + 增量分页（先小步：tail 窗口分页） | 前端 | L / 中 |
| 12 | 打开动态注册面 + 聊天 keyed 渲染槽（`chat.node.<kind>`） | 前端 | M / 低 |
| 13 | 样式语义 token 层、i18n 键集校验、补流式/历史 UI 测试 | 前端 | S-M / 低 |
| 14 | todo/jobs 宿主注入模型工具（按 agent 逐个落地） | 循环/安全 | L / 高 |
| 15 | scope 联动沙箱写守卫 + env 凭据 scrub（`*KEY*/*SECRET*/*TOKEN*`） | 循环/安全 | M / 低-中 |
| 16 | 轻量 append-only 事件日志（chunk 级，fork/compaction 地基） | 会话数据 | M / 中 |
| 17 | 续聊漏斗：对 ACP `supportsLoad=false` 的 agent 做服务端回放 | 会话数据 | M / 中 |
| 18 | README 规范门禁 + 关键路径快照（ACP JSONL 回放） | 工程实践 | S-M / 中 |

### P2 — 远期（依赖 P0/P1 的地基）

| # | 建议 | 来源 | 工作量/风险 |
|---|---|---|---|
| 19 | 配置分层组合（profile/patch）、按 agent 隔离作用域、运行时热装载 | 插件体系 | L / 高 |
| 20 | 上下文压缩（compaction，带血缘）、fork/分支、血缘与语义检索 | 会话数据 | L / 高 |
| 21 | 实时指标投影（token/TTFT）、会话常驻吃帧、补齐双路由 | 前端 | S-L / 中 |
| 22 | 撤销/回滚钩子、防御模式文档化（`docs/defensive-patterns.md` 化） | 循环/安全 | S / 低 |
| 23 | 依赖合规 THIRD_PARTY_NOTICES、BENCHMARK.md、文档 i18n 管线（仅核心页试点） | 工程实践 | S-L / 低-高 |

### 依赖次序要点

- **P0-7（可逆注册）是插件体系一切后续（注入/热装载/配置组合）的前提**；P0-4 与之独立可先行。
- **P1-16（事件日志）是会话侧 fork/compaction/血缘的分水岭**；P0-5（FTS）不依赖它可先行。
- 前端 P0-6（事件游标）先于 P0/P1-11（快照分页），后者先小步做分页。
- 工程侧 P0-1（CI 门禁）不依赖任何代码重构，**建议作为第一个合入项**。

## 五、结语

三个根本认知差异贯穿全部五个领域：

1. **事件是日志还是通知**（数据层 + 前端）：DSH 把一切事件当**持久日志**，UI 与模型历史都是它的**投影**；AgentDock 把事件当**即时通知**写入可变状态。这是"数据层分水岭"与"前端快照改造"两条主线的共同哲学，也是价值最大的长期方向。
2. **自研运行时还是编排器**（循环/插件）：DSH 自研全套运行循环并"一切皆插件"；AgentDock 走 ACP 编排外部 agent 的务实路线。**不应照搬 DSH 的整套工具运行时**，而应在编排层补上审批策略、可区分超时、写守卫防御与最小自我管理工具——差距最大、性价比最高的四项。
3. **质量靠自觉还是靠门禁**（工程实践）：DSH 把质量与文档**机制化、机器可校验**；AgentDock 工具齐备但 lint 不进 CI。先把既有 lint/测试接入 CI，再逐步引入 hooks、快照与合规。

> 附：调研过程中发现 AgentDock 的 `CLAUDE.md` 描述已过期（无 `src/api/`、`src/store/auth.ts`，仅 HashRouter），建议顺带更新文档，避免误导后续 agent。
