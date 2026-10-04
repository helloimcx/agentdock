import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentLaunchConfig } from '@cc/plugin-sdk';
import type { AgentExecutionBackend, AgentExecutionBackendInput } from '../agent-execution-types.js';
import { resolveAgentRuntimeDefinition } from '../../agents/registry.js';
import { buildDeviceClaudeMd, buildDeviceSystemPrompt, type MeshNodeMetadata } from './device-environment.js';

export function isRemoteMeshProject(project: AgentExecutionBackendInput['project']): boolean {
  const deviceId = String(project.device_id || project.agent?.options?.device_id || '').trim();
  return deviceId.startsWith('node:');
}

export function resolveMeshNodeId(project: AgentExecutionBackendInput['project']): string {
  const deviceId = String(project.device_id || project.agent?.options?.device_id || '').trim();
  return deviceId.startsWith('node:') ? deviceId : '';
}

export function remoteMeshShellScriptPath(): string {
  return resolve(__dirname, 'agentdock-mesh-shell.js');
}

function remoteMeshFileMcpServerPath(): string {
  return resolve(__dirname, 'remote-mesh-mcp-server.js');
}

function remoteMeshPiExtensionPath(): string {
  return resolve(__dirname, 'pi-mesh-extension.js');
}

export function lookupMeshNode(baseDir: string, nodeId: string): MeshNodeMetadata | null {
  if (!baseDir || !nodeId) return null;
  try {
    const dbPath = resolve(baseDir, 'local-core.db');
    if (!existsSync(dbPath)) return null;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const stmt = db.prepare('SELECT data FROM mesh_nodes WHERE id = ?');
      const row = stmt.get(nodeId) as { data?: string } | undefined;
      if (row?.data) {
        return JSON.parse(row.data);
      }
    } finally {
      db.close();
    }
  } catch {
    // Ignore database lookup error and fall back gracefully
  }
  return null;
}

function provisionShadowDirectory(
  shadowDir: string,
  node: MeshNodeMetadata | { label?: string; platform?: string },
  filesystemPolicy: 'claudecode' | 'opencode' | 'pi' = 'claudecode',
): string {
  const claudeMdContent = buildDeviceClaudeMd(node, filesystemPolicy);
  try {
    writeFileSync(resolve(shadowDir, 'CLAUDE.md'), claudeMdContent, 'utf8');
    writeFileSync(resolve(shadowDir, 'AGENTS.md'), claudeMdContent, 'utf8');
    writeFileSync(resolve(shadowDir, 'GEMINI.md'), claudeMdContent, 'utf8');
  } catch {
    // Best-effort provisioning
  }

  const binDir = resolve(shadowDir, '.bin');
  mkdirSync(binDir, { recursive: true });
  const isWindowsHost = process.platform === 'win32';
  const shellWrapperPath = resolve(binDir, isWindowsHost ? 'mesh-bash.cmd' : 'mesh-bash');
  const shellScriptPath = remoteMeshShellScriptPath();

  const shWrapperContent = [
    '#!/bin/sh',
    `exec "${process.execPath}" "${shellScriptPath}" "$@"`,
    '',
  ].join('\n');

  const cmdWrapperContent = [
    '@echo off',
    `"${process.execPath}" "${shellScriptPath}" %*`,
    '',
  ].join('\r\n');

  try {
    for (const name of ['mesh-bash', 'mesh-shell', 'bash', 'sh']) {
      const filePath = resolve(binDir, name);
      writeFileSync(filePath, shWrapperContent, { mode: 0o755, encoding: 'utf8' });
      chmodSync(filePath, 0o755);
    }
    for (const name of ['mesh-bash.cmd', 'mesh-shell.cmd', 'bash.cmd', 'sh.cmd']) {
      writeFileSync(resolve(binDir, name), cmdWrapperContent, { encoding: 'utf8' });
    }
  } catch {
    // Best-effort permission setting
  }

  return shellWrapperPath;
}

export class RemoteMeshExecutionBackend implements AgentExecutionBackend {
  readonly mode = 'mesh' as const;

  prepareLaunch(input: AgentExecutionBackendInput): AgentLaunchConfig {
    const filesystemPolicy = requireMeshFilesystemPolicy(input.launchConfig.agentType);
    const nodeId = resolveMeshNodeId(input.project);
    const rawWorkspaceId = input.launchConfig.workspaceId || input.project.name || 'workspace';
    const safeWorkspaceId = rawWorkspaceId.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^\.+/, '') || 'workspace';
    const shadowDir = resolve(input.configState.baseDir, 'remote-shadow', safeWorkspaceId);
    mkdirSync(shadowDir, { recursive: true });
    const node = resolveMeshNodeMetadata(input.configState.baseDir, nodeId);
    const shellWrapperPath = provisionShadowDirectory(shadowDir, node, filesystemPolicy);
    const meshLaunchConfig = applyRuntimeMeshPolicy(
      input.launchConfig,
      filesystemPolicy,
      shadowDir,
      shellWrapperPath,
    );
    const binDir = resolve(shadowDir, '.bin');

    const localCoreUrl = String(process.env.AGENTDOCK_LOCAL_CORE_URL || 'http://127.0.0.1:9831').trim();
    const adminToken = String(process.env.AGENTDOCK_MESH_ADMIN_TOKEN || '').trim();

    // The old server exposed a duplicate shell. Keep only the Mesh file MCP
    // tools; terminal execution continues through the configured shell proxy.
    const mcpServers = buildMeshMcpServers(meshLaunchConfig, filesystemPolicy, nodeId, localCoreUrl, adminToken);
    const systemPromptAppend = buildDeviceSystemPrompt(node);

    return {
      ...meshLaunchConfig,
      workDir: shadowDir,
      mcpServers,
      env: buildMeshLaunchEnvironment(meshLaunchConfig, {
        shellWrapperPath,
        binDir,
        nodeId,
        node,
        localCoreUrl,
        adminToken,
      }),
      execution: {
        mode: 'mesh',
        transport: 'remote-mesh-shell',
        nodeId,
        node,
        systemPromptAppend,
      },
    };
  }
}

function requireMeshFilesystemPolicy(agentTypeInput: string): 'claudecode' | 'opencode' | 'pi' {
  const agentType = String(agentTypeInput || '').trim().toLowerCase();
  const runtime = resolveAgentRuntimeDefinition(agentType);
  if (!runtime) throw new Error(`Mesh execution is not enabled for unknown agent runtime "${agentType || '(empty)'}".`);
  const filesystemPolicy = runtime.mesh.filesystem;
  if (filesystemPolicy === 'unsupported') {
    throw new Error(`Mesh execution is not enabled for ${runtime.displayName}: ${runtime.mesh.unsupportedReason || 'remote workspace file operations are not enforced for this runtime.'}`);
  }
  return filesystemPolicy;
}

function resolveMeshNodeMetadata(baseDir: string, nodeId: string): MeshNodeMetadata {
  return lookupMeshNode(baseDir, nodeId) || { label: nodeId, platform: 'unknown' };
}

function buildMeshMcpServers(
  launchConfig: AgentLaunchConfig,
  filesystemPolicy: 'claudecode' | 'opencode' | 'pi' | 'unsupported',
  nodeId: string,
  localCoreUrl: string,
  adminToken: string,
) {
  const servers = (launchConfig.mcpServers || [])
    .filter((server) => !['agentdock-remote-mesh', 'agentdock-mesh-files'].includes(server.name));
  if (filesystemPolicy === 'pi') return servers;
  servers.push({
    name: 'agentdock-mesh-files',
    type: 'stdio',
    command: process.execPath,
    args: [remoteMeshFileMcpServerPath()],
    env: {
      AGENTDOCK_MESH_NODE_ID: nodeId,
      AGENTDOCK_LOCAL_CORE_URL: localCoreUrl,
      AGENTDOCK_MESH_ADMIN_TOKEN: adminToken,
    },
    enabled: true,
  });
  return servers;
}

function buildMeshLaunchEnvironment(
  launchConfig: AgentLaunchConfig,
  options: {
    shellWrapperPath: string;
    binDir: string;
    nodeId: string;
    node: MeshNodeMetadata;
    localCoreUrl: string;
    adminToken: string;
  },
) {
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const existingPath = launchConfig.env?.PATH || process.env.PATH || '';
  return {
    ...launchConfig.env,
    SHELL: options.shellWrapperPath,
    CLAUDE_CODE_SHELL: options.shellWrapperPath,
    PATH: `${options.binDir}${delimiter}${existingPath}`,
    AGENTDOCK_MESH_NODE_ID: options.nodeId,
    AGENTDOCK_LOCAL_CORE_URL: options.localCoreUrl,
    AGENTDOCK_MESH_ADMIN_TOKEN: options.adminToken,
    AGENTDOCK_MESH_NODE_PLATFORM: String(options.node.platform || '').trim(),
    AGENTDOCK_MESH_NODE_LABEL: String(options.node.label || '').trim(),
  };
}

function applyRuntimeMeshPolicy(
  launchConfig: AgentLaunchConfig,
  filesystemPolicy: 'claudecode' | 'opencode' | 'pi' | 'unsupported',
  shadowDir: string,
  shellWrapperPath: string,
): AgentLaunchConfig {
  if (filesystemPolicy === 'pi') return applyPiMeshPolicy(launchConfig, shadowDir);
  if (filesystemPolicy !== 'opencode') return launchConfig;
  const env = { ...launchConfig.env };
  let config: Record<string, unknown> = { $schema: 'https://opencode.ai/config.json' };
  try {
    const parsed = JSON.parse(env.OPENCODE_CONFIG_CONTENT || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed;
  } catch {
    throw new Error('Mesh execution cannot secure OpenCode because OPENCODE_CONFIG_CONTENT is invalid JSON.');
  }
  config.instructions = [resolve(shadowDir, 'AGENTS.md')];
  config.permission = {
    ...((config.permission && typeof config.permission === 'object') ? config.permission as Record<string, unknown> : {}),
    read: 'deny',
    edit: 'deny',
    glob: 'deny',
    grep: 'deny',
    list: 'deny',
  };
  config.shell = shellWrapperPath;
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
  return { ...launchConfig, env };
}

function applyPiMeshPolicy(launchConfig: AgentLaunchConfig, shadowDir: string): AgentLaunchConfig {
  const env = { ...launchConfig.env };
  const piBinary = String(env.PI_ACP_PI_COMMAND || '').trim();
  if (!piBinary) throw new Error('Mesh execution cannot secure Pi because PI_ACP_PI_COMMAND is missing.');
  const extensionPath = remoteMeshPiExtensionPath();
  const wrapperPath = resolve(shadowDir, '.bin', process.platform === 'win32' ? 'pi-mesh.cmd' : 'pi-mesh');
  const toolList = 'mesh_read_file,mesh_write_file,mesh_edit_file,mesh_list_directory,mesh_glob_files,mesh_execute_command';
  const script = process.platform === 'win32'
    ? [
        '@echo off',
        `"${piBinary}" --tools ${toolList} --extension "${extensionPath}" %*`,
        '',
      ].join('\r\n')
    : [
        '#!/bin/sh',
        `exec "${piBinary}" --tools ${toolList} --extension "${extensionPath}" "$@"`,
        '',
      ].join('\n');
  writeFileSync(wrapperPath, script, { encoding: 'utf8', mode: 0o755 });
  if (process.platform !== 'win32') chmodSync(wrapperPath, 0o755);
  env.PI_ACP_PI_COMMAND = wrapperPath;
  return { ...launchConfig, env };
}
