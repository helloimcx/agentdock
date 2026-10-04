# Mesh 运行时兼容性

Mesh 兼容性是一套执行约束。只有当 Local AI Core 能如实向运行时说明宿主机与设备的职责，并能把工作区 Shell 和文件操作路由到配对节点，或禁用相应的本地工具时，该运行时才允许用于 Mesh。只靠提示词不能保证操作被正确路由。文件工具只能访问节点批准的根目录；Shell 从该目录启动，但仍使用设备用户本身的操作系统权限，因此不会被限制在批准根目录内，也不构成沙箱。

| 已注册运行时 | Mesh 状态 | 上下文如何传入 | 工作区文件操作如何约束 |
|---|---|---|---|
| Claude Code (`claudecode`) | 可用 | ACP `systemPrompt.append` 和 `CLAUDE.md` | 通过 Mesh 文件 MCP 操作文件；禁用 ACP 原生文件工具；Shell 转发到 Mesh 代理 |
| OpenCode (`opencode`) | 可用 | 通过运行时配置加载 `AGENTS.md` | 通过 Mesh 文件 MCP 操作文件；拒绝本地 read/edit/glob/grep/list；Shell 明确指向 Mesh 代理 |
| Pi (`pi`) | 可用 | 工作区中的 `AGENTS.md` | Pi 启动包装器只开放 Mesh 扩展工具，不提供本地内置文件与 Shell 工具 |
| Codex (`codex`) | 暂不开放 | Mesh 尚未启用 | 尚无经过验证的文件操作接管或替换方案 |
| Hermes (`hermes`) | 暂不开放 | Mesh 尚未启用 | 尚无经过验证的文件操作接管或替换方案 |
| LocalCore ACP (`localcore-acp`) | 暂不开放 | Mesh 尚未启用 | 尚无经过验证的文件操作接管或替换方案 |
| Cursor (`cursor`) | 暂不开放 | Mesh 尚未启用 | 尚无经过验证的文件操作接管或替换方案 |
| Gemini (`gemini`) | 暂不开放 | Mesh 尚未启用 | 尚无经过验证的文件操作接管或替换方案 |
| Qoder (`qoder`) | 暂不开放 | Mesh 尚未启用 | 尚无经过验证的文件操作接管或替换方案 |
| iFlow (`iflow`) | 暂不开放 | Mesh 尚未启用 | 尚无经过验证的文件操作接管或替换方案 |

“暂不开放”表示启动 Mesh 工作区时会在创建影子工作区之前失败；这些运行时的本地和 sandbox 执行不受影响。只有在对应运行时的 ACP 或工具配置经过路由/禁用测试，且上下文传递方式经过核实后，才应增加支持。

代码中的运行时配置表是支持状态的唯一事实来源。这里的“可用”表示适配器已接入，并通过仓库级配置与路由测试；不代表已经针对所有 provider 二进制及版本完成端到端验证。适配器行为和失败关闭测试位于 `tests/integration/remote-workspace-mesh.test.ts`、`tests/integration/remote-mesh-filesystem-tools.test.ts` 和 `tests/integration/workspace-mcp-servers.test.ts`。对实际运行时程序做启动冒烟验证仍是发布前单独需要完成的兼容性检查。
