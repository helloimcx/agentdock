# 验证流程去重与本地检查分层

状态：已批准，实施中。日期：2026-10-24（Asia/Shanghai）。

## Goal

落实已讨论的优化 1、2、4：允许普通本地提交选择受影响检查；完整验证只执行一次类型检查、一次前后端构建、一次 Node 测试和一次 BDD；CI 补齐可复现的架构校验并统一测试发现入口。

基线：`origin/main`，`abfd14a243b284817d773574f7381004af91ffb2`。
任务分支：`codex/2026-10-24-verification-pipeline`。

## Scope

- 更新 `AGENTS.md` 和 README：开发迭代、普通提交、高风险变更、PR CI 各自应执行的验证；列出实际运行与未运行的检查。
- 重组 `package.json`、构建/测试/coverage 脚本，使单次完整验证没有重复阶段。
- 普通 Node 测试和 c8 使用同一测试文件发现入口，消除 renderer 测试在两套 runner 中重复登记。
- 更新测试登记回归测试，防止源码测试未编译、编译后未执行或两套 runner 集合不同。
- CI 使用官方 Archify 固定 revision `25cf37080fc8b1dbe758a4efc3935b55f3327083` 执行 `pnpm lint:arch`；测试与覆盖率共享同一次 Node 执行，保留现有检查名称。

## Non-goals

- 不引入自动变更影响分析、路径过滤或模块测试选择算法（此前优化 3）。
- 不迁移 Jenkins，不改变发布、部署或打包工作流的职责。
- 不改变远端分支保护，不发布、不推送、不创建 PR。
- 不降低覆盖率阈值、不跳过现有测试、不修改应用功能或 UI。

## Behavior / Interface

### 本地规则

1. 日常开发与普通提交：执行受影响测试和适用静态检查；报告选择依据、执行结果及未执行范围，不强制每次 `pnpm verify`。
2. 公共协议/共享 contracts、持久化/迁移、安全/权限、并发/事务、依赖升级、构建/测试/CI 基础设施、核心架构及影响范围不清楚的变更：提交前执行 `pnpm verify`。本任务属于此类。
3. PR 和 main CI 保留完整静态检查、架构校验、所有现有 Node 测试、BDD 和现有覆盖率阈值。文档明确：workflow 的执行不等于远端已启用必需状态检查。
4. 提供无需重复完整构建的测试执行入口，文档明确其前置构建要求；不将过期构建产物的局部测试描述为当前源码已通过。

### 命令契约

- `pnpm test`：保留完整无覆盖率测试语义，类型检查、生产构建、共享 Node runner、BDD 各一次。
- `pnpm coverage`：保留独立可运行的 Node 覆盖率语义，干净构建后运行全部 Node 测试并检查原阈值；不暗中承担 BDD 或完整静态检查。
- 新增完整测试加覆盖率入口（建议 `test:ci`）：干净的带 source map 构建一次、Node/c8 一次、BDD 一次。CI 类型检查由独立 lint job 执行。
- `pnpm verify` / `pnpm qa`：类型检查、现有静态门禁、架构校验、上述完整测试加覆盖率入口，各一次。
- 构建入口复用 Pi Durable worker、Electron package、alias 和 managed skills 处理；覆盖率构建必须先清理 dist-electron，保留 renderer packaging 测试所需产物。
- Node runner 与 c8 从同一个文件发现模块取得确定性测试清单；空清单、缺少应有的编译测试、子进程启动失败、测试失败、BDD 失败、覆盖率不足均返回非零。

### CI 与架构校验

- 保留 `Lint & Typecheck`、`Test`、`Coverage` 检查名称。
- lint job 执行类型检查、静态门禁和架构校验；Test job 执行完整测试加覆盖率入口。
- Coverage job 作为依赖 Test 成功的显式结果检查，传播失败/取消状态，不能因依赖失败被跳过而显示无条件成功；不再次构建或执行测试。
- CI 从官方 `tt-a1i/archify` 固定完整 commit `25cf37080fc8b1dbe758a4efc3935b55f3327083` 获取校验工具，通过 `ARCHIFY_BIN` 运行；禁止依赖开发机 home 目录或浮动分支。使用全部现有规范验证兼容性。
- 缺少校验器、非法 JSON、未知图类型、校验失败均必须阻断。保持现有 showcase 检查，不用自制简化 schema 代替。

## Constraints / Compatibility

- 使用 pnpm；CI Node 22，兼顾已有 macOS/Windows 本地命令路径。
- 保留原覆盖率阈值、所有现有测试及 BDD，独立 test/coverage 命令仍可在干净 checkout 运行。
- 不引入业务依赖；固定外部校验工具来源与 revision，在文档中给出本地配置方式。
- 保留主工作区已有未跟踪文件；所有本任务产物、实现和验证位于独立 worktree。

## Acceptance Criteria

1. AGENTS 与 README 一致写明普通本地提交不强制全量，高风险变更与 CI 必须完整验证。
2. 编排回归测试证明一次 verify：类型检查、renderer 构建、backend/desktop 构建、Node/c8、BDD 各一次；失败立即返回非零。
3. 普通 runner 与 coverage 的测试集合相同且覆盖基线现有集合；新增 renderer 测试不再登记到两个 runner 清单。
4. 测试证明遗漏编译测试、空集合、失败/取消/启动失败和覆盖率不足不会被误报为成功。
5. 固定版本 Archify 能校验全部现有规范，CI 明确执行 lint:arch；非法规范的负向验证返回非零。
6. CI 仅执行一次完整测试/覆盖率构建；保留三项现有检查名称并正确传播失败。
7. 在 worktree 执行完整 pnpm verify，记录真实结果、命令耗时与阶段次数；无法执行的项目单独说明。
8. 独立 Review 无未解决阻塞问题；最终 diff 不含宿主工作区文件、机器路径或下载工具。
