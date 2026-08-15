# DSH 与 AgentDock 插件/扩展体系架构对比

> 对比基于 DSH 最新 master（`/tmp/dsh-src/deepseek-harness-master`）与 AgentDock 本地源码（`/Users/momo/code/agentdock`）。以下结论均来自实际读取的文件（后附路径），未编造。

## 一、DSH 插件体系亮点（AgentDock 没有的机制）

DSH 把 vendored **Cordis** 作为基座：整个产品（模型适配、工具注册表、会话日志、agent 循环）都是插件，无特权核心，全部可从配置替换。核心机制如下：

| 亮点机制 | 关键语义 | 出处 |
|---|---|---|
| **可逆副作用注册 `ctx.effect`/`ctx.on`/`ctx.provide`** | 每个注册都返回 disposer，插件卸载时逆序自动回收（含异步 disposer）；`ctx.tools.register` 之类也会挂到调用插件 fiber 上自动卸载 | `docs/cordis-primer.md` L13/44；`docs/cordis-api/fiber.md` L8-26；教程 `02-lifecycle-and-effects.md` |
| **fiber 状态机 + 依赖驱动装载** | PENDING→LOADING→ACTIVE→UNLOADING→DISPOSED；依赖未满足即 PENDING 等待；依赖消失/被热替换时依赖者连带卸载重启 | 教程 `02` L68-82；`03-services.md` L74-78；`docs/cordis-api/fiber.md` |
| **服务注入 `inject`（按 key 不按实现）** | 插件声明 `inject: ['tools']` 才激活；`Service` 子类注册 `ctx.<key>`，TS 声明合并保证类型；provider 在配置里可整块替换 | 教程 `03-services.md`；`docs/cordis-api/registry.md` |
| **事件四/五种派发模式（`emit`/`parallel`/`serial`/`bail`/`waterfall`）** | `waterfall` 是洋葱中间件：监听器收 `(...args, next)`，调 `next()` 委托、不调即短路，用于策略/拦截；TS 声明合并 + `@mode` 标注做强契约 | `docs/cordis-api/events.md`；`cordis-primer.md` L26-34；`AGENTS.md` L106 |
| **scope/isolate 按 agent 隔离注册** | `ctx.isolate(name,label)` 隔离某服务作用域；`dsh-scope` 提供 opaque `ScopeKey`、`scopeTarget` 路由、作用域层级（子看祖先、事件自祖先向上升）；每 agent 一线程 `createScope(agentCtx)`；agent preset 以 standing scope 让多会话共享一份注册 | `docs/cordis-api/context.md` L39-66；`packages/core/scope/README.md`；`docs/subsystems/scope.md`；`packages/preset/agent-presets/README.md` |
| **profile/bundle/patch 配置分层组合** | 一个运行实例是启动时按序叠层的插件树：bundle → profile 的 `cordis.patch.yml` → home 层 → `--patch` overlay；patch 按 `id` 定位行、整段替换 config 或 insert；`dsh --profile web --dump-config` 导出可看可改 | `docs/architecture.md` L16-37；`packages/boot/app-boot/README.md`(Profiles)；`AGENTS.md` L34 |
| **运行时热装载（HMR）** | `ctx.plugin(child)` 嵌套装载；`cordis-plugin-hmr` 监听文件按 fiber 卸载重载；改 `cordis.yml` 按 `id` diff 只变改动的行；`fiber.restart()/update()` 走 `internal/update` waterfall 可 veto | 教程 `06-composition-and-hmr.md`；`fiber.md` L230-273 |
| **agent 自修改插件** | `dsh-tool-cordis` 暴露 `cordis_inspect/define/run/stop/undefine` 五个模型可调用工具，在 live 进程里动态挂载/停止动态包（`ctx.dynamic` 沙箱），会话内自增改运行时 | `packages/extensions/tool-cordis/README.md`；`AGENTS.md` L50 |
| **配置校验 + 表达式** | 插件导出 `Config` 同时是类型与 Standard-Schema 校验器，启动前校验失败即 FAILED 不半启动；loader 支持 `!!js` 在 config/`disabled` 里算表达式（按环境选插件） | 教程 `05-config.md`；`cordis-primer.md` L38 |

## 二、AgentDock 现状与差距（逐条对照）

AgentDock 插件体系集中在 `packages/plugin-sdk/src/`（契约）与 `services/local-ai-core/src/kernel/`（运行时），内置插件为 `plugins/builtin/*`。现状对照：

- **静态注册、一次性装载、不可逆**：`LocalCorePluginRegistry.register` 仅 `Map.set`，无 unregister；`capability-registry` 每个 kind 一个 `Map` 只增不改；`lifecycle-manager.init/start/stopAll` 全量跑一遍。→ 无 `ctx.effect`/disposer 语义，无法按插件卸载回滚副作用（`plugin-registry.ts`、`capability-registry.ts`）。
- **依赖是显式 topo 排级，不是服务注入**：`dependsOn` 仅用于 `list()` 里 DFS 拓扑排序，无"服务 key 激活/等待"概念，无 PENDING 状态；插件拿不到"依赖已满足"的保证，`createRuntime` 直接同步从 `bootstrapLocalCoreRuntime` 手工解包各类 runtime（`channelRuntime`、`knowledgeProvider`…），消费方仍是 `import 具体类` 而非通过 ctx key。`bootstrap.ts` L183-319、`plugin-registry.ts`。
- **无事件拦截中间件**：`LocalCoreEventBus` 只有 `emit`（同步广播、忽略返回值）+ `on`，无 waterfall/serial/bail；无法做 `agent/pre-step`、`tools/pre-execute` 这类策略/拦截扩展点（`event-bus.ts`）。
- **无按 agent/workspace 隔离作用域**：所有能力注册是进程级全局，无 `ScopeKey`/`scopeTarget`，无法做"某 agent 换一套工具/通道"（`bootstrap.ts` 全量全局注册）。
- **无配置文件驱动插件组合**：插件集硬编码在 `catalog.ts` + `bootstrapLocalCoreRuntime`；`disabledPluginIds` 只按 `state.getSettings().plugins` 在启动时一次性算；无 profile/bundle/patch 分层、无 `!!js` 表达式。`bootstrap.ts` L204-214、`catalog.ts`。
- **无运行时热装载**：grep `services/local-ai-core/src/runtime/` 无任何插件 register/get/enable 调用——装载完全发生在 `bootstrapLocalCoreRuntime` 一次性完成；`restartService`/`refreshBindings` 只重连通道网关，不重新装载插件（`local-core-controller.ts` L155）。
- **`configSchema` 只声明不校验**：`runtime-types.ts` 有 `PluginConfigSchema`/`PluginConfigFieldSchema`，但 kernel 无任何 schema 校验器接入；`PluginContext.config.get()` 未校验类型（`runtime-types.ts` L138-158）。
- **`createRuntime` 强制同步**：bootstrap 里 `resolveRuntime` 遇 Promise 直接 throw（`bootstrap.ts` L183-192），阻塞异步初始化。
- **无 fiber 状态机/启动审计**：无 `PENDING` 诊断、无 `assertEntriesActivated` 式"某插件实际没起来"的启动失败报告；`lifecycle-manager` 各阶段 `try/catch` 吞错仅记日志。

**已有的稳固之处**：清单含 `id/kind/version/provides/dependsOn`（契约清晰）；`channel/shared/plugin.ts` 已写出"自带生命周期收尾"的辅助（缓存 runtime、`bus.on` 返回的 unsubscribe、`start/stop` 配对）——只是这些靠插件自觉，而非框架强制可逆注册。这是不错的雏形。

## 三、可借鉴 / 可落地的改进建议

> 级别：P0 高优先；S/M/L 为工作量；改动范围指相应目录。

### P0 — 引入可逆副作用注册（`ctx.effect` 语义）

- **做法**：kernel 层给 `PluginContext` 增加 `effect(cb): disposer`，`EventBus.on`、`CapabilityRegistry.registerX` 全部改为返回 disposer 并自动挂到当前插件 fiber；`plugin-registry` 增加 `unregister(id)`，`lifecycle-manager` 在 stop 时逆序执行每插件已收集 disposer。channel/scheduler 里手写的"收尾"逻辑改为声明性 effect。
- **范围**：`packages/plugin-sdk/src/runtime-types.ts`、`services/local-ai-core/src/kernel/`。
- **工作量**：M。**风险**：中——需设计"当前插件 fiber"跟踪，避免把现有 null 侧写成 destroy 时序 bug。
- **收益**：为热装载、按能力卸载、插件替换打底。

### P0 — 插件配置校验落地 + 统一装载审计

- **做法**：kernel 提供一个（或复用 `zod`/`superstruct`）把 `manifest.configSchema.fields` 编译成校验器，`init`/`start` 前执行；无 `configSchema` 则跳过。同时加一个启动后断言：凡是 enabled 的插件无 runtime/未 init 即抛标签化错误（对标 `assertEntriesActivated`）。
- **范围**：`packages/plugin-sdk`、`kernel/bootstrap.ts`、`kernel/lifecycle-manager.ts`。
- **工作量**：S。**风险**：低。
- **收益**：修掉"坏的/半配置插件静默启动"与"插件没起来无人知"两大缺陷。

### P1 — 事件派发升级：加 `waterfall` / `serial` 拦截点

- **做法**：`event-bus.ts` 扩展 `emit/waterfall/serial/bail` 四种派发；在 agent 请求前、消息入库点定义 `agent/pre-step`、`localcore/pre-execute` 等 waterfall 事件，让 policy 类插件可 `next()` 委托或短路。这是能力注册之外最便宜的中枢扩展点。
- **范围**：`packages/plugin-sdk/src/runtime-types.ts`、`kernel/event-bus.ts`、`runtime/handlers/*`。
- **工作量**：M。**风险**：中——需保证向后兼容现有 `emit` 语义。
- **收益**：无需改 agent-loop 即可做权限/策略/审计插拔。

### P1 — 服务注入替换显式 topo（inject/ctx key）

- **做法**：把 `createRuntime` 改为"按 `provides` 注册 `ctx.<key>`"，消费者经 `ctx.get('channel:lark')` 获取；`dependsOn` 升级为 `inject: string[]`，装载时对未满足 key 的插件进入 wait-and-resume，key 消失即连带卸载。先做最小版：`inject` 等待 + 满足后激活，暂不做依赖变更热重启。
- **范围**：`plugin-sdk/src/runtime-types.ts`、`kernel/plugin-registry.ts`、`kernel/bootstrap.ts`。
- **工作量**：L。**风险**：高——改动装载模型，建议先做 `inject` 等待这一半，PENDING 状态后补。
- **收益**：让内置插件的 provider 可替换，为"换图表驱动"铺路。

### P1 — 运行时插件热装载（最小版）

- **做法**：把"boot 一次装载"改为可再次 `mount(id)`/`unmount(id)`（依赖 `installPluginSet` 重构 + 上面的可逆 effect）；`disabledPluginIds` 改为订阅 settings 变更后 diff，对变化项做 token 化 reload。外部插件目录扫描（`userDataPath/plugins`）先不引入，只支持内置插件开关生效。
- **范围**：`kernel/boot`、`kernel/plugin-registry`、`runtime/local-core-controller.ts`、`runtime/local-core-runtime-state.ts`。
- **工作量**：L。**风险**：高。收益：免重启启停通道/调度器插件。注意 `AGENTS.md` 明示"静态注册稳定后才做动态装载"。

### P2 — 配置分层组合（profile/bundle/patch）

- **做法**：参考 DSH 的 `cordis.patch.yml` 按 id patch 语义，给 AgentDock 引入一个"插件清单分层"文件（bundle 层 + 用户 patch 层），entry 带稳定 `id` 支持 diff，避免改动 `catalog.ts`。这依赖 P0/P1 的可逆装载与配置校验。
- **范围**：`kernel/bootstrap.ts`、新增 `packages/plugin-sdk` 内的 entry 类型、`services/local-ai-core/src/plugins/`。
- **工作量**：L。**风险**：高。建议排 P2，等装载模型稳定再做。

### P2 — 按 agent/workspace 隔离作用域与 agent 自检工具

- **做法**：先不做完整隔离，仅把 `WorkspaceRouter` 的 agent 可改写能力清单下沉到 `ctx.getCapabilitySnapshot()` 并按 agentId 覆盖（对标 `scopeTarget` 的雏形）；再探 `packages/extensions/tool-cordis`，用 `@cc/core-sdk` 暴露只读 `plugin.diagnostics` 工具给 agent 查看本进程插件态。
- **范围**：`kernel/capability-registry.ts`、`router/workspace-router.ts`、`packages/plugin-sdk`。
- **工作量**：M（隔离）/ S（只读 agent 工具）。**风险**：隔离 M 中。
- **收益**：支持"一个 workspace 一套通道/调度"；先做只读诊断成本低、价值立现。

---

**总体判断**：AgentDock 已有清晰的清单/能力注册骨架与克制的内置插件分层，但底层仍是最简"启动时一次性全局注册"，缺少 DSH 的可逆 effect、服务注入、事件拦截、作用域隔离与运行时组合。建议按 **P0(可逆注册+校验审计)→P1(inject+事件派发)→P1(热装载)→P2(配置组合/隔离)** 的依赖顺序推进，每步都能独立落地并即时改善可测性。
