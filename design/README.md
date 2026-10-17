# design/ — AgentDock UI 原型（唯一设计源）

AgentDock 完整可点击静态原型，以 `index.html` 为唯一入口，通过 hash 路由切换真实应用中的主要模块。包含概览、聊天、管家、工作区、AI 服务商、成本与预算、知识库、技能中心、自动化、设备互联和系统；列表、菜单、表单、页面切换和常用操作使用内联假数据演示。

> **硬规则：任何 UI 改动必须先改/先出本目录下的可点击原型，经用户确认后，才允许动实现代码。**

## 文件清单

| 页面 | 文件 | 状态 | 对应实现 |
|---|---|---|---|
| AgentDock 全局可点击原型 | `index.html` | 已确认并实现（2026-10-17；`src/pages/Butler/`） | 全局导航与主要模块保持完整；管家配置支持 LAC 内部委派、工作区 Agent 绑定、长任务跟踪策略和任务进展查看 |

状态词汇：`待确认`（等用户看）→ `已确认`（可开发）→ `已确认并实现`（附日期，原型保留为设计事实源）。

- 所有样式、脚本和假数据都内联在 `index.html`，不依赖构建流程或外部资源。
- 管家配置页面的演示截图（假数据）：`screenshots/butler-config-prototype.1440x1800.light.png`（2026-10-17 按已确认原型重新生成）。
- 校验清单一致性：运行 prototype-first skill 中的 `scripts/check_design.py design/`。

## 本地预览

双击 `index.html` 即可；也可在仓库根目录运行：`cd design && python -m http.server 8765`，然后打开 `http://127.0.0.1:8765/`。

## 口径基准

应用导航以 `src/app/ui-contributions.tsx` 与 `src/components/Layout/sidebar-nav-model.ts` 为准；各视图交互以 `src/pages/` 下对应实现为准。管家 Bot 的身份、受管 Bot、LAC 内部工作区委派与旧共享群聊路由，以 [管家 LAC 委派变更记录](../docs/architecture/changes/2026-10-17-butler-lac-orchestration.md) 为准。原型数据为假数据，不连接 Local AI Core。
