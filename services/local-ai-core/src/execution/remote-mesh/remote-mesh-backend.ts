import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentLaunchConfig, AgentMcpServerConfig } from '@cc/plugin-sdk';
import type { AgentExecutionBackend, AgentExecutionBackendInput } from '../agent-execution-types.js';

export function isRemoteMeshProject(project: AgentExecutionBackendInput['project']): boolean {
  const deviceId = String(project.device_id || project.agent?.options?.device_id || '').trim();
  return deviceId.startsWith('node:');
}

function resolveMeshNodeId(project: AgentExecutionBackendInput['project']): string {
  const deviceId = String(project.device_id || project.agent?.options?.device_id || '').trim();
  return deviceId.startsWith('node:') ? deviceId : '';
}

function remoteMeshMcpScriptPath(): string {
  return resolve(__dirname, 'remote-mesh-mcp-server.js');
}

export class RemoteMeshExecutionBackend implements AgentExecutionBackend {
  readonly mode = 'mesh' as const;

  prepareLaunch(input: AgentExecutionBackendInput): AgentLaunchConfig {
    const nodeId = resolveMeshNodeId(input.project);
    const rawWorkspaceId = input.launchConfig.workspaceId || input.project.name || 'workspace';
    const safeWorkspaceId = rawWorkspaceId.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^\.+/, '') || 'workspace';
    const shadowDir = resolve(input.configState.baseDir, 'remote-shadow', safeWorkspaceId);
    mkdirSync(shadowDir, { recursive: true });

    const localCoreUrl = String(process.env.AGENTDOCK_LOCAL_CORE_URL || 'http://127.0.0.1:9831').trim();
    const adminToken = String(process.env.AGENTDOCK_MESH_ADMIN_TOKEN || '').trim();

    const meshMcpServer: AgentMcpServerConfig = {
      name: 'agentdock-remote-mesh',
      type: 'stdio',
      command: process.execPath,
      args: [remoteMeshMcpScriptPath()],
      env: {
        AGENTDOCK_MESH_NODE_ID: nodeId,
        AGENTDOCK_LOCAL_CORE_URL: localCoreUrl,
        AGENTDOCK_MESH_ADMIN_TOKEN: adminToken,
      },
      enabled: true,
    };

    const existingMcp = input.launchConfig.mcpServers || [];
    const mcpServers = [
      meshMcpServer,
      ...existingMcp.filter((s) => s.name !== 'agentdock-remote-mesh'),
    ];

    return {
      ...input.launchConfig,
      workDir: shadowDir,
      mcpServers,
      execution: {
        mode: 'mesh',
        transport: 'remote-mesh-stdio',
        nodeId,
      },
    };
  }
}
