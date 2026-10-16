import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeliveryRecord, DeliveryReconcileInput } from '@cc/superai-contracts';
import { reconcileAutomationDelivery } from '@cc/core-sdk/automations';
import { Button } from '@/components/ui';

export default function DeliveryRecoveryPanel({ automationId, workspaceId, deliveries, onChanged }: {
  automationId: string; workspaceId: string; deliveries: DeliveryRecord[]; onChanged: () => Promise<void>;
}) {
  return <div className="space-y-2">{deliveries.filter((row) => row.status === 'unknown' || row.status === 'failed').map((row) =>
    <DeliveryRecovery key={row.id} record={row} automationId={automationId} workspaceId={workspaceId} onChanged={onChanged} />)}</div>;
}

function DeliveryRecovery({ record, automationId, workspaceId, onChanged }: {
  record: DeliveryRecord; automationId: string; workspaceId: string; onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [risk, setRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reconcile = async (action: DeliveryReconcileInput['action']) => {
    setBusy(true); setError('');
    try {
      await reconcileAutomationDelivery(automationId, workspaceId, record.id, { action, reason, acknowledgeDuplicateRisk: risk });
      await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2 rounded-md border border-amber-400/40 p-3">
    <p>{t('delivery.recovery')} · {record.status} · {record.platform}</p>
    <p className="text-muted-foreground">{record.error}</p>
    <input className="w-full rounded border bg-transparent p-2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('delivery.reason')} aria-label={t('delivery.reason')} />
    <label className="flex items-center gap-2"><input type="checkbox" checked={risk} onChange={(event) => setRisk(event.target.checked)} />{t('delivery.duplicateRisk')}</label>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy || !reason.trim()} onClick={() => void reconcile('confirm-delivered')}>{t('delivery.confirm')}</Button>
      <Button size="sm" variant="secondary" disabled={busy || !reason.trim() || !risk} onClick={() => void reconcile('retry')}>{t('delivery.retry')}</Button>
      <Button size="sm" variant="ghost" disabled={busy || !reason.trim()} onClick={() => void reconcile('cancel')}>{t('delivery.cancel')}</Button>
    </div>
    {error && <p role="alert" className="text-red-500">{error}</p>}
  </div>;
}
