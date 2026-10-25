import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createMeshClient } from '@cc/core-sdk/mesh';
import { getMeshAdminToken } from '@cc/core-sdk/runtime';
import type { MeshNode, TailscalePeer } from '@cc/superai-contracts';
import type { TailscaleConnection } from '@cc/superai-contracts/mesh-onboarding';
import { Select } from '@/components/ui';
import { OnboardingDialog } from './OnboardingDialog';
import { eligibleExecutionNodes, PEER_TARGET_PREFIX } from './onboarding-model';

type Props = {
  selectedDevice: string;
  meshNodes?: MeshNode[];
  tailscalePeers?: TailscalePeer[];
  tailscaleError?: string | null;
  onDeviceChange: (id: string) => void;
  onNodeBound?: (node: MeshNode) => void;
};

export function ExecutionDeviceSelector({ selectedDevice, meshNodes = [], tailscalePeers = [], tailscaleError, onDeviceChange, onNodeBound }: Props) {
  const { t } = useTranslation();
  const [peer, setPeer] = useState<TailscalePeer | null>(null);
  const [connection, setConnection] = useState<TailscaleConnection>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const nodes = eligibleExecutionNodes(meshNodes, selectedDevice, tailscalePeers);
  const peers = tailscalePeers.filter(item => item.online && !item.isSelf && item.stableIdentity === true && /^(macos|darwin|linux)$/i.test(item.os) && !nodes.some(node => node.id === item.meshNodeId));
  const change = async (id: string) => {
    if (!id.startsWith(PEER_TARGET_PREFIX)) { onDeviceChange(id); return; }
    const candidate = peers.find(item => item.id === id.slice(PEER_TARGET_PREFIX.length));
    if (!candidate) return;
    setPending(true);
    setError('');
    try {
      const saved = await createMeshClient(getMeshAdminToken()).listTailscaleConnections();
      setConnection(saved.connections.find(item => item.peerId === candidate.id));
      setPeer(candidate);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  };
  const unavailable = selectedDevice !== 'local' && !nodes.some(node => node.id === selectedDevice);
  return <div className="space-y-1">
    <Select label={t('mesh.onboarding.executionDevice')} value={selectedDevice} disabled={pending} onChange={event => { void change(event.target.value); }}>
      <option value="local">{t('mesh.onboarding.localDevice')}</option>
      {unavailable && <option value={selectedDevice} disabled>{selectedDevice} · {t(selectedDevice.startsWith('node:ts:') ? 'mesh.onboarding.legacy' : 'mesh.onboarding.unavailableTarget')}</option>}
      {nodes.map(node => <option key={node.id} value={node.id}>{node.label} · {t(`mesh.nodeStatus.${node.status}`)}</option>)}
      {peers.map(item => <option key={item.id} value={`${PEER_TARGET_PREFIX}${item.id}`}>{item.name} · {t('mesh.onboarding.connectFirst')}</option>)}
    </Select>
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    {tailscaleError === 'auth_required' && <p className="text-xs text-muted-foreground">{t('mesh.workspaceAuthHint')}</p>}
    {unavailable && <p className="text-xs text-amber-500">{t('mesh.onboarding.invalidTarget')}</p>}
    {peer && <OnboardingDialog key={peer.id} peer={peer} connection={connection} onClose={() => setPeer(null)} onReady={node => { onNodeBound?.(node); onDeviceChange(node.id); setPeer(null); }} />}
  </div>;
}
