---
name: mobile-automation
description: Android 移动端自动化技能。提供基于 Intent/DeepLink 的 App 页面秒级直达（mobile-apps），以及免 ADB/免 Root 的屏幕 UI 元素感知、序号精准点击、文本输入与手势交互（mobile-ui）。
platforms:
  - android
requiresTools:
  - mobile-apps
  - mobile-ui
triggers:
  - 手机操作
  - 移动端
  - 打开应用
  - 淘宝
  - 美团
  - 微信
  - 支付宝
  - 高德
  - 屏幕点击
  - 加入购物车
  - 扫一扫
  - 付款码
  - mobile-apps
  - mobile-ui
---

# Mobile Automation (Android 移动端自动化技能)

本技能为 Android 设备（小米/HyperOS、Termux 及主流 Android 环境）提供免 ADB、免 Root 的一等公民端侧自动化能力。
结合宏观 DeepLink 直达与微观 UI 元素定位，支持电商搜索加购、生活服务导航、系统设置调节等复合业务流。

---

## 1. 工具分工与核心命令

### 1.1 宏观页面直达：`mobile-apps` (Macro Navigation)
通过 Android 原生 Intent / DeepLink 秒级跳转目标页面，避开层层首页弹窗：
* `mobile-apps list`: 查看设备支持的预置应用与快捷动作列表（支持 `--json`）。
* `mobile-apps open <app> [action] [options]`: 打开指定 App 并直达对应功能页面。
  * **电商加购/搜索**: `mobile-apps open taobao search --keyword="商品关键词"`
  * **外卖生活**: `mobile-apps open meituan search --keyword="美食关键词"`
  * **地图导航**: `mobile-apps open amap navigate --destination="目标地址"`
  * **支付扫码**: `mobile-apps open alipay pay`（付款码）、`mobile-apps open alipay scan`（扫一扫）、`mobile-apps open alipay bus`（乘车码）
  * **社交通讯**: `mobile-apps open wechat scan`（微信扫码）
  * **系统设置**: `mobile-apps open system settings`、`mobile-apps open system wifi`
* `mobile-apps intent "<uri>"`: 打开自定义 DeepLink URI（如 `snssdk1128://...`）。

### 1.2 微观页面内交互：`mobile-ui` (In-Page Accessibility Interaction)
到达页面后，感知当前 UI 树并执行无障碍手势：
* `mobile-ui status`: 检查无障碍桥接服务状态、当前活跃应用包名（Package）与前台 Activity。
* `mobile-ui dump`: 提取当前屏幕可见元素树，生成带有 1-based 序号 `[1]`, `[2]`, ... 的结构化文本列表。
* `mobile-ui click <index>`: 按元素序号精准点击（如 `mobile-ui click 5`）。
* `mobile-ui click "<text>"`: 点击文本匹配目标（支持模糊匹配）。
* `mobile-ui input "<text>" [--target <index>]`: 在当前焦点或指定输入框中输入文本。
* `mobile-ui scroll [down|up]`: 屏幕半屏滑动（上滑查看更多/下滑返回顶部）。
* `mobile-ui back`: 发送 Android 系统物理返回键。
* `mobile-ui wait "<text>"`: 等待目标页面元素加载就绪。

---

## 2. 标准自动化操作 SOP (Standard Operating Procedure)

完成复合任务时，严格遵循 **“宏观直达 -> 稳定等待 -> UI感知 -> 序号点击 -> 验证反馈”** 的五步闭环：

### 流程示例：淘宝商品搜索与精准加购
```bash
# 1. 宏观直达商品搜索页
mobile-apps open taobao search --keyword="亚博智能 树莓派5四足机器狗"

# 2. 等待页面网络与组件渲染完成 (2秒)
sleep 2

# 3. 获取屏幕元素列表，定位目标商品卡片
mobile-ui dump

# 4. 根据 dump 输出的目标商品卡片序号（假设为 [3]）点击进入详情页
mobile-ui click 3
sleep 2

# 5. 再次 dump 定位详情页右下角「加入购物车」按钮（假设为 [18]）
mobile-ui dump
mobile-ui click 18
sleep 1

# 6. 若弹出规格选择抽屉，dump 选定特定 SKU 规格与确定按钮
mobile-ui dump
mobile-ui click "AI大模型机器狗"
sleep 1
mobile-ui click "确定"

# 7. 最终状态确认
mobile-ui dump
```

---

## 3. 避坑与鲁棒性准则 (Golden Rules)

1. **异步渲染等待**：App 跨进程启动或网络搜索列表需要约 1~2 秒渲染耗时，在 `mobile-apps open` 之后必须执行 `sleep 2` 再进行 `mobile-ui dump`，避免 dump 到白屏或过渡页。
2. **优先使用序号点击**：推荐使用 `mobile-ui click <index>` 替代坐标盲点或长文本模糊匹配，确保命中具体的可交互无障碍节点。
3. **弹窗防御**：遇到系统权限弹窗、升级提示或广告浮层时，先 dump 识别「关闭」、「跳过」或「取消」的序号并点击消除，或调用 `mobile-ui back` 返回。
4. **客户端脱离更新**：当需要静默升级移动端 Mesh 节点 CLI 工具时，执行 `agentdock-node-update`，该进程会在后台常驻守护并完成自动重连。
