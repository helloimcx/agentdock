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

export function buildDeviceClaudeMd(
  node?: MeshNodeMetadata,
  filesystemPolicy: 'claudecode' | 'opencode' | 'pi' = 'claudecode',
): string {
  const label = String(node?.label || '').trim() || 'Remote-Device';
  const platform = String(node?.platform || '').trim() || 'unknown';
  const hint = resolvePlatformHint(platform);
  const fileTools = filesystemPolicy === 'pi'
    ? 'Use mesh_read_file, mesh_write_file, mesh_edit_file, mesh_list_directory, and mesh_glob_files for device files; use mesh_execute_command for a device command.'
    : 'Use the agentdock-mesh-files MCP tools read_file, write_file, edit_file, list_directory, and glob_files for device files.';

  return [
    '# AgentDock Mesh Workspace',
    '',
    '## Where the agent runs',
    'The agent process, its runtime configuration, credentials, and private persistent memory run on the AgentDock host.',
    `The workspace execution target is the paired Mesh node "${label}" (${platform}). ${hint}`,
    '',
    '## Remote operation rules',
    'Use only tools explicitly described as Mesh-routed for device workspace operations.',
    fileTools,
    'The Mesh terminal proxy runs commands on the paired node with its approved root as the starting working directory. Relative paths begin there, but shell execution is not confined to that directory: when shell is authorized by both Core and the node, commands run with the paired device user’s normal OS permissions and may access other device paths or network resources allowed to that user.',
    'The approved root confines the Mesh file tools; it is not an OS sandbox for shell commands. Shell is usable only when both Core and the paired node authorize it. If shell.exec is denied, stop and report the denial rather than trying a host command.',
    'ACP filesystem requests and the AgentDock Mesh file tools are routed to the paired node when those tools are exposed in this session.',
    'Other runtime-local file tools operate on the AgentDock host. Do not use them to inspect or change the device workspace.',
    'If the device is offline, a tool is unavailable, or a path is rejected, report the error. Never retry against the host workspace as a fallback.',
    '',
    '## Memory and runtime state',
    'Agent private memory, runtime configuration, and credentials remain on the AgentDock host. Device files, logs, and live process state belong to the paired node.',
    'Treat device process status and other changing observations as time-sensitive; check them on the device before reporting them as current.',
    '',
  ].join('\n');
}

export function buildDeviceSystemPrompt(node?: MeshNodeMetadata): string {
  const label = String(node?.label || '').trim() || 'Remote-Device';
  const platform = String(node?.platform || '').trim() || 'unknown';
  const hint = resolvePlatformHint(platform);

  return [
    `[AgentDock Mesh Execution Boundary]`,
    `The ACP agent process, runtime configuration, credentials, and private persistent memory run on the AgentDock host. The selected workspace target is the paired Mesh node "${label}" (${platform}); ${hint}`,
    `Use only tools explicitly described as Mesh-routed for device workspace operations. The configured Mesh terminal proxy starts on the paired node in its approved root; relative paths begin there, but shell is not confined to that directory. When authorized by both Core and the node, shell runs with the device user's normal OS permissions and may access other paths or network resources allowed to that user. The approved root confines Mesh file tools only. ACP filesystem requests and AgentDock Mesh file tools are remote only when exposed for this session.`,
    `Any runtime-local file tool still accesses the AgentDock host. Do not use it for device workspace files. If a Mesh operation is unavailable, rejected, or the node is offline, report that error and do not fall back to host files.`,
    `Agent private memory, runtime configuration, and credentials remain host-owned. Device files and live process state belong to the node; verify changing device state on the node before reporting it as current.`,
  ].join('\n');
}
