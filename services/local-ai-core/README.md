# Local AI Core

`services/local-ai-core` 是桌面端本地核心服务，统一承接：

- runtime/service 状态管理
- 线程与消息路由（本地 ACP）
- 本地 SQLite 持久化
- Feishu/Lark 原生网关
- HTTP API + SSE 事件流

## 目录分层

```txt
src/
  acp/       # ACP backend / store / permission formatting
  gateway/   # 平台网关（当前为 native Lark gateway）
  router/    # workspace 路由与配置归一化
  runtime/   # 本地服务入口（HTTP/SSE server、standalone 启动）
  thread/    # 线程 ID 编解码与 Thread DTO 映射
```

## 核心文件

- `src/runtime/server.ts`: Local AI Core HTTP/SSE 服务
- `src/runtime/standalone.ts`: standalone 启动入口
- `src/router/workspace-router.ts`: workspace 级路由主入口
- `src/gateway/local-core-lark-gateway.ts`: Feishu/Lark 原生网关
- `src/acp/local-core-acp-backend.ts`: ACP 子进程桥接与流式事件处理
- `src/acp/local-core-acp-store.ts`: SQLite 持久化层

## 对外接口（概览）

- 健康检查：`GET /api/local/v1/health`
- runtime：`/api/local/v1/runtime/*`
- 配置：`/api/local/v1/config*`
- 线程：`/api/local/v1/threads*`
- 知识库：`/api/local/v1/knowledge*`
- Lark 网关：`/api/local/v1/platforms/lark/*`
- 事件流：`GET /api/local/v1/events`（SSE）

> 具体路由定义以 `src/runtime/server.ts` 为准。

## 本地开发与验证

在仓库根目录执行：

```bash
pnpm build:electron
pnpm test
```

仅启动本地核心（已构建产物）：

```bash
pnpm start:core
```

开发模式（构建并启动本地核心）：

```bash
pnpm dev:core
```

## 设计约束

- 内部平台类型统一使用 `lark`（兼容读取 `feishu`）
- Local AI Core 为本地线程与事件流的统一入口
- 本仓库默认运行形态为 Local AI Core 单核运行时，不依赖 `cc-connect`
