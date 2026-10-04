# AgentDock Accessibility Bridge Daemon (`agentdock-a11y`)

`agentdock-a11y` 是为 Android / Termux 移动端设计的极简本地无障碍自动化桥接守护进程（Accessibility Bridge Daemon）。

它运行在 Android 系统中，利用官方 `AccessibilityService` 权限，在本地回环地址（`127.0.0.1:19832`）开启极简的 HTTP REST 接口，为 Termux 下的 `mobile-ui` CLI 及云端大模型 Agent 提供免 ADB、免 Root 的页面内感知与微观交互能力。

---

## 1. 架构与安全模型

- **仅限本地回环（Loopback Only）**：HTTP 服务仅绑定 `127.0.0.1:19832`，不向局域网或外部网络暴露，天然隔离外部未授权访问。
- **免 ADB & 免 Root**：利用 Android 官方无障碍体系（`AccessibilityNodeInfo` 与 `dispatchGesture`），开启一次系统辅助功能开关即可长期生效，手机重启后随系统常驻保活。
- **双模点击保障（Dual-Action）**：优先触发目标节点的 `AccessibilityNodeInfo.performAction(ACTION_CLICK)`；若节点不可直接点击，自动根据节点中心坐标 `(cx, cy)` 调用免 Root 的 `AccessibilityService.dispatchGesture()` 注入 50ms 真实物理轻触手势，保障 100% 触发成功率。

---

## 2. HTTP REST 协议契约 (`http://127.0.0.1:19832`)

### 2.1 状态检查
- **请求**：`GET /api/status`
- **响应示例**：
  ```json
  {
    "ok": true,
    "version": "1.0.0",
    "serviceEnabled": true,
    "currentPackage": "com.taobao.taobao",
    "currentActivity": "com.taobao.search.SearchActivity",
    "screenWidth": 1080,
    "screenHeight": 2400
  }
  ```

### 2.2 屏幕结构获取
- **请求**：`GET /api/dump?interactiveOnly=true`
- **响应示例**：
  ```json
  {
    "ok": true,
    "package": "com.taobao.taobao",
    "activity": "com.taobao.search.SearchActivity",
    "screenWidth": 1080,
    "screenHeight": 2400,
    "count": 3,
    "elements": [
      {
        "index": 1,
        "text": "搜索",
        "id": "search_btn",
        "className": "android.widget.Button",
        "bounds": [800, 120, 1000, 200],
        "center": [900, 160],
        "clickable": true,
        "editable": false,
        "scrollable": false
      }
    ]
  }
  ```

### 2.3 元素点击
- **请求**：`POST /api/click`
- **请求体**：
  ```json
  { "index": 1 }
  // 或 { "text": "搜索" }
  // 或 { "id": "search_btn" }
  // 或 { "point": [900, 160] }
  ```
- **响应示例**：
  ```json
  {
    "ok": true,
    "method": "action_click",
    "target": { "index": 1, "text": "搜索" }
  }
  ```

### 2.4 文本输入
- **请求**：`POST /api/input`
- **请求体**：
  ```json
  {
    "text": "精品咖啡豆",
    "index": 1,
    "clear": true
  }
  ```
- **响应示例**：
  ```json
  {
    "ok": true,
    "inputText": "精品咖啡豆",
    "targetIndex": 1
  }
  ```

### 2.5 屏幕滑动
- **请求**：`POST /api/scroll`
- **请求体**：
  ```json
  {
    "direction": "down",
    "distance": 0.5
  }
  ```
- **响应示例**：
  ```json
  {
    "ok": true,
    "direction": "down"
  }
  ```

### 2.6 系统导航动作
- **请求**：`POST /api/action`
- **请求体**：
  ```json
  {
    "action": "back" // 或 "home", "recents"
  }
  ```
- **响应示例**：
  ```json
  {
    "ok": true,
    "action": "back"
  }
  ```

---

## 3. 安装与配置指南

1. **安装 APK**：通过安装器安装 `agentdock-a11y.apk`（体积约 200KB）。
2. **开启无障碍服务**：
   - 进入系统 **设置 -> 更多设置 -> 无障碍 -> 已下载的服务（或应用）**。
   - 找到 **AgentDock 无障碍服务** 并开启开关。
3. **保活配置（HyperOS / MIUI）**：
   - 进入应用信息，将省电策略调整为 **无限制**。
   - 允许 **自启动** 和 **后台弹出界面**。
4. **验证连接**：
   在 Termux 终端中执行：
   ```bash
   mobile-ui status
   ```
   返回当前应用包名与服务开启状态即表示就绪。
