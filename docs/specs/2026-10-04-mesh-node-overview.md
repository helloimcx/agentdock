# Spec: 无凭据查看 Mesh 节点概况

## Goal

打开 Mesh 页面时，无需输入 Mesh 管理令牌即可查看已登记节点的基本信息。

## Scope

- Mesh 已启用时允许无 Mesh 管理令牌调用 `GET /api/local/v1/mesh/nodes`。
- 页面直接显示并定时刷新节点概况，仅显示节点信息。
- 配对、撤销、执行、请求历史与结果查看不出现在免凭据页面。
- 所有其他管理 API 继续要求管理员令牌。

## Non-goals

- 不移除 Mesh 未配置 `AGENTDOCK_MESH_ADMIN_TOKEN` 时的禁用行为。
- 不开放配对、撤销、命令执行、文件访问、请求历史或取消操作。
- 不改变节点协议、持久化结构、主应用登录认证或其他 API。

## Behavior / Interface

- Mesh 已启用时，匿名 `GET /mesh/nodes` 返回现有节点列表响应。
- 匿名 `GET /mesh/requests` 与所有写操作仍返回 `401`。
- Mesh 未启用时，匿名 `GET /mesh/nodes` 仍返回 `503`。
- 有效管理员令牌继续可访问现有管理路由。
- Renderer 无凭据读取并显示加载错误、空列表或节点详情。

## Constraints / Compatibility

节点名称、ID、平台、状态及能力将对任何能访问 Core Mesh 路由的人可见。管理员令牌仍只保留在需要管理 API 的调用方内存中，不注入 renderer。保持现有 `MeshNode` 响应结构与其他 SDK 调用兼容。

## Acceptance Criteria

1. Mesh 已启用时，不带 Authorization 的 `GET /mesh/nodes` 返回 `200` 和节点概况。
2. Mesh 未启用时，不带 Authorization 的 `GET /mesh/nodes` 返回 `503`。
3. 无令牌的 `GET /mesh/requests`、配对、撤销、执行和取消请求仍返回 `401`。
4. 有效管理员令牌仍可访问节点与管理 API。
5. Mesh 页面不显示管理员令牌输入表单，并显示节点名称、ID、平台、状态和能力；空列表与请求错误可见。
