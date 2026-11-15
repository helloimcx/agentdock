import type { MeshNode, TailscalePeer } from '@cc/superai-contracts';
import type { TailscaleConnectionResult, TailscaleOperationStage } from '@cc/superai-contracts/mesh-onboarding';

const CANONICAL_NODE = /^node:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const PEER_TARGET_PREFIX = 'tailscale-peer:';
export const ONBOARDING_STAGES = ['preflight', 'deploying', 'pairing', 'connecting', 'verifying', 'ready'] as const;

export function operationFinished(stage: TailscaleOperationStage): boolean {
  return ['ready', 'failed', 'cancelled', 'interrupted'].includes(stage);
}

export function eligibleExecutionNodes(nodes: MeshNode[], selectedId = 'local', peers: TailscalePeer[] = []): MeshNode[] {
  return nodes.filter(node => {
    if (!CANONICAL_NODE.test(node.id) || node.status === 'revoked') return false;
    if (node.id === selectedId && node.status === 'offline') return true;
    if (node.status !== 'online' || !node.capabilities.includes('shell.exec')) return false;
    if (node.onboardingStatus !== undefined && (node.onboardingStatus !== 'ready' || node.onboardingDesiredState !== 'active')) return false;
    const peer = peers.find(item => item.meshNodeId === node.id);
    return !peer?.connectionStatus || peer.connectionStatus === 'ready';
  });
}

export function executionTargetAllowed(id: string, nodes: MeshNode[], selectedId = 'local', peers: TailscalePeer[] = []): boolean {
  return id === 'local' || eligibleExecutionNodes(nodes, selectedId, peers).some(node => node.id === id);
}

export function readyExecutionNode(result: TailscaleConnectionResult, nodes: MeshNode[]): MeshNode | undefined {
  if (result.operation.stage !== 'ready' || result.connection.status !== 'ready' || result.connection.desiredState !== 'active' || !result.connection.allowShell) return undefined;
  return eligibleExecutionNodes(nodes).find(node => node.id === result.connection.nodeId && node.id === result.operation.nodeId);
}

export function firstInvalidExecutionTarget(
  config: import('@cc/superai-contracts').DesktopConnectConfig,
  persisted: import('@cc/superai-contracts').DesktopConnectConfig | null,
  nodes: MeshNode[],
  peers: TailscalePeer[] = [],
): string | undefined {
  for (const project of config.projects || []) {
    const previous = persisted?.projects?.find(item => (project.workspace_id && item.workspace_id === project.workspace_id) || item.name === project.name);
    const savedId = previous?.device_id || previous?.agent?.options?.device_id || 'local';
    const targets = [project.device_id, project.agent?.options?.device_id].filter((id): id is string => Boolean(id));
    const invalid = targets.find(id => !executionTargetAllowed(id, nodes, savedId, peers));
    if (invalid) return invalid;
  }
  return undefined;
}
