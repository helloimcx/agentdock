import { useTranslation } from 'react-i18next';
import { Button, Card, PageHeader } from '@/components/ui';
import { useMesh } from './useMesh';

export default function Devices() {
  const { t } = useTranslation();
  const { nodes, error, loading, refresh } = useMesh();
  return <div className="space-y-4 animate-fade-in">
    <PageHeader title={t('mesh.title')} description={t('mesh.description')} />
    <div className="flex gap-2"><Button variant="secondary" onClick={() => { void refresh(); }}>{t('mesh.refresh')}</Button></div>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    <Card className="space-y-3 p-4">
      {loading && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {!loading && nodes.length === 0 && <p className="text-muted-foreground">{t('mesh.noDevices')}</p>}
      {nodes.map(node => <div key={node.id} className="space-y-1 border-b border-border pb-3">
        <p className="font-medium">{node.label} · {t(`mesh.nodeStatus.${node.status}`)}</p>
        <p className="text-xs text-muted-foreground">{node.platform} · {node.id}</p>
        <p className="text-sm">{node.capabilities.join(', ')}</p>
      </div>)}
    </Card>
  </div>;
}
