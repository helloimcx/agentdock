import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, PageHeader } from '@/components/ui';
import { useMesh } from './useMesh';
import DevicePairing from './DevicePairing';
import DeviceExecution from './DeviceExecution';
import RequestResult from './RequestResult';

export default function Devices() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [token, setToken] = useState('');
  const { client, nodes, requests, error, refresh, run } = useMesh(token);
  const disconnect = () => { setToken(''); setInput(''); };
  return <div className="space-y-4 animate-fade-in">
    <PageHeader title={t('mesh.title')} description={t('mesh.description')} />
    {!token ? <Card className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">{t('mesh.authenticationHelp')}</p>
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); setToken(input); setInput(''); }}>
        <Input aria-label={t('mesh.adminToken')} type="password" autoComplete="off" placeholder={t('mesh.adminToken')} value={input} onChange={event => setInput(event.target.value)} />
        <Button type="submit" disabled={!input.trim()}>{t('mesh.connect')}</Button>
      </form>
    </Card> : <>
      <div className="flex gap-2"><Button variant="secondary" onClick={() => { void refresh(); }}>{t('mesh.refresh')}</Button><Button variant="secondary" onClick={disconnect}>{t('mesh.disconnect')}</Button></div>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      <DevicePairing client={client} refresh={refresh} />
      <Card className="space-y-3 p-4">
        {nodes.length === 0 && <p className="text-muted-foreground">{t('mesh.noDevices')}</p>}
        {nodes.map(node => <div key={node.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div><p className="font-medium">{node.label} · {t(`mesh.nodeStatus.${node.status}`)}</p><p className="text-xs text-muted-foreground">{node.platform} · {node.id}</p><p className="text-sm">{node.capabilities.join(', ')}</p></div>
          <Button variant="secondary" disabled={node.status === 'revoked'} onClick={() => {
            if (window.confirm(t('mesh.revokeConfirm', { label: node.label }))) void run(() => client.revokeNode(node.id));
          }}>{t('mesh.revoke')}</Button>
        </div>)}
      </Card>
      <DeviceExecution nodes={nodes} client={client} run={run} />
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t('mesh.history')}</h2>
        <p className="text-sm text-muted-foreground">{t('mesh.outcomeHelp')}</p>
        {requests.map(request => <div key={request.id} className="space-y-1 border-b border-border pb-3">
          <p className="text-sm">{nodes.find(node => node.id === request.nodeId)?.label || request.nodeId} · {request.capability} · {t(`mesh.requestStatus.${request.status}`)}</p>
          <p className="text-xs text-muted-foreground">{request.id}</p>
          {request.status === 'running' && <Button variant="secondary" size="sm" onClick={() => { void run(() => client.cancelRequest(request.id)); }}>{t('mesh.cancel')}</Button>}
          {request.error && <p className="text-sm text-red-400">{request.error}</p>}
          {request.result !== undefined && <details><summary className="cursor-pointer text-sm">{t('mesh.result')}</summary><RequestResult result={request.result} /></details>}
        </div>)}
      </Card>
    </>}
  </div>;
}
