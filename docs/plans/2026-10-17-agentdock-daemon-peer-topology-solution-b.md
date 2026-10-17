# AgentDock Monorepo 平级规范化与 agentdock-daemon 重构架构方案（方案 B）

> **文档标识**：`docs/plans/2026-10-17-agentdock-daemon-peer-topology-solution-b.md`  
> **设计角色**：高级软件架构师（独立方案求解 B）  
> **架构影响**：`Architecture Impact: Required`  
> **基线分支**：`codex/2026-10-17-agentdock-daemon-refactor`  
> **基线状态**：TypeScript 0 错误，ESLint 108 warnings（门禁基线），1083 unit/integration tests 100% pass，80 BDD scenarios 100% pass，Archify 9 项 showcase 规则 100% pass

---

## 1. 问题理解与关键假设

### 1.1 核心问题诊断：根目录职责倒挂与历史命名债务

当前 AgentDock Monorepo 存在两个紧密交织的系统级结构缺陷：

```text
【当前现状：职责倒挂与目录散落】
agentdock (Root package.json: @kafca/agentdock)
├── src/                  <-- React 19 UI 渲染层（本应属于 Web 应用壳）
├── electron/             <-- Electron 桌面壳（本应属于 Desktop 应用壳）
├── apps/                 <-- 占位空壳（shell-desktop/README.md, shell-web/README.md）
├── services/
│   └── local-ai-core/    <-- 核心守护进程被置于三级子目录，且背负陈旧历史代号
├── packages/             <-- contracts, core-sdk, knowledge-api, plugin-sdk
└── shared/               <-- desktop.ts 跨端共享类型
```

1. **Monorepo 拓扑“严重倒挂”（Topological Inversion）**：
   - **根目录严重超载**：根目录直接承载了 React 19 前端源码（`src/`）、Electron 主进程源码（`electron/`）、静态资源（`public/`, `index.html`）、桌面应用打包配置（`electron-builder`）以及所有应用端与服务端依赖（`react`, `@larksuiteoapi/node-sdk`, `@agentclientprotocol/claude-agent-acp` 等混在一起）。
   - **应用壳层形同虚设**：`apps/shell-desktop` 与 `apps/shell-web` 自创立以来一直仅包含两行声明为“未来迁移占位桩”的 `README.md`。
   - **核心守护进程被孤立与降级**：核心后端被下放于 `services/local-ai-core`，导致“上层消费壳占据 Root 王座，核心业务运行时蜷缩子目录”的反模式；且根 `package.json` 反向代理了其全部运行时依赖。
2. **`local-ai-core` 历史命名债务**：
   - `local-ai-core`（简称 `lac`、`local-core`、`@cc/local-ai-core`）是产品孵化初期的历史代号，在代码库中有超过 650 处路径和命名残留。
   - 随着产品正式定名为 **AgentDock** 并推出 `agentdock` CLI 工具链和容器生态，内部实现命名与产品外部品牌心智发生严重背离。
   - 必须彻底废除 `local-ai-core` 历史命名，正名为 **`agentdock-daemon`**（对应包名 `@agentdock/daemon`）。

### 1.2 关键架构假设

- **A1. 单一发行体发布契约不变（Zero-Breaking Unified Distribution）**：
  - AgentDock 对外保持以 `@kafca/agentdock` npm 包（内含 CLI 与静态资源）以及单体桌面客户端（macOS DMG/ZIP, Windows NSIS/ZIP）形式统一发布。重构为内部 Workspace 解耦，不得破坏最终打包与分发管道。
- **A2. 进程边界与通信协议不变（Process & Protocol Invariance）**：
  - Desktop 模式下，Electron 主进程依然通过子进程唤起 Daemon（`ELECTRON_RUN_AS_NODE=1`），并监听健康检查端点 `http://127.0.0.1:9831/api/local/v1/health`；
  - Web/Desktop 渲染层与 Daemon 之间依然严格通过 HTTP/WebSocket/SSE 由 `@cc/core-sdk` 通信；
  - 本次重构不修改任何 REST 路由路径（`/api/local/v1/*` 保持兼容）或 WebSocket 通信契约。
- **A3. 持久化与用户数据零丢失（Data Compatibility）**：
  - 运行时 SQLite 数据库（`~/.agentdock/runtime/local-core.db` 或 `/var/lib/agentdock/runtime/local-core.db`）文件保持无缝兼容；
  - 系统日志目录（`~/.agentdock/logs/`）与配置文件读取逻辑平滑继承。
- **A4. 门禁零妥协（Zero-Tolerance Quality Gates）**：
  - 迁移后必须 100% 通过现有全部严格门禁：TypeScript 0 错误、循环依赖 0 容忍、重复代码 Gate、Knip 死代码阈值、函数/文件长度限制、ESLint 复杂度（<= 108）、Archify 架构规范（9/9 passed）、1083 单元测试与 80 BDD 场景全部绿灯。

---

## 2. 技术方案

### 2.1 目标拓扑：三层平级规范化架构（Peer Normalized Monorepo）

```text
agentdock/ (Workspace Root)
├── apps/                          <-- [应用壳层] 终端用户可执行应用壳
│   ├── shell-desktop/             <-- [@agentdock/shell-desktop] Electron 桌面壳应用
│   │   ├── src/
│   │   │   ├── main.ts            <-- Electron 启动入口、窗口与进程管理
│   │   │   └── preload.ts         <-- Electron 安全预加载脚本
│   │   ├── managed-skills/        <-- 桌面特有托管技能静态资产
│   │   ├── package.json           <-- 声明 desktop 专用依赖与启动脚本
│   │   └── tsconfig.json          <-- 继承根配置，针对 Electron 主进程
│   └── shell-web/                 <-- [@agentdock/shell-web] React 19 渲染端应用
│       ├── src/                   <-- 完整迁移原根目录 src/（pages, components, store...）
│       ├── public/                <-- 静态图标与资源
│       ├── index.html             <-- SPA HTML 入口
│       ├── preview.html           <-- 预览环境入口
│       ├── vite.config.ts         <-- 专属 Vite 打包配置
│       ├── package.json           <-- 声明 react, radix, tailwind 等渲染依赖
│       └── tsconfig.json          <-- 针对浏览器 DOM + React JSX 的类型配置
├── services/                      <-- [后台服务层] 独立常驻后台进程与服务
│   └── agentdock-daemon/          <-- [@agentdock/daemon] 原 services/local-ai-core 完整正名
│       ├── src/
│       │   ├── acp/               <-- Agent Client Protocol 会话与流式调度
│       │   ├── agents/            <-- 运行时适配器（Claude Code, Codex, Pi...）
│       │   ├── automation/        <-- 自动化触发器与监控
│       │   ├── channel/           <-- 飞书/企业微信/微信长轮询与网关
│       │   ├── cli/               <-- 守护进程 CLI（lac/agentdock-daemon 指令）
│       │   ├── kernel/            <-- 内核引导、SQLite 迁移、插件注册表
│       │   ├── mesh/              <-- 分布式 Mesh 节点协同
│       │   ├── router/            <-- 工作区路由与模型供应商路由
│       │   ├── runtime/           <-- HTTP REST / WS / External SSE 服务端
│       │   ├── sandbox/           <-- Docker / OpenSandbox 容器隔离
│       │   ├── scheduler/         <-- Cron 定时引擎与任务分发
│       │   ├── security/          <-- 权限控制与沙箱边界
│       │   ├── skills/            <-- 技能索引与分发服务
│       │   └── thread/            <-- 线程状态机与知识库绑定
│       ├── package.json           <-- 声明 daemon 自身所需的全部后端生产依赖
│       └── tsconfig.json          <-- 针对 Node 22 CommonJS/ESM 的编译配置
├── packages/                      <-- [共享库层] 内部跨包共享库与 SDK
│   ├── contracts/                 <-- [@cc/superai-contracts] 数据模型与核心契约
│   ├── core-sdk/                  <-- [@cc/core-sdk] 守护进程客户端 SDK
│   ├── knowledge-api/             <-- [@cc/knowledge-api] 知识库与向量存储
│   └── plugin-sdk/                <-- [@cc/plugin-sdk] 插件生命周期 SPI
├── shared/                        <-- [跨进程类型] shared/desktop.ts 跨端公共协议
├── bin/                           <-- 根分发 CLI 入口（agentdock, agentdock-node 等）
├── scripts/                       <-- 工作区编排、编译、构建与门禁脚本
├── tests/                         <-- 跨层契约、集成、Electron 与 BDD 测试套件
└── package.json                   <-- 根聚合包（@kafca/agentdock，管理发布与统一构建）
```

### 2.2 包命名规范（Package Naming Conventions）

| 物理路径 | 旧 Package Name | 新 Package Name | 私有性 | 说明 |
|---|---|---|---|---|
| `services/agentdock-daemon` | `@cc/local-ai-core` | `@agentdock/daemon` | `private: true` | 核心守护进程服务包，彻底废弃 `@cc/local-ai-core` |
| `apps/shell-desktop` | 无 (散落在 Root) | `@agentdock/shell-desktop` | `private: true` | Electron 桌面主进程应用壳 |
| `apps/shell-web` | 无 (散落在 Root) | `@agentdock/shell-web` | `private: true` | React 19 Web 渲染端应用壳 |
| `packages/contracts` | `@cc/superai-contracts` | `@cc/superai-contracts` | `private: true` | 保留原有作用域，新增 `@agentdock/contracts` 别名映射 |
| `packages/core-sdk` | `@cc/core-sdk` | `@cc/core-sdk` | `private: true` | 客户端 SDK，对外支持 `@agentdock/core-sdk` 映射 |
| `packages/knowledge-api` | `@cc/knowledge-api` | `@cc/knowledge-api` | `private: true` | 知识库底层库 |
| `packages/plugin-sdk` | `@cc/plugin-sdk` | `@cc/plugin-sdk` | `private: true` | 插件机制 SDK |
| `.` (Root) | `@kafca/agentdock` | `@kafca/agentdock` | 公开发布 | 统一聚合入口，对外发布 npm 包与桌面安装包 |

### 2.3 构建配置与编译流水线（Build Pipeline & Artifacts Topology）

Monorepo 保留高效的双轨编译机制，但重构编译边界与输出结构：

1. **Web 渲染端编译（Vite）**：
   - 源码位于 `apps/shell-web/src/`，配置文件在 `apps/shell-web/vite.config.ts`。
   - `build.outDir` 统一输出至根目录 `dist/renderer/`（相对路径 `../../dist/renderer`）。
   - **设计收益**：根目录下的 `dist/renderer` 路径完全保持不变，`electron-builder`、`bin/agentdock.mjs` 以及生产冒烟测试 `renderer-packaging.test.ts` 零断裂。
2. **Node / Electron 编译（TypeScript + tsc-alias）**：
   - 使用统一编译配置 `tsconfig.electron.json`，`outDir` 统一输出至根目录 `dist-electron/`：
     - `dist-electron/apps/shell-desktop/src/main.js`（原 `dist-electron/electron/main.js`）
     - `dist-electron/services/agentdock-daemon/src/runtime/standalone.js`（原 `dist-electron/services/local-ai-core/...`）
     - `dist-electron/packages/...`
     - `dist-electron/tests/...`
   - **双向平滑兼容垫片（Backwards-Compatible Shims）**：
     在 `scripts/write-electron-package.mjs` 或专用包装阶段生成轻量转发桩：
     - `dist-electron/electron/main.js` 导出并启动 `dist-electron/apps/shell-desktop/src/main.js`；
     - `dist-electron/services/local-ai-core/src/runtime/standalone.js` 导出并执行 `dist-electron/services/agentdock-daemon/src/runtime/standalone.js`。
     确保任何外部旧脚本、本地调试断点或测试工具在迁移瞬间不会遭遇 `MODULE_NOT_FOUND`。

### 2.4 路径别名（Path Aliases）标准化

终结长达 4-5 层的 `../../../../services/local-ai-core/...` 脆弱相对路径引用，在 `tsconfig.json` 和 `tsconfig.electron.json` 中建立一等公民别名：

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["apps/shell-web/src/*"],
      "@agentdock/web": ["apps/shell-web/src/index.ts"],
      "@agentdock/web/*": ["apps/shell-web/src/*"],
      "@agentdock/desktop": ["apps/shell-desktop/src/index.ts"],
      "@agentdock/desktop/*": ["apps/shell-desktop/src/*"],
      "@agentdock/daemon": ["services/agentdock-daemon/src/index.ts"],
      "@agentdock/daemon/*": ["services/agentdock-daemon/src/*"],
      "@cc/superai-contracts": ["packages/contracts/src/index.ts"],
      "@cc/superai-contracts/*": ["packages/contracts/src/*"],
      "@cc/core-sdk": ["packages/core-sdk/src/index.ts"],
      "@cc/core-sdk/*": ["packages/core-sdk/src/*"],
      "@cc/plugin-sdk": ["packages/plugin-sdk/src/index.ts"],
      "@cc/plugin-sdk/*": ["packages/plugin-sdk/src/*"],
      "@cc/knowledge-api": ["packages/knowledge-api/src/index.ts"],
      "@shared/*": ["shared/*"]
    }
  }
}
```

> **注意**：`tsc-alias -p tsconfig.electron.json` 会在生成 `dist-electron/` 时自动将 `@agentdock/daemon/*` 等别名替换为实际编译后的相对 require 路径，完全规避 Node.js CJS 运行时缺少模块解析器的问题。

### 2.5 启动脚本与 CLI 统一适配

1. **`bin/agentdock.mjs`**：
   - 核心运行时入口由旧路径重定向为新路径：
     ```js
     const daemonEntry = path.join(packageRoot, 'dist-electron', 'services', 'agentdock-daemon', 'src', 'runtime', 'standalone.js');
     const legacyEntry = path.join(packageRoot, 'dist-electron', 'services', 'local-ai-core', 'src', 'runtime', 'standalone.js');
     const coreEntry = existsSync(daemonEntry) ? daemonEntry : legacyEntry;
     ```
   - CLI 帮助信息将 `agentdock core` 升级为 `agentdock daemon`（同时将 `core` 设为向后兼容别名）。
2. **`bin/agentdock-node.mjs`, `bin/mobile-apps.mjs`, `bin/mobile-ui.mjs`**：
   - 入口引用由 `../dist-electron/services/local-ai-core/...` 更新为 `../dist-electron/services/agentdock-daemon/...`。
3. **`apps/shell-desktop/src/main.ts`**：
   - 守护进程拉起函数升级：
     ```ts
     function daemonEntryPath() {
       const newPath = appResourcePath('dist-electron', 'services', 'agentdock-daemon', 'src', 'runtime', 'standalone.js');
       if (existsSync(newPath)) return newPath;
       return appResourcePath('dist-electron', 'services', 'local-ai-core', 'src', 'runtime', 'standalone.js');
     }
     ```
4. **根开发与构建脚本**：
   - `pnpm dev` -> `scripts/dev.mjs` 监听并编译 `apps/shell-web` 与 `apps/shell-desktop`。
   - `pnpm dev:core` 增加别名 `pnpm dev:daemon`。
   - `scripts/copy-managed-skills.mjs` 源路径由 `services/local-ai-core/src/skills/builtin` 更新为 `services/agentdock-daemon/src/skills/builtin`。

---

## 3. 架构/设计决策及理由

### 决策 1：为何选择三层平级拓扑（`apps/` + `services/` + `packages/`）而非将 Daemon 强塞入 `apps/`？
- **评估**：
  - 选项 A（全扔进 `apps/`，即 `apps/shell-desktop`, `apps/shell-web`, `apps/agentdock-daemon`）：虽然概念上“只有应用和库两类”，但抹杀了“客户端交互壳”与“后台系统守护进程”的系统本质区别。
  - 选项 B（标准三层拓扑 `apps/` + `services/` + `packages/`）：
    - `pnpm-workspace.yaml` 原生已声明 `apps/*`、`services/*`、`packages/*`；
    - `apps/*` 纯粹承载用户交互外壳（Desktop Electron Window Shell, Web Browser UI）；
    - `services/*` 承载无头（headless）、独立生命周期、跨网络监听的后端守护进程（`agentdock-daemon`）；
    - `packages/*` 承载无状态可复用库与契约。
- **结论**：采纳选项 B。这是最符合 Monorepo 领域驱动设计、改动风险最小且语义最清晰的权威方案。

### 决策 2：为何保留根包 `@kafca/agentdock` 作为聚合发布包，而非将 `apps/shell-desktop` 独立发版？
- **评估**：
  - 若将发布主体转移至 `apps/shell-desktop`，会导致 npm 镜像仓库、GitHub Release 标签、Homebrew 脚本、Docker 镜像拉取指令全部产生 Breaking Change，且开发者拉取仓库后根目录将无法直接执行 `pnpm dev`。
- **结论**：根 `package.json` 保留聚合入口和发布元数据角色（Distribution Coordinator），内部应用包与服务包设为 `private: true` 纳入 workspace。既达成了代码与依赖的彻底模块化解耦，又对外提供了 100% 稳定的单一产品交付。

### 决策 3：前端构建产物是否维持根级 `dist/renderer` 映射？
- **评估**：
  - 若 Vite 输出到 `apps/shell-web/dist/`，则 `electron-builder`、Electron 生产路径 `appResourcePath('dist', 'renderer')`、`bin/agentdock.mjs` 静态资源托管全部需要同步重写，且涉及复杂的相对路径跨越。
- **结论**：`apps/shell-web/vite.config.ts` 的 `outDir` 显式配置为根目录 `../../dist/renderer`。内部源码物理平级归位，产物交付路径保持稳定，最大化降低回归风险。

### 决策 4：`electron-builder` 打包范围与 ASAR 策略的平级适配
- **评估**：
  - 当前打包配置声明为：
    ```json
    "files": [
      "dist/renderer/**",
      "dist-electron/**",
      "build/icon.png",
      "node_modules/**",
      "package.json"
    ]
    ```
- **结论**：因为所有构建产物依然规范汇总于 `dist/renderer` 和 `dist-electron/`，`electron-builder` 打包输入规则天然与新拓扑 100% 契合，无需重构打包黑盒，完美保障 macOS DMG 和 Windows 安装包生成。

### 决策 5：CI Gates 扫描目录的平级收敛
- **评估**：
  - 现有多项静态检查脚本（`lint-circular.mjs`, `lint-duplicate.mjs`, `lint-metrics-common.mjs`）硬编码了 `ENTRY_DIRS = ['src', 'services', 'packages', 'electron', 'shared']`。
- **结论**：统一收敛为：
  ```js
  export const ENTRY_DIRS = ['apps', 'services', 'packages', 'shared'];
  ```
  优雅消除散落目录的扫描特权，使 CI 门禁在顶层架构上实现真正的规范化平级校验。

---

## 4. 预计影响的模块/文件清单

### 4.1 核心目录与文件物理搬迁表（Move / Rename Map）

| 原文件 / 目录路径 | 目标文件 / 目录路径 | 操作类型 | 说明 |
|---|---|---|---|
| `services/local-ai-core/` | `services/agentdock-daemon/` | `git mv` | 核心守护进程目录整体更名 |
| `electron/` (除 managed-skills) | `apps/shell-desktop/src/` | `git mv` | Electron main.ts, preload.ts 归位至桌面壳 |
| `electron/managed-skills/` | `apps/shell-desktop/managed-skills/` | `git mv` | 桌面静态技能资产归位 |
| `src/` | `apps/shell-web/src/` | `git mv` | React 19 UI 渲染端全部源码归位 |
| `index.html` | `apps/shell-web/index.html` | `git mv` | Web 应用 HTML 入口 |
| `preview.html` | `apps/shell-web/preview.html` | `git mv` | Web 预览 HTML 入口 |
| `vite.config.ts` | `apps/shell-web/vite.config.ts` | `git mv` | Web 打包构建配置归位 |
| `vite-env.d.ts` | `apps/shell-web/vite-env.d.ts` | `git mv` | Web 类型声明归位 |
| `public/` | `apps/shell-web/public/` | `git mv` | Web 静态资源归位 |
| `tailwind.config.ts` | `apps/shell-web/tailwind.config.ts` | `git mv` | Web 样式配置归位（或根部软链） |
| `postcss.config.js` | `apps/shell-web/postcss.config.js` | `git mv` | Web PostCSS 配置归位 |

### 4.2 配置文件新增与调整清单

| 文件路径 | 变更类型 | 核心变更点 |
|---|---|---|
| `pnpm-workspace.yaml` | 修改 | 确认 `apps/*`, `services/*`, `packages/*` 完整覆盖 |
| `package.json` (Root) | 修改 | 调整 `scripts` 启动命令路径、main 入口、依赖分流 |
| `apps/shell-desktop/package.json` | 新增/修改 | 定义 `@agentdock/shell-desktop`，声明 electron 等依赖 |
| `apps/shell-desktop/tsconfig.json` | 新增 | 配置针对 Electron 主进程的 TS 编译选项 |
| `apps/shell-web/package.json` | 新增/修改 | 定义 `@agentdock/shell-web`，声明 react, radix, tailwind 等 |
| `apps/shell-web/tsconfig.json` | 新增 | 配置针对 React JSX 与 DOM 的 TS 编译选项 |
| `services/agentdock-daemon/package.json` | 修改 | 名称更新为 `@agentdock/daemon`，明确自身完整依赖 |
| `services/agentdock-daemon/tsconfig.json` | 新增/修改 | 针对守护进程服务的独立 TS 配置 |
| `tsconfig.json` | 修改 | Base 路径映射升级（指向 `apps/shell-web/src` 等） |
| `tsconfig.electron.json` | 修改 | `include` 与 `paths` 匹配 `apps/shell-desktop` 与 `services/agentdock-daemon` |
| `knip.json` | 修改 | 死代码检查 entry 改为指向 `apps/shell-desktop`, `apps/shell-web`, `services/agentdock-daemon` |
| `.c8rc.json` | 修改 | 覆盖率 include 范围更新为 `apps/**/*.ts`, `services/**/*.ts` 等 |
| `docker/agentdock/core.Dockerfile` | 修改 | `COPY services/local-ai-core` -> `COPY services/agentdock-daemon` |
| `docker/agentdock/Dockerfile` | 修改 | 同步 Dockerfile 复制路径 |
| `docker/agentdock/web.Dockerfile` | 修改 | 同步 Dockerfile 复制路径 |

### 4.3 脚本与入口文件改动清单

- `bin/agentdock.mjs`：更新 coreEntry 路径指向 `agentdock-daemon`。
- `bin/agentdock-node.mjs`, `bin/mobile-apps.mjs`, `bin/mobile-ui.mjs`：更新路径。
- `scripts/dev.mjs`：适配新的工作区结构。
- `scripts/launch-core.mjs`：更新指向 `services/agentdock-daemon/src/runtime/standalone.js`。
- `scripts/copy-managed-skills.mjs`：更新源目录为 `services/agentdock-daemon/src/skills/builtin`。
- `scripts/build-pi-durable.mjs`：更新 worker tsconfig 路径。
- `scripts/lint-circular.mjs`, `scripts/lint-duplicate.mjs`, `scripts/lint-metrics-common.mjs`：将 `ENTRY_DIRS` 更新为 `['apps', 'services', 'packages', 'shared']`。

### 4.4 测试文件与引用重构清单

- 125 个测试文件内部 `from '../../services/local-ai-core/src/...'` 批量安全迁移为 `from '@agentdock/daemon/...'` 或相对路径 `from '../../services/agentdock-daemon/src/...'`。
- `tests/electron/renderer-packaging.test.ts` 更新对 main、testScript 和产物命名的断言。

### 4.5 架构图与核心文档清单

- `docs/architecture/system-architecture.json`：更新 L1 架构图中的组件名称（`Local AI Core` -> `AgentDock Daemon`，以及物理路径映射）。
- `docs/architecture/changes/2026-10-17-agentdock-daemon-peer-topology.md`：记录本架构变更。
- `docs/architecture.md`、`docs/architecture/overview.md`：同步更新架构事实。
- `README.md`、`AGENTS.md`、`DESIGN.md`：同步更新项目目录树与命令说明。

---

## 5. 兼容性、迁移、边界条件和主要风险

### 5.1 兼容性设计（Compatibility Matrix）

1. **运行时环境变量兼容**：
   - 优先读取 `AGENTDOCK_DAEMON_BASE`，向下兼容读取 `VITE_LOCAL_AI_CORE_BASE`；
   - 优先读取 `AGENTDOCK_LOG_DIR`（默认 `~/.agentdock/logs`）；
   - 数据文件继续兼容 `/var/lib/agentdock/runtime/local-core.db`，同时在未来平滑迁移脚本中支持符号链接。
2. **CLI 命令向下兼容**：
   - 用户执行 `agentdock core` 仍能正常运行，内部作为 `agentdock daemon` 的透明别名，输出提示建议使用新指令。
3. **编译产物垫片（Compiled Output Shims）**：
   - 构建流水线在 `dist-electron/electron/main.js` 生成 2 行代码：
     ```js
     module.exports = require('../apps/shell-desktop/src/main.js');
     ```
   - 在 `dist-electron/services/local-ai-core/src/runtime/standalone.js` 生成：
     ```js
     module.exports = require('../../agentdock-daemon/src/runtime/standalone.js');
     ```
   - 彻底防范任何因构建缓存或外部第三方脚本造成的硬编码路径找不到问题。

### 5.2 边界条件与风险防范（Edge Cases & Risk Mitigation）

| 风险场景 | 影响面 | 防护与消除措施 |
|---|---|---|
| **Git 历史提交记录丢失** | 无法通过 `git log --follow` 追踪文件演进 | 严禁通过删除重写的方式移动大文件；**全部使用 `git mv` 执行重命名与归位**，保留完整的 Git 历史链条。 |
| **测试套件 CJS 路径解析失败** | `node --test` 找不到模块引发大面积 Red | 构建阶段通过 `tsc-alias` 统一将别名重写为真实物理相对路径；保留 `dist-electron` 垫片；在正式移除前跑通所有测试。 |
| **Knip 死代码检查误报飙升** | `pnpm lint:dead-code` 门禁挂掉（阈值 172） | 细致更新 `knip.json` 的 `entry` 配置，精确对应 `apps/shell-desktop/src/main.ts`、`apps/shell-web/src/main.tsx` 等新入口。 |
| **ESLint 复杂度门禁波动** | 超出 baseline 108 warnings 触发 CI 失败 | 迁移代码保持 1:1 内容对齐，不做无谓的代码逻辑改动或格式化波动，确保 complexity 告警数维持 108 不变。 |
| **Docker 镜像构建断裂** | 容器化部署失败 | 同步审查并更新 `docker/agentdock/` 下的全部 Dockerfile，并在本地方案中提供验证步骤。 |

---

## 6. 测试策略与门禁保障

为确保本重构百分之百稳妥，执行全套自动化验证矩阵：

```text
               【门禁保障流水线 Verification Matrix】
                                │
   ┌────────────────────────────┼────────────────────────────┐
   ▼                            ▼                            ▼
[静态质量门禁]               [架构契约门禁]               [动态功能门禁]
• pnpm typecheck (0 err)    • pnpm lint:arch (9/9 pass) • pnpm test (1083 tests)
• pnpm lint:circular (0)    • Archify showcase check    • pnpm test:bdd (80 scen)
• pnpm lint:duplicate (pass)• L1 System Arch spec sync  • pnpm coverage (>=68/68/72/66)
• pnpm lint:dead-code (<=172)                           • pnpm e2e:smoke (smoke pass)
• pnpm lint:complexity:gate
```

1. **类型检查**：`pnpm typecheck`（覆盖根 tsconfig、apps/shell-web、services/agentdock-daemon 与 BDD tsconfig）。
2. **六大静态门禁聚合**：`pnpm lint:gates`（含循环依赖、重复代码、死代码分析、文件尺寸、函数长度与复杂度）。
3. **架构规约门禁**：`pnpm lint:arch` 运行 Archify showcase profile，验证架构描述文件无语法或结构漂移。
4. **全量自动化测试**：
   - 运行 1083+ 单元与集成测试：`dist-electron/tests/**/*.test.js`；
   - 运行 80 个 Cucumber BDD 特征场景：`pnpm test:bdd`。
5. **覆盖率基线保护**：`pnpm coverage` 严守 lines>=68, statements>=68, functions>=72, branches>=66。
6. **最终发版构建与冒烟测试**：`pnpm build && pnpm e2e:smoke`，确保 Electron 客户端冷启动、Daemon 探针健康与能力快照完好无损。

---

## 7. 可执行 Spec

### 7.1 Goal
建立清晰、对称、规范的三层 Monorepo 拓扑（`apps/*` 客户端应用壳、`services/*` 独立守护进程、`packages/*` 共享契约与 SDK），彻底终结 `src/` 和 `electron/` 散落根目录的倒挂现状，并将核心运行时彻底由 `local-ai-core` 重命名为 `agentdock-daemon`，全程保持零破坏性发布。

### 7.2 Scope
- 目录结构：`services/local-ai-core` -> `services/agentdock-daemon`；`electron/` -> `apps/shell-desktop`；`src/` -> `apps/shell-web`；
- 构建与配置：`package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `vite.config.ts`, `knip.json`, `eslint.config.mjs`, `.c8rc.json`；
- CLI 与脚本：`bin/*.mjs`, `scripts/*.mjs`；
- Docker：`docker/agentdock/*.Dockerfile`；
- 测试与文档：`tests/**/*.ts`, `AGENTS.md`, `README.md`, `DESIGN.md`, `docs/architecture/*`。

### 7.3 Non-goals
- 不改变前后端通信协议和 REST API 路径签名；
- 不改变 SQLite 存储 Schema 和会话编排业务逻辑；
- 不将单一发布形式拆解为独立的多个 npm 包分别发布；
- 不重构页面 UI 业务组件或样式。

### 7.4 Acceptance Criteria（验收标准）

- [ ] **AC-1 (平级目录生效)**：`src/` 与 `electron/` 均不再作为根目录的一等源码目录存在，分别收敛至 `apps/shell-web` 与 `apps/shell-desktop`；
- [ ] **AC-2 (Daemon 彻底重命名)**：`services/local-ai-core` 物理目录彻底更名为 `services/agentdock-daemon`，包名改为 `@agentdock/daemon`，代码库内除必要的历史兼容垫片外，废除 `local-ai-core` 显式业务命名；
- [ ] **AC-3 (编译与别名生效)**：`pnpm build:web` 产物正常落入 `dist/renderer/`；`pnpm build:electron` 正常产出 `dist-electron/`，别名解析无报错；
- [ ] **AC-4 (启动脚本运行无阻)**：`pnpm dev`, `pnpm dev:core`, `agentdock daemon`, `agentdock core` 均可正常拉起服务与桌面窗口；
- [ ] **AC-5 (全套门禁 100% 通过)**：`pnpm verify`（含 `typecheck`, `lint:gates`, `lint:arch`, `test`, `coverage`）全绿通过，0 错误；
- [ ] **AC-6 (打包与冒烟通过)**：`pnpm build` 与 `pnpm e2e:smoke` 成功执行并通过各项场景验证；
- [ ] **AC-7 (架构与文档一致性)**：L1 架构图通过 Archify 校验并生成一致性事实，README 架构图成功同步更新。

---

## 8. 可执行 Plan（实施路线图）

整个实施分为 6 个可独立提交、安全回退的 Phase：

### Phase 0: 架构基线确认与变更记录准备
1. 确认当前 Git 状态干净，建立重构分支保护；
2. 依据 `docs/architecture/maintenance.md` 创建 `docs/architecture/changes/2026-10-17-agentdock-daemon-peer-topology.md` 变更记录草案；
3. 执行预检基线（`pnpm typecheck && pnpm lint:gates && pnpm lint:arch`）。

### Phase 1: 守护进程物理重命名与包规范化（services/local-ai-core -> services/agentdock-daemon）
1. 使用 `git mv services/local-ai-core services/agentdock-daemon` 执行目录更名；
2. 更新 `services/agentdock-daemon/package.json`（name 改为 `@agentdock/daemon`）；
3. 更新 `pnpm-workspace.yaml` 与根 `package.json` 中的引用；
4. 更新 `scripts/build-pi-durable.mjs`、`scripts/copy-managed-skills.mjs`、`scripts/launch-core.mjs`；
5. 更新 `bin/agentdock.mjs` 及各 node-cli 入口中的查找路径，并建立向后兼容别名；
6. 更新 `docker/agentdock/*.Dockerfile`；
7. 建立兼容垫片 `dist-electron/services/local-ai-core`；
8. 验证：执行 `pnpm build:electron` 确保编译通过。

### Phase 2: 应用壳层平级归位（apps/shell-desktop & apps/shell-web）
1. 使用 `git mv electron apps/shell-desktop/src`（或在 `apps/shell-desktop` 下合理组织，保留 `managed-skills`）；
2. 使用 `git mv src apps/shell-web/src`；
3. 将 `index.html`, `preview.html`, `public`, `vite.config.ts`, `vite-env.d.ts` 迁入 `apps/shell-web/`；
4. 初始化 `apps/shell-desktop/package.json` 与 `apps/shell-web/package.json`；
5. 调整 `apps/shell-web/vite.config.ts` 中的 `outDir` 指向根 `../../dist/renderer`；
6. 调整根 `package.json` 的 `main` 字段指向 `dist-electron/apps/shell-desktop/src/main.js`；
7. 建立兼容垫片 `dist-electron/electron/main.js`。

### Phase 3: TypeScript 编译管线与路径别名升级
1. 重构 `tsconfig.json` 与 `tsconfig.electron.json`：
   - 增加 `@agentdock/daemon/*`、`@agentdock/desktop/*`、`@agentdock/web/*` 路径别名；
   - 更新 `include` 扫描清单（由 `electron/**` 改为 `apps/shell-desktop/**`，`src/**` 改为 `apps/shell-web/**`，`services/local-ai-core/**` 改为 `services/agentdock-daemon/**`）；
2. 为 `apps/shell-desktop`, `apps/shell-web`, `services/agentdock-daemon` 配置各自专属的 `tsconfig.json`；
3. 执行 `pnpm typecheck` 验证全局类型系统完备性。

### Phase 4: 测试套件与代码引用批量更新
1. 批量更新测试套件（`tests/integration/`, `tests/contracts/`, `tests/electron/`）中对 `services/local-ai-core` 的相对引用，统一替换为 `@agentdock/daemon` 或 `services/agentdock-daemon`；
2. 更新 `tests/electron/renderer-packaging.test.ts` 中对 `package.json` 脚本和入口的断言；
3. 适配 `knip.json` 入口配置；
4. 适配 `scripts/lint-circular.mjs`、`scripts/lint-duplicate.mjs`、`scripts/lint-metrics-common.mjs` 中的 `ENTRY_DIRS`；
5. 适配 `.c8rc.json` 中的 `include` 覆盖范围；
6. 执行测试全套回归：`pnpm test && pnpm test:bdd`。

### Phase 5: 架构规约、图表与文档全面同步
1. 更新 `docs/architecture/system-architecture.json`（将 `Local AI Core` 节点更新为 `AgentDock Daemon`，规范拓扑描述）；
2. 运行 `pnpm lint:arch` 验证 Archify 9 项 showcase 规则全部通过；
3. 重新导出架构图产物（HTML, PNG），更新 `README.md` 中的架构图引用块；
4. 更新 `AGENTS.md`、`README.md`、`DESIGN.md` 中的工程目录说明；
5. 完成 `docs/architecture/changes/2026-10-17-agentdock-daemon-peer-topology.md`。

### Phase 6: 全局质量门禁验证与交付验收
1. 运行 `pnpm verify` 执行最终完整把关（`typecheck` + `lint:gates` + `lint:arch` + `test` + `coverage`）；
2. 运行 `pnpm e2e:smoke` 进行冷启动端到端冒烟验证；
3. 检查 Git 变更树，确保无临时未跟踪文件与意外删除；
4. 整理最终重构评审报告，完成方案落地交付。
