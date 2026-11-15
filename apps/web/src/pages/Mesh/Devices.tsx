import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Modal, PageHeader } from '@/components/ui';
import type { MeshNode, TailscalePeer } from '@cc/superai-contracts';
import type { TailscaleConnection } from '@cc/superai-contracts/mesh-onboarding';
import { OnboardingDialog } from './OnboardingDialog';
import { useMesh } from './useMesh';

function AdminTokenCard({ onTokenChange }: { onTokenChange: () => void }) {
  const { t } = useTranslation();
  const [tokenInput, setTokenInput] = useState('');
  const [hasToken, setHasToken] = useState(() => Boolean(localStorage.getItem('agentdock_mesh_token') || localStorage.getItem('agentdock_token')));
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = tokenInput.trim();
    if (trimmed) {
      localStorage.setItem('agentdock_mesh_token', trimmed);
      setHasToken(true);
      setIsEditing(false);
      setTokenInput('');
      onTokenChange();
    }
  };

  const handleClear = () => {
    localStorage.removeItem('agentdock_mesh_token');
    setHasToken(false);
    setIsEditing(false);
    setTokenInput('');
    onTokenChange();
  };

  if (!hasToken || isEditing) {
    return (
      <Card className="space-y-3 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{t('mesh.adminToken')}</h3>
          <p className="text-xs text-muted-foreground">{t('mesh.authenticationHelp')}</p>
        </div>
        <form className="flex gap-2" onSubmit={handleSave}>
          <Input
            aria-label={t('mesh.adminToken')}
            type="password"
            autoComplete="off"
            placeholder={t('mesh.adminToken')}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <Button type="submit" disabled={!tokenInput.trim()}>{t('mesh.connect')}</Button>
          {isEditing && (
            <Button variant="secondary" type="button" onClick={() => setIsEditing(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
          )}
        </form>
      </Card>
    );
  }

  return (
    <Card className="flex items-center justify-between p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="font-medium">{t('mesh.adminToken')}:</span>
        <span className="text-xs text-muted-foreground">••••••••</span>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
          {t('common.edit', 'Change')}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleClear}>
          {t('mesh.disconnect')}
        </Button>
      </div>
    </Card>
  );
}

function PairedNodesCard({ nodes, loading }: { nodes: MeshNode[]; loading: boolean }) {
  const { t } = useTranslation();
  return <Card className="space-y-3 p-4">
    {loading && <p className="text-muted-foreground">{t('common.loading')}</p>}
    {!loading && !nodes.length && <p className="text-muted-foreground">{t('mesh.noDevices')}</p>}
    {nodes.map(node => <div key={node.id} className="space-y-1 border-b border-border pb-3 last:border-0 last:pb-0">
      <p className="font-medium">{node.label} · {t(`mesh.nodeStatus.${node.status}`)}</p>
      <p className="text-xs text-muted-foreground">{node.platform} · {node.id}</p>
      <p className="text-sm text-muted-foreground">{node.id.startsWith('node:ts:') ? t('mesh.onboarding.legacy') : t(node.capabilities.includes('shell.exec') ? 'mesh.onboarding.shellCapabilities' : 'mesh.onboarding.fileCapabilities')}</p>
    </div>)}
  </Card>;
}

function ConnectionActions({ connection, onAction }: { connection: TailscaleConnection; onAction: (kind: 'disconnect' | 'revoke') => void }) {
  const { t } = useTranslation();
  if (connection.status === 'revoked') return null;
  return <>
    {connection.desiredState === 'active' && <Button size="sm" variant="secondary" onClick={() => onAction('disconnect')}>{t('mesh.onboarding.disconnect')}</Button>}
    {connection.nodeId && <Button size="sm" variant="danger" onClick={() => onAction('revoke')}>{t('mesh.onboarding.revoke')}</Button>}
  </>;
}

function MissingPeerRow({ connection, onAction }: { connection: TailscaleConnection; onAction: (kind: 'disconnect' | 'revoke') => void }) {
  const { t } = useTranslation();
  return <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
    <div><p>{connection.peerId} · {t(`mesh.onboarding.connectionStatus.${connection.status}`)}</p><p className="text-xs text-muted-foreground">{t('mesh.onboarding.missingPeer')}</p></div>
    <div className="flex gap-2"><ConnectionActions connection={connection} onAction={onAction} /></div>
  </div>;
}

function PeerRow({ peer, connection, onOpen, onAction }: { peer: TailscalePeer; connection?: TailscaleConnection; onOpen: () => void; onAction: (kind: 'disconnect' | 'revoke') => void }) {
  const { t } = useTranslation();
  const supported = /^(macos|darwin|linux)$/i.test(peer.os);
  return <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
    <div className="space-y-1">
      <p className="font-medium">{peer.name} <span className="text-xs text-muted-foreground">({peer.os})</span></p>
      <p className="text-xs text-muted-foreground">{peer.ips[0] || peer.dnsName} · {t(peer.online ? 'mesh.nodeStatus.online' : 'mesh.nodeStatus.offline')}</p>
      <p className="text-xs text-muted-foreground">{connection ? t(`mesh.onboarding.connectionStatus.${connection.status}`) : t('mesh.onboarding.notConnected')}</p>
      {connection && <p className="text-xs text-muted-foreground">{t(connection.allowShell ? 'mesh.onboarding.shellCapabilities' : 'mesh.onboarding.fileCapabilities')}</p>}
      {peer.stableIdentity !== true && <p className="text-xs text-amber-500">{t('mesh.onboarding.noStableId')}</p>}
      {!supported && <p className="text-xs text-muted-foreground">{t('mesh.onboarding.unsupported')}</p>}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={!peer.online || peer.stableIdentity !== true || !supported} onClick={onOpen}>{t(connection ? 'mesh.onboarding.settings' : 'mesh.onboarding.start')}</Button>
      {connection && <ConnectionActions connection={connection} onAction={onAction} />}
    </div>
  </div>;
}

function DiscoveryError({ authRequired, error }: { authRequired: boolean; error?: string }) {
  const { t } = useTranslation();
  return <>{authRequired ? t('mesh.authRequired') : error || t('mesh.tailscaleNotRunning')}</>;
}

export default function Devices() {
  const { t } = useTranslation();
  const { nodes, connections, tailscale, error, loading, refresh, act } = useMesh();
  const [selected, setSelected] = useState<TailscalePeer | null>(null);
  const [action, setAction] = useState<{ connection: TailscaleConnection; kind: 'disconnect' | 'revoke' } | null>(null);
  const [pending, setPending] = useState(false);
  const confirmAction = async () => {
    if (!action) return;
    setPending(true);
    try { await act(action.connection, action.kind); setAction(null); }
    catch { /* useMesh retains action errors across polling. */ }
    finally { setPending(false); }
  };
  const discoveryError = tailscale.available ? '' : tailscale.error;
  const authError = /401|unauthorized|authentication/i.test(discoveryError || '');
  return <div className="space-y-6 animate-fade-in">
    <PageHeader title={t('mesh.title')} description={t('mesh.description')} />
    <Button variant="secondary" onClick={() => { void refresh(); }}>{t('mesh.refresh')}</Button>
    <AdminTokenCard onTokenChange={() => { void refresh(); }} />
    {error && <p role="alert" className="text-red-400">{error}</p>}
    <section className="space-y-2"><h2 className="text-sm font-semibold">{t('mesh.meshNodes')}</h2><PairedNodesCard nodes={nodes} loading={loading} /></section>
    <section className="space-y-2"><h2 className="text-sm font-semibold">{t('mesh.tailscaleTitle')}</h2>
      <Card className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">{t('mesh.onboarding.description')}</p>
        {!tailscale.available ? <p className="text-sm text-amber-500"><DiscoveryError authRequired={authError} error={discoveryError} /></p> : <>
          {tailscale.self && <p className="rounded bg-muted p-3 text-sm">{tailscale.self.name} · {t('mesh.tailscaleSelf')} · {tailscale.self.ips.join(', ')}</p>}
          {!tailscale.peers.length && <p className="text-muted-foreground">{t('mesh.tailscaleNoPeers')}</p>}
          <div className="divide-y divide-border">{tailscale.peers.map(peer => {
            const connection = connections.find(item => item.peerId === peer.id);
            return <PeerRow key={peer.id} peer={peer} connection={connection} onOpen={() => setSelected(peer)} onAction={kind => { if (connection) setAction({ connection, kind }); }} />;
          })}</div>
        </>}
      </Card>
    </section>
    {connections.filter(item => !tailscale.peers.some(peer => peer.id === item.peerId)).map(connection => <MissingPeerRow key={connection.id} connection={connection} onAction={kind => setAction({ connection, kind })} />)}
    {selected && <OnboardingDialog key={selected.id} peer={selected} connection={connections.find(item => item.peerId === selected.id)} onClose={() => { setSelected(null); void refresh(); }} />}
    <Modal open={Boolean(action)} onClose={() => { if (!pending) setAction(null); }} title={t(action?.kind === 'revoke' ? 'mesh.onboarding.revoke' : 'mesh.onboarding.disconnect')}>
      <p className="text-sm">{t(action?.kind === 'revoke' ? 'mesh.onboarding.revokeWarning' : 'mesh.onboarding.disconnectWarning')}</p>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="secondary" disabled={pending} onClick={() => setAction(null)}>{t('common.cancel')}</Button><Button variant={action?.kind === 'revoke' ? 'danger' : 'primary'} loading={pending} onClick={() => { void confirmAction(); }}>{t('common.confirm')}</Button></div>
    </Modal>
  </div>;
}
