# DSH vs AgentDock：工程实践、文档体系、测试与质量工具对比

> 结论基于实际阅读 DSH master 源码（`/tmp/dsh-src/deepseek-harness-master`）与 AgentDock 源码（`/Users/momo/code/agentdock`）。

## 一、DSH 工程实践亮点

### 1. 文档体系：i18n 管线 + 自动生成目录（最强差异点）

| 机制 | 实现 | 落地文件/命令 |
|---|---|---|
| 双语三件套 | 每篇文档 `foo.md`+`foo.zh.md`+`foo.i18n.yaml`（存双方 git blob 哈希），一人改动必须同步另一份 | `docs/i18n/README.md` |
| 一致性门禁 | 组件哈希与结构签名，改了单边即 CI 红；`--write <pair>` 重新确认 | `scripts/verify-translation-pairing.ts` |
| Git 合并驱动 | 自动合并 `.i18n.yaml` 冲突，失败回退重构 | `scripts/merge-translation-pairing.ts` |
| 类型等价粘贴 | `` ```ts type-equiv `` 代码块与源码声明用 TypeScript 解析器比对，防止文档漂移 | `scripts/verify-type-equiv.ts` |
| 目录自动生成 | module-graph（mermaid 依赖图）、config-catalog、tool-catalog、persistence-catalog、cordis-api/client-catalog 均从源码生成，`--check` 验证新鲜度 | `scripts/gen-module-graph.ts`、`gen-config-catalog.ts` 等 |
| 文档分级 | "one home per fact" 分层（根 AGENTS/架构/subsystems/Agent Notes/postmortem/cookbook/user），预算门禁 | `docs/AGENTS.md`、`verify-doc-budgets.ts` |

`module-graph.md` 从各包 `peerDependencies` 生成 mermaid 依赖图；`config-catalog.md` 把每个插件 Config 类型 + schemastery schema 交叉校验后粘贴生成，是"部署轴"参考。

### 2. 多形态测试矩阵（vitest 多套配置）

| 配置 | 覆盖 | 关键策略 |
|---|---|---|
| `vitest.config.ts` | 单元测试 + 每文件 100% 覆盖门禁 | 覆盖未命中=死代码提示 |
| `vitest.e2e.config.ts` | 真实 API（DeepSeek 等），无 key 自动跳过 | `test:e2e` |
| `vitest.snapshot.config.ts` | ACP/headless 关键路径重放，keyless 金样 | `test:snapshot` |
| `vitest.web.config.ts` | Chromium 浏览器快照，CI 强制 `DSH_SNAPSHOT=replay` 只读 | `test:web` |
| `vitest.web.perf.ts` / `vitest.web-stress.config.ts` | 可选性能/压力车道，不进默认 CI | `test:web:perf`/`test:web:stress` |
| `vitest.shared.ts` | 装饰器插件 + exec 参数共享 | — |

测试哲学（`docs/testing.md`）：优先真实实现而非 mock、验证"世界"而非 agent 自报、测试真实入口路径（内置 lib 产物）。coverage 门禁是逐文件 100% 而非单一阈值。

### 3. 质量工具与工程门禁

| 项 | DSH 做法 |
|---|---|
| Lint | **oxlint**（`.oxlintrc.json` 11KB + 快速 `.oxlintrc.staged.json`），非 eslint |
| Git hooks | `lefthook.yml`：pre-commit（翻译配对、暂存 oxlint 自动修、THIRD_PARTY 再生、空白、vendor guard）、pre-push（typecheck） |
| 依赖合规 | `THIRD_PARTY_NOTICES.md` 由 `gen-third-party-notices.ts` 生成，commit 时自动再生 + 新鲜度门禁；`vendor/README.md` manifest + `check-vendor-manifest.sh` |
| 包 README 强制 | `verify-package-readme-model-experience.ts`（`## Model Experience`：model sees/token effect/KV cache）+ `verify-package-readme-limitations.ts`（`## Known Limitations and Deferred Work`） |
| 脚本与 CI | 147 个脚本由 `run-gates.ts` 统一清单；`check:all`；CI 按 lane 分组（static/coverage/snapshots-artifacts/consumers）+ Node 22.19/24/26 兼容矩阵；python SDK 用 `.gitlab-ci.yml` manylinux wheel 构建 |
| Benchmark | `BENCHMARK.md` + `python/sdk` + `pytest.ini` |

## 二、AgentDock 现状与差距

**基线（已在用）**：lint 六项（complexity/circular/madge、duplicate/jscpd、dead-code/knip、function-length、file-size）、c8 覆盖率、Node 内置 test runner + Cucumber BDD、e2e:smoke、AGENTS.md/CLAUDE.md 双指南、README 带 New 章节。CLAUDE.md 为独立文件（16K）而非 symlink。

**主要差距**：

| 维度 | AgentDock 现状 | 差距 |
|---|---|---|
| CI 门禁 | `.github/workflows/ci.yml` 只有一个 `test` job（`pnpm test`，ubuntu/node22） | 无 lint/coverage/snapshot/合规门禁，lint 系列全为 `warn` 不进 CI |
| Git hooks | 无 lefthook/husky | 暂存校验缺失 |
| 文档新鲜度 | `docs/`（adr/architecture/features/planning/…）为一次性编写，无生成/异动门禁 | 无自动目录、无类型等价校验 |
| i18n 文档 | 无 | 中文文档无双语一致性保障 |
| 依赖合规 | 无 THIRD_PARTY_NOTICES | 无披露合规 |
| README 规范 | 仅约定 New 章节 | 无数式化 Model Experience/Limitations 门禁 |
| Benchmark | 无 | 无 `BENCHMARK.md` |
| 测试形态 | unit + contracts/integration/electron + BDD + smoke | 无覆盖率门禁阈值、无浏览器/e2e 快照回放 |

## 三、可落地改进建议（P0/P1/P2）

| 优先级 | 建议 | 具体做法 | 改动范围 | 工作量 | 风险 |
|---|---|---|---|---|---|
| **P0** | CI 完整门禁链 | ci.yml 扩为 lint/circular/duplicate/dead-code/typecheck/coverage 多 job（复用既有 scripts），coverage 加阈值 check-coverage；并纳入 BDD | `.github/workflows/ci.yml`、`.c8rc.json` | M | 低，仅装配 |
| **P0** | Git hooks（lefthook） | 引入 lefthook，pre-commit 跑 lint:circular/duplicate/dead-code + typecheck，pre-push 跑 `pnpm test` | 根 `lefthook.yml`、package.json/postinstall | S | 中，钩子误阻需预案 |
| **P1** | README 规范门禁脚本 | 仿 DSH 写 `verify-readme-model-experience.ts`/验证 New 章节存在，纳入 typecheck 组 | `scripts/` | S | 低 |
| **P1** | 覆盖率门禁 & 关键路径快照 | coverage 设阈值；为 ACP 状态机回放 JSONL 快照（仿 DSH `test:snapshot`） | `.c8rc.json`、scripts | M | 中，需建金样 |
| **P1** | 依赖合规 THIRD_PARTY_NOTICES | 用 `license-checker`/手动生成披露文档 + 校验脚本 | 根文件、scripts | S | 低 |
| **P1** | docs 类型等价/链接门禁 | 对 `docs/architecture/` 关键类型引入 type-equiv 或 md-link 校验 | `scripts/verify-md-links.ts` 类似 | S-M | 低 |
| **P2** | BENCHMARK.md | 新增基准文档，用 `pnpm e2e:smoke` 计时沉淀基线 | 根文件 | S | 低 |
| **P2** | 文档 i18n 管线 | 抽中文文档成配对并加校验（工程量大，慎选范围） | 全局 docs | L | 高，仅核心文档试点 |

**P0 为最高优先**：当前 lint 六项是纯报告不进 CI，产出的质量信号无人把关，是首个值得合入的差距。P2 的 i18n 全量管线对单团队价值有限，建议只对 `docs/architecture/` 核心页做轻量链接/类型校验。
