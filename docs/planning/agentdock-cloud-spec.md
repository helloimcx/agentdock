# AgentDock Cloud 完整开发 SPEC

版本：`v0.1`
模式：`Cloud Mode`
核心定位：**AgentDock Cloud 是 AgentDock 的云端 Agent 执行平面，并为 Cloud Web 提供与本地模式一致的会话 API 和 SSE。**

当前代码落地状态：已实现可编译的 MVP 骨架、端到端 fake sandbox 流程、OpenSandbox lifecycle/execd adapter、Cloud Web local-compatible API/SSE、SQLite 投影、output 文件扫描，以及基于官方 `rocketmq-client-nodejs` 的 RocketMQ Proxy producer/consumer adapter。compose 默认通过 `rocketmq-proxy:8081` 走真实 RocketMQ，测试和本机 smoke 可切换为 memory adapter。

---

# 1. 背景与目标

## 1.1 背景

AgentDock 当前已有本地运行形态：

```text
Desktop App
  ↓
local-ai-core
  ↓
本地 Agent Runtime
```

现在需要新增云端运行形态：

```text
Cloud Web / Client / Upstream Service
  ↓
AgentDock Cloud
  ↓
OpenSandbox
  ↓
Sandbox Runtime
  ↓
RocketMQ
  ↓
AgentDock Cloud Event Consumer
  ↓
SQLite conversation projection + SSE
```

其中：

```text
Cloud Web：
  与 local 模式核心 chat 工作流功能和样式保持一致的 Web UI；MVP 仅用于验证流程通路。

Client / Upstream Service：
  任意可信调用方，用于创建任务、查询任务、取消任务；实际使用时主要直接消费 RocketMQ 事件。

AgentDock Cloud Event Consumer：
  AgentDock Cloud 内置事件消费模块，消费 RocketMQ 中 sandbox 运行事件，更新会话投影并向 Web 前端发送 SSE。

AgentDock Cloud：
  负责 Agent 云端执行、会话记录投影、Cloud Web API 和 SSE。
```

---

## 1.2 项目目标

实现一个新的云端服务：

```text
services/agentdock-cloud
```

它负责：

```text
1. 接收任务创建请求
2. 创建空项目工作目录、任务记录和会话记录
3. 调用 OpenSandbox 创建 sandbox
4. 准备本地卷 project workspace 和独立 runtime metadata
5. 创建 sandbox，并多 bind mount 必要目录
6. 启动 sandbox 内的 AgentDock Runtime
7. 解析 Agent Runtime 输出的结构化事件
8. 将事件补全为标准 Cloud Event
9. 发布事件到 RocketMQ
10. 消费 RocketMQ 中的 Cloud Event
11. 投影为与 local 模式一致的 thread/message/run/task 记录
12. 通过 SSE 推送 local-compatible event 给 Cloud Web
13. 扫描当前 session output 文件并登记元数据
14. 更新任务状态
15. 清理 sandbox
```

---

## 1.3 非目标

AgentDock Cloud **不负责**：

```text
1. 桌面客户端连接
2. WebSocket，Cloud Web 实时更新使用 SSE
3. 第三方业务消费端
4. 第三方客户端推送协议
5. 调用方用户体系；Cloud Web MVP 不做登录鉴权
6. 调用方业务会话体系
7. 调用方 UI 协议；但 Cloud Web 使用 AgentDock 自身 local-compatible API
8. 调用方业务权限
9. Portal Server 逻辑
10. 多实例调度，MVP 暂不做
11. 独立任务队列，MVP 暂不做
```

---

# 2. 总体架构

## 2.1 云端执行链路

```text
┌────────────────────────────┐
│ Cloud Web / Upstream        │
│ - same UI as local mode     │
│ - create/query/cancel task  │
│ - thread/message APIs       │
└──────────────┬─────────────┘
               │ HTTP / SSE
               ▼
┌────────────────────────────┐
│ AgentDock Cloud             │
│                            │
│ API Layer                  │
│ - create task              │
│ - query task               │
│ - cancel task              │
│ - query output files       │
│ - local-compatible threads │
│ - local-compatible events  │
│                            │
│ Execution Layer            │
│ - local execution manager  │
│ - task executor            │
│ - OpenSandbox provider     │
│ - runtime runner           │
│ - local volume workspace   │
│                            │
│ Event Layer                │
│ - runtime event parser     │
│ - event sequencer          │
│ - RocketMQ publisher       │
│ - RocketMQ consumer        │
│ - conversation projector   │
│ - SSE broadcaster          │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ OpenSandbox Server          │
│ - create sandbox            │
│ - exec command              │
│ - mount project workspace   │
│ - delete sandbox            │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ Sandbox Container           │
│ image: sandbox-runtime      │
│ /workspace isolated         │
└──────────────┬─────────────┘
               │ stdout/events.jsonl
               ▼
┌────────────────────────────┐
│ AgentDock Cloud             │
│ parse + enrich events       │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ RocketMQ                    │
│ topic: agentdock_events     │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ AgentDock Cloud Consumer     │
│ - consume sandbox events     │
│ - update SQLite projection   │
│ - broadcast SSE to web       │
└────────────────────────────┘
```

## 2.1.1 Docker Compose 模块

MVP 使用 docker-compose 部署：

```text
web
  ↓ HTTP / SSE
agentdock-cloud
  ↓
rocketmq-namesrv / rocketmq-broker
  ↓
opensandbox-server
  ↓
sandbox-runtime containers
```

compose 第一版包含：

```text
1. web：AgentDock Web UI，复用 local 模式核心 chat 前端代码和样式，仅用于验证通路。
2. agentdock-cloud：Cloud API、执行管理、RocketMQ producer/consumer、SQLite、SSE。
3. rocketmq-namesrv。
4. rocketmq-broker。
5. opensandbox-server。
```

不包含 PostgreSQL；数据存储使用 agentdock-cloud 容器挂载卷中的 SQLite。

---

## 2.2 与 local-ai-core 的关系

`local-ai-core` 和 `agentdock-cloud` 是两种运行壳。

```text
local-ai-core       agentdock-cloud
     │                    │
     └───────┬────────────┘
             ▼
       shared packages
```

不允许：

```text
agentdock-cloud
  ↓ HTTP
local-ai-core
```

推荐：

```text
local-ai-core 使用 runtime-core / acp-core / plugin-core
agentdock-cloud 也使用 runtime-core / acp-core / plugin-core
```

---

# 3. 仓库结构

## 3.1 顶层结构

```text
services/
  agentdock-cloud/
  local-ai-core/

apps/
  shell-web/

images/
  sandbox-runtime/

packages/
  runtime-core/
  acp-core/
  plugin-core/
  workspace-core/
  sandbox-core/
  event-core/
  rocketmq-core/
  contracts/
  plugin-sdk/
```

---

## 3.2 `services/agentdock-cloud`

```text
services/agentdock-cloud/
  src/
    main.ts

    api/
      task.controller.ts
      workspace.controller.ts
      thread.controller.ts
      event-stream.controller.ts
      health.controller.ts

    application/
      task-service.ts
      task-lifecycle-service.ts
      task-cancel-service.ts
      conversation-service.ts

    execution/
      local-execution-manager.ts
      task-executor.ts
      running-task-registry.ts
      task-resource-limiter.ts
      runtime-command-builder.ts

    sandbox/
      sandbox-provider.ts
      opensandbox-provider.ts
      sandbox-types.ts

    workspace/
      workspace-layout.ts
      local-volume-storage-provider.ts
      workspace-path-guard.ts

    events/
      cloud-event-types.ts
      event-sequencer.ts
      runtime-event-parser.ts
      event-publisher.ts
      rocketmq-event-publisher.ts
      rocketmq-event-consumer.ts
      conversation-projector.ts
      sse-broadcaster.ts

    persistence/
      db.ts
      task-repository.ts
      event-repository.ts
      file-repository.ts
      thread-repository.ts
      message-repository.ts
      run-repository.ts

    config/
      config.ts

    errors/
      errors.ts

    observability/
      logger.ts
      metrics.ts
```

---

## 3.3 `images/sandbox-runtime`

```text
images/
  sandbox-runtime/
    Dockerfile
    entrypoint.sh
    package.json
    README.md
```

镜像用途：

```text
提供标准化 Agent Runtime 执行环境。
```

---

# 4. 核心服务职责

## 4.1 AgentDock Cloud

负责：

```text
1. 对可信调用方提供任务 API
2. 维护任务状态
3. 调用 OpenSandbox 管理 sandbox
4. 准备并挂载本地卷 workspace
5. 启动 Agent Runtime
6. 解析 sandbox stdout / events.jsonl
7. 发布 RocketMQ 事件
8. 消费 RocketMQ 事件
9. 更新 SQLite 会话投影
10. 通过 SSE 推送 Cloud Web
11. 记录关键事件
12. 清理执行资源
```

不负责：

```text
1. 第三方 RocketMQ 消费端
2. WebSocket
3. 第三方客户端实时推送
4. 调用方权限体系
5. 调用方业务流程
```

---

## 4.2 OpenSandbox

负责：

```text
1. sandbox 创建
2. sandbox 删除
3. sandbox command exec
4. sandbox 本地卷挂载
5. sandbox TTL
6. Docker runtime 管理
```

AgentDock Cloud 不直接调用 Docker。

---

## 4.3 Sandbox Runtime

负责：

```text
1. 在 sandbox 内启动 AgentDock Runtime
2. 执行具体 Agent
3. 读写 /workspace
4. 输出结构化运行事件
5. 写 /workspace/.agentdock/task/logs/events.jsonl
6. 生成 /workspace/.agentdock/output 产物
```

不负责：

```text
1. 连接 RocketMQ
2. 持有数据库凭证
3. 持有对象存储写权限
4. 持有调用方 token
5. 访问 Docker socket
```

---

## 4.4 Cloud Web

Cloud Web 属于 docker-compose 云端版本的一部分。

负责：

```text
1. 复用 local 模式核心 chat UI、路由、组件、样式和交互。
2. 通过 agentdock-cloud HTTP API 读写 workspace/thread/message/task。
3. 通过 agentdock-cloud SSE 接收 local-compatible events。
4. 用户不应从 UI 感知 agent 是本地进程还是 sandbox runtime。
5. MVP 只覆盖 workspace/project 创建、thread 列表、thread 详情、发送消息、流式消息、run 状态、取消任务。
```

区别：

```text
1. local 模式前端连接 local-ai-core。
2. cloud 模式前端连接 agentdock-cloud。
3. cloud 模式的 agent 运行在 OpenSandbox 创建的 container sandbox 中。
4. cloud 模式的 SSE 来源是 RocketMQ 中的 sandbox Cloud Events，经 agentdock-cloud 投影后广播。
5. Cloud Web MVP 不显示项目文件树，不浏览项目文件内容；`GET /api/v1/tasks/:taskId/files` 保留给调试和上游查询。
```

---

## 4.5 External Event Consumer

不属于 AgentDock Cloud。

它可以：

```text
1. 消费 RocketMQ
2. 将事件推给客户端
3. 落库
4. 聚合
5. 触发自动化流程
6. 做审计
```

---

# 5. API SPEC

所有 API 面向可信调用方。MVP docker-compose 中 Cloud Web 仅用于流程验证，`/api/local/v1/*` 不做登录鉴权；`/api/v1/*` 可保留内部 API key 开关，但 MVP 不以鉴权为阻塞项。

统一前缀：

```text
/api/v1
```

后续生产鉴权方式：

```http
Authorization: Bearer <AGENTDOCK_CLOUD_API_KEY>
```

---

## 5.1 创建任务

```http
POST /api/v1/tasks
```

### Request

```json
{
  "tenantId": "tenant_123",
  "userId": "user_456",
  "workspaceId": "ws_001",
  "threadId": "thread_001",
  "agentId": "pi",
  "message": "帮我分析这个项目",
  "inputFiles": [],
  "runtime": {
    "sandboxProvider": "opensandbox",
    "image": "agentdock/sandbox-runtime:v0.1.0",
    "cpu": 2,
    "memoryMb": 4096,
    "timeoutSeconds": 600,
    "workspaceSizeMb": 10240
  },
  "metadata": {
    "caller": "portal",
    "callerTaskId": "caller_task_001",
    "clientRequestId": "req_001"
  }
}
```

### Response

```json
{
  "taskId": "task_789",
  "runId": "run_001",
  "status": "accepted"
}
```

### 行为

```text
1. 校验请求参数
2. 创建 task 记录，status=created
3. 发布 task.created 事件
4. 检查本实例并发容量
5. 注册 running task
6. 异步启动 TaskExecutor
7. 更新 status=accepted
8. 发布 task.accepted 事件
9. 返回 taskId/runId
```

HTTP 请求不等待 Agent 执行完成。

---

## 5.2 查询任务

```http
GET /api/v1/tasks/:taskId
```

### Response

```json
{
  "taskId": "task_789",
  "runId": "run_001",
  "tenantId": "tenant_123",
  "userId": "user_456",
  "workspaceId": "ws_001",
  "threadId": "thread_001",
  "agentId": "codex",
  "status": "running",
  "sandboxId": "sandbox_abc",
  "runtimeImage": "agentdock/sandbox-runtime:v0.1.0",
  "metadata": {
    "caller": "portal",
    "callerTaskId": "caller_task_001",
    "clientRequestId": "req_001"
  },
  "createdAt": "2026-05-13T12:00:00.000Z",
  "acceptedAt": "2026-05-13T12:00:01.000Z",
  "startedAt": "2026-05-13T12:00:03.000Z",
  "finishedAt": null,
  "errorCode": null,
  "errorMessage": null
}
```

---

## 5.3 取消任务

```http
POST /api/v1/tasks/:taskId/cancel
```

### Response

```json
{
  "taskId": "task_789",
  "status": "cancelling"
}
```

### 行为

```text
1. 查询 task
2. 如果任务已结束，返回当前状态
3. 更新 status=cancelling
4. 发布 task.cancelling
5. ExecutionManager 找到 RunningTask
6. 调用 OpenSandbox stop/delete
7. 更新 status=cancelled
8. 发布 task.cancelled
```

---

## 5.4 查询输出文件

```http
GET /api/v1/tasks/:taskId/files
```

### Response

```json
{
  "taskId": "task_789",
  "files": [
    {
      "fileId": "file_out_001",
      "path": "output/report.md",
      "objectUri": "local-volume://tenant/tenant_123/user/user_456/workspace/ws_001/thread/thread_001/task/task_789/output/report.md",
      "sizeBytes": 18492,
      "mimeType": "text/markdown",
      "checksum": "sha256:xxx",
      "createdAt": "2026-05-13T12:03:00.000Z"
    }
  ]
}
```

---

## 5.5 健康检查

```http
GET /healthz
```

```json
{
  "status": "ok",
  "service": "agentdock-cloud",
  "instanceId": "agentdock-cloud-01"
}
```

---

## 5.6 Metrics

```http
GET /metrics
```

Prometheus 格式。

---

## 5.7 Cloud Web Compatible APIs

Cloud Web 需要复用 local 模式功能和样式，因此 AgentDock Cloud 必须提供与前端期望一致的会话 API。

MVP 优先兼容 renderer 当前使用的 local-core API 形状：

```http
GET /api/local/v1/health
GET /api/local/v1/capabilities/snapshot
GET /api/local/v1/workspaces
GET /api/local/v1/workspaces/:workspaceId/threads
POST /api/local/v1/workspaces/:workspaceId/threads
GET /api/local/v1/threads/:threadId
POST /api/local/v1/threads/:threadId/messages
POST /api/local/v1/threads/:threadId/cancel
GET /api/local/v1/events
```

兼容要求：

```text
1. Cloud Web 和 local 模式使用同一套 React 页面、组件和样式。
2. Cloud Web 只通过配置切换 API base，从 local-ai-core 切到 agentdock-cloud。
3. 用户在 UI 上不应感知 agent 运行位置差异。
4. Cloud API 返回的 ThreadSummary、ThreadDetail、ThreadMessage、RunSummary、LocalCoreEvent 应复用 shared contracts。
5. MVP 只做核心 chat 工作流，不显示项目文件树、不预览项目文件内容。
6. MVP 不要求实现 local 模式所有系统配置、runtime 安装、channel gateway、knowledge、scheduler、monitor API；未支持能力通过 capabilities snapshot 隐藏。
```

---

## 5.8 SSE

```http
GET /api/local/v1/events
```

AgentDock Cloud 对 Cloud Web 暴露 SSE，event name 与 local 模式保持一致：

```text
runtime.updated
thread.updated
thread.session.activated
message.created
message.updated
run.updated
presence.updated
stream.updated
```

SSE 事件来源：

```text
1. sandbox runtime 输出结构化事件。
2. AgentDock Cloud 补全为 Cloud Event 并发布 RocketMQ。
3. AgentDock Cloud 内置 RocketMQ consumer 消费 Cloud Event。
4. ConversationProjector 更新 SQLite thread/message/run/task 投影。
5. SseBroadcaster 将投影结果转换为 LocalCoreEvent 推给 Web。
```

RocketMQ 是 Cloud Web MVP 的唯一实时数据源：TaskExecutor 不直接推 SSE，也不绕过 RocketMQ 更新聊天流。

Cloud Web 不直接消费 RocketMQ，也不直接理解 AgentDockCloudEvent。

---

# 6. 任务状态机

```text
created
  ↓
accepted
  ↓
input_syncing
  ↓
sandbox_creating
  ↓
sandbox_created
  ↓
running
  ↓
output_syncing
  ↓
succeeded
```

失败分支：

```text
failed
```

取消分支：

```text
cancelling
  ↓
cancelled
```

超时分支：

```text
timeout
```

---

## 6.1 状态定义

| 状态                 | 说明                 |
| ------------------ | ------------------ |
| `created`          | 任务记录已创建            |
| `accepted`         | 本实例已接收执行           |
| `sandbox_creating` | 正在创建 sandbox       |
| `sandbox_created`  | sandbox 已创建        |
| `input_syncing`    | 正在准备本地卷 workspace |
| `running`          | Agent Runtime 正在运行 |
| `output_syncing`   | 正在扫描 output 文件     |
| `succeeded`        | 执行成功               |
| `failed`           | 执行失败               |
| `cancelling`       | 正在取消               |
| `cancelled`        | 已取消                |
| `timeout`          | 执行超时               |

---

# 7. 数据库 SPEC

MVP 复用现有本地模式的 SQLite 存储思路，不引入 PostgreSQL 服务。

默认数据库文件：

```text
/data/agentdock/agentdock-cloud.db
```

说明：

```text
1. SQLite 只服务单实例 docker-compose MVP。
2. JSON 字段统一以 TEXT 保存 JSON 字符串。
3. 时间字段统一保存 ISO 8601 字符串。
4. 后续多实例部署时再迁移到 PostgreSQL 或其他外部数据库。
```

---

## 7.1 `agent_tasks`

```sql
CREATE TABLE agent_tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,

  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,

  status TEXT NOT NULL,

  sandbox_id TEXT,
  runtime_image TEXT,
  runtime_payload_json TEXT,
  input_payload_json TEXT,
  metadata_json TEXT,

  error_code TEXT,
  error_message TEXT,

  created_at TEXT NOT NULL,
  accepted_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_agent_tasks_tenant_user
ON agent_tasks (tenant_id, user_id);

CREATE INDEX idx_agent_tasks_workspace_thread
ON agent_tasks (workspace_id, thread_id);

CREATE INDEX idx_agent_tasks_status
ON agent_tasks (status);

CREATE INDEX idx_agent_tasks_created_at
ON agent_tasks (created_at);
```

---

## 7.2 `agent_events`

MVP 可只落关键事件；生产建议落全量事件。

```sql
CREATE TABLE agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  event_id TEXT NOT NULL UNIQUE,

  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,

  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  metadata_json TEXT,
  source_json TEXT,

  created_at TEXT NOT NULL,

  UNIQUE(task_id, run_id, seq)
);

CREATE INDEX idx_agent_events_task_seq
ON agent_events (task_id, run_id, seq);

CREATE INDEX idx_agent_events_type
ON agent_events (type);
```

---

## 7.3 `workspace_files`

```sql
CREATE TABLE workspace_files (
  id TEXT PRIMARY KEY,

  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  thread_id TEXT,
  task_id TEXT,

  path TEXT NOT NULL,
  kind TEXT NOT NULL,

  object_uri TEXT NOT NULL,
  size_bytes INTEGER,
  mime_type TEXT,
  checksum TEXT,

  created_at TEXT NOT NULL
);

CREATE INDEX idx_workspace_files_task
ON workspace_files (task_id);

CREATE INDEX idx_workspace_files_workspace
ON workspace_files (workspace_id);
```

---

## 7.4 `workspace_registry`

Cloud Web 创建的项目需要持久化工作目录。`workspace_registry` 记录 workspace 与宿主机本地卷目录的绑定关系。

```sql
CREATE TABLE workspace_registry (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  workdir_path TEXT NOT NULL,
  default_agent_id TEXT NOT NULL DEFAULT 'pi',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT
);

CREATE INDEX idx_workspace_registry_tenant_user
ON workspace_registry (tenant_id, user_id);
```

`workdir_path` 指向宿主机或 compose volume 内的项目工作目录，例如：

```text
/data/agentdock/workspaces/tenant/{tenantId}/user/{userId}/workspace/{workspaceId}/workdir
```

OpenSandbox 创建 agent sandbox 时将该目录挂载到容器内：

```text
/workspace
```

系统运行元数据不写入 `workdir_path`。task runtime dir 和 session output dir 使用 `storage.runtimeRoot` 下的独立路径，并通过额外 bind mount 暴露给 sandbox。

---

## 7.5 `threads`

Cloud threads 与 local 模式保持同一语义，用于 Cloud Web 会话列表和会话详情。

```sql
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  bridge_session_key TEXT NOT NULL,
  title TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  history_count INTEGER NOT NULL DEFAULT 0,
  excerpt TEXT,
  agent_mode TEXT NOT NULL DEFAULT 'default'
);

CREATE INDEX idx_threads_workspace_updated
ON threads (workspace_id, updated_at DESC);

CREATE INDEX idx_threads_tenant_user
ON threads (tenant_id, user_id);
```

---

## 7.6 `messages`

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_call_json TEXT,
  bridge_kind TEXT,
  bridge_status TEXT,
  timestamp TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'message',
  seq INTEGER NOT NULL
);

CREATE INDEX idx_messages_thread_seq
ON messages (thread_id, seq);
```

---

## 7.7 `runs`

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  task_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_runs_thread_updated
ON runs (thread_id, updated_at DESC);

CREATE INDEX idx_runs_task
ON runs (task_id);
```

---

## 7.8 Conversation Projection

RocketMQ consumer 将 `AgentDockCloudEvent` 投影为 local-compatible 会话记录：

| Cloud Event | SQLite Projection | SSE |
| --- | --- | --- |
| `task.accepted` / `task.started` | upsert `runs(status=running)` | `run.updated`, `presence.updated` |
| `agent.message.delta` | append/update assistant progress message | `message.created` or `message.updated`, `stream.updated` |
| `agent.message.completed` | finalize assistant message | `message.updated`, `presence.updated` |
| `agent.thought.delta` | append/update thought progress message | `message.created` or `message.updated`, `stream.updated` |
| `agent.plan.updated` | append/update plan progress message | `message.created` or `message.updated`, `stream.updated` |
| `tool.started` / `tool.delta` / `tool.finished` | append/update tool progress message | `message.created` or `message.updated`, `stream.updated` |
| `task.succeeded` | update run/task completed | `run.updated`, `presence.updated` |
| `task.failed` / `task.cancelled` / `task.timeout` | update run/task terminal state | `run.updated`, `presence.updated` |

投影规则：

```text
1. POST message 时先写入 user message，再创建 run/task。
2. 同一个 run 的 assistant delta 复用稳定 message id，避免前端重复气泡。
3. projector 必须按 taskId/runId/seq 幂等处理事件。
4. SSE payload 使用 LocalCoreEvent shape，尽量不新增前端专用事件。
```

---

# 8. Cloud Event SPEC

AgentDock Cloud 发布到 RocketMQ 的标准事件。

---

## 8.1 Event Envelope

```ts
export interface AgentDockCloudEvent {
  eventId: string;

  tenantId: string;
  userId: string;

  workspaceId: string;
  threadId: string;
  taskId: string;
  runId: string;

  seq: number;
  type: AgentDockCloudEventType;
  payload: unknown;

  timestamp: string;

  metadata?: Record<string, unknown>;

  source: {
    service: "agentdock-cloud";
    instanceId: string;
    sandboxId?: string;
    agentId?: string;
    runtimeImage?: string;
  };
}
```

---

## 8.2 Event Type

```ts
export type AgentDockCloudEventType =
  | "task.created"
  | "task.accepted"
  | "task.started"
  | "task.succeeded"
  | "task.failed"
  | "task.cancelling"
  | "task.cancelled"
  | "task.timeout"

  | "sandbox.creating"
  | "sandbox.created"
  | "sandbox.deleted"
  | "sandbox.failed"

  | "workspace.input_syncing"
  | "workspace.input_synced"
  | "workspace.output_syncing"
  | "workspace.output_synced"

  | "agent.started"
  | "agent.message.delta"
  | "agent.message.completed"
  | "agent.thought.delta"
  | "agent.plan.updated"

  | "tool.started"
  | "tool.delta"
  | "tool.finished"
  | "tool.failed"

  | "file.created"
  | "file.updated"

  | "runtime.log"
  | "runtime.error";
```

---

## 8.3 RocketMQ

Topic：

```text
agentdock_events
```

Tags：

```text
task
sandbox
workspace
agent
tool
file
runtime
error
```

Key：

```text
taskId
```

---

## 8.4 Tag 映射规则

| Event Type Prefix | Tag         |
| ----------------- | ----------- |
| `task.*`          | `task`      |
| `sandbox.*`       | `sandbox`   |
| `workspace.*`     | `workspace` |
| `agent.*`         | `agent`     |
| `tool.*`          | `tool`      |
| `file.*`          | `file`      |
| `runtime.log`     | `runtime`   |
| `runtime.error`   | `error`     |

---

## 8.5 示例事件

```json
{
  "eventId": "evt_001",
  "tenantId": "tenant_123",
  "userId": "user_456",
  "workspaceId": "ws_001",
  "threadId": "thread_001",
  "taskId": "task_789",
  "runId": "run_001",
  "seq": 1,
  "type": "task.accepted",
  "payload": {
    "message": "任务已接收"
  },
  "timestamp": "2026-05-13T12:00:01.000Z",
  "metadata": {
    "caller": "portal",
    "callerTaskId": "caller_task_001",
    "clientRequestId": "req_001"
  },
  "source": {
    "service": "agentdock-cloud",
    "instanceId": "agentdock-cloud-01",
    "agentId": "codex"
  }
}
```

---

# 9. Sandbox Runtime Event SPEC

Sandbox 内部不直接发 RocketMQ。

---

## 9.1 stdout 格式

```text
__AGENTDOCK_EVENT__ {"type":"agent.message.delta","payload":{"delta":"正在分析项目结构..."}}
```

---

## 9.2 `events.jsonl`

同时写：

```text
/workspace/.agentdock/task/logs/events.jsonl
```

每行：

```json
{"type":"agent.message.delta","payload":{"delta":"正在分析项目结构..."},"timestamp":"2026-05-13T12:00:08.000Z"}
```

---

## 9.3 Runtime Event 类型

```ts
export interface SandboxRuntimeEvent {
  type: string;
  payload: unknown;
  timestamp?: string;
}
```

AgentDock Cloud 负责补全：

```text
eventId
tenantId
userId
workspaceId
threadId
taskId
runId
seq
metadata
source
```

---

# 10. OpenSandbox 集成 SPEC

## 10.1 `SandboxProvider`

```ts
export interface SandboxProvider {
  create(input: CreateSandboxInput): Promise<SandboxRef>;

  uploadFile(
    sandboxId: string,
    input: UploadFileInput,
  ): Promise<void>;

  exec(
    sandboxId: string,
    input: ExecInput,
  ): AsyncIterable<SandboxExecEvent>;

  downloadFile(
    sandboxId: string,
    input: DownloadFileInput,
  ): Promise<Buffer>;

  listFiles(
    sandboxId: string,
    input: ListFilesInput,
  ): Promise<SandboxFileInfo[]>;

  delete(sandboxId: string): Promise<void>;

  stop(sandboxId: string): Promise<void>;
}
```

---

## 10.2 `CreateSandboxInput`

```ts
export interface CreateSandboxInput {
  taskId: string;
  runId: string;
  image: string;
  cpu: number;
  memoryMb: number;
  timeoutSeconds: number;
  env: Record<string, string>;
  labels: Record<string, string>;
  mounts: SandboxMount[];
}

export interface SandboxMount {
  source: string;
  target: string;
  readonly?: boolean;
}
```

MVP 必须支持多个 bind mount：

```text
1. project workdir -> /workspace
2. current task runtime dir -> /workspace/.agentdock/task
3. current session output dir -> /workspace/.agentdock/output
```

Agent 只能看到当前 task runtime dir 和当前 session output；不能看到其他 session/task 的 output 或系统元数据。

---

## 10.3 `SandboxRef`

```ts
export interface SandboxRef {
  id: string;
  status: "created" | "running" | "stopped" | "deleted";
}
```

---

## 10.4 `UploadFileInput`

```ts
export interface UploadFileInput {
  localPath?: string;
  buffer?: Buffer;
  remotePath: string;
}
```

---

## 10.5 `DownloadFileInput`

```ts
export interface DownloadFileInput {
  remotePath: string;
}
```

---

## 10.6 `ListFilesInput`

```ts
export interface ListFilesInput {
  remotePath: string;
  recursive?: boolean;
}
```

---

## 10.7 `SandboxFileInfo`

```ts
export interface SandboxFileInfo {
  path: string;
  sizeBytes: number;
  isDirectory: boolean;
  modifiedAt?: string;
}
```

---

## 10.8 `ExecInput`

```ts
export interface ExecInput {
  command: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutSeconds: number;
}
```

---

## 10.9 `SandboxExecEvent`

```ts
export type SandboxExecEvent =
  | {
      type: "stdout";
      data: string;
    }
  | {
      type: "stderr";
      data: string;
    }
  | {
      type: "exit";
      exitCode: number;
      signal?: string;
    };
```

---

# 11. Workspace SPEC

## 11.1 Sandbox 内目录

```text
/workspace/
  ...                 用户项目文件，持久化在宿主机本地卷
  .agentdock/
    task/             当前 task runtime dir，单独 bind mount
      message.json
      scratch/
      logs/
        events.jsonl
    output/           当前 session output，单独 bind mount
```

---

## 11.2 宿主机本地卷路径

```text
/data/agentdock/workspaces/
  tenant/{tenantId}/
    user/{userId}/
      workspace/{workspaceId}/
        workdir/     持久化项目工作目录，挂载为 sandbox /workspace

/data/agentdock/runtime/
  tenant/{tenantId}/
    user/{userId}/
      workspace/{workspaceId}/
        sessions/{sessionId}/output/   当前 session output，挂载为 /workspace/.agentdock/output
        tasks/{taskId}/                当前 task runtime dir，挂载为 /workspace/.agentdock/task
          message.json
          scratch/
          logs/
```

---

## 11.3 Workspace 挂载规则

第一版默认创建空项目目录，不做 Git clone、zip 上传、对象存储下载，也不通过 OpenSandbox upload API 同步输入文件。

Cloud Web 创建项目时，AgentDock Cloud 在宿主机或 compose volume 中创建 project workspace：

```text
/data/agentdock/workspaces/tenant/{tenantId}/user/{userId}/workspace/{workspaceId}/workdir
```

OpenSandbox 创建 sandbox 时必须支持多个 bind mount：

```text
project workdir -> /workspace
current task runtime dir -> /workspace/.agentdock/task
current session output dir -> /workspace/.agentdock/output
```

注意：

```text
1. /workspace 是用户项目根目录，跨 thread/task 持久化。
2. 系统元数据不放在 project workdir 内，避免 agent 看到其他 session/task。
3. agent 只能看到当前 task runtime dir 和当前 session output。
4. inputFiles 字段保留为后续外部存储下载接口，MVP 可为空。
5. sandbox runtime 不持有对象存储写权限。
```

---

## 11.4 Output 登记规则

Agent Runtime 写：

```text
/workspace/.agentdock/output/**
```

AgentDock Cloud 在任务结束后扫描对应本地卷目录：

```text
/data/agentdock/runtime/tenant/{tenantId}/user/{userId}/workspace/{workspaceId}/sessions/{sessionId}/output/
```

并写入：

```text
workspace_files
```

文件 URI 使用：

```text
local-volume://tenant/{tenantId}/user/{userId}/workspace/{workspaceId}/thread/{threadId}/task/{taskId}/output/{relativePath}
```

MVP 不上传产物到 S3/OSS。

---

## 11.5 Message File

任务启动前，AgentDock Cloud 写入：

```text
/workspace/.agentdock/task/message.json
```

内容：

```json
{
  "message": "帮我分析这个项目",
  "metadata": {
    "tenantId": "tenant_123",
    "userId": "user_456",
    "workspaceId": "ws_001",
    "threadId": "thread_001",
    "taskId": "task_789",
    "runId": "run_001"
  }
}
```

不要写入：

```text
数据库凭证
RocketMQ 凭证
对象存储写凭证
调用方 token
```

---

# 12. Sandbox Runtime 镜像 SPEC

## 12.1 镜像名称

MVP：

```text
agentdock/sandbox-runtime:v0.1.0
```

---

## 12.2 镜像内容

必须包含：

```text
Node.js 22
Python 3
git
curl
wget
jq
ripgrep
unzip
tar
ca-certificates
tini
AgentDock Runtime bundle
AgentDock runtime CLI
内置 pi-acp runtime
内置 Pi coding agent runtime
非 root 用户 agentdock:10001
```

不包含：

```text
docker
docker.sock
kubectl
ssh private key
云厂商永久密钥
RocketMQ 凭证
数据库凭证
调用方 token
```

---

## 12.3 运行命令

```bash
/opt/agentdock/bin/agentdock-runtime run \
  --task-id "$TASK_ID" \
  --run-id "$RUN_ID" \
  --agent "$AGENT_ID" \
  --workspace "$WORKSPACE_ROOT" \
  --message-file "/workspace/.agentdock/task/message.json"
```

---

## 12.4 环境变量

```text
TASK_ID
RUN_ID
AGENT_ID
WORKSPACE_ROOT=/workspace
EVENT_MODE=stdout
```

Pi runtime 约束：

```text
1. MVP 默认 agentId=pi。
2. pi-acp 和 Pi coding agent runtime 在镜像构建阶段内置，不在 sandbox 启动时动态安装。
3. PI_ACP_PI_COMMAND 指向镜像内置 Pi coding agent bin。
4. provider API key 只通过 task runtime env 注入，不写进镜像。
5. Pi 配置目录写入 /workspace/.agentdock/task/pi-agent。
```

---

## 12.5 Dockerfile 示例

```dockerfile
FROM node:22-bookworm-slim

ARG USERNAME=agentdock
ARG UID=10001
ARG GID=10001

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    git \
    curl \
    wget \
    ca-certificates \
    jq \
    ripgrep \
    unzip \
    tar \
    bash \
    tini \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -g ${GID} ${USERNAME} \
  && useradd -m -u ${UID} -g ${GID} -s /bin/bash ${USERNAME}

RUN mkdir -p /opt/agentdock /workspace/.agentdock \
  && chown -R ${UID}:${GID} /opt/agentdock /workspace

WORKDIR /opt/agentdock

COPY dist/agentdock-runtime ./agentdock-runtime
COPY package.json ./package.json
COPY node_modules ./node_modules

RUN chmod +x ./agentdock-runtime

USER ${UID}:${GID}

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/agentdock/agentdock-runtime"]
CMD ["run"]
```

---

# 13. 执行流程 SPEC

## 13.1 创建任务流程

```text
1. Client 调 POST /api/v1/tasks
2. AgentDock Cloud 校验请求
3. 创建 task，status=created
4. 发布 task.created
5. 检查本地并发容量
6. 注册 RunningTask
7. 异步启动 TaskExecutor
8. 更新 status=accepted
9. 发布 task.accepted
10. 返回 taskId/runId
```

---

## 13.2 TaskExecutor 主流程

```text
1. 更新 status=input_syncing
2. 发布 workspace.input_syncing
3. 确保 project workspace 已存在
4. 创建 runtime metadata dir 和 session output dir
5. 写 /workspace/.agentdock/task/message.json 对应本地卷文件
6. 发布 workspace.input_synced
7. 更新 status=sandbox_creating
8. 发布 sandbox.creating
9. 调 OpenSandbox create，并挂载 project workdir、task runtime dir、session output dir
10. 写入 sandbox_id
11. 更新 status=sandbox_created
12. 发布 sandbox.created
13. 构造 runtime command
14. 更新 status=running
15. 发布 task.started
16. 发布 agent.started
17. 调 OpenSandbox exec
18. 读取 stdout/stderr
19. 解析 __AGENTDOCK_EVENT__
20. 补全 Cloud Event envelope
21. 发布 RocketMQ
22. exec exitCode=0
23. 更新 status=output_syncing
24. 发布 workspace.output_syncing
25. 扫描本地卷 /workspace/.agentdock/output 对应目录
26. 写 workspace_files
27. 发布 workspace.output_synced
28. 更新 status=succeeded
29. 发布 task.succeeded
30. 删除 sandbox
31. 发布 sandbox.deleted
32. 从 RunningTaskRegistry 移除
```

---

## 13.3 失败流程

```text
1. 捕获异常
2. 更新 task status=failed
3. 写 error_code/error_message
4. 发布 task.failed
5. 保留本地卷 /workspace/.agentdock/task/logs
6. 尝试删除 sandbox
7. 发布 sandbox.deleted 或 sandbox.failed
8. 从 RunningTaskRegistry 移除
```

---

## 13.4 超时流程

```text
1. TaskExecutor 设置 timeout
2. 超时触发
3. 调 OpenSandbox stop/delete
4. 更新 status=timeout
5. 发布 task.timeout
6. 尝试同步 logs
7. 从 RunningTaskRegistry 移除
```

---

## 13.5 取消流程

```text
1. Client 调 POST /api/v1/tasks/:taskId/cancel
2. 更新 status=cancelling
3. 发布 task.cancelling
4. ExecutionManager 找 RunningTask
5. 调 OpenSandbox stop/delete
6. 更新 status=cancelled
7. 发布 task.cancelled
8. 从 RunningTaskRegistry 移除
```

---

# 14. 并发与资源限制

MVP 单实例部署。

配置：

```yaml
execution:
  maxConcurrentTasks: 10
  defaultTimeoutSeconds: 600

sandbox:
  provider: opensandbox
  defaultImage: agentdock/sandbox-runtime:v0.1.0
  defaultCpu: 2
  defaultMemoryMb: 4096
  defaultWorkspaceSizeMb: 10240
```

超过容量：

```http
429 Too Many Requests
```

响应：

```json
{
  "error": "CAPACITY_EXCEEDED",
  "message": "当前 Agent 执行资源繁忙，请稍后重试"
}
```

---

# 15. 配置 SPEC

```yaml
service:
  name: agentdock-cloud
  instanceId: agentdock-cloud-01
  port: 8080

web:
  enabled: true
  publicBaseUrl: http://localhost:8088
  apiBaseUrl: http://agentdock-cloud:8080/api/local/v1

database:
  provider: sqlite
  path: /data/agentdock/agentdock-cloud.db

storage:
  provider: local-volume
  workspaceRoot: /data/agentdock/workspaces
  runtimeRoot: /data/agentdock/runtime

opensandbox:
  endpoint: http://opensandbox-server:8090
  apiKey: ${OPENSANDBOX_API_KEY}

rocketmq:
  nameServer: 127.0.0.1:9876
  topic: agentdock_events
  producerGroup: agentdock-cloud-producer
  consumerGroup: agentdock-cloud-consumer

execution:
  maxConcurrentTasks: 10
  defaultTimeoutSeconds: 600

sandbox:
  defaultImage: agentdock/sandbox-runtime:v0.1.0
  defaultCpu: 2
  defaultMemoryMb: 4096
  defaultWorkspaceSizeMb: 10240

security:
  authEnabled: false
  internalApiKey: ${AGENTDOCK_CLOUD_API_KEY}
```

---

# 16. 安全 SPEC

## 16.1 API 鉴权

MVP docker-compose 只用于验证流程通路，默认 `security.authEnabled=false`：

```text
1. Cloud Web 不做登录鉴权。
2. /api/local/v1/* 不鉴权。
3. /api/v1/* 可保留内部 API Key 开关，但不作为 MVP 阻塞项。
```

后续生产启用鉴权时，`/api/v1/*` 请求使用：

```http
Authorization: Bearer <token>
```

后续可支持：

```text
mTLS
JWT
调用方级别 appKey/appSecret
```

---

## 16.2 Sandbox 禁止持有

```text
RocketMQ 凭证
数据库凭证
对象存储写权限
调用方 token
Docker socket
宿主机敏感路径
```

---

## 16.3 Sandbox 网络

MVP 至少要求：

```text
1. sandbox 不访问数据库
2. sandbox 不访问 RocketMQ
3. sandbox 不访问 Docker socket
4. sandbox 不访问 cloud metadata service
5. sandbox 只访问必要外网或 Tool Gateway
```

---

## 16.4 文件路径安全

所有路径必须通过 `WorkspacePathGuard`。

```ts
export class WorkspacePathGuard {
  constructor(private readonly root: string) {}

  resolve(relativePath: string): string {
    const target = path.resolve(this.root, relativePath);
    const root = path.resolve(this.root);

    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Path escapes workspace: ${relativePath}`);
    }

    return target;
  }
}
```

---

# 17. 错误码 SPEC

| 错误码                     | 说明           |
| ----------------------- | ------------ |
| `INVALID_REQUEST`       | 请求参数错误       |
| `UNAUTHORIZED`          | 鉴权失败         |
| `CAPACITY_EXCEEDED`     | 本实例执行容量不足    |
| `TASK_NOT_FOUND`        | 任务不存在        |
| `TASK_ALREADY_FINISHED` | 任务已结束，不能取消   |
| `SANDBOX_CREATE_FAILED` | sandbox 创建失败 |
| `SANDBOX_EXEC_FAILED`   | runtime 执行失败 |
| `INPUT_SYNC_FAILED`     | input 同步失败   |
| `OUTPUT_SYNC_FAILED`    | output 同步失败  |
| `EVENT_PUBLISH_FAILED`  | 事件发布失败       |
| `TASK_TIMEOUT`          | 任务超时         |
| `TASK_CANCELLED`        | 任务取消         |
| `INTERNAL_ERROR`        | 内部错误         |

---

# 18. 日志与可观测性

每条日志必须包含：

```text
taskId
runId
tenantId
userId
workspaceId
threadId
sandboxId
instanceId
```

---

## 18.1 Metrics

```text
agentdock_task_created_total
agentdock_task_accepted_total
agentdock_task_running_total
agentdock_task_succeeded_total
agentdock_task_failed_total
agentdock_task_cancelled_total
agentdock_task_timeout_total

agentdock_running_tasks
agentdock_capacity_limit

agentdock_sandbox_create_duration_seconds
agentdock_task_duration_seconds
agentdock_input_sync_duration_seconds
agentdock_output_sync_duration_seconds

agentdock_event_publish_total
agentdock_event_publish_failed_total
```

---

## 18.2 Trace Span

```text
create_task
accept_task
create_sandbox
sync_input
write_message_file
exec_runtime
parse_runtime_event
publish_rocketmq
sync_output
delete_sandbox
cancel_task
timeout_task
```

---

# 19. TypeScript 接口 SPEC

## 19.1 `AgentTask`

```ts
export interface AgentTask {
  id: string;
  runId: string;

  tenantId: string;
  userId: string;
  workspaceId: string;
  threadId: string;
  agentId: string;

  message: string;
  inputFiles: AgentTaskInputFile[];

  runtime: AgentTaskRuntime;
  metadata?: Record<string, unknown>;

  status: AgentTaskStatus;
}
```

---

## 19.2 `AgentTaskRuntime`

```ts
export interface AgentTaskRuntime {
  sandboxProvider: "opensandbox";
  image: string;
  cpu: number;
  memoryMb: number;
  timeoutSeconds: number;
  workspaceSizeMb?: number;
}
```

---

## 19.3 `AgentTaskInputFile`

```ts
export interface AgentTaskInputFile {
  fileId: string;
  uri: string;
  path: string;
  sizeBytes?: number;
  checksum?: string;
}
```

---

## 19.4 `AgentTaskStatus`

```ts
export type AgentTaskStatus =
  | "created"
  | "accepted"
  | "sandbox_creating"
  | "sandbox_created"
  | "input_syncing"
  | "running"
  | "output_syncing"
  | "succeeded"
  | "failed"
  | "cancelling"
  | "cancelled"
  | "timeout";
```

---

# 20. 核心类 SPEC

## 20.1 `TaskService`

```ts
class TaskService {
  createTask(input: CreateTaskInput): Promise<AgentTask>;

  getTask(taskId: string): Promise<AgentTask | null>;

  cancelTask(taskId: string): Promise<void>;

  markStatus(
    taskId: string,
    status: AgentTaskStatus,
  ): Promise<void>;

  markFailed(
    taskId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void>;
}
```

---

## 20.2 `LocalExecutionManager`

```ts
class LocalExecutionManager {
  tryStart(task: AgentTask): Promise<boolean>;

  cancel(taskId: string): Promise<void>;

  getRunningTask(taskId: string): RunningTask | undefined;
}
```

---

## 20.3 `TaskExecutor`

```ts
class TaskExecutor {
  run(task: AgentTask): Promise<void>;
}
```

---

## 20.4 `RunningTaskRegistry`

```ts
class RunningTaskRegistry {
  add(task: RunningTask): void;

  get(taskId: string): RunningTask | undefined;

  remove(taskId: string): void;

  size(): number;
}
```

---

## 20.5 `TaskResourceLimiter`

```ts
class TaskResourceLimiter {
  canAccept(task: AgentTask): boolean;
}
```

---

## 20.6 `RuntimeEventParser`

```ts
class RuntimeEventParser {
  parseStdoutLine(line: string): SandboxRuntimeEvent | null;
}
```

---

## 20.7 `EventSequencer`

```ts
class EventSequencer {
  next(taskId: string, runId: string): Promise<number>;
}
```

---

## 20.8 `EventPublisher`

```ts
export interface EventPublisher {
  publish(event: AgentDockCloudEvent): Promise<void>;
}
```

---

# 21. 关键伪代码

## 21.1 创建任务

```ts
app.post("/api/v1/tasks", async (req, res) => {
  const input = validateCreateTaskRequest(req.body);

  const task = await taskService.createTask(input);

  await cloudEventPublisher.publishTaskEvent(task, "task.created", {
    message: "任务已创建",
  });

  const accepted = await executionManager.tryStart(task);

  if (!accepted) {
    await taskService.markFailed(
      task.id,
      "CAPACITY_EXCEEDED",
      "当前 Agent 执行资源繁忙",
    );

    return res.status(429).json({
      error: "CAPACITY_EXCEEDED",
      message: "当前 Agent 执行资源繁忙，请稍后重试",
    });
  }

  await taskService.markStatus(task.id, "accepted");

  await cloudEventPublisher.publishTaskEvent(task, "task.accepted", {
    message: "任务已接收",
  });

  return res.json({
    taskId: task.id,
    runId: task.runId,
    status: "accepted",
  });
});
```

---

## 21.2 TaskExecutor

```ts
class TaskExecutor {
  async run(task: AgentTask): Promise<void> {
    let sandbox: SandboxRef | undefined;

    try {
      await this.taskRepo.updateStatus(task.id, "sandbox_creating");
      await this.publish(task, "sandbox.creating", {});

      sandbox = await this.sandboxProvider.create({
        taskId: task.id,
        runId: task.runId,
        image: task.runtime.image,
        cpu: task.runtime.cpu,
        memoryMb: task.runtime.memoryMb,
        timeoutSeconds: task.runtime.timeoutSeconds,
        env: {
          TASK_ID: task.id,
          RUN_ID: task.runId,
          AGENT_ID: task.agentId,
          WORKSPACE_ROOT: "/workspace",
          EVENT_MODE: "stdout",
        },
        labels: {
          taskId: task.id,
          runId: task.runId,
          tenantId: task.tenantId,
          userId: task.userId,
        },
      });

      await this.taskRepo.setSandboxId(task.id, sandbox.id);

      await this.taskRepo.updateStatus(task.id, "sandbox_created");
      await this.publish(task, "sandbox.created", {
        sandboxId: sandbox.id,
      });

      await this.taskRepo.updateStatus(task.id, "input_syncing");
      await this.publish(task, "workspace.input_syncing", {});

      await this.workspaceSync.syncInput(task, sandbox.id);
      await this.workspaceSync.writeMessageFile(task, sandbox.id);

      await this.publish(task, "workspace.input_synced", {});

      await this.taskRepo.updateStatus(task.id, "running");
      await this.publish(task, "task.started", {});
      await this.publish(task, "agent.started", {
        agentId: task.agentId,
      });

      const command = this.commandBuilder.build(task);

      for await (const event of this.sandboxProvider.exec(sandbox.id, {
        command,
        cwd: "/workspace",
        timeoutSeconds: task.runtime.timeoutSeconds,
      })) {
        if (event.type === "stdout") {
          await this.handleStdout(task, sandbox, event.data);
        }

        if (event.type === "stderr") {
          await this.publish(task, "runtime.log", {
            stream: "stderr",
            message: event.data,
          });
        }

        if (event.type === "exit" && event.exitCode !== 0) {
          throw new AgentDockError(
            "SANDBOX_EXEC_FAILED",
            `Runtime exited with code ${event.exitCode}`,
          );
        }
      }

      await this.taskRepo.updateStatus(task.id, "output_syncing");
      await this.publish(task, "workspace.output_syncing", {});

      await this.workspaceSync.syncOutput(task, sandbox.id);

      await this.publish(task, "workspace.output_synced", {});

      await this.taskRepo.updateStatus(task.id, "succeeded");
      await this.publish(task, "task.succeeded", {});
    } catch (err) {
      const normalized = normalizeError(err);

      await this.taskRepo.markFailed(
        task.id,
        normalized.code,
        normalized.message,
      );

      await this.publish(task, "task.failed", {
        errorCode: normalized.code,
        message: normalized.message,
      });
    } finally {
      if (sandbox) {
        await this.sandboxProvider.delete(sandbox.id).catch(() => undefined);

        await this.publish(task, "sandbox.deleted", {
          sandboxId: sandbox.id,
        });
      }

      this.runningTaskRegistry.remove(task.id);
    }
  }
}
```

---

## 21.3 stdout 解析

```ts
class RuntimeEventParser {
  parseStdoutLine(line: string): SandboxRuntimeEvent | null {
    const prefix = "__AGENTDOCK_EVENT__ ";

    if (!line.startsWith(prefix)) {
      return null;
    }

    const jsonText = line.slice(prefix.length);

    return JSON.parse(jsonText);
  }
}
```

---

## 21.4 发布 Cloud Event

```ts
async function publishRuntimeEvent(
  task: AgentTask,
  sandbox: SandboxRef,
  runtimeEvent: SandboxRuntimeEvent,
) {
  const seq = await eventSequencer.next(task.id, task.runId);

  const event: AgentDockCloudEvent = {
    eventId: createId("evt"),
    tenantId: task.tenantId,
    userId: task.userId,
    workspaceId: task.workspaceId,
    threadId: task.threadId,
    taskId: task.id,
    runId: task.runId,
    seq,
    type: runtimeEvent.type as AgentDockCloudEventType,
    payload: runtimeEvent.payload,
    timestamp: runtimeEvent.timestamp ?? new Date().toISOString(),
    metadata: task.metadata,
    source: {
      service: "agentdock-cloud",
      instanceId: config.service.instanceId,
      sandboxId: sandbox.id,
      agentId: task.agentId,
      runtimeImage: task.runtime.image,
    },
  };

  await eventRepository.save(event);
  await eventPublisher.publish(event);
}
```

---

# 22. MVP 范围

## 22.1 必须完成

```text
1. services/agentdock-cloud skeleton
2. POST /api/v1/tasks
3. GET /api/v1/tasks/:taskId
4. POST /api/v1/tasks/:taskId/cancel
5. GET /api/v1/tasks/:taskId/files
6. Cloud Web docker-compose 模块
7. local-compatible thread/message/run APIs
8. local-compatible SSE `/api/local/v1/events`
9. SQLite task/event/file/thread/message/run 表
10. OpenSandboxProvider
11. sandbox-runtime 镜像
12. stdout 事件解析
13. RocketMQEventPublisher
14. RocketMQEventConsumer
15. ConversationProjector
16. workspace local volume prepare/output scan
17. 任务取消
18. 任务超时
19. 基础日志
20. 基础 metrics
```

---

## 22.2 暂不做

```text
1. 多实例调度
2. 任务队列
3. 独立 agent-worker
4. realtime-gateway
5. 第三方 RocketMQ 消费端
6. 第三方调用方客户端推送
7. 调用方用户体系
8. 调用方 UI 协议；Cloud Web 使用 AgentDock 自身 local-compatible API
9. 复杂计费
10. Firecracker
11. 浏览器 GUI sandbox
12. PostgreSQL 外部数据库
13. 对象存储产物上传
```

---

# 23. 后续演进

## 23.1 第二阶段

```text
1. agent_events 全量落库
2. 多实例部署
3. instanceId 绑定 task
4. worker heartbeat
5. 任务恢复机制
6. OpenSandbox 多 host 支持
7. 多种 sandbox 镜像
8. sandbox 网络 egress 策略
9. 对象存储签名 URL
10. 更完整 metrics
11. PostgreSQL 或其他外部数据库迁移
```

---

## 23.2 第三阶段

```text
1. 拆 agent-worker
2. 引入任务队列
3. 独立 Scheduler
4. 按任务类型分池
5. 高风险任务使用 gVisor / Kata / Firecracker
6. ClickHouse 存储事件日志
7. 租户配额
8. 计费
9. 审计系统
```

---

# 24. 开发顺序

推荐按以下顺序实现：

```text
1. 建立 services/agentdock-cloud skeleton
2. 建立 config / logger / healthz
3. 建立 SQLite schema
4. 实现 Thread/Message/Run/Task/File/Event repositories
5. 实现 local-compatible capabilities/workspace/thread/message APIs
6. 实现 local-compatible SSE broadcaster
7. 实现 TaskService
8. 实现 POST /api/v1/tasks 和 thread message -> task 创建
9. 实现 RunningTaskRegistry
10. 实现 LocalExecutionManager
11. 建立 packages/sandbox-core 接口
12. 实现 OpenSandboxProvider
13. 建立 images/sandbox-runtime
14. 实现 runtime stdout event 格式
15. 实现 RuntimeEventParser
16. 实现 EventSequencer
17. 实现 RocketMQEventPublisher
18. 实现 RocketMQEventConsumer
19. 实现 ConversationProjector
20. 实现 WorkspaceSyncService
21. 实现 TaskExecutor
22. 实现 cancel
23. 实现 timeout
24. 实现 output files API
25. 新增 Cloud Web compose 模块并接 agentdock-cloud
26. 做 Cloud Web 端到端联调，确认 UI 与 local 模式一致
```

---

# 25. 最终定义

```text
AgentDock Cloud 是 AgentDock 的云端 Agent 执行平面和 Cloud Web 后端。

它通过 OpenSandbox 创建隔离执行环境，
通过 sandbox-runtime 镜像运行 AgentDock Runtime，
通过 RocketMQ 发布并消费标准化执行事件，
将 sandbox 事件投影为与 local 模式一致的会话记录，
并通过 SSE 推送给 Cloud Web。

任何可信调用方都可以创建任务；
Cloud Web 可以像 local 模式一样查看 workspace、thread、message 和 run 状态；
外部事件消费方也可以消费 RocketMQ 事件并自行处理业务编排。
```

最终核心边界：

```text
AgentDock Cloud 管任务执行；
OpenSandbox 管 sandbox；
sandbox-runtime 管 Agent 运行环境；
RocketMQ 管事件传递；
调用方和事件消费方不属于 AgentDock Cloud。
```
