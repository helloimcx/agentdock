# design/ — AgentDock UI 原型（唯一设计源）

AgentDock 完整可点击静态原型，以 `index.html` 为唯一入口，通过 hash 路由切换真实应用中的主要模块。包含概览、聊天、管家、工作区、AI 服务商、成本与预算、知识库、技能中心、自动化、设备互联和系统；列表、菜单、表单、页面切换和常用操作使用内联假数据演示。

> **硬规则：任何 UI 改动必须先改/先出本目录下的可点击原型，经用户确认后，才允许动实现代码。**

## 文件清单

| 页面 | 文件 | 状态 | 对应实现 |
|---|---|---|---|
| AgentDock 全局可点击原型 | `index.html` | 已确认并实现（2026-11-08；`apps/web/src/pages/Automation/AutomationDetailModal.tsx`） | 全局导航与主要模块保持完整；自动化详情逐次呈现执行、投递和已知轨迹 |

状态词汇：`待确认`（等用户看）→ `已确认`（可开发）→ `已确认并实现`（附日期，原型保留为设计事实源）。

- 所有样式、脚本和假数据都内联在 `index.html`，不依赖构建流程或外部资源。
- 管家配置页面的演示截图（假数据）：`screenshots/butler-config-prototype.1440x1800.light.png`（2026-10-17 按已确认原型重新生成）。
- 校验清单一致性：运行 prototype-first skill 中的 `scripts/check_design.py design/`。

## 本地预览

双击 `index.html` 即可；也可在仓库根目录运行：`cd design && python -m http.server 8765`，然后打开 `http://127.0.0.1:8765/`。

## 口径基准

应用导航以 `src/app/ui-contributions.tsx` 与 `src/components/Layout/sidebar-nav-model.ts` 为准；各视图交互以 `src/pages/` 下对应实现为准。管家 Bot 的身份、受管 Bot、LAC 内部工作区委派与旧共享群聊路由，以 [管家 LAC 委派变更记录](../docs/architecture/changes/2026-10-17-butler-lac-orchestration.md) 为准。原型数据为假数据，不连接 Local AI Core。

## 自动化运行关联原型自审（2026-11-08）

打开 `index.html#/automations`，在“每日工作摘要”中点击“查看详情”；可分别查看两次独立运行的执行与投递结果，并模拟打开执行轨迹和返回详情。原型数据与轨迹为演示数据。

- 已在 Chrome 实际打开并查看[桌面截图（1440×900）](screenshots/automation-correlation-desktop.png)和[移动截图（390×844）](screenshots/automation-correlation-mobile.png)。标题、每次运行的执行状态与投递状态可区分；未发现横向溢出或关闭按钮遮挡。
- 已实际点击详情、打开轨迹、返回详情及 Escape 关闭。真实 API、访问失败、缺失关联和恢复操作未在静态原型中模拟。
- 适用尺寸、长内容与键盘可读性部分验证：已查看桌面及窄屏；文字放大、完整键盘焦点循环、对比度工具测量和屏幕阅读器尚未验证。
- 原型中的轨迹跳转为模拟；实现仅在关联证据存在时打开对应 ACP Run，否则提示轨迹不可用。原型已于 2026-11-08 确认并实现；上述自审不等于正式用户测试或无障碍认证。
