# Spec：远程工作区调用 LAC

## Goal

让远程工作区 Agent 能在保留远程设备 Bash 能力的同时调用 Local AI Core 的 LAC 功能。

## Scope

- 在主机侧增加会话绑定的 LAC Dispatcher，复用现有 CLI 业务处理逻辑，并提供独立的结构化 MCP 控制工具。
- 首期在 Mesh Shell Proxy 中识别语法明确的独立 `lac <domain> <action> ...` 命令，兼容现有 Skills；普通 Shell 命令仍经 Mesh 在设备执行。两个入口调用同一 dispatcher。
- 首期覆盖不需要文件传递的 memory、scheduler、monitor、automation 操作；按现有命令和授权语义建立逐项 allowlist。
- 返回标准 stdout、stderr 和 exit code；为不支持的 lac 组合返回可理解的错误。

## Non-goals

- 首期支持混合 Shell 表达式、管道、重定向、命令替换或脚本内部动态调用 `lac`。
- 远程设备安装完整 LAC 或接收 Core 管理 token。
- 首期将远端文件当成本机文件，或默默将 rules/skills 写入本机 shadow workspace。
- 开放任意 CLI 子命令、任意 base URL、跨 workspace/thread/channel 的调用。

## Behavior / Interface

- 输入由 argv 解析，不得将未验证的整段 Shell 文本交给主机 Shell。
- 路由依据 Shell 词法段中的实际命令位置；仅在参数或普通远端管道中提到 `lac` 时仍走设备 Shell。只剥离已识别的 Claude bootstrap/eval/pwd 包装，不得丢弃任意条件或复合前缀。
- MCP 工具以结构化 operation/arguments 调用主机 dispatcher；独立 `lac` 命令经受限 Shell 解析后转成同一 operation/arguments。dispatcher 校验 allowlist 和 session-scoped workspace/thread/channel 上下文，再调用 LAC handler。
- 用户传入的 `--base-url`、伪造上下文和越权目标必须拒绝；调用目标来自可信会话上下文。
- 普通命令继续以远端设备 Bash 语义执行。
- 实际以 `lac` 为命令的 `&&`、`|`、重定向、`$()` 等组合在首期清晰报不支持，并提示分成独立步骤；非 LAC 命令参数中出现 `lac` 一词时仍保留远端 Shell 语义。
- 远端文件参数在首期明确报不支持；文件能力单独走 Mesh 文件读取与主机临时存储设计。

## Constraints / Compatibility

- MCP 与 Shell 兼容入口共用 host dispatcher；优先复用 CLI domain handler，不在入口复制业务逻辑。对 `runCli(argv, env, io)` 的复用必须先过滤身份与 base URL 参数。
- dispatcher 是主机内组件间边界，不通过 Mesh 管理 API 向远程暴露通用执行接口。
- Claude、OpenCode、Pi 等 runtime 的接入能力逐个验证；未验证的平台不得宣称支持。
- 先更新相关 Managed Skill 文案，说明可用命令和混合命令边界。

## Acceptance Criteria

1. MCP 的 scheduler 查询和远程工作区中的 `lac scheduler list` 使用同一 dispatcher、当前主机会话上下文，并分别返回结构化结果及与主机 CLI 一致的退出码/输出。
2. `git status` 等非 LAC 命令仍在目标远程设备执行。
3. 引号、空参数、空格和转义参数解析后不会改变 argv 语义；解析失败时 fail closed。
4. `lac ... --base-url <url>`、跨 workspace/thread/channel 伪造、未列入 allowlist 的命令均被拒绝。
5. 以 `lac` 为命令的复合调用、管道、重定向和命令替换不会在主机执行，并给出明确错误；普通远端管道即使包含 `lac` 字样也继续执行在设备。
6. dispatcher 不向设备或 Agent 环境下发 Mesh admin token / Core 管理凭据。
7. 未支持 runtime 和文件参数明确失败；支持矩阵及限制见文档。
8. 单元、集成和 runtime 冒烟验证覆盖以上行为；`pnpm lint:arch` 通过，架构事实、变更记录、provider artifacts、overview 和 README diagram 一致。
