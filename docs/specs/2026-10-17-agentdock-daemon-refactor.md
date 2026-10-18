# Spec: AgentDock 终极纯粹架构——双支柱拓扑与 @agentdock/* 命名大一统

> **文档标识**：`SPEC-2026-10-DAEMON-REFACTOR`  
> **重构级别**：核心架构彻底演进（Zero-Debt Target Architecture）  
> **工作区分支**：`codex/2026-10-17-agentdock-daemon-refactor`  
> **架构影响**：`Architecture Impact: Required`

---

## 1. Goal (目标)

1. **纯双支柱拓扑（Two-Tier Pure Architecture）**：彻底清除根目录下散落的 `src/`、`electron/`、`shared/` 与冗余单目录 `services/`，构建高度对称且纯粹的 **`apps/*`（应用层）** 与 **`packages/*`（共享库层）**。
2. **命名空间与品牌大一统（Namespace Unification）**：
   - 彻底废除 `cc-connect` 时代的 `@cc/*` 与 `superai` 代号，全库统一为 **`@agentdock/*`**；
   - 核心守护服务命名从 `local-ai-core` 正名为 **`agentdock-daemon`**（目录 `apps/daemon`，包名 `@agentdock/daemon`）；
   - 彻底清理 `lac`（Local AI Core）缩写，命令行正名为 `agentdock`（并提供极简别名 `ad`，保留 `lac` 兼容）。
3. **消除历史产物目录**：后端编译产物收敛为 `dist/daemon` 与 `dist/desktop`，淘汰在服务器上运行带有 `electron` 烙印的 `dist-electron`。
4. **高质量闭环交付**：保持全套 TypeScript 0 错误、7 项 CI 门禁 100% 达标、Archify 架构规则校验 PASS、1000+ 测试与 80 BDD 场景全部绿灯。

---

## 2. Target Layout (目标目录拓扑)

```text
agentdock/
├── apps/                               # 【所有具备独立入口与生命周期的目标应用】
│   ├── daemon/                         # 后台常驻守护进程应用（原 services/local-ai-core）
│   │   ├── src/ (acp, kernel, runtime, mesh, channel, scheduler, security)
│   │   ├── package.json                # @agentdock/daemon
│   │   └── tsconfig.json
│   ├── desktop/                        # 桌面 Electron 外壳应用（原 electron/）
│   │   ├── src/ (main.ts, preload.ts)
│   │   ├── managed-skills/
│   │   ├── package.json                # @agentdock/desktop
│   │   └── tsconfig.json
│   └── web/                            # React 19 SPA 渲染端应用（原 src/）
│       ├── src/ (components, pages, store, i18n)
│       ├── public/, index.html, vite.config.ts
│       ├── package.json                # @agentdock/web
│       └── tsconfig.json
│
├── packages/                           # 【所有跨端复用的纯净共享库】
│   ├── contracts/                      # @agentdock/contracts (原 @cc/superai-contracts)
│   ├── sdk/                            # @agentdock/sdk (原 @cc/core-sdk)
│   ├── plugin-sdk/                     # @agentdock/plugin-sdk (原 @cc/plugin-sdk)
│   └── knowledge/                      # @agentdock/knowledge (原 @cc/knowledge-api)
│
├── bin/                                # 全局 CLI 命令入口 (agentdock, agentdock-node, ad)
├── build/                              # 打包资源 (icon.png 等)
├── dist/                               # 统一产物目录 (dist/web, dist/desktop, dist/daemon)
├── docs/                               # 架构规约、规范与计划
├── tests/                              # 集成测试、契约测试、BDD
├── pnpm-workspace.yaml                 # 仅声明 apps/* 与 packages/*
└── package.json                        # 根编排与统一发包配置 (@kafca/agentdock)
```

---

## 3. Scope & Package Mapping (范围与包名映射)

| 物理路径 | 旧包名 / 旧目录 | 新包名 / 新目录 | 角色职责 |
|---|---|---|---|
| `apps/daemon` | `@cc/local-ai-core`<br>(`services/local-ai-core`) | `@agentdock/daemon` | 核心守护进程、ACP 协议、Mesh 调度、SQLite、渠道网关 |
| `apps/desktop` | *(无，散落于根 `electron/`)* | `@agentdock/desktop` | Electron 桌面外壳，拉起伴生 Daemon 与 Web 视图 |
| `apps/web` | *(无，散落于根 `src/`)* | `@agentdock/web` | React 19 单页用户界面渲染端 |
| `packages/contracts` | `@cc/superai-contracts` | `@agentdock/contracts` | 领域模型、跨进程协议，吸收 `shared/desktop.ts` |
| `packages/sdk` | `@cc/core-sdk`<br>(`packages/core-sdk`) | `@agentdock/sdk` | Daemon API 强类型客户端 SDK |
| `packages/plugin-sdk` | `@cc/plugin-sdk` | `@agentdock/plugin-sdk` | 插件运行时标准与沙箱契约 |
| `packages/knowledge` | `@cc/knowledge-api`<br>(`packages/knowledge-api`) | `@agentdock/knowledge` | 知识库与向量引擎实现 |

---

## 4. Invariants & Compatibility (不变式与平滑兼容)

1. **平滑过渡别名导出**：
   - `packages/contracts` 同时导出并保留 `@cc/superai-contracts` 路径别名与类型定义；
   - `packages/sdk` 兼容导出 `@cc/core-sdk`；
   - 守护进程对外提供兼容层：`GET /api/local/v1/health` 响应 `{ name: "agentdock-daemon", legacyName: "local-ai-core", version: "0.1.0" }`。
2. **CLI 双向兼容**：
   - 原 `lac <domain> <action>` 在终端中自动路由至 `agentdock <domain> <action>`；
   - 提供极简别名 `ad`；
   - 原 `agentdock core` 兼容路由至 `agentdock daemon`。
3. **数据无损迁移**：
   - 自动检测并平滑升级 `userData/runtime/local-core.db` $\to$ `agentdock.db`；
   - `local-core-settings.json` $\to$ `agentdock-settings.json`。
4. **单向依赖规则**：
   - `apps/*` $\to$ `packages/*`（单向 inward）；
   - 严禁 `packages/*` 反向依赖 `apps/*`；
   - `apps/web` 绝不直接依赖 `apps/daemon` 内部代码。

---

## 5. Acceptance Criteria (验收准则)

- [ ] **AC-1**: 根目录下无 `src/`、`electron/`、`shared/`、`services/` 目录；`pnpm-workspace.yaml` 仅声明 `apps/*` 与 `packages/*`。
- [ ] **AC-2**: 核心守护进程完整迁移至 `apps/daemon/`，包名为 `@agentdock/daemon`。
- [ ] **AC-3**: 共享包全部使用 `@agentdock/*` 作用域，消灭 `@cc/*` 与 `superai` 残留。
- [ ] **AC-4**: 跨进程 `desktop.ts` 优雅收拢于 `packages/contracts/src/desktop.ts`，根目录无孤立 `shared/`。
- [ ] **AC-5**: `bin/agentdock.mjs daemon` 能独立启动守护服务，健康检查返回 `agentdock-daemon`。
- [ ] **AC-6**: `pnpm typecheck` 双 TS 配置 0 错误（含 BDD）。
- [ ] **AC-7**: `pnpm lint:gates` 7 项门禁全部通过（环依赖=0, 死代码<=172, 圈复杂度<=108）。
- [ ] **AC-8**: `pnpm lint:arch` Archify 9 项架构规则全部通过。
- [ ] **AC-9**: `pnpm test` + `pnpm test:bdd` 全量测试 100% 绿灯。
- [ ] **AC-10**: `pnpm coverage` C8 覆盖率四项指标完全达标。
- [ ] **AC-11**: `pnpm e2e:smoke` 冒烟测试全通。
