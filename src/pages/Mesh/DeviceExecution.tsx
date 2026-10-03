import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Select } from '@/components/ui';
import type { MeshCapability, MeshNode } from '@cc/superai-contracts';
import type { createMeshClient } from '@cc/core-sdk/mesh';

export default function DeviceExecution({ nodes, client, run }: {
  nodes: MeshNode[]; client: ReturnType<typeof createMeshClient>; run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState('');
  const [capability, setCapability] = useState<MeshCapability>('filesystem.list');
  const [path, setPath] = useState('.');
  const [program, setProgram] = useState('');
  const [argv, setArgv] = useState('[]');
  const node = nodes.find(device => device.id === selectedId && device.status === 'online');
  const execute = () => run(async () => {
    if (!node) return;
    return client.execute({ nodeId: node.id, capability, args: capability === 'shell.exec' ? { program, arguments: JSON.parse(argv) } : { path } });
  });
  return <Card className="space-y-3 p-4">
    <h2 className="font-semibold">{t('mesh.execute')}</h2>
    <div className="flex flex-wrap gap-2">
      <div className="space-y-1"><label htmlFor="mesh-device" className="text-sm">{t('mesh.device')}</label>
      <Select id="mesh-device" value={selectedId} onChange={event => { setSelectedId(event.target.value); setCapability('filesystem.list'); }}>
        <option value="">{t('mesh.selectDevice')}</option>
        {nodes.filter(device => device.status === 'online').map(device => <option key={device.id} value={device.id}>{device.label}</option>)}
      </Select></div>
      <div className="space-y-1"><label htmlFor="mesh-capability" className="text-sm">{t('mesh.capability')}</label>
      <Select id="mesh-capability" value={capability} onChange={event => setCapability(event.target.value as MeshCapability)}>
        {(node?.capabilities || []).map(item => <option key={item} value={item}>{t(`mesh.capabilities.${item.replace('.', '_')}`)}</option>)}
      </Select></div>
    </div>
    {capability === 'shell.exec' ? <div className="space-y-2">
      <Input aria-label={t('mesh.program')} placeholder={t('mesh.program')} value={program} onChange={event => setProgram(event.target.value)} />
      <Input aria-label={t('mesh.arguments')} placeholder={t('mesh.arguments')} value={argv} onChange={event => setArgv(event.target.value)} />
    </div> : <Input aria-label={t('mesh.path')} placeholder={t('mesh.path')} value={path} onChange={event => setPath(event.target.value)} />}
    <Button disabled={!node?.capabilities.includes(capability)} onClick={() => { void execute(); }}>{t('mesh.execute')}</Button>
  </Card>;
}
