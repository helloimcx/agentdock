import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentLaunchConfig } from '@cc/plugin-sdk';
import type { AgentExecutionBackend, AgentExecutionBackendInput } from '../agent-execution-types.js';
import { buildDeviceClaudeMd, buildDeviceSystemPrompt, type MeshNodeMetadata } from './device-environment.js';

export function isRemoteMeshProject(project: AgentExecutionBackendInput['project']): boolean {
  const deviceId = String(project.device_id || project.agent?.options?.device_id || '').trim();
  return deviceId.startsWith('node:');
}

function resolveMeshNodeId(project: AgentExecutionBackendInput['project']): string {
  const deviceId = String(project.device_id || project.agent?.options?.device_id || '').trim();
  return deviceId.startsWith('node:') ? deviceId : '';
}

function remoteMeshShellScriptPath(): string {
  return resolve(__dirname, 'agentdock-mesh-shell.js');
}

function lookupMeshNode(baseDir: string, nodeId: string): MeshNodeMetadata | null {
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

function provisionToolWrappers(binDir: string, shellScriptPath: string, isWindowsHost: boolean): void {
  const tools = ['mobile-apps', 'mobile-ui', 'agentdock-node-update'];
  for (const tool of tools) {
    const shToolContent = [
      '#!/bin/sh',
      `CMD="${tool}"`,
      'for arg in "$@"; do',
      "  escaped=$(printf '%s\\n' \"$arg\" | sed \"s/'/'\\\\\\\\''/g\")",
      '  CMD="$CMD \'$escaped\'"',
      'done',
      `exec "${process.execPath}" "${shellScriptPath}" -c "$CMD"`,
      '',
    ].join('\n');
    const cmdToolContent = [
      '@echo off',
      `"${process.execPath}" "${shellScriptPath}" -c "${tool} %*"`,
      '',
    ].join('\r\n');
    try {
      const toolFile = resolve(binDir, tool);
      writeFileSync(toolFile, shToolContent, { mode: 0o755, encoding: 'utf8' });
      chmodSync(toolFile, 0o755);
      if (isWindowsHost) {
        writeFileSync(resolve(binDir, `${tool}.cmd`), cmdToolContent, { encoding: 'utf8' });
      }
    } catch {
      // Best-effort
    }
  }
}

function provisionShadowDirectory(shadowDir: string, node: MeshNodeMetadata | { label?: string; platform?: string }): string {
  const claudeMdContent = buildDeviceClaudeMd(node);
  try {
    writeFileSync(resolve(shadowDir, 'CLAUDE.md'), claudeMdContent, 'utf8');
    writeFileSync(resolve(shadowDir, 'AGENTS.md'), claudeMdContent, 'utf8');
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

  provisionToolWrappers(binDir, shellScriptPath, isWindowsHost);

  return shellWrapperPath;
}

export class RemoteMeshExecutionBackend implements AgentExecutionBackend {
  readonly mode = 'mesh' as const;

  prepareLaunch(input: AgentExecutionBackendInput): AgentLaunchConfig {
    const nodeId = resolveMeshNodeId(input.project);
    const rawWorkspaceId = input.launchConfig.workspaceId || input.project.name || 'workspace';
    const safeWorkspaceId = rawWorkspaceId.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^\.+/, '') || 'workspace';
    const shadowDir = resolve(input.configState.baseDir, 'remote-shadow', safeWorkspaceId);
    mkdirSync(shadowDir, { recursive: true });

    const node = lookupMeshNode(input.configState.baseDir, nodeId) || {
      label: nodeId,
      platform: 'unknown',
    };

    const shellWrapperPath = provisionShadowDirectory(shadowDir, node);
    const binDir = resolve(shadowDir, '.bin');

    const localCoreUrl = String(process.env.AGENTDOCK_LOCAL_CORE_URL || 'http://127.0.0.1:9831').trim();
    const adminToken = String(process.env.AGENTDOCK_MESH_ADMIN_TOKEN || '').trim();

    // Completely remove agentdock-remote-mesh from mcpServers
    const existingMcp = input.launchConfig.mcpServers || [];
    const mcpServers = existingMcp.filter((s) => s.name !== 'agentdock-remote-mesh');

    const systemPromptAppend = buildDeviceSystemPrompt(node);

    const delimiter = process.platform === 'win32' ? ';' : ':';
    const existingPath = input.launchConfig.env?.PATH || process.env.PATH || '';
    const augmentedPath = `${binDir}${delimiter}${existingPath}`;

    return {
      ...input.launchConfig,
      workDir: shadowDir,
      mcpServers,
      env: {
        ...input.launchConfig.env,
        SHELL: shellWrapperPath,
        CLAUDE_CODE_SHELL: shellWrapperPath,
        PATH: augmentedPath,
        AGENTDOCK_MESH_NODE_ID: nodeId,
        AGENTDOCK_LOCAL_CORE_URL: localCoreUrl,
        AGENTDOCK_MESH_ADMIN_TOKEN: adminToken,
        AGENTDOCK_MESH_NODE_PLATFORM: String(node.platform || '').trim(),
        AGENTDOCK_MESH_NODE_LABEL: String(node.label || '').trim(),
      },
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
