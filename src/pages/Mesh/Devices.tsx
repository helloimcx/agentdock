import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, PageHeader } from '@/components/ui';
import type { MeshNode, TailscalePeer, TailscaleStatusResponse } from '@cc/superai-contracts';
import { useMesh } from './useMesh';

function PairedNodesCard({ nodes, loading }: { nodes: MeshNode[]; loading: boolean }) {
  const { t } = useTranslation();
  return (
    <Card className="space-y-3 p-4">
      {loading && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {!loading && nodes.length === 0 && (
        <p className="text-muted-foreground">{t('mesh.noDevices')}</p>
      )}
      {nodes.map(node => (
        <div key={node.id} className="space-y-1 border-b border-border pb-3 last:border-0 last:pb-0">
          <p className="font-medium">
            {node.label} · <span className={node.status === 'online' ? 'text-emerald-400' : 'text-muted-foreground'}>{t(`mesh.nodeStatus.${node.status}`)}</span>
          </p>
          <p className="text-xs text-muted-foreground">{node.platform} · {node.id}</p>
          <p className="text-sm text-muted-foreground">{node.capabilities.join(', ')}</p>
        </div>
      ))}
    </Card>
  );
}

function isPeerBound(peer: TailscalePeer, nodes: MeshNode[]) {
  if (peer.meshNodeId) return true;
  const safeName = peer.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return nodes.some(
    n => n.id === `node:ts:${safeName}` || n.id === `node:${safeName}` || n.label.startsWith(peer.name),
  );
}

function TailscalePeersCard({
  tailscale,
  nodes,
  bindingId,
  onBindPeer,
}: {
  tailscale: TailscaleStatusResponse;
  nodes: MeshNode[];
  bindingId: string | null;
  onBindPeer: (peer: TailscalePeer) => void;
}) {
  const { t } = useTranslation();

  if (!tailscale.available) {
    return (
      <Card className="p-4">
        <p className="text-sm text-amber-400">
          {tailscale.error || t('mesh.tailscaleNotRunning', 'Tailscale 未运行或 CLI 不可用。')}
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-4">
      <p className="text-xs text-muted-foreground">
        {t('mesh.tailscaleDescription', '在当前 Tailnet 私有网中自动探测到的设备，可直接一键绑定为 Mesh 执行节点。')}
      </p>

      <div className="space-y-3">
        {tailscale.self && (
          <div className="flex items-center justify-between rounded-md bg-muted/40 p-2.5 text-sm">
            <div className="space-y-0.5">
              <p className="font-medium">
                {tailscale.self.name}{' '}
                <span className="text-xs text-muted-foreground">
                  ({t('mesh.tailscaleSelf', '本机')}) · {tailscale.self.os}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">{tailscale.self.ips.join(', ')}</p>
            </div>
            <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
              {t('mesh.nodeStatus.online')}
            </span>
          </div>
        )}

        {tailscale.peers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('mesh.tailscaleNoPeers', '未在当前 Tailnet 中探测到其他对端设备。')}</p>
        ) : (
          <div className="divide-y divide-border">
            {tailscale.peers.map(peer => {
              const bound = isPeerBound(peer, nodes);
              const isBusy = bindingId === peer.id;
              return (
                <div key={peer.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      {peer.name}{' '}
                      <span className="text-xs text-muted-foreground">({peer.os})</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {peer.ips[0] || peer.dnsName || 'No IP'}{' '}
                      <span className={peer.online ? 'text-emerald-400' : 'text-zinc-500'}>
                        · {peer.online ? t('mesh.nodeStatus.online') : t('mesh.nodeStatus.offline')}
                      </span>
                    </p>
                  </div>
                  <div>
                    {bound ? (
                      <span className="rounded bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                        {t('mesh.bound', '已绑定')}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => onBindPeer(peer)}
                      >
                        {isBusy ? '...' : t('mesh.bindAsMeshNode', '一键绑定为 Mesh 节点')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function Devices() {
  const { t } = useTranslation();
  const { nodes, tailscale, bindTailscale, error, loading, refresh } = useMesh();
  const [bindingId, setBindingId] = useState<string | null>(null);

  const handleBindPeer = async (peer: TailscalePeer) => {
    setBindingId(peer.id);
    try {
      await bindTailscale({
        name: peer.name,
        dnsName: peer.dnsName,
        ips: peer.ips,
        os: peer.os,
        allowShell: true,
      });
    } finally {
      setBindingId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title={t('mesh.title')} description={t('mesh.description')} />
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => { void refresh(); }}>
          {t('mesh.refresh')}
        </Button>
      </div>

      {error && <p role="alert" className="text-red-400">{error}</p>}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t('mesh.meshNodes', '已配对 Mesh 节点')}
        </h2>
        <PairedNodesCard nodes={nodes} loading={loading} />
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t('mesh.tailscaleTitle', 'Tailscale 局域网设备发现')}
        </h2>
        <TailscalePeersCard
          tailscale={tailscale}
          nodes={nodes}
          bindingId={bindingId}
          onBindPeer={(peer) => { void handleBindPeer(peer); }}
        />
      </div>
    </div>
  );
}
