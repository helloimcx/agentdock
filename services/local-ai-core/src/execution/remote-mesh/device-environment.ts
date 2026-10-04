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

export function buildDeviceClaudeMd(node?: MeshNodeMetadata): string {
  const label = String(node?.label || '').trim() || 'Remote-Device';
  const platform = String(node?.platform || '').trim() || 'unknown';
  const hint = resolvePlatformHint(platform);

  return [
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
    '',
  ].join('\n');
}

export function buildDeviceSystemPrompt(node?: MeshNodeMetadata): string {
  const label = String(node?.label || '').trim() || 'Remote-Device';
  const platform = String(node?.platform || '').trim() || 'unknown';
  const hint = resolvePlatformHint(platform);

  return [
    `[Remote Device Environment]`,
    `This workspace is connected directly to a remote ${platform} device named "${label}" via AgentDock Mesh.`,
    `All terminal commands execute directly on this target device through your native Bash tool (${hint}).`,
    `Do not search for ADB or external connection bridges. To inspect or edit files, use standard shell commands (cat, grep, sed, echo).`,
  ].join('\n');
}
