export interface MeshNodeMetadata {
  label?: string;
  platform?: string;
}

export function resolvePlatformHint(platform: string): string {
  const normalized = String(platform || '').trim().toLowerCase();
  switch (normalized) {
    case 'android':
      return 'This is an Android / Termux environment. You can use standard Linux shell utilities and Android-specific tools (such as termux-*, df, pm, etc.).';
    case 'darwin':
    case 'macos':
      return 'This is a macOS (Darwin) environment. Use standard macOS / zsh shell tools.';
    case 'win32':
    case 'windows':
      return 'This is a Windows environment. Use PowerShell or standard Windows CLI commands.';
    case 'linux':
      return 'This is a standard Linux POSIX environment. Use standard Linux shell commands and package managers.';
    default:
      return normalized ? `This is a ${normalized} system environment.` : 'This is a standard POSIX environment.';
  }
}

export function buildAndroidMobileInstructions(): string {
  return [
    '',
    '## Android Mobile App & In-Page UI Automation',
    'This device has two built-in tools for mobile automation (no ADB / no root required):',
    '',
    '### 1. Macro Navigation (`mobile-apps`)',
    'Launch and jump directly to target app pages via Intent / DeepLink:',
    '- `mobile-apps list`: view all supported apps and shortcuts.',
    '- `mobile-apps open alipay pay`: open Alipay payment code (付款码).',
    '- `mobile-apps open alipay scan`: open Alipay scanner (扫一扫).',
    '- `mobile-apps open alipay bus`: open subway/bus ride code (乘车码).',
    '- `mobile-apps open wechat scan`: open WeChat scanner (微信扫一扫).',
    '- `mobile-apps open amap navigate --destination="地点"`: start navigation on Amap (高德地图).',
    '- `mobile-apps open meituan search --keyword="美食"`: search food/takeout on Meituan (美团).',
    '- `mobile-apps open taobao search --keyword="商品"`: search products on Taobao (淘宝).',
    '- `mobile-apps open system settings`: open Android system settings.',
    '- `mobile-apps open system wifi`: open WLAN / WiFi settings.',
    '- `mobile-apps intent "<uri>"`: open custom deep-link URI.',
    '',
    '### 2. In-Page UI Micro-Interaction (`mobile-ui`)',
    'Once on an app page, perceive elements and interact with the UI:',
    '- `mobile-ui screen status`: inspect screen-on, keyguard and keep-awake lease state.',
    '- `mobile-ui screen keep-awake [--duration=120]`: hold screen on before navigation; duration 1..600 seconds.',
    '- `mobile-ui screen release`: remove screen hold in final cleanup on success, cancellation or failure.',
    '- UI operations automatically renew a 120-second idle lease. Before a long pause, renew explicitly; pauses beyond the lease can allow sleep.',
    '- If the phone is locked or off, stop and ask the user to unlock it; never enter or request lock-screen credentials.',
    '- Manual screen-off ends the hold. Legacy bridges warn when keep-awake is unavailable; update the APK to enable it.',
    '- Cleanup is best effort; idle expiry releases abandoned holds. One device has one shared screen hold: avoid concurrent UI automation.',
    '- `mobile-ui status`: inspect active package, activity, and bridge connection.',
    '- `mobile-ui dump`: inspect current screen elements with 1-based indices; filtered dumps may have gaps, so use the exact displayed index.',
    '- `mobile-ui click <index>`: click element by its index number (e.g. `mobile-ui click 1`).',
    '- `mobile-ui click "<text>"`: click element matching text.',
    '- `mobile-ui input "<text>" [--target <index>]`: type text into input box.',
    '- `mobile-ui scroll [down|up]`: scroll up/down half screen.',
    '- `mobile-ui back`: press Android system Back button.',
    '- `mobile-ui wait "<text>"`: wait until target element appears on screen.',
    '',
    'Workflow Pattern: Prefer `mobile-apps open ...` to jump to page -> `sleep 2` -> `mobile-ui dump` -> `mobile-ui click <index>`.',
    'To update the mobile node client in background, run `agentdock-node-update`.',
  ].join('\n');
}

export function buildDeviceClaudeMd(node?: MeshNodeMetadata): string {
  const label = String(node?.label || '').trim() || 'Remote-Device';
  const platform = String(node?.platform || '').trim() || 'unknown';
  const hint = resolvePlatformHint(platform);
  const isAndroid = platform.toLowerCase() === 'android';

  const sections = [
    '# Remote Device Workspace',
    '',
    `You are operating directly on a remote device via AgentDock Mesh:`,
    `- Device Name: ${label}`,
    `- Platform: ${platform}`,
    `- Description: ${hint}`,
    '',
    'All terminal commands run directly on this device via your native Bash tool.',
    'There is no need for ADB, SSH setup, or external bridges — the terminal IS the remote machine.',
    'To read or modify files on the device, use standard shell utilities (cat, grep, sed, echo, etc.).',
  ];

  if (isAndroid) {
    sections.push(buildAndroidMobileInstructions());
  }

  sections.push('');
  return sections.join('\n');
}

export function buildDeviceSystemPrompt(node?: MeshNodeMetadata): string {
  const label = String(node?.label || '').trim() || 'Remote-Device';
  const platform = String(node?.platform || '').trim() || 'unknown';
  const hint = resolvePlatformHint(platform);
  const isAndroid = platform.toLowerCase() === 'android';
  const mobileNotice = isAndroid
    ? ' Built-in tools `mobile-apps` (jump to apps/pages) and `mobile-ui` (dump screen elements, click by index [1..N], input text, scroll, back) are available. To update client, run `agentdock-node-update`.'
    : '';

  return [
    `[Remote Device Environment]`,
    `This workspace is connected directly to a remote ${platform} device named "${label}" via AgentDock Mesh.`,
    `All terminal commands execute directly on this target device through your native Bash tool (${hint}).${mobileNotice}`,
    `Do not search for ADB or external connection bridges. To inspect or edit files, use standard shell commands (cat, grep, sed, echo).`,
  ].join('\n');
}
