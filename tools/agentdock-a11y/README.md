# AgentDock Mobile Mesh & Accessibility Daemon (`agentdock-a11y`)

`agentdock-a11y` 是为 Android 移动端设计的 **All-in-One 原生 Mesh 节点与无障碍自动化守护进程**。

它运行在 Android 系统中，同时承担两项关键职责：
1. **系统无障碍与自动化引擎**：利用 Android 官方 `AccessibilityService` 权限，提供免 ADB、免 Root 的页面内微观感知与手势交互（`mobile-ui`），并集成原生 Intent 宏观直达能力（`mobile-apps`）；
2. **原生 WebSocket Mesh Client**：采用纯出站长连接（Outbound Only），直接连接云端 AgentDock Mesh Gateway，**手机端零监听端口、零本地攻击面、免内网穿透**。

同时内置洁净室实现的系统硬件能力，全套兼容大模型常用的 `termux-api` 命令（TTS 语音播报、电池状态、剪贴板读写、震动、手电筒、音量调节、位置等），真正实现**“一个 APK 搞定全套手机自动化，完全脱离对 Termux 及 Node.js 的依赖”**。

---

## 1. 架构与安全模型

```mermaid
flowchart LR
    Cloud["云端 Local AI Core<br/>(Mesh Gateway)"] <==>|WSS 出站长连接<br/>(免监听端口 / 免穿透)| APK["agentdock-a11y.apk<br/>(原生 MeshClient)"]
    
    subgraph APKInt["APK 进程内直接分发"]
        APK --> Dispatcher["CommandDispatcher<br/>(虚拟 Shell 拦截器)"]
        Dispatcher --> A11y["AgentDockAccessibilityService<br/>(屏幕 Dump / 双模点击 / 文本输入 / 手势)"]
        Dispatcher --> IntentEngine["IntentEngine<br/>(原生 Intent 调起微信/支付宝/高德/美团/淘宝)"]
        Dispatcher --> SysApis["SystemApiHandlers<br/>(TTS / 电池 / 剪贴板 / 振动 / 手电筒 / 定位)"]
        Dispatcher --> Sh["ProcessBuilder<br/>(/system/bin/sh 降级执行通用命令)"]
    end
```

- **双模架构支持（Dual-Mode Bridge & Mesh）**：既支持独立的出站长连接（WSS Outbound）直连云端网关，又内置本地回环（`127.0.0.1:19832`，仅限本机 127.0.0.1 访问）HTTP 桥接服务，完美配合本地 Termux 终端客户端毫秒级协同调用。
- **系统级保活（Accessibility + Foreground Service）**：基于 Android 官方无障碍服务与前台服务常驻，享有系统级高优先级保活待遇，息屏或手机重启后自动随系统拉起重连。
- **双模点击保障（Dual-Action）**：优先触发目标节点的 `AccessibilityNodeInfo.performAction(ACTION_CLICK)`；若节点不可直接点击，自动根据节点中心坐标 `(cx, cy)` 调用免 Root 的 `AccessibilityService.dispatchGesture()` 注入 50ms 真实物理轻触手势。
- **特权剪贴板访问与屏幕租约**：内置 `ScreenController` 屏幕亮屏保活租约控制，执行期间持有 WakeLock 防止自动回锁，并突破 Android 10+ 后台无法读取剪贴板的限制。

---

## 2. 支持的指令集规范

云端大模型 Agent（如 Claude Code / Codex）下发的命令会由 APK 内部的 `CommandDispatcher` 自动拦截并极速处理：

### 2.1 页面微观感知与交互 (`mobile-ui`)
- `mobile-ui status [--json]`：获取无障碍服务状态、当前前台应用包名与 Activity、屏幕分辨率。
- `mobile-ui dump [--interactive-only] [--json]`：遍历当前屏幕控件，输出带 1-based 序号的紧凑表格。
- `mobile-ui click <index | "text" | x,y> [--id=<viewId>]`：按序号、文本、坐标或控件 ID 触发点击。
- `mobile-ui input <text> [--target=<index>] [--no-clear]`：向输入框输入文本（默认清空原内容）。
- `mobile-ui scroll [down|up|left|right]`：屏幕物理滑动手势。
- `mobile-ui back` / `mobile-ui home`：触发系统返回键或主页键。
- `mobile-ui wait <text>`：轮询等待指定文本出现。

### 2.2 应用快捷调起 (`mobile-apps`)
- `mobile-apps open alipay pay`：直接打开支付宝付款码。
- `mobile-apps open alipay scan`：打开支付宝扫一扫。
- `mobile-apps open alipay bus`：打开支付宝地铁/乘车码。
- `mobile-apps open wechat scan`：打开微信扫一扫。
- `mobile-apps open amap navigate --destination="广州塔"`：高德地图路线规划。
- `mobile-apps open meituan search --keyword="美食"`：美团搜索。
- `mobile-apps open taobao search --keyword="商品"`：淘宝搜索。
- `mobile-apps open system wifi`：直接跳转系统 WiFi 设置。
- `mobile-apps intent "<uri>"`：调起自定义 DeepLink URL。

### 2.3 系统与硬件能力 (兼容 `termux-api` 语法)
- `termux-tts-speak "<文本>"`：调用 Android 系统内置引擎朗读语音。
- `termux-battery-status`：返回电量百分比、充电状态、健康度及温度的 JSON。
- `termux-clipboard-get`：读取系统当前剪贴板内容。
- `termux-clipboard-set "<文本>"`：向剪贴板写入文本。
- `termux-vibrate`：触发物理震动。
- `termux-torch [on|off]`：开关手电筒/后置补光灯。
- `termux-toast "<文本>"`：在屏幕浮现 Toast 提示。
- `termux-volume [music|ring|alarm] [0-15]`：查询或调整音量。
- `termux-location`：获取 GPS/基站经纬度坐标 JSON。

---

## 3. 安装与配置指南（极简步骤）

1. **安装 APK**：安装 `agentdock-a11y.apk`（体积约 200KB）。
2. **配置权限**：
   - 进入系统 **设置 -> 更多设置 -> 无障碍 -> 已下载的服务（或应用）**，开启 **AgentDock 无障碍服务**。
   - 打开应用，进入 **应用信息**，将省电策略调整为 **无限制**，开启 **自启动**。
3. **配对接入**：
   - 打开应用界面；
   - 输入 AgentDock 服务端地址（如 `https://your-server.com` 或 `http://192.168.1.100:9831`）；
   - 输入在服务端生成的 10 分钟单次配对令牌（Pairing Token）；
   - 点击 **【配对并连接 Mesh 网关】**。
4. **验证连接**：
   界面状态变更为 `🟢 Mesh 状态: 已连接 (node:xxxx)` 即表示配对成功且常驻在线，云端即可直接下发各种自动化与控制指令。
