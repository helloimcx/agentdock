# Spec: 移动端页面内操作与免 ADB 无障碍桥接 (Mobile Accessibility Bridge)

## 1. Goal
在第一阶段已实现的 `mobile-apps`（语义 DeepLink 宏观直达目标 App 页面）基础之上，实现第二阶段：**页面内微观感知与自动化交互（`mobile-ui`）**。
在手机随身携带、免 USB ADB 连接、免 Root 权限、不依赖脆弱的无线调试配对的前置物理约束下，使大模型 Agent 能够通过 Termux 运行的 AgentDock Mesh 节点：
1. **感知屏幕**：结构化获取当前屏幕上的所有可见可交互元素（提取文本、ID、类型、位置坐标，并赋予单调递增的序号列表 `[1], [2], ...`）；
2. **精准交互**：支持基于序号（“点击第 X 个元素”）、文本匹配、控件 ID 或物理坐标触发点击；
3. **文本输入**：支持在当前页面指定输入框或当前焦点输入框中输入文本并支持清空重写；
4. **手势与按键**：支持页面滚动（上滑/下滑/翻页）以及系统级物理导航（Back 返回键、Home 键）；
5. **极简协同**：与 `mobile-apps` 形成“宏观直达页面 + 微观感知操作”的完整自动化交互闭环。

---

## 2. Scope
- **免 ADB 双向无障碍桥接架构 (`agentdock-a11y`)**：
  采用轻量 Android AccessibilityService 极简桥接 APK，在手机端随系统自启，通过本地环回 TCP (`127.0.0.1:19832`) 提供高性能 RESTful HTTP 服务，实现 Termux 沙箱与系统无障碍层的低延迟双向通信。
- **页面感知与降噪提取引擎 (`UIDumpEngine`)**：
  遍历 `AccessibilityNodeInfo` 树，执行可见性判定、视口裁剪、无意义容器折叠与去重、文本与控件属性提取；按自上而下、自左向右（Reading Order）进行几何分行排序，编排稳定的 1-based 序号。
- **交互执行器 (`UIActionExecutor`)**：
  支持序号点击（优先 `ACTION_CLICK`，平滑回退至坐标手势 `dispatchGesture`）、文本模糊/精确匹配点击、坐标点击、文本输入（`ACTION_SET_TEXT`）及手势滚动与全局物理键。
- **CLI 命令行工具 (`mobile-ui`)**：
  打包进 `@kafca/agentdock`，提供友好易读的终端输出格式（紧凑文本表格与 `--json` 原始数据），支持 `status`, `dump`, `click`, `input`, `scroll`, `back`, `home`, `wait` 等常用子命令。
- **远程透明代理与环境自适应注入**：
  在 `remote-mesh-backend.ts` 中向影子 `.bin` 注入 `mobile-ui` wrapper；在 `device-environment.ts` 中当 `platform === 'android'` 时向系统 Prompt 和 `CLAUDE.md` 注入在页面内微观交互的使用规范和协同工作流。
- **自动化测试与协议 Mock**：
  为协议通信、UI 格式化、CLI 参数解析、错误诊断和环境注入提供完备的单元测试，复杂度严格控制在 ESLint $\le 15$。

---

## 3. Non-goals
- **非目标 1：不依赖 PC ADB、USB 线缆或无线调试配对**。日常外出携带时无线调试易随网络切换或手机重启失效，本方案绝对不以此为运行前提。
- **非目标 2：不进行耗费算力的本地视觉多模态大模型截屏推理**。优先直接获取 Android 原生可访问性树（Accessibility Tree），Token 占用极小（几十~几百 Token），毫秒级响应，零端侧额外算力开销。
- **非目标 3：不替代第一阶段的 DeepLink 宏观跳转**。进入 App 目标页面依然优先使用 `mobile-apps open ...`，到达页面后才使用 `mobile-ui` 进行微观交互。

---

## 4. Behavior & Interface Specification

### 4.1 CLI 命令行语法 (`mobile-ui`)

```bash
# 1. 检查无障碍桥接服务状态与当前前台应用
mobile-ui status

# 2. 感知与打印当前屏幕可见元素（默认带 1-based 序号，文本紧凑排版）
mobile-ui dump [--interactive-only] [--json]

# 3. 元素点击交互
mobile-ui click 3                          # 点击第 3 个元素（推荐，对 LLM 最稳定）
mobile-ui click "综合排序"                  # 点击文本为“综合排序”的元素
mobile-ui click --id="search_button"       # 点击指定 viewId 的元素
mobile-ui click 720,640                    # 点击绝对物理坐标 (x,y)

# 4. 文本输入
mobile-ui input "特浓咖啡豆" --target 2    # 向第 2 个输入框输入文本
mobile-ui input "特浓咖啡豆"                # 向当前处于焦点的输入框输入文本
mobile-ui input "新内容" --no-clear        # 追加输入，不预先清空原有内容

# 5. 页面手势与物理导航
mobile-ui scroll down                      # 向上滑动半屏（浏览下一屏内容）
mobile-ui scroll up                        # 向下滑动半屏（返回上一屏内容）
mobile-ui back                             # 触发系统返回键（Back）
mobile-ui home                             # 触发系统桌面键（Home）

# 6. 同步等待（页面加载保护）
mobile-ui wait "商品列表" --timeout 5      # 最多等待 5 秒直到页面出现目标文字
```

### 4.2 终端紧凑输出规范 (`mobile-ui dump`)
为避免占用大量 Context Window Token，默认输出为经过几何排序的简洁文本列表：
```text
=== 当前屏幕: com.taobao.taobao / 淘宝 (1440x3200) ===
[1] [Button] "搜索" (id: search_button)
[2] [EditText] "搜索发现: 挂耳咖啡" (id: search_edit_text)
[3] [TextView] "综合排序" (selected)
[4] [TextView] "销量"
[5] [Card] "隅田川挂耳意式黑咖啡 24袋装 ¥49.9" (center: 720, 680)
[6] [Card] "星巴克派克市场烘焙咖啡豆 250g ¥88.0" (center: 720, 1120)
[7] [Button] "加入购物车" (center: 1200, 720)
```

### 4.3 本地无障碍服务 HTTP REST 协议契约 (`127.0.0.1:19832`)

1. **`GET /api/status`**
   - 响应：`{ ok: boolean, version: string, serviceEnabled: boolean, currentPackage: string, currentActivity: string, screenWidth: number, screenHeight: number }`
2. **`GET /api/dump?interactiveOnly=true`**
   - 响应：`{ ok: boolean, package: string, activity: string, count: number, elements: UIElement[] }`
   - `UIElement` 结构：
     ```ts
     export interface UIElement {
       index: number;
       text: string;
       desc?: string;
       id?: string;
       className: string;
       bounds: [number, number, number, number]; // [left, top, right, bottom]
       center: [number, number];                 // [cx, cy]
       clickable: boolean;
       editable: boolean;
       scrollable: boolean;
       selected?: boolean;
     }
     ```
3. **`POST /api/click`**
   - 请求：`{ index?: number, text?: string, id?: string, point?: [number, number] }`
   - 响应：`{ ok: boolean, target?: Partial<UIElement>, method: 'action_click' | 'gesture_tap' }`
4. **`POST /api/input`**
   - 请求：`{ text: string, index?: number, clear?: boolean }`
   - 响应：`{ ok: boolean, inputText: string, targetIndex?: number }`
5. **`POST /api/scroll`**
   - 请求：`{ direction: 'down' | 'up' | 'left' | 'right', distance?: number, durationMs?: number }`
   - 响应：`{ ok: boolean, direction: string }`
6. **`POST /api/action`**
   - 请求：`{ action: 'back' | 'home' | 'recents' }`
   - 响应：`{ ok: boolean, action: string }`

---

## 5. Constraints & Compatibility
1. **免 ADB & 免 Root 约束**：绝对不依赖任何 `adb shell` 或 `su` 二进制。所有操作仅通过系统无障碍授权与本地 `127.0.0.1` TCP 通信完成。
2. **通信超时与自愈约束**：HTTP 请求设置 3000ms 强制超时，在服务未就绪时输出友好中文引导，禁止命令发生死锁挂起。
3. **跨平台隔离约束**：非 Android 宿主环境（Darwin、Linux、Windows）不加载 Android 页面交互说明，不污染系统环境。
4. **代码质量约束**：所有新增函数复杂度严格控制在 ESLint `<= 15`，零循环引用，覆盖率契约达标。

---

## 6. Acceptance Criteria
- **AC-1**：定义完整的 `mobile-ui` 模块与协议数据契约（`types.ts`, `client.ts`, `formatter.ts`, `cli.ts`）。
- **AC-2**：CLI 支持 `status`, `dump`, `click`, `input`, `scroll`, `back`, `home`, `wait`，并支持 `--json` 输出与紧凑文本视图。
- **AC-3**：当节点为 Android 时，云端 Agent 在 `CLAUDE.md` 与 System Prompt 中自动获得 `mobile-ui` 的使用指引与最佳实践示例；透明 Shell 代理能正常路由 `mobile-ui`。
- **AC-4**：本地 Mock HTTP 单元测试 100% 覆盖状态查询、UI 树解析、几何排序、多策略点击、文本输入、滑动与异常降级分支。
- **AC-5**：编写完整的 Android 桥接 APK 规范与真机快速启动指南，实现开箱即用。
