# Spec: 工作区本地与远程目录可视化选择（Directory Picker）

## 1. 目标（Goal）

为 AgentDock 前端创建与编辑 Workspace 流程增加可视化目录选择器（Directory Picker）：
1. **本机目录浏览与选定（Local Device）**：在选择“本机 (Local)”时，前端可通过 Local AI Core 后端安全遍历宿主机目录树，支持进入子目录、返回上层目录并选定目标工作区物理路径；
2. **远程目录浏览与选定（Mesh Node）**：在选择已配对的远程 Mesh 设备（`node:<uuid>`）时，前端可通过 Mesh 反向信道（`filesystem.list` 能力）动态读取远程客户端 `--root` 范围内的目录树，支持多级下钻并选定目标相对/绝对路径；
3. **一致的高效交互体验**：在新建 Workspace 弹窗与项目基本配置表单中，路径输入框旁提供直观的“浏览...”按钮，弹出统一的目录选择器模态框（支持面包屑导航、快速搜索过滤、一键选定）。

---

## 2. 范围（Scope）

1. **后端本地目录读取 API（`services/local-ai-core`）**：
   - 新增 `POST /api/local/v1/fs/directories` 路由；
   - 接受 `{ path?: string }`：若为空则默认打开用户主目录（`os.homedir()`）；
   - 过滤只读目录列表，防范非法文件类型与权限异常，返回当前路径、上级路径与子目录名列表。
2. **Core SDK 统一目录查询抽象（`packages/core-sdk`）**：
   - 封装 `listDirectories({ deviceId?: string, path?: string })` 方法；
   - 本地设备请求 `/api/local/v1/fs/directories`；
   - 远程 Mesh 设备通过 `/api/local/v1/mesh/execute` 发起 `filesystem.list` 请求并归一化输出结构。
3. **前端目录选择组件（`src/pages/Desktop/DirectoryPickerModal.tsx`）**：
   - 弹窗展示当前设备标签、当前路径、返回上级操作、目录列表及加载状态；
   - 点击子目录进入下级，底部“选择此目录”按钮将选中路径自动回填至表单。
4. **前端工作区表单集成（`src/pages/Desktop/`）**：
   - `workspace-components.tsx`（创建工作区弹窗）与 `workspace-sections.tsx`（项目详情基础设置）集成浏览按钮。

---

## 3. 非目标（Non-goals）

1. 不提供任意文件的创建、重命名、删除等完整文件管理器功能（仅用于工作区根目录选择）。
2. 不绕过远程 Mesh Client 的 `--root` 沙箱限制（远程设备必须且只能在 `--root` 授权根目录内浏览）。
3. 不依赖 Electron IPC（遵循零 IPC 契约，Web 模式与 Desktop 模式保持 100% 相同 HTTP/WSS 通信路径）。

---

## 4. 接口契约（Interface Contracts）

### 4.1 本地目录查询接口
- **请求**：`POST /api/local/v1/fs/directories`
- **请求体**：
  ```json
  { "path": "/Users/momo/code" }
  ```
- **成功响应**：
  ```json
  {
    "ok": true,
    "data": {
      "path": "/Users/momo/code",
      "parentPath": "/Users/momo",
      "directories": ["agentdock", "my-project", "demo"]
    }
  }
  ```

### 4.2 SDK 统一调用接口
```ts
export interface DirectoryListingResult {
  path: string;
  parentPath?: string | null;
  directories: string[];
}

export function listDirectories(target: {
  deviceId?: string;
  path?: string;
}): Promise<DirectoryListingResult>;
```

---

## 5. 验收标准（Acceptance Criteria）

- [ ] **AC-1**：在创建工作区弹窗中选择“本机 (Local)”并点击“浏览”，弹窗能正确加载并展示宿主机目录，双击/点击可进入子目录并返回上级，选定后自动将绝对路径填入“Host workspace path”。
- [ ] **AC-2**：选择已连接的 Mesh 设备并点击“浏览”，弹窗能通过 Mesh 反向信道正确加载远程机器的 `--root` 目录结构，选定后自动回填路径。
- [ ] **AC-3**：当目录不存在、无读取权限或远程设备离线时，选择器弹窗内友好展示错误提示，不发生界面崩溃或请求挂死。
- [ ] **AC-4**：所有静态门禁（`pnpm lint:gates`、`pnpm lint:arch`）与现有测试套件（`pnpm test`）100% 保持通过。
