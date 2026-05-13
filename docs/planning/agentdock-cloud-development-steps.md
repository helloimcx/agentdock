# AgentDock Cloud Development Steps

本文档是 `agentdock-cloud` 第一版的可勾选开发步骤。目标是在现有本地模式之外新增云端执行平面：通过 docker-compose 部署 Cloud Web、AgentDock Cloud、RocketMQ、OpenSandbox Server，并通过 OpenSandbox 在 Docker container sandbox 内运行 agent。Cloud Web 功能和样式与 local 模式一致；区别是前端连接 agentdock-cloud，agent 运行在 sandbox，SSE 来自 RocketMQ 中的 sandbox 事件投影。数据存储 MVP 复用本地模式的 SQLite 思路，不引入 PostgreSQL 服务。

## Implementation Status

- [x] 已新增 `packages/cloud-core`，集中 cloud event、sandbox provider、mount 和本地卷路径规则。
- [x] 已新增 `services/agentdock-cloud`，提供 SQLite、local-compatible HTTP API、SSE、事件投影、sandbox executor 和 fake sandbox provider。
- [x] 已新增 docker-compose、Cloud Web nginx 反向代理、agentdock-cloud Dockerfile、OpenSandbox 配置样例和 sandbox runtime 镜像。
- [x] Cloud Web runtime detection 已兼容 `agentdock-cloud` health。
- [x] 已添加集成测试覆盖 workspace/thread/message/sandbox event/projection 主链路。
- [x] OpenSandbox provider 已按 lifecycle `/v1/sandboxes` 和 execd `/command` SSE 接入，并覆盖多 bind mount 测试。
- [x] 已实现 task 执行阶段状态、并发限制、SSE heartbeat、Prometheus `/metrics`、output 文件扫描和 SQLite 文件元数据。
- [x] 已接入官方 `rocketmq-client-nodejs`，新增 RocketMQ Proxy producer/consumer adapter；本地测试仍可用 memory adapter。

## 0. Scope And Defaults

- [ ] 确认服务名为 `services/agentdock-cloud`，不通过 HTTP 调用 `services/local-ai-core`。
- [ ] 确认部署入口为 `deploy/agentdock-cloud/docker-compose.yml`。
- [ ] 确认 compose 第一版包含 `web`、`agentdock-cloud`、`rocketmq-namesrv`、`rocketmq-broker`、`opensandbox-server`。
- [ ] 确认 Cloud Web 复用 local 模式前端页面、组件、样式和交互。
- [ ] 确认 Cloud Web API base 指向 `agentdock-cloud`，不连接 `local-ai-core`。
- [ ] 确认 Cloud Web 不直接消费 RocketMQ，只消费 agentdock-cloud 暴露的 HTTP API 和 SSE。
- [ ] 确认 agentdock-cloud 内置 RocketMQ consumer，将 sandbox Cloud Events 投影为 local-compatible 会话事件。
- [ ] 确认 RocketMQ 是 Cloud Web MVP 的唯一实时数据源；TaskExecutor 不直接推 SSE。
- [ ] 确认 Cloud Web 仅用于验证流程通路；实际使用时上游服务直接消费 RocketMQ。
- [ ] 确认数据存储第一版使用 SQLite 文件 `/data/agentdock/agentdock-cloud.db`。
- [ ] 确认第一版存储默认使用本地卷，不做产物上传。
- [ ] 确认 Cloud Web 创建的项目工作目录持久化到宿主机/compose volume。
- [ ] 确认 sandbox 启动时挂载项目工作目录到容器内 `/workspace`。
- [ ] 确认系统运行元数据不放在项目 workdir 内，而是放在 `/data/agentdock/runtime/...`。
- [ ] 确认 sandbox 通过多 bind mount 只看到当前 task runtime dir 和当前 session output。
- [ ] 确认 sandbox 中必要路径为 `/workspace/.agentdock/task` 和 `/workspace/.agentdock/output`。
- [ ] 确认 RocketMQ 负责 sandbox event 传递；MVP 只实现 agentdock-cloud 内置 consumer，不实现第三方消费端、Portal Server 或调用方用户体系。
- [ ] 确认 MVP 单实例运行，不做多实例调度、任务队列、worker heartbeat 或任务恢复。

## 1. Docker Compose Deployment

- [ ] 新增 `deploy/agentdock-cloud/docker-compose.yml`。
- [ ] 新增 `deploy/agentdock-cloud/.env.example`，包含 web API base、OpenSandbox API key、SQLite db path、RocketMQ、workspace root、runtime root 等配置。
- [ ] 新增 `deploy/agentdock-cloud/opensandbox.config.toml`。
- [ ] 配置 `web` 服务，使用现有 renderer build，暴露 `8088` 或约定端口。
- [ ] 配置 `web` 的 API base 指向 `http://agentdock-cloud:8080/api/local/v1` 或同源反向代理路径。
- [ ] 确保 `web` 服务不需要知道 sandbox、RocketMQ、OpenSandbox 细节。
- [ ] 配置 `agentdock-cloud` 服务，暴露 `8080`，依赖 `rocketmq-broker`、`opensandbox-server`。
- [ ] 配置 `rocketmq-namesrv` 服务。
- [ ] 配置 `rocketmq-broker` 服务，并确保 broker 可连接 nameserver。
- [ ] 可选配置 `rocketmq-dashboard`，仅用于本地调试。
- [ ] 配置 `opensandbox-server` 服务，使用 `opensandbox/server:latest` 或固定版本镜像。
- [ ] 给 `opensandbox-server` 挂载 `/var/run/docker.sock:/var/run/docker.sock`。
- [ ] 给 `opensandbox-server` 设置 `SANDBOX_CONFIG_PATH=/etc/opensandbox/config.toml`。
- [ ] 在 OpenSandbox TOML 中设置 `[server] host="0.0.0.0"`、`port=8090`、`api_key`。
- [ ] 在 OpenSandbox TOML 中设置 `[runtime] type="docker"`。
- [ ] 在 OpenSandbox TOML 中设置 `[docker] network_mode="bridge"`、`no_new_privileges=true`、`pids_limit=4096`。
- [ ] 配置单一 `agentdock-cloud-data` volume，挂载到 cloud 容器 `/data/agentdock`，同时保存 SQLite 数据库和本地工作目录。
- [ ] 为所有服务配置同一个 compose network。
- [ ] 为 `web`、`agentdock-cloud`、`rocketmq`、`opensandbox-server` 配置 healthcheck。

## 2. AgentDock Cloud Service Skeleton

- [ ] 新增 `services/agentdock-cloud/package.json`。
- [ ] 新增 `services/agentdock-cloud/tsconfig.json`。
- [ ] 新增 `services/agentdock-cloud/src/main.ts`。
- [ ] 实现配置加载模块 `src/config/config.ts`，从环境变量读取所有部署配置。
- [ ] 实现基础 logger，日志字段至少包含 `service`、`instanceId`，任务执行期间包含 `taskId`、`runId`、`tenantId`、`userId`、`workspaceId`、`threadId`、`sandboxId`。
- [ ] 实现错误类型和错误码：`INVALID_REQUEST`、`UNAUTHORIZED`、`CAPACITY_EXCEEDED`、`TASK_NOT_FOUND`、`SANDBOX_CREATE_FAILED`、`SANDBOX_EXEC_FAILED`、`TASK_TIMEOUT`、`TASK_CANCELLED`、`INTERNAL_ERROR`。
- [ ] 实现 HTTP server。
- [ ] 实现 `/healthz`，返回 service、instanceId、status。
- [ ] 实现 `/metrics`，输出 Prometheus 格式指标。
- [ ] MVP 不实现 Cloud Web 登录鉴权。
- [ ] `/api/local/v1/*` MVP 不鉴权，仅用于 compose 内验证流程通路。
- [ ] `/api/v1/*` 可保留内部 API key 开关，但不作为 MVP 阻塞项。
- [ ] 实现 SSE client 管理和 heartbeat。
- [ ] 新增 README 或启动说明，说明 compose 下服务端口和必要环境变量。

## 3. Contracts And Types

- [ ] 新增 cloud task request/response 类型。
- [ ] 定义 `AgentTaskStatus`：`created`、`accepted`、`sandbox_creating`、`sandbox_created`、`input_syncing`、`running`、`output_syncing`、`succeeded`、`failed`、`cancelling`、`cancelled`、`timeout`。
- [ ] 定义 `AgentTaskRuntime`，包含 `sandboxProvider`、`image`、`cpu`、`memoryMb`、`timeoutSeconds`、`workspaceSizeMb`。
- [ ] 定义 `AgentTaskInputFile`，保留 `fileId`、`uri`、`path`、`sizeBytes`、`checksum`。
- [ ] 定义 `AgentDockCloudEvent` envelope。
- [ ] 定义 cloud event type union。
- [ ] 定义 RocketMQ tag 映射规则。
- [ ] 复用 `ThreadSummary`、`ThreadDetail`、`ThreadMessage`、`RunSummary`、`LocalCoreEvent` shared contracts。
- [ ] 定义 Cloud Event 到 LocalCoreEvent 的投影输入/输出类型。
- [ ] 新增 sandbox provider 接口：`create`、`exec`、`delete`、`stop`。
- [ ] 定义 OpenSandbox volume/mount 输入类型，确保可表达多个 bind mount。
- [ ] create sandbox 必须挂载 project workdir 到 `/workspace`。
- [ ] create sandbox 必须挂载 current task runtime dir 到 `/workspace/.agentdock/task`。
- [ ] create sandbox 必须挂载 current session output dir 到 `/workspace/.agentdock/output`。
- [ ] 新增 storage provider 接口，默认实现为本地卷。

## 4. Database And Repositories

- [ ] 新增 SQLite schema/migration 目录，复用现有本地 SQLite 风格。
- [ ] 配置默认数据库路径 `AGENTDOCK_CLOUD_DB_PATH=/data/agentdock/agentdock-cloud.db`。
- [ ] 新增 `agent_tasks` 表。
- [ ] 新增 `agent_events` 表。
- [ ] 新增 `workspace_files` 表。
- [ ] 新增 `workspace_registry` 表，记录 Cloud Web 项目与宿主机工作目录绑定。
- [ ] 新增 `threads` 表，字段语义与 local 模式一致。
- [ ] 新增 `messages` 表，字段语义与 local 模式一致。
- [ ] 新增 `runs` 表，字段语义与 local 模式一致。
- [ ] JSON 字段统一使用 `*_json TEXT` 存储 JSON 字符串。
- [ ] 时间字段统一使用 ISO 8601 `TEXT`。
- [ ] 为 task tenant/user、workspace/thread、status、created_at 添加索引。
- [ ] 为 event task/run/seq、type 添加索引。
- [ ] 为 workspace files task、workspace 添加索引。
- [ ] 实现 `TaskRepository`。
- [ ] 实现 `EventRepository`。
- [ ] 实现 `FileRepository`。
- [ ] 实现 `WorkspaceRegistryRepository`。
- [ ] 实现 `ThreadRepository`。
- [ ] 实现 `MessageRepository`。
- [ ] 实现 `RunRepository`。
- [ ] 实现启动时 migration 执行或提供明确的 migration 命令。
- [ ] 确保 repository 不依赖 renderer、Electron 或 Local AI Core store。
- [ ] 明确 SQLite 只支持单实例 MVP，后续多实例再迁移外部数据库。

## 5. Local Volume Storage

- [ ] 实现 `StorageProvider` 接口。
- [ ] 实现 `LocalVolumeStorageProvider`。
- [ ] 使用配置项 `AGENTDOCK_CLOUD_WORKSPACE_ROOT=/data/agentdock/workspaces`。
- [ ] 使用配置项 `AGENTDOCK_CLOUD_RUNTIME_ROOT=/data/agentdock/runtime`。
- [ ] Cloud Web 创建项目时生成持久化项目工作目录：`tenant/{tenantId}/user/{userId}/workspace/{workspaceId}/workdir`。
- [ ] 将项目工作目录路径写入 `workspace_registry.workdir_path`。
- [ ] Cloud Web 创建项目时只创建空项目目录，不做 Git clone、zip 上传或 inputFiles 下载。
- [ ] 每次 task 执行前创建 runtime task dir：`runtime/tenant/{tenantId}/user/{userId}/workspace/{workspaceId}/tasks/{taskId}`。
- [ ] 每次 task 执行前创建 session output dir：`runtime/tenant/{tenantId}/user/{userId}/workspace/{workspaceId}/sessions/{sessionId}/output`。
- [ ] 写入 `/workspace/.agentdock/task/message.json` 对应的宿主机 runtime task 文件。
- [ ] `message.json` 只包含 message 和 task metadata，不写数据库、RocketMQ、对象存储或调用方 token。
- [ ] 实现 output 扫描，读取当前 session output dir。
- [ ] 为 output 文件生成 `local-volume://...` URI。
- [ ] 写入 `workspace_files` 元数据。
- [ ] 实现 `WorkspacePathGuard`，禁止 `../`、绝对路径和路径逃逸。
- [ ] 第一版不实现 output 上传。
- [ ] 第一版不要求 `inputFiles` 从外部 URI 下载；仅保留接口和本地卷扩展点。

## 6. Task API

- [ ] 实现 `POST /api/v1/tasks` 参数校验。
- [ ] 当 `threadId` 已存在时，任务写入该 thread 的 user message 和 run。
- [ ] 当 `threadId` 为空或不存在时，按 Cloud Web 会话语义创建 thread。
- [ ] 创建 task 记录，初始状态为 `created`。
- [ ] 发布 `task.created` 事件。
- [ ] 检查本实例并发容量。
- [ ] 容量不足时返回 `429 CAPACITY_EXCEEDED`。
- [ ] 注册 running task。
- [ ] 异步启动 `TaskExecutor`。
- [ ] 更新 task 状态为 `accepted`。
- [ ] 发布 `task.accepted` 事件。
- [ ] 返回 `{ taskId, runId, status: "accepted" }`。
- [ ] 实现 `GET /api/v1/tasks/:taskId`。
- [ ] 实现 `POST /api/v1/tasks/:taskId/cancel`。
- [ ] 实现 `GET /api/v1/tasks/:taskId/files`，从 `workspace_files` 或本地卷扫描结果返回 output 元数据。
- [ ] 所有 API 错误返回统一 JSON envelope。

## 6.1 Cloud Web Compatible API

- [ ] 实现 `GET /api/local/v1/health`，返回 `name=agentdock-cloud` 或前端可识别的 cloud runtime health。
- [ ] 实现 `GET /api/local/v1/capabilities/snapshot`，只暴露 Cloud MVP 支持能力。
- [ ] 实现 `GET /api/local/v1/workspaces`。
- [ ] 实现 `GET /api/local/v1/workspaces/:workspaceId/threads`。
- [ ] 实现 `POST /api/local/v1/workspaces/:workspaceId/threads`。
- [ ] 实现 `GET /api/local/v1/threads/:threadId`。
- [ ] 实现 `POST /api/local/v1/threads/:threadId/messages`，内部创建 agent task 并启动 sandbox 执行。
- [ ] 实现 `POST /api/local/v1/threads/:threadId/cancel`，内部取消对应 running task。
- [ ] 实现 `GET /api/local/v1/events` SSE。
- [ ] 确保 API response shape 与 local 模式前端消费的 contracts 一致。
- [ ] 未实现的 local 模式能力通过 capabilities snapshot 隐藏，不让 UI 暴露不可用入口。

## 6.2 Cloud Web Frontend

- [ ] 复用现有 React renderer，不 fork 一套 Cloud UI。
- [ ] 新增 cloud web build 配置，设置 API base 为 agentdock-cloud。
- [ ] 新增 runtime provider 或配置项，让前端在 cloud compose 中使用 cloud/local-compatible API。
- [ ] 更新前端 runtime bootstrap，使其能识别 `agentdock-cloud` health，并仍兼容 local-ai-core。
- [ ] 保持线程列表、聊天页、消息流、run 状态、文件结果展示与 local 模式一致。
- [ ] 确保 Cloud Web 不展示 local-only runtime 安装、桌面 bridge、Electron 专属状态。
- [ ] 通过 screenshots 或 smoke test 验证 cloud UI 和 local UI 主路径一致。

## 7. Execution Manager

- [ ] 实现 `RunningTaskRegistry`。
- [ ] 实现 `TaskResourceLimiter`，读取 `execution.maxConcurrentTasks`。
- [ ] 实现 `LocalExecutionManager.tryStart(task)`。
- [ ] 实现 `LocalExecutionManager.cancel(taskId)`。
- [ ] 保证同一个 task 不会重复注册。
- [ ] 保证 task 结束、失败、取消、超时后从 registry 移除。
- [ ] 保证终态事件只发布一次。

## 8. OpenSandbox Provider

- [ ] 实现 OpenSandbox HTTP client。
- [ ] 请求 OpenSandbox 时使用 `OPEN-SANDBOX-API-KEY` header。
- [ ] 实现 sandbox create。
- [ ] create 请求包含 runtime image、env、metadata、resource limits。
- [ ] create 请求包含三个 bind mount：project workdir -> `/workspace`、task runtime dir -> `/workspace/.agentdock/task`、session output dir -> `/workspace/.agentdock/output`。
- [ ] 验证 OpenSandbox 支持多个 bind mount 和目标路径覆盖；不支持时优先补 OpenSandbox 能力。
- [ ] 实现 sandbox exec，并将 stdout/stderr/exit 转换为 `SandboxExecEvent`。
- [ ] 实现 sandbox delete。
- [ ] 实现 sandbox stop 或用 delete 作为 MVP stop fallback。
- [ ] 将 OpenSandbox lifecycle state 映射为 cloud 内部 sandbox 状态。
- [ ] 记录 OpenSandbox 请求失败的结构化错误。

## 9. Task Executor

- [ ] 状态更新为 `input_syncing`，发布 `workspace.input_syncing`。
- [ ] 确保项目工作目录存在。
- [ ] 确保 runtime task dir 存在，并创建 `scratch`、`logs`。
- [ ] 确保当前 session output dir 存在。
- [ ] 写入 runtime task dir 的 `message.json`。
- [ ] 发布 `workspace.input_synced`。
- [ ] 状态更新为 `sandbox_creating`，发布 `sandbox.creating`。
- [ ] 调用 OpenSandbox create，并挂载 project workdir、task runtime dir、session output dir。
- [ ] 保存 `sandboxId`。
- [ ] 状态更新为 `sandbox_created`，发布 `sandbox.created`。
- [ ] 构造 runtime command。
- [ ] 状态更新为 `running`。
- [ ] 发布 `task.started`。
- [ ] 发布 `agent.started`。
- [ ] 调用 OpenSandbox exec。
- [ ] 读取 stdout，解析 `__AGENTDOCK_EVENT__ {json}`。
- [ ] 普通 stdout/stderr 转为 `runtime.log`。
- [ ] runtime event 补全为 `AgentDockCloudEvent`。
- [ ] 保存关键 event 到 `agent_events`。
- [ ] 发布 event 到 RocketMQ。
- [ ] exec exitCode 非 0 时标记 `SANDBOX_EXEC_FAILED`。
- [ ] exec 成功后状态更新为 `output_syncing`。
- [ ] 发布 `workspace.output_syncing`。
- [ ] 扫描 `/workspace/.agentdock/output` 对应的 current session output 本地卷目录。
- [ ] 写入 output file 元数据。
- [ ] 发布 `workspace.output_synced`。
- [ ] 状态更新为 `succeeded`。
- [ ] 发布 `task.succeeded`。
- [ ] 删除 sandbox。
- [ ] 发布 `sandbox.deleted`。
- [ ] 移除 running task。

## 10. Cancel, Timeout, Failure

- [ ] cancel 请求将未终结任务更新为 `cancelling`。
- [ ] 发布 `task.cancelling`。
- [ ] 调用 OpenSandbox stop/delete。
- [ ] 更新状态为 `cancelled`。
- [ ] 发布 `task.cancelled`。
- [ ] timeout 使用 task runtime `timeoutSeconds` 或默认配置。
- [ ] timeout 触发后调用 OpenSandbox stop/delete。
- [ ] 更新状态为 `timeout`。
- [ ] 发布 `task.timeout`。
- [ ] 失败时更新状态为 `failed`。
- [ ] 写入 `errorCode` 和 `errorMessage`。
- [ ] 发布 `task.failed`。
- [ ] 失败、取消、超时都尝试保留 runtime task dir 的 `logs` 和 current session output。
- [ ] 失败、取消、超时都必须清理 sandbox 和 running registry。

## 11. RocketMQ Events

- [ ] 实现 `EventPublisher` 接口。
- [ ] 实现 `RocketMQEventPublisher`。
- [ ] topic 默认为 `agentdock_events`。
- [ ] message key 使用 `taskId`。
- [ ] tag 根据 event type prefix 映射：`task`、`sandbox`、`workspace`、`agent`、`tool`、`file`、`runtime`、`error`。
- [ ] 实现 `EventSequencer`，保证同一 task/run seq 单调递增。
- [ ] `AgentDockCloudEvent.source` 包含 `service`、`instanceId`、`sandboxId`、`agentId`、`runtimeImage`。
- [ ] RocketMQ 发布失败时增加失败指标并记录错误。
- [ ] 明确发布失败策略：MVP 将 task 标记为 `failed`，错误码 `EVENT_PUBLISH_FAILED`。
- [ ] 实现 `RocketMQEventConsumer`，消费 `agentdock_events`。
- [ ] consumer group 默认为 `agentdock-cloud-consumer`。
- [ ] consumer 按 taskId/runId/seq 幂等处理事件。
- [ ] consumer 不直接推给前端，先交给 `ConversationProjector` 更新 SQLite 投影。

## 11.1 Conversation Projection And SSE

- [ ] 实现 `ConversationProjector`。
- [ ] `task.accepted` / `task.started` 更新 `runs` 为 running，并广播 `run.updated`。
- [ ] `agent.message.delta` 追加或更新 assistant message，并广播 `message.created` 或 `message.updated`。
- [ ] `agent.message.completed` finalize assistant message，并广播 `message.updated` 和 `presence.updated`。
- [ ] `agent.thought.delta` 投影为 thought/progress message，并广播 local-compatible message event。
- [ ] `agent.plan.updated` 投影为 plan/progress message，并广播 local-compatible message event。
- [ ] `tool.started` / `tool.delta` / `tool.finished` / `tool.failed` 投影为 tool/progress message。
- [ ] `task.succeeded` 更新 task/run 为 completed，并广播 `run.updated` 和 `presence.updated`。
- [ ] `task.failed` / `task.cancelled` / `task.timeout` 更新 task/run 为 terminal state，并广播 `run.updated` 和 `presence.updated`。
- [ ] 实现 `SseBroadcaster`，event name 使用 `LocalCoreEvent.type`。
- [ ] SSE heartbeat 间隔与 local-ai-core 保持一致或接近。
- [ ] 确保 Cloud Web 只消费 SSE 中的 `LocalCoreEvent`，不消费原始 Cloud Event。

## 12. Sandbox Runtime Image

- [ ] 新增 `images/sandbox-runtime/Dockerfile`。
- [ ] 新增 `images/sandbox-runtime/README.md`，记录镜像用途、构建命令、运行命令、内置 runtime 和安全约束。
- [ ] 新增 `images/sandbox-runtime/entrypoint.sh` 或等价入口，统一启动 `/opt/agentdock/bin/agentdock-runtime`。
- [ ] 新增 `images/sandbox-runtime/package.json`，声明镜像构建所需 runtime 依赖和 build 脚本。
- [ ] 镜像基于 Node.js 22。
- [ ] 安装 Python 3、git、curl、wget、jq、ripgrep、unzip、tar、ca-certificates、tini。
- [ ] 创建非 root 用户 `agentdock:10001`。
- [ ] 镜像内只创建 `/workspace/.agentdock` 作为默认占位；实际项目目录由宿主机本地卷挂载到 `/workspace`。
- [ ] 新增 sandbox runtime bundle 构建脚本，例如 `scripts/build-sandbox-runtime.mjs`。
- [ ] 构建脚本输出 `dist/sandbox-runtime/`，包含 cloud sandbox runtime CLI 和运行所需 package metadata。
- [ ] 将 sandbox runtime bundle 复制到镜像 `/opt/agentdock`。
- [ ] 在镜像内提供 `/opt/agentdock/bin/agentdock-runtime`。
- [ ] runtime CLI 支持 `run --task-id --run-id --agent --workspace --message-file`。
- [ ] runtime 从 message file 读取 message 和 metadata。
- [ ] runtime 输出标准 stdout event prefix。
- [ ] runtime 同时写 `/workspace/.agentdock/task/logs/events.jsonl`。
- [ ] runtime 默认支持 `--agent pi`。
- [ ] runtime 收到不支持的 agent id 时输出 `runtime.error` 并以非 0 退出。
- [ ] runtime 启动前输出 `agent.started`。
- [ ] runtime 完成后输出 `agent.message.completed` 或对应终态事件。
- [ ] 镜像不包含 docker、docker.sock、kubectl、ssh private key、数据库凭证、RocketMQ 凭证或调用方 token。

## 12.1 Pi Agent Runtime In Sandbox

- [ ] 第一版默认内置 Pi agent runtime，cloud create task 默认 `agentId` 为 `pi`。
- [ ] 明确 sandbox runtime 的 Pi 运行边界：在 container 内运行 Pi，不依赖宿主机已安装的 `pi` 命令。
- [ ] 将 `pi-acp` runtime 作为镜像内置依赖安装到 `/opt/agentdock/runtimes/pi-acp` 或等价路径。
- [ ] 将 Pi coding agent runtime 作为镜像内置依赖安装到 `/opt/agentdock/runtimes/pi` 或等价路径。
- [ ] 在 `/opt/agentdock/bin/agentdock-runtime` 中为 `agentId=pi` 选择内置 `pi-acp` 命令。
- [ ] 为 Pi 设置 `PI_ACP_PI_COMMAND`，指向镜像内置 Pi coding agent 命令。
- [ ] 支持通过 task runtime env 注入 provider API key，例如 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY`、`KIMI_API_KEY`。
- [ ] 支持通过 message metadata 或 cloud runtime config 生成 Pi 的 `auth.json`、`models.json`、`settings.json`。
- [ ] 将 Pi 配置目录放在 `/workspace/.agentdock/task/pi-agent`，避免写入镜像层、宿主全局目录或项目 workdir。
- [ ] Pi 配置目录权限设置为仅 `agentdock` 用户可读写。
- [ ] 不把任何 provider API key bake 进镜像。
- [ ] Pi runtime stdout/stderr 统一转换为 AgentDock Cloud runtime events。
- [ ] Pi ACP 的 agent message delta 映射为 `agent.message.delta`。
- [ ] Pi ACP 的 tool call start/delta/finish 映射为 `tool.started`、`tool.delta`、`tool.finished` 或 `tool.failed`。
- [ ] Pi runtime 异常退出时输出 `runtime.error` 并让 task executor 标记 `SANDBOX_EXEC_FAILED`。
- [ ] 为 Pi agent 增加最小 smoke prompt：读取 `/workspace/.agentdock/task/message.json`，写 `/workspace/.agentdock/output/report.md`。

## 12.2 Sandbox Image Build And Publish

- [ ] 新增根目录脚本 `pnpm build:sandbox-runtime` 或 service 脚本，生成 sandbox runtime bundle。
- [ ] 新增根目录脚本 `pnpm docker:build:sandbox-runtime`，构建 `agentdock/sandbox-runtime:v0.1.0`。
- [ ] 新增构建参数 `SANDBOX_RUNTIME_IMAGE=agentdock/sandbox-runtime:v0.1.0`。
- [ ] Dockerfile 使用多阶段构建，builder 阶段安装依赖和生成 bundle，runtime 阶段只复制产物。
- [ ] Dockerfile 固定 pnpm/node 版本，保证可重复构建。
- [ ] Dockerfile 设置 `NODE_ENV=production`、`WORKSPACE_ROOT=/workspace`。
- [ ] Dockerfile 在最终镜像中只保留 production dependencies 和内置 Pi runtime 必需文件。
- [ ] Dockerfile 为 `/opt/agentdock` 和 `/workspace` 设置 `agentdock:agentdock` ownership。
- [ ] Dockerfile 增加 `HEALTHCHECK` 或提供可执行的 `agentdock-runtime --version` 验证命令。
- [ ] 构建完成后运行 `docker run --rm agentdock/sandbox-runtime:v0.1.0 /opt/agentdock/bin/agentdock-runtime --version`。
- [ ] 构建完成后运行无网络/无凭证 smoke，确认镜像能解析 message file 并输出标准事件。
- [ ] 在 compose `.env.example` 中默认设置 `AGENTDOCK_SANDBOX_IMAGE=agentdock/sandbox-runtime:v0.1.0`。
- [ ] `agentdock-cloud` create task 未传 runtime image 时使用默认 sandbox runtime image。
- [ ] 记录镜像发布流程：本地 tag、推送 registry、compose 使用固定 tag。

## 13. Observability

- [ ] 增加 task created/accepted/running/succeeded/failed/cancelled/timeout counters。
- [ ] 增加 running tasks gauge。
- [ ] 增加 capacity limit gauge。
- [ ] 增加 sandbox create duration。
- [ ] 增加 task duration。
- [ ] 增加 event publish success/failure counters。
- [ ] 日志统一输出 JSON 或稳定结构。
- [ ] 每个 task 生命周期日志都带 task/run/tenant/workspace/thread/sandbox 上下文。

## 14. Documentation

- [ ] 在 `README.md` 的 `New` section 增加 Cloud Mode 用户可见说明。
- [ ] 新增 `services/agentdock-cloud/README.md`。
- [ ] 新增 Cloud Web compose 说明，明确 UI 与 local 模式一致，运行差异只在后端 sandbox。
- [ ] 新增或补充 `images/sandbox-runtime/README.md`，说明如何构建默认内置 Pi agent runtime 的 sandbox 镜像。
- [ ] 新增 compose 启动说明：复制 `.env.example`、`docker compose up -d`、健康检查、提交测试任务。
- [ ] 记录 OpenSandbox Docker socket 权限风险。
- [ ] 记录第一版本地卷存储限制：不上传产物，不保证多实例共享。
- [ ] 记录后续接入 S3/OSS 的 `StorageProvider` 扩展点。
- [ ] 记录 Pi provider API key 通过 task runtime env 注入，不能写入镜像。
- [ ] 记录 SSE 数据链路：sandbox runtime -> RocketMQ -> agentdock-cloud consumer -> SQLite projection -> SSE -> Cloud Web。
- [ ] 记录 Cloud Web MVP 不做鉴权，仅用于验证流程通路。
- [ ] 记录 Cloud Web MVP 不显示项目文件树，files API 仅用于调试和上游查询。

## 15. Unit Tests

- [ ] 测试 Cloud Web MVP 无鉴权访问核心 chat API。
- [ ] 测试 create task request validation。
- [ ] 测试 task status transition。
- [ ] 测试 capacity limiter。
- [ ] 测试 running task registry。
- [ ] 测试 `LocalVolumeStorageProvider` 路径生成和目录创建。
- [ ] 测试 output file 扫描和 `local-volume://` URI 生成。
- [ ] 测试 Cloud Web 创建项目时会创建持久化 project workdir 并写入 `workspace_registry`。
- [ ] 测试系统 runtime metadata 不写入 project workdir。
- [ ] 测试 task runtime dir 和 session output dir 创建在 `AGENTDOCK_CLOUD_RUNTIME_ROOT` 下。
- [ ] 测试 `WorkspacePathGuard` 拒绝路径逃逸。
- [ ] 测试 runtime stdout parser。
- [ ] 测试 cloud event envelope 补全。
- [ ] 测试 RocketMQ tag mapping。
- [ ] 测试 event sequencer 单调递增。
- [ ] 测试 repository CRUD。
- [ ] 测试 thread/message/run repository 与 local 模式字段语义一致。
- [ ] 测试 `agentdock-runtime run --agent pi` 会选择内置 Pi runtime。
- [ ] 测试 Pi runtime config 生成到 `/workspace/.agentdock/task/pi-agent`。
- [ ] 测试不支持的 agent id 输出 runtime error 并非 0 退出。
- [ ] 测试 ConversationProjector 对 `agent.message.delta` 复用稳定 assistant message id。
- [ ] 测试 ConversationProjector 对重复 `taskId/runId/seq` 幂等。
- [ ] 测试 SseBroadcaster 输出 event name 和 payload 符合 `LocalCoreEvent`。
- [ ] 测试 capabilities snapshot 隐藏 Cloud MVP 不支持模块。

## 16. Integration Tests

- [ ] fake OpenSandbox create/exec/delete 打通 task succeeded 流程。
- [ ] fake exec stdout 输出 agent event，验证 event repository 和 publisher。
- [ ] fake exec stderr 输出 runtime log。
- [ ] fake exec exitCode 非 0，验证 task failed。
- [ ] fake OpenSandbox create 失败，验证 `SANDBOX_CREATE_FAILED`。
- [ ] cancel running task，验证 stop/delete 和 `task.cancelled`。
- [ ] timeout running task，验证 `task.timeout`。
- [ ] fake output 文件写入 current session output dir，验证 files API。
- [ ] RocketMQ 发布失败，验证 `EVENT_PUBLISH_FAILED`。
- [ ] 使用 fake Pi runtime 验证 sandbox runtime CLI 能读取 message file、输出 `agent.started`、写 output 文件。
- [ ] 使用 fake Pi ACP stream 验证 message delta 和 tool events 映射为 cloud event。
- [ ] fake RocketMQ consumer 消费 Cloud Event 后，验证 threads/messages/runs 被正确投影。
- [ ] fake SSE client 能收到 `message.created`、`message.updated`、`run.updated`、`presence.updated`。
- [ ] `POST /api/local/v1/threads/:threadId/messages` 能创建 task 并启动 sandbox 执行。
- [ ] Cloud Web compatible API response 能被现有 thread chat 前端模型解析。
- [ ] 验证 Cloud Web MVP 不需要文件树 API。

## 17. Compose Smoke Test

- [ ] `docker compose up -d` 能启动所有服务。
- [ ] Cloud Web 服务启动并可访问。
- [ ] `pnpm docker:build:sandbox-runtime` 能构建默认内置 Pi runtime 的 `agentdock/sandbox-runtime:v0.1.0`。
- [ ] OpenSandbox 能拉起 `agentdock/sandbox-runtime:v0.1.0`。
- [ ] `curl http://localhost:8080/healthz` 返回 ok。
- [ ] `curl http://localhost:8090/health` 返回 healthy。
- [ ] SQLite schema migration 成功执行。
- [ ] RocketMQ topic 可创建或自动创建。
- [ ] 提交最小 task，返回 accepted。
- [ ] task 创建本地 workspace 目录。
- [ ] Cloud Web 创建项目后，宿主机/volume 中存在持久化 project workdir。
- [ ] OpenSandbox 创建 sandbox 时将 project workdir 挂载到 `/workspace`。
- [ ] OpenSandbox 创建 sandbox 时将 task runtime dir 挂载到 `/workspace/.agentdock/task`。
- [ ] OpenSandbox 创建 sandbox 时将 current session output dir 挂载到 `/workspace/.agentdock/output`。
- [ ] sandbox 内能读取 `/workspace/.agentdock/task/message.json`。
- [ ] sandbox 内能写 `/workspace/.agentdock/output/report.md`。
- [ ] sandbox 内看不到其他 session output 和其他 task runtime metadata。
- [ ] 默认 `agentId=pi` 的任务能启动内置 Pi runtime。
- [ ] runtime event 被发布到 RocketMQ。
- [ ] agentdock-cloud consumer 从 RocketMQ 消费 runtime event。
- [ ] SQLite 中生成 thread/message/run 会话记录。
- [ ] Cloud Web SSE 收到 local-compatible message/run/presence events。
- [ ] task 最终状态为 `succeeded`。
- [ ] files API 返回 output 元数据。
- [ ] sandbox 执行结束后被删除。
- [ ] 在 Cloud Web 中完成一次聊天，视觉和交互与 local 模式主路径一致。

## 18. Later Phases

- [ ] 实现 S3/OSS `StorageProvider`。
- [ ] 迁移到 PostgreSQL 或其他外部数据库以支持多实例。
- [ ] 支持 inputFiles 从外部 URI 下载到本地 workspace。
- [ ] 支持 output 上传到对象存储。
- [ ] 支持多实例部署和任务恢复。
- [ ] 引入独立任务队列。
- [ ] 拆分 agent-worker。
- [ ] 支持 Kubernetes OpenSandbox runtime。
- [ ] 增加租户级配额。
- [ ] 增加审计和计费。
