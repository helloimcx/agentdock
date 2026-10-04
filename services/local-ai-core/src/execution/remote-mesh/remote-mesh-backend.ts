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

export function resolveMeshNodeId(project: AgentExecutionBackendInput['project']): string {
  const deviceId = String(project.device_id || project.agent?.options?.device_id || '').trim();
  return deviceId.startsWith('node:') ? deviceId : '';
}

export function remoteMeshShellScriptPath(): string {
  return resolve(__dirname, 'agentdock-mesh-shell.js');
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

    // Auto-provision CLAUDE.md and AGENTS.md in shadow directory
    const claudeMdContent = buildDeviceClaudeMd(node);
    try {
      writeFileSync(resolve(shadowDir, 'CLAUDE.md'), claudeMdContent, 'utf8');
      writeFileSync(resolve(shadowDir, 'AGENTS.md'), claudeMdContent, 'utf8');
    } catch {
      // Best-effort provisioning
    }

    // Auto-provision executable shell wrapper script in shadowDir/.bin/mesh-shell
    const binDir = resolve(shadowDir, '.bin');
    mkdirSync(binDir, { recursive: true });
    const isWindowsHost = process.platform === 'win32';
    const shellWrapperPath = resolve(binDir, isWindowsHost ? 'mesh-shell.cmd' : 'mesh-shell');
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
      writeFileSync(resolve(binDir, 'mesh-shell'), shWrapperContent, { mode: 0o755, encoding: 'utf8' });
      chmodSync(resolve(binDir, 'mesh-shell'), 0o755);
      writeFileSync(resolve(binDir, 'mesh-shell.cmd'), cmdWrapperContent, { encoding: 'utf8' });
    } catch {
      // Best-effort permission setting
    }

    const localCoreUrl = String(process.env.AGENTDOCK_LOCAL_CORE_URL || 'http://127.0.0.1:9831').trim();
    const adminToken = String(process.env.AGENTDOCK_MESH_ADMIN_TOKEN || '').trim();

    // Completely remove agentdock-remote-mesh from mcpServers
    const existingMcp = input.launchConfig.mcpServers || [];
    const mcpServers = existingMcp.filter((s) => s.name !== 'agentdock-remote-mesh');

    const systemPromptAppend = buildDeviceSystemPrompt(node);

    return {
      ...input.launchConfig,
      workDir: shadowDir,
      mcpServers,
      env: {
        ...input.launchConfig.env,
        SHELL: shellWrapperPath,
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
