# Spec: 移动端常用 App 语义快捷指令库 (Mobile App Intent Library)

## 1. Goal
在 AgentDock 代码仓库中统一维护移动端常用 App 的语义快捷指令库（`mobile-apps`），支持微信、支付宝、高德、美团、淘宝、网易云、抖音、Bilibili、系统设置等 30+ 个高频直达场景。当远程节点为 Android 时，自动向 Agent 注入结构化调用文档，使得用户在即时通讯平台（如飞书、企微、Web）发送日常服务指令时，Agent 能以零额外权限、毫秒级响应精准直达目标界面。

## 2. Scope
- **语义应用注册表 (`MobileAppRegistry`)**：在代码仓库中维护包含微信、支付宝、高德、百度地图、美团、淘宝、京东、网易云音乐、Bilibili、抖音及 Android 核心系统设置在内的 30+ 个高频场景元数据（包名、URL Scheme、组件、参数规范）。
- **意图组装引擎 (`IntentBuilder`)**：负责解析用户传入的 App、Action 及动态参数（如目的地、搜索词、网址），校验必要参数并安全转义生成 Android 标准 `am start` 指令。
- **CLI 命令行工具 (`mobile-apps`)**：打包在 `@kafca/agentdock` 中，提供 `mobile-apps list`（列出支持场景）、`mobile-apps open <app> [action] [params]`（执行跳转）、`mobile-apps intent <uri>`（直达自定义 Scheme）、`--dry-run`（打印原生 am 命令）等能力。
- **Agent 环境自适应注入 (`device-environment.ts`)**：当检测到 Mesh 节点为 Android (`node.platform === 'android'`) 时，在 `CLAUDE.md`、`AGENTS.md` 及系统 Prompt 中动态追加快捷指令列表与最佳实践，引导 Agent 主动优先使用语义工具。
- **客户端脱离更新机制 (`agentdock-node-update`)**：提供异步脱离 Supervisor 脚本与命令，避免 Agent 远程更新自己时因进程被杀导致连接异常断开，并在手机端脚本提供 `update` 选项。
- **自动化测试**：对注册表完整性、参数转义注入防护、指令组装逻辑、提示词注入及更新脚本生成进行全方位单测与集成测试覆盖。

## 3. Non-goals
- 本阶段不引入 ADB 无线调试或辅助功能无障碍点击（属于后续阶段）。
- 不处理未公开私有协议逆向，仅收录官方支持或经过广泛验证的稳定 DeepLink。
- 不拦截非 Android 平台的终端环境。

## 4. Behavior / Interface

### 4.1 CLI 命令规范
```bash
# 查看所有支持的 App 与动作
mobile-apps list [--json]

# 打开应用主页
mobile-apps open alipay
mobile-apps open wechat

# 常用场景直达
mobile-apps open alipay pay                          # 支付宝付款码
mobile-apps open alipay scan                         # 支付宝扫一扫
mobile-apps open alipay ride                         # 支付宝乘车码
mobile-apps open wechat scan                         # 微信扫一扫
mobile-apps open amap navigate --destination="广州塔" # 高德地图直接导航
mobile-apps open meituan search --keyword="咖啡"     # 美团搜索
mobile-apps open system settings                     # 系统设置
mobile-apps open system wifi                         # WiFi 设置

# 调试与验证
mobile-apps open alipay pay --dry-run
# 输出: am start -a android.intent.action.VIEW -d "alipayqr://platformapi/startapp?saId=20000056"

# 客户端更新指令
agentdock-node-update
# 输出: [mesh] Starting detached self-update in background...
```

### 4.2 结构化定义规范 (`MobileAppDefinition`)
```ts
export interface MobileAppAction {
  id: string;
  displayName: string;
  description: string;
  action?: string; // 默认 'android.intent.action.VIEW'
  uriTemplate?: string;
  component?: string; // 'com.example.app/.MainActivity'
  parameters?: {
    name: string;
    description: string;
    required?: boolean;
    defaultValue?: string;
  }[];
}

export interface MobileAppDefinition {
  id: string;
  displayName: string;
  packageName: string;
  actions: Record<string, MobileAppAction>;
}
```

## 5. Constraints / Compatibility
- **运行环境**：同时支持在手机端 Termux 环境下直接执行（调用系统 `am start`），以及在服务端代码库单元测试中运行。
- **安全性**：参数填充必须严格转义单双引号与特殊 shell 字符，防止 Shell 命令注入。
- **零依赖原则**：核心注册表与 Builder 使用 Node.js 原生标准库，不引入额外重量级依赖。
- **更新持久性**：自更新过程不得破坏已有的 `$HOME/.agentdock/mesh-node.json` 身份凭据文件。

## 6. Acceptance Criteria
- **AC-1**：定义并收录支付宝（付款码、扫一扫、乘车码、收款码、蚂蚁森林）、微信（启动、扫一扫）、高德/百度（导航、搜索）、美团（搜索、外卖）、淘宝/京东（搜索、购物车、订单）、网易云（搜索、日推）、B站/抖音（主页、搜索）、系统（设置、WiFi、蓝牙、应用信息、网页、拨号）等 30+ 个典型场景。
- **AC-2**：`mobile-apps open` 支持参数替换与 `--dry-run` 打印命令，遇到缺失必要参数时友好报错。
- **AC-3**：当设备平台为 Android 时，`buildDeviceClaudeMd` 和 `buildDeviceSystemPrompt` 自动呈现 `mobile-apps` 指令文档。
- **AC-4**：单元测试 100% 覆盖核心组装分支与注入防御，代码复杂度保持在 ESLint `<= 15` 门禁以内。
- **AC-5**：提供 `agentdock-node-update` 脱离进程自更新 CLI，并支持手机端脚本 `setup-agentdock.sh update`。
