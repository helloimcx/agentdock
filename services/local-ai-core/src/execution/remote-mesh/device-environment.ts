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

function buildAndroidMobileInstructions(): string {
  return [
    '',
    '## Android Mobile App Automation',
    'This device has the built-in shortcut tool `mobile-apps` to launch and control installed apps directly:',
    '- `mobile-apps list`: view all supported apps and shortcuts.',
    '- `mobile-apps open alipay pay`: open Alipay payment code (付款码).',
    '- `mobile-apps open alipay scan`: open Alipay scanner (扫一扫).',
    '- `mobile-apps open alipay ride`: open subway/bus ride code (乘车码).',
    '- `mobile-apps open wechat scan`: open WeChat scanner (微信扫一扫).',
    '- `mobile-apps open wechat pay`: open WeChat offline pay (微信收付款).',
    '- `mobile-apps open amap navigate --destination="地点"`: start navigation on Amap (高德地图).',
    '- `mobile-apps open meituan search --keyword="美食"`: search food/takeout on Meituan (美团).',
    '- `mobile-apps open taobao search --keyword="商品"`: search products on Taobao (淘宝).',
    '- `mobile-apps open system settings`: open Android system settings.',
    '- `mobile-apps open system wifi`: open WLAN / WiFi settings.',
    '- `mobile-apps intent "<uri>"`: open custom deep-link URI.',
    '- `agentdock-node-update`: safely update the AgentDock mobile client in background.',
    'When the user asks to open an app, show payment code, scan, or navigate, prefer `mobile-apps` over shell guessing.',
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
    ? ' Built-in shortcut tool `mobile-apps` is available to launch apps, payment codes, scanners, and navigation (e.g. `mobile-apps open alipay pay`). To update client, run `agentdock-node-update`.'
    : '';

  return [
    `[Remote Device Environment]`,
    `This workspace is connected directly to a remote ${platform} device named "${label}" via AgentDock Mesh.`,
    `All terminal commands execute directly on this target device through your native Bash tool (${hint}).${mobileNotice}`,
    `Do not search for ADB or external connection bridges. To inspect or edit files, use standard shell commands (cat, grep, sed, echo).`,
  ].join('\n');
}
