# Spec: Android 无障碍桥接 APK 原生集成 AgentDock Mesh Client

## 1. Goal
在现有的 Android 无障碍桥接 APK (`agentdock-a11y`) 中直接集成 **AgentDock Mesh Client** 原生长连接客户端，使该 APK 同时担任**系统无障碍代理**与 **Mesh 节点**双重职责。
彻底移除原有的本地 HTTP 回环服务 (`127.0.0.1:19832`)，实现手机端**零端口监听（Zero-Listening-Port, Outbound Only）**的极简安全架构。
脱离对 Termux / Node.js 复杂环境的强依赖，用户只需安装单个 APK，开启无障碍并输入/扫描配对码，即可将真实 Android 手机接入 AgentDock 云端大模型，实现对屏幕微观操作（`mobile-ui`）、应用宏观直达（`mobile-apps`）及常用系统硬件接口（兼容 `termux-api`）的全能操控。同时完整保留原有的 npm client（`agentdock-node`），继续支持 Linux/macOS/Windows 环境。

---

## 2. Scope
1. **原生轻量 WebSocket Mesh 客户端 (`MeshClient.java`)**：
   - 纯 Java 零外部重依赖实现 RFC 6455 协议客户端（支持 `ws://` 与 `wss://`）；
   - 支持向 Mesh Gateway 请求配对（`/api/local/v1/mesh/enroll`）；
   - 建立安全出站长连接（`/api/local/v1/mesh/connect`），发送 `hello` 握手，10s 心跳保活，45s 心跳超时，指数退避自动重连；
   - 接收 `execute` 执行请求，分发处理并回传 `result` 响应，支持 `cancel` 取消。
2. **彻底移除本地 HTTP 端口服务**：
   - 移除 `HttpServerBridge.java` 及 19832 端口监听逻辑，手机端不开放任何 TCP 监听端口；
   - 所有自动化与设备控制指令全部通过安全 WebSocket Mesh 通道下发，在 APK 进程内内存直调。
3. **虚拟 Shell 命令分发器 (`CommandDispatcher.java`)**：
   - 拦截并解析由云端 ACP / `agentdock-mesh-shell` 发来的 `sh -c "<command>"` 终端指令；
   - **`mobile-ui <args>`**：直接映射调用进程内 `AgentDockAccessibilityService` 内存方法（`status`, `dump`, `click`, `input`, `scroll`, `back`, `home`, `wait`），并输出标准紧凑格式或 JSON；
   - **`mobile-apps <args>`**：直接映射调用内置 `IntentEngine`，原生通过 `context.startActivity` 调起目标 App；
   - **`termux-*` 语法兼容**：
     - `termux-tts-speak <text>`：直接调用 Android 原生 `TextToSpeech`；
     - `termux-battery-status`：读取原生 `BatteryManager` 并返回 100% 兼容的 JSON；
     - `termux-clipboard-get` / `termux-clipboard-set <text>`：利用无障碍后台特权安全读写 `ClipboardManager`；
     - `termux-vibrate` / `termux-torch` / `termux-toast` / `termux-volume` / `termux-location` 等原生洁净室实现；
   - 其他基础 Linux 命令：降级调用 Android 原生 `/system/bin/sh -c` 执行。
4. **宏观快捷指令引擎 (`IntentEngine.java`)**：
   - 内置支付宝（付款码/扫一扫/乘车码）、微信（扫一扫）、高德地图（导航/搜索）、美团、淘宝、系统设置（WiFi/蓝牙/显示）等高频 Intent 模板；
   - 支持原生自定义 DeepLink URI 调起。
5. **配对凭据与配置持久化 (`MeshPreferences.java` & `MainActivity.java`)**：
   - 在 Android `SharedPreferences` 中安全持久化 `serverUrl`、`nodeId`、`token`；
   - 在 `MainActivity` 中提供配置界面（输入 Server 地址、配对 Token，点击“配对并连接”按钮，展示连接状态与实时节点状态）。
6. **npm 客户端保留**：
   - 保留 `services/local-ai-core/src/mesh/` 下的所有 npm client 代码，非 Android 节点功能完全不受影响。
7. **自动化测试覆盖**：
   - 新增针对 Android A11y 虚拟 Shell 路由契约、参数解析与标准输出格式对齐的测试套件。

---

## 3. Non-goals
- **不在手机端监听任何本地或外网端口**：彻底弃用本地 Socket Server，避免端口冲突与权限风险。
- **不打包完整 Linux 用户态**：不打包 GCC、Python、Node.js 等庞大开发工具链。
- **不修改服务端核心 Mesh 协议**：协议契约使用既有的 `shell.exec` 和 Mesh v1 规范，服务端无需进行破坏性重构。
- **不依赖第三方重度框架**：不引入 React Native、Flutter 或重量级外部网络库，保持 APK 安装包体积在 1MB 以内的极致轻量化。

---

## 4. Behavior & Interface Specification

### 4.1 配对与连接流程
1. 用户在 AgentDock Web 端或管理员 CLI 生成配对凭据（包含 `server` 与 `pairingToken`）。
2. 用户打开 `AgentDock 无障碍服务` APK，在主界面输入 Server 地址（如 `http://192.168.1.100:9831`）与配对令牌（或在文本框粘贴），点击【配对并接入】。
3. APK 后台异步发起 HTTP POST 请求至 `<server>/api/local/v1/mesh/enroll`，获取 `nodeId` 与永久 `token`，持久化至 `SharedPreferences`。
4. APK 自动建立 WebSocket 长连接，界面状态显示 `🟢 已连接 Mesh 网关 (节点 ID: node:xxxx)`。
5. 手机息屏或重启后，随无障碍服务及前台常驻服务自动拉起重连。

### 4.2 命令拦截行为对照表
| 云端 Agent 下发指令 | 拦截处理模块 | 执行动作 | 输出格式 |
|---|---|---|---|
| `mobile-ui status` | `AgentDockAccessibilityService` | 读取当前包名、Activity、屏幕分辨率与服务状态 | 纯文本/JSON，对齐现有 CLI |
| `mobile-ui dump` | `AgentDockAccessibilityService` | 遍历提取可见控件并生成 1-based 序号 | 紧凑文本表格，对齐现有 CLI |
| `mobile-ui click <idx>` | `AgentDockAccessibilityService` | 双模点击（节点 performAction 或 dispatchGesture） | `{"ok":true,"method":"...","target":{...}}` |
| `mobile-ui input <text>` | `AgentDockAccessibilityService` | 寻找焦点输入框并 `ACTION_SET_TEXT` | `{"ok":true,"inputText":"...","targetIndex":...}` |
| `mobile-ui scroll <dir>` | `AgentDockAccessibilityService` | 派发真实物理滑动滑动手势 | `{"ok":true,"direction":"down"}` |
| `mobile-ui back / home` | `AgentDockAccessibilityService` | 调用系统 `GLOBAL_ACTION_BACK / HOME` | `{"ok":true,"action":"back"}` |
| `mobile-apps open <app> <act>` | `IntentEngine` | 构造原生 Intent 并 `startActivity` | `{"ok":true,"app":"...","action":"..."}` |
| `termux-tts-speak <text>` | `SystemApiHandlers` | 调用原生 `TextToSpeech.speak` | 空文本（Exit 0） |
| `termux-battery-status` | `SystemApiHandlers` | 读取 `BatteryManager` 广播属性 | `{"health":"GOOD","percentage":...,"plugged":"...","status":"..."}` |
| `termux-clipboard-get` | `SystemApiHandlers` | 读取 `ClipboardManager` | 剪贴板纯文本内容 |
| `termux-clipboard-set <t>` | `SystemApiHandlers` | 写入 `ClipboardManager` | 空文本（Exit 0） |
| `termux-vibrate` | `SystemApiHandlers` | 调用 `Vibrator` | 空文本（Exit 0） |
| `termux-torch [on|off]` | `SystemApiHandlers` | 调用 `CameraManager.setTorchMode` | 空文本（Exit 0） |
| `termux-toast <text>` | `SystemApiHandlers` | 主线程弹出 Toast 提示 | 空文本（Exit 0） |
| 其他指令 (如 `df -h`, `uname -a`) | `ProcessBuilder` | 降级调用 `/system/bin/sh -c` | 标准 stdout/stderr 与 exitCode |

---

## 5. Constraints & Compatibility
- **兼容性**：
  - 支持 Android 8.0+ (API 26~34)，minSdkVersion = 26。
  - 原有 npm client 保持不变。
- **安全与权限模型**：
  - 纯出站长连接（Outbound Only），无须配置内网穿透或端口映射，无本地监听端口，零网络攻击面。

---

## 6. Acceptance Criteria
1. **原生 Mesh 客户端可正常连接与保活**：APK 在配置合法 server 与 pairingToken 时，可顺利在 Mesh Gateway 上注册为在线节点，且心跳与断线重连正常。
2. **手机端无监听端口**：移除 `HttpServerBridge`，手机端不再监听 19832 端口。
3. **`mobile-ui` 命令在无 Termux 依赖下顺畅执行**：通过云端下发 `mobile-ui status/dump/click`，APK 内部直接解析并执行无障碍操作，输出符合既有规范。
4. **`mobile-apps` 命令可原生直达应用**：下发 `mobile-apps open alipay bus` 等指令时，能通过原生 Intent 成功调起支付宝乘车码。
5. **`termux-api` 常用命令无缝兼容**：下发 `termux-battery-status`、`termux-tts-speak`、`termux-clipboard-get/set`、`termux-vibrate` 时，原生正确执行并返回预期结果。
6. **npm client 保留验证**：现有 Node.js 版 `agentdock-node` 及所有集成测试全部正常通过。
