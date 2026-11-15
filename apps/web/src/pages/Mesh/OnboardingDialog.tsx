import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MeshNode, TailscalePeer } from '@cc/superai-contracts';
import type { TailscaleConnection, TailscaleConnectionResult } from '@cc/superai-contracts/mesh-onboarding';
import { Button, Input, Modal } from '@/components/ui';
import { ONBOARDING_STAGES, operationFinished, readyExecutionNode } from './onboarding-model';
import { useTailscaleOnboarding } from './useTailscaleOnboarding';

type Profile = Pick<TailscaleConnection, 'sshUser' | 'approvedRoot' | 'allowShell'>;
type Flow = ReturnType<typeof useTailscaleOnboarding>;
type Props = { peer: TailscalePeer; connection?: TailscaleConnection; onClose: () => void; onReady?: (node: MeshNode) => void };

function initialProfile(connection?: TailscaleConnection): Profile {
  return { sshUser: connection?.sshUser || '', approvedRoot: connection?.approvedRoot || '~/AgentDock', allowShell: connection?.allowShell || false };
}

function needsReauthorization(connection: TailscaleConnection | undefined, profile: Profile): boolean {
  if (!connection) return false;
  return ['revoked', 'needs_repair'].includes(connection.status) || profile.sshUser !== connection.sshUser || profile.approvedRoot !== connection.approvedRoot || profile.allowShell !== connection.allowShell;
}

function OnboardingForm({ profile, onChange, reauthorize, confirmed, onConfirm }: { profile: Profile; onChange: (profile: Profile) => void; reauthorize: boolean; confirmed: boolean; onConfirm: (value: boolean) => void }) {
  const { t } = useTranslation();
  return <div className="space-y-3">
    <Input label={t('mesh.onboarding.sshUser')} value={profile.sshUser} onChange={event => onChange({ ...profile, sshUser: event.target.value })} autoComplete="username" />
    <Input label={t('mesh.onboarding.approvedRoot')} value={profile.approvedRoot} onChange={event => onChange({ ...profile, approvedRoot: event.target.value })} />
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={profile.allowShell} onChange={event => onChange({ ...profile, allowShell: event.target.checked })} />{t('mesh.onboarding.allowShell')}</label>
    <p className="text-xs text-muted-foreground">{t(profile.allowShell ? 'mesh.onboarding.shellWarning' : 'mesh.onboarding.filesOnly')}</p>
    {reauthorize && <label className="flex items-start gap-2 rounded border border-amber-500/40 p-3 text-sm"><input type="checkbox" checked={confirmed} onChange={event => onConfirm(event.target.checked)} />{t('mesh.onboarding.reauthorizeConsent')}</label>}
  </div>;
}

function OperationProgress({ result }: { result: TailscaleConnectionResult }) {
  const { t } = useTranslation();
  const complete = result.operation.stage === 'ready' && result.connection.status === 'ready';
  const errorKey = result.operation.errorCode?.startsWith('BOOTSTRAP_') ? 'BOOTSTRAP_FAILED' : result.operation.errorCode;
  const stageIndex = ONBOARDING_STAGES.findIndex(stage => stage === result.operation.stage);
  return <div className="space-y-2" role="status" aria-live="polite">
    <ol className="space-y-2">{ONBOARDING_STAGES.map((stage, index) => {
      const current = stage === result.operation.stage;
      const done = complete || (stageIndex >= 0 && index < stageIndex);
      return <li key={stage} className={`flex justify-between text-sm ${current ? 'font-semibold text-primary' : 'text-muted-foreground'}`}><span>{t(`mesh.onboarding.stages.${stage}`)}</span><span>{done ? '✓' : current ? '…' : '—'}</span></li>;
    })}</ol>
    <p className="text-xs text-muted-foreground">{t(`mesh.onboarding.connectionStatus.${result.connection.status}`)}</p>
    {complete && <p className="rounded bg-emerald-500/10 p-3 text-sm">{t(result.connection.allowShell ? 'mesh.onboarding.readyShell' : 'mesh.onboarding.readyFiles')}</p>}
    {['failed', 'cancelled', 'interrupted'].includes(result.operation.stage) && <p className="rounded bg-amber-500/10 p-3 text-sm">{t(`mesh.onboarding.stages.${result.operation.stage}`)}</p>}
    {result.operation.errorCode && <p role="alert" className="text-sm text-red-400">{t(`mesh.onboarding.errors.${errorKey}`, { defaultValue: result.operation.errorMessage || t('mesh.onboarding.failed') })}</p>}
  </div>;
}

function DialogActions({ flow, active, complete, reauthorize, canStart, onStart, onClose, onReady }: { flow: Flow; active: boolean; complete: boolean; reauthorize: boolean; canStart: boolean; onStart: () => void; onClose: () => void; onReady?: (node: MeshNode) => void }) {
  const { t } = useTranslation();
  const readyNode = flow.result ? readyExecutionNode(flow.result, flow.nodes) : undefined;
  const actionKey = reauthorize ? 'reauthorize' : flow.result ? 'retry' : 'start';
  return <div className="flex flex-wrap justify-end gap-2">
    {active ? <Button variant="secondary" disabled={!flow.result} loading={flow.pending} onClick={() => { void flow.cancel(); }}>{t('mesh.onboarding.cancel')}</Button> : <Button variant="secondary" disabled={flow.pending} onClick={onClose}>{t(complete ? 'mesh.onboarding.done' : 'mesh.onboarding.close')}</Button>}
    {!active && !complete && <Button loading={flow.pending} disabled={!canStart} onClick={onStart}>{t(`mesh.onboarding.${actionKey}`)}</Button>}
    {complete && onReady && readyNode && <Button onClick={() => onReady(readyNode)}>{t('mesh.onboarding.useDevice')}</Button>}
  </div>;
}

function activeOperation(result?: TailscaleConnectionResult, connection?: TailscaleConnection): boolean {
  return result ? !operationFinished(result.operation.stage) : connection?.status === 'connecting';
}

export function OnboardingDialog({ peer, connection, onClose, onReady }: Props) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState(() => initialProfile(connection));
  const [confirmed, setConfirmed] = useState(false);
  const flow = useTailscaleOnboarding(peer.id, connection);
  const active = activeOperation(flow.result, connection);
  const reauthorize = needsReauthorization(flow.result?.connection || connection, profile);
  const complete = flow.result?.operation.stage === 'ready' && flow.result.connection.status === 'ready';
  useEffect(() => { if (flow.result) setProfile(initialProfile(flow.result.connection)); }, [flow.result]);
  const allowed = Boolean(profile.sshUser.trim() && profile.approvedRoot.trim() && peer.stableIdentity === true && peer.online && (!reauthorize || confirmed));
  const close = () => { if (!flow.pending && !active) onClose(); };
  return <Modal open onClose={close} title={t('mesh.onboarding.title', { name: peer.name })}>
    <p className="text-sm text-muted-foreground">{t('mesh.onboarding.prerequisites')}</p>
    {!active && !complete && <OnboardingForm profile={profile} onChange={next => { setProfile(next); setConfirmed(false); }} reauthorize={reauthorize} confirmed={confirmed} onConfirm={setConfirmed} />}
    {flow.result && <OperationProgress result={flow.result} />}
    {flow.targetPending && <p role="status" className="text-sm text-muted-foreground">{t('mesh.onboarding.waitingForMesh')}</p>}
    {flow.error && <p role="alert" className="text-sm text-red-400">{flow.error}</p>}
    <DialogActions flow={flow} active={active} complete={complete} reauthorize={reauthorize} canStart={allowed} onStart={() => { void flow.start({ ...profile, sshUser: profile.sshUser.trim(), approvedRoot: profile.approvedRoot.trim() }, reauthorize); }} onClose={onClose} onReady={onReady} />
  </Modal>;
}
