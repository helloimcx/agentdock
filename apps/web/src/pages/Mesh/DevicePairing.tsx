import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input } from '@/components/ui';
import type { MeshPairing } from '@cc/superai-contracts';
import type { createMeshClient } from '@cc/core-sdk/mesh';

export default function DevicePairing({ client, refresh }: { client: ReturnType<typeof createMeshClient>; refresh: () => Promise<void> }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [allowShell, setAllowShell] = useState(false);
  const [pairing, setPairing] = useState<MeshPairing>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pair = async () => {
    setBusy(true); setError(''); setPairing(undefined);
    try { setPairing(await client.createPairing({ label, allowShell })); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Pairing failed.'); }
    finally { setBusy(false); }
  };
  return <Card className="space-y-3 p-4">
    <h2 className="font-semibold">{t('mesh.pair')}</h2>
    <div className="flex gap-2">
      <Input aria-label={t('mesh.label')} placeholder={t('mesh.label')} maxLength={100} value={label} onChange={event => setLabel(event.target.value)} />
      <Button disabled={!label.trim() || busy} onClick={() => { void pair(); }}>{t('mesh.pair')}</Button>
    </div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowShell} onChange={event => setAllowShell(event.target.checked)} />{t('mesh.allowShell')}</label>
    <p className="text-sm text-muted-foreground">{t('mesh.shellWarning')}</p>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {pairing && <div className="space-y-2">
      <p className="text-sm">{t('mesh.pairingHelp')}</p>
      <code className="block break-all select-all text-sm">{pairing.pairingToken}</code>
      <p className="text-xs text-muted-foreground">{t('mesh.expires')}: {new Date(pairing.expiresAt).toLocaleString()}</p>
      <Button variant="secondary" onClick={() => setPairing(undefined)}>{t('mesh.hideToken')}</Button>
    </div>}
  </Card>;
}
