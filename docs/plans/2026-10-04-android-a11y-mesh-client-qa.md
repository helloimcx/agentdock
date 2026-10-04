# Android A11y Mesh Client Real-Device QA — 2026-10-04

| Acceptance Area | Result | Evidence |
|---|---|---|
| **Zero-Listening-Port Outbound Security** | PASS | `adb shell netstat / ss` 确认手机端 19832 端口彻底关闭，零本地监听 TCP 端口；纯出站 WebSocket 连接至 Core `/api/local/v1/mesh/connect` |
| **Cleartext & TLS Connectivity** | PASS | AndroidManifest 启用 `usesCleartextTraffic="true"`；支持局域网 HTTP 及生产环境 HTTPS/WSS 主机名强校验 |
| **Pairing & Enrollment UI** | PASS | `MainActivity` 输入 Server 与 PairingToken，一键请求 `/enroll` 获取 `nodeId` 与 `token` 并持久化至 `MeshPreferences`；支持 Intent 传参自动配对 |
| **WebSocket Mesh Keepalive & Reconnect** | PASS | 10s 心跳、45s 超时重连与指数退避；前台服务与 Partial WakeLock 保活 |
| **mobile-ui Screen Perception & Control** | PASS | 真机 `mobile-ui dump` 返回带单调递增索引的真实视觉层级树（检测到 `com.agentdock.a11y` 与系统界面） |
| **mobile-ui Screen Lease Keep-Awake** | PASS | `mobile-ui screen status` 成功返回 `cliProtocol: 2` 与 `screenProtocol: 2`，对齐云端 `ScreenLease` 契约 |
| **mobile-apps Macro Intent Navigation** | PASS | `mobile-apps open settings` 成功调起 Android 原生系统设置主页（ExitCode: 0, Output: `Opened system settings: open`） |
| **termux-battery-status Compatibility** | PASS | 返回 100% 格式对齐的电池 JSON：`{"percentage":100,"status":"FULL","plugged":"AC","health":"GOOD","temperature":31.6}` |
| **termux-toast & termux-vibrate** | PASS | 成功触发硬件振动与桌面浮动 Toast（ExitCode: 0） |
| **termux-tts-speak** | PASS | 成功调用 Android 原生 TTS 引擎发音（ExitCode: 0） |
| **Linux Shell Fallback** | PASS | `uname -a` 成功调用系统 `/system/bin/sh`（输出：`Linux localhost 5.15.194-android13-... Toybox`） |
| **Preservation of npm Client** | PASS | `agentdock-node` 跨平台客户端无回归，全部既有合约与集成测试 100% 通过 |

## Device & Environment
- **Device**: Xiaomi 13 (nuwa, 2210132C)
- **OS**: Android 16 (HyperOS)
- **APK Size**: 49 KB (zero heavy dependencies, pure native Java)
- **Transport**: Outbound WebSocket via ADB reverse / LAN
