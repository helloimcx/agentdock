# AgentDock

基于 Local AI Core 的本地桌面 AI 工作台，内置原生 Feishu/Lark 网关与本地 ACP 会话运行时。

## 运行模式

- **桌面模式** — Electron 作为壳进程启动本地 Local AI Core，并加载桌面 UI
- **Local AI Core 模式** — 通过本地 `127.0.0.1:9831` 提供 runtime、chat、知识库与 Lark 网关能力

## 技术栈

React 19 · Electron 35 · Vite · TypeScript · Tailwind CSS · Zustand · i18next · react-markdown

## New

### 2026-05-03

- 新增 Lark 机器人扫码新建/绑定入口，基于官方 Device Flow 自动创建应用，扫码确认后自动感知、写回 App ID/App Secret，并立即激活到可发送消息状态。
- 支持同一个 workspace 绑定多个 Lark/微信 channel 实例，实例级隔离运行时、扫码绑定和消息路由。
- Lark 扫码创建机器人默认请求 `card.action.trigger` 卡片回传交互回调，并自动启用卡片按钮处理。
- 优化 channel 工具与权限交互：Lark 工具结果默认隐藏详细输出，权限按钮点击完成后移除可重复点击按钮。
- 新增通用 channel outbound 文件回传能力，支持通过当前或指定 Lark/微信会话发送本地文件。
- 调整 Local AI Core channel 目录结构，将 Lark、微信实现隔离到独立模块，并保留公共文件处理能力。

### 2026-05-02

- 新增通用 channel 图片消息到 ACP 多模态传递。
- 新增 Codex Agent ACP 支持，并接入 runtime 检测与交互权限流程。

## 快速开始

```bash
pnpm install
pnpm dev          # 启动开发环境（Vite + Electron）
pnpm start:core   # 启动已构建的 Local AI Core
```

## macOS 打开应用

如果安装后提示应用无法打开，可先清除隔离属性再启动：

```bash
xattr -cr /Applications/AgentDock.app
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 启动开发环境 |
| `pnpm dev:web` | 仅启动 Web 开发服务器 |
| `pnpm dev:core` | 构建并启动 Local AI Core |
| `pnpm build` | 完整生产构建 |
| `pnpm build:renderer` | 仅构建 React 前端 |
| `pnpm build:electron` | 仅构建 Electron 主进程 |
| `pnpm build:core` | 构建 Local AI Core 产物 |
| `pnpm start:core` | 运行已构建的 Local AI Core |
| `pnpm start:prod` | 运行已构建的 Electron 应用 |
| `pnpm e2e:smoke` | E2E 冒烟测试 |

## 环境变量

| 变量 | 说明 |
|---|---|
| `AI_WORKSTATION_USER_DATA_DIR` | 用户数据目录 |
| `AI_WORKSTATION_SMOKE_OUTPUT` | 冒烟测试输出路径 |
| `AI_WORKSTATION_SMOKE_SCENARIO` | 冒烟测试场景 |
| `AI_WORKSTATION_FORCE_RUNTIME_STATUS_ERROR` | 强制触发运行时状态错误，用于测试 |
| `AI_WORKSTATION_DEV_SERVER_URL` | Electron 开发模式连接的前端地址 |

## 项目结构

```
├── electron/        # Electron 主进程壳
├── apps/            # 未来的桌面/Web 前端壳目录
├── packages/        # contracts、core-sdk、knowledge-api
├── services/        # Local AI Core
├── src/             # React 渲染进程
│   ├── pages/       # 页面组件
│   ├── components/  # UI 组件库
│   ├── api/         # API 客户端
│   ├── store/       # Zustand 状态管理
│   └── types/       # 类型定义
├── shared/          # 跨进程共享类型
└── scripts/         # 构建/启动脚本
```
