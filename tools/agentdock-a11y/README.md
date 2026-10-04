# AgentDock Accessibility Bridge Daemon (`agentdock-a11y`)

`agentdock-a11y` 是为 Android / Termux 移动端设计的极简本地无障碍自动化桥接守护进程（Accessibility Bridge Daemon）。

它运行在 Android 系统中，利用官方 `AccessibilityService` 权限，在本地回环地址（`127.0.0.1:19832`）开启极简的 HTTP REST 接口，为 Termux 下的 `mobile-ui` CLI 及云端大模型 Agent 提供免 ADB、免 Root 的页面内感知与微观交互能力。

---

## 1. 架构与安全模型

- **仅限本地回环（Loopback Only）**：HTTP 服务仅绑定 `127.0.0.1:19832`，不向局域网或外部网络暴露，天然隔离外部未授权访问。
- **免 ADB & 免 Root**：利用 Android 官方无障碍体系（`AccessibilityNodeInfo` 与 `dispatchGesture`），开启一次系统辅助功能开关即可长期生效，重启后是否恢复受系统权限与厂商后台策略影响。
- **双模点击保障（Dual-Action）**：优先触发目标节点的 `AccessibilityNodeInfo.performAction(ACTION_CLICK)`；若节点不可直接点击，自动根据节点中心坐标 `(cx, cy)` 调用免 Root 的 `AccessibilityService.dispatchGesture()` 注入 50ms 真实物理轻触手势，尽量提高交互成功率，仍需检查返回结果。

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

## 4. 自动化期间亮屏

支持此协议的 APK 使用无障碍窗口保持亮屏，不修改系统息屏时间，不依赖 ADB/Root，也不自动解锁。

```bash
mobile-ui screen status
mobile-ui screen keep-awake --duration=120
# 导航及页面操作；dump/click/input/scroll/back/home/wait 自动续期 120 秒
mobile-ui screen release
```

开始前需要手机已亮屏并解锁。连续 120 秒没有续期会释放窗口，随后系统按原息屏策略处理；到期不代表立刻关屏。`--duration` 接受 1–600 的整数，后续普通 UI 操作会续期为默认 120 秒。长等待前按需续期。任务结束应在 finally 清理中 release；断连或崩溃由到期及进程窗口清理兜底。手动息屏、服务中断或销毁也会释放，不会自动唤醒手机。一个设备共享一个亮屏窗口，不应同时运行多个界面自动化任务。

APK 主界面显示屏幕状态并提供「释放当前亮屏保护」按钮。旧 APK 没有 screen 接口时会警告，原页面操作仍可用，但不提供亮屏或新的锁屏保护保证。

HTTP 协议：`GET /api/screen` 只读取；`POST /api/screen` 接收 `{"action":"acquire","durationSeconds":120}` 或 `{"action":"release"}`。返回 `ok, interactive, locked, keepAwake, remainingMs`，失败另有 `code,error`，锁屏/息屏为 `USER_UNLOCK_REQUIRED`。所有设备窗口和保护状态在主线程处理。

### 构建与验证

需要 JDK、Android SDK platform 34 与 build-tools 34.0.0；设置 `ANDROID_HOME` 后执行 `bash tools/agentdock-a11y/build.sh`。执行 `bash tools/agentdock-a11y/test.sh` 检查纯 Java 租期生命周期及列表/点击编号一致性。`build/`、APK 和 `keystore/` 不入版本控制。更新已安装 APK 时必须使用原有签名；构建缺少旧密钥时生成的新调试密钥不能保证可覆盖更新。

HyperOS 实际保持亮屏效果、页面触摸/焦点和手动锁屏行为需要用新 APK 真机验证；契约测试不能证明这些系统效果。

页面序号统一来自完整节点目录；过滤后的 dump 可能跳号。始终使用显示出的精确 index，不按列表位置重新编号。新桥接统一 dump/click/input 的排序与编号，避免空布局容器造成索引偏移；页面变化后应重新 dump。
