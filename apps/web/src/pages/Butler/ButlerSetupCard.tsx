import { useEffect, useState } from 'react';
import { Bot, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ButlerBotEndpoint, ButlerProfile, ButlerTrackingPolicy, WorkspaceSummary } from '@cc/superai-contracts';
import { Badge, Button, Card, Input, Select } from '@/components/ui';
import { butlerChatHref } from './butler-page-model';

type ButlerTransport = 'channel' | 'core';
type ManagedBotInput = { botId: string; bindingId?: string; sharedChatId: string; managedBotName: string; managerBotName: string };

function botSelectionKey(bot: ButlerBotEndpoint) {
  return bot.bindingId || bot.id;
}

interface ButlerSetupCardProps {
  profile: ButlerProfile | null;
  bots: ButlerBotEndpoint[];
  workspaces: WorkspaceSummary[];
  busy: boolean;
  onConfigure: (managerBotId: string, managerBindingId: string | undefined, managedBots: ManagedBotInput[], transport: ButlerTransport,
    trackingPolicy: ButlerTrackingPolicy) => Promise<unknown>;
}

interface ManagedBotRowProps {
  bot: ButlerBotEndpoint;
  workspace?: WorkspaceSummary;
  transport: ButlerTransport;
  selected: boolean;
  sharedChatId: string;
  managedBotName: string;
  managerBotName: string;
  busy: boolean;
  onToggle: (botId: string) => void;
  onSharedChatChange: (botId: string, sharedChatId: string) => void;
  onManagedBotNameChange: (botId: string, name: string) => void;
  onManagerBotNameChange: (botId: string, name: string) => void;
}

function ManagedBotRow({ bot, workspace, transport, selected, sharedChatId, managedBotName, managerBotName, busy, onToggle,
  onSharedChatChange, onManagedBotNameChange, onManagerBotNameChange }: ManagedBotRowProps) {
  const { t } = useTranslation();
  const usesCore = transport === 'core';
  return <div className="grid gap-3 rounded-lg border border-border/70 p-3">
    <label className="flex items-start gap-2 text-sm">
      <input className="mt-1" type="checkbox" checked={selected} onChange={() => onToggle(botSelectionKey(bot))}
        disabled={busy || (!usesCore && !bot.connected)} />
      <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><Bot size={15} />
        <strong>{bot.displayName}</strong><Badge variant={bot.connected ? 'success' : 'warning'}>{t(bot.connected ? 'butler.connected' : 'butler.disconnected')}</Badge></span>
        <span className="mt-1 block text-xs text-muted-foreground">{workspace?.name || bot.workspaceId} · {bot.workspaceId}/{bot.instanceId}
          {!bot.connected ? ` · ${t('butler.disconnected')}` : ''}</span>
      </span>
    </label>
    {selected && (usesCore
      ? <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-3">
        <div><p className="text-xs text-muted-foreground">{t('butler.delegationWorkspace')}</p><p className="mt-1 font-medium">{workspace?.name || bot.workspaceId}</p></div>
        <div><p className="text-xs text-muted-foreground">{t('butler.agentRuntime')}</p><p className="mt-1 font-medium">{workspace?.agentType || t('butler.workspaceDefault')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('butler.workspaceModelDefault')}</p></div>
        <div><p className="text-xs text-muted-foreground">{t('butler.dispatchRoute')}</p><p className="mt-1 font-medium">{t('butler.transportCore')}</p></div>
      </div>
      : <div className="grid gap-3 lg:grid-cols-3">
        <Input aria-label={`${t('butler.managedBotName')} ${bot.displayName}`} label={t('butler.managedBotName')} value={managedBotName}
          onChange={(event) => onManagedBotNameChange(botSelectionKey(bot), event.target.value)} placeholder={bot.displayName} required />
        <Input aria-label={`${t('butler.managerBotName')} ${bot.displayName}`} label={t('butler.managerBotName')} value={managerBotName}
          onChange={(event) => onManagerBotNameChange(botSelectionKey(bot), event.target.value)} placeholder={t('butler.managerBotNamePlaceholder')} required />
        <Input aria-label={`${t('butler.sharedChatId')} ${bot.displayName}`} label={t('butler.sharedChatId')} value={sharedChatId}
          onChange={(event) => onSharedChatChange(botSelectionKey(bot), event.target.value)} placeholder="oc_…" required />
      </div>)}
  </div>;
}

interface ManagerBotView {
  managerBot?: ButlerBotEndpoint;
  choices: ButlerBotEndpoint[];
  statusKey: string;
}

function resolveManagerBotView(managerBotKey: string, profile: ButlerProfile | null, bots: ButlerBotEndpoint[]): ManagerBotView {
  const discovered = bots.find((bot) => botSelectionKey(bot) === managerBotKey);
  const profileManager = profile && botSelectionKey(profile.managerBot) === managerBotKey ? profile.managerBot : undefined;
  const managerBot = discovered || (profileManager ? { ...profileManager, connected: false } : undefined);
  const choices = bots.filter((bot) => bot.connected || botSelectionKey(bot) === managerBotKey);
  if (profileManager && !choices.some((bot) => botSelectionKey(bot) === managerBotKey)) choices.push({ ...profileManager, connected: false });
  const statusKey = discovered ? (discovered.connected ? 'butler.connected' : 'butler.disconnected') : 'butler.notDiscovered';
  return { managerBot, choices, statusKey };
}

interface ManagerBindingPanelProps {
  managerBotId: string;
  managerBot?: ButlerBotEndpoint;
  managerChoices: ButlerBotEndpoint[];
  managerWorkspace?: WorkspaceSummary;
  managerStatus: string;
  busy: boolean;
  onManagerChange: (botId: string) => void;
}

function ManagerBindingPanel({ managerBotId, managerBot, managerChoices, managerWorkspace, managerStatus, busy, onManagerChange }: ManagerBindingPanelProps) {
  const { t } = useTranslation();
  return <div className="space-y-3">
    <Select aria-label={t('butler.managerBot')} label={t('butler.managerBot')} value={managerBotId} onChange={(event) => onManagerChange(event.target.value)} disabled={busy}>
      <option value="">{t('butler.chooseManagerBot')}</option>{managerChoices.map((bot) => <option value={botSelectionKey(bot)} key={botSelectionKey(bot)} disabled={!bot.connected}>
        {bot.displayName} · {bot.workspaceId}/{bot.instanceId}{!bot.connected ? ` · ${t(managerStatus)}` : ''}</option>)}
    </Select>
    {managerBot && <div className="space-y-3 rounded-lg border border-border/70 p-3">
      <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{t('butler.bindingTitle')}</span>
        <Badge variant={managerBot.connected ? 'success' : 'warning'}>{t(managerStatus)}</Badge></div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div><p className="text-xs text-muted-foreground">{t('butler.bindingWorkspace')}</p><p className="mt-1 font-medium">{managerWorkspace?.name || managerBot.workspaceId}</p></div>
        <div><p className="text-xs text-muted-foreground">{t('butler.channelInstance')}</p><p className="mt-1 font-medium">{t('butler.platformLark')} · {managerBot.instanceId}</p></div>
      </div>
      <Button asChild size="sm" variant="ghost"><Link to={managerWorkspace ? `/workspace?project=${encodeURIComponent(managerWorkspace.name)}` : '/workspace'}>{t('butler.openWorkspace')}</Link></Button>
    </div>}
  </div>;
}

function ManagerRolePanel({ managerBot, profile }: { managerBot?: ButlerBotEndpoint; profile: ButlerProfile | null }) {
  const { t } = useTranslation();
  const canOpenChat = Boolean(profile && managerBot && botSelectionKey(profile.managerBot) === botSelectionKey(managerBot));
  return <div className="flex flex-col justify-between gap-3 rounded-lg border border-primary/20 bg-primary/[0.035] p-4">
    <div><div className="flex items-center gap-2"><Bot size={17} className="text-primary" /><h3 className="font-medium">{managerBot?.displayName || t('butler.managerBot')}</h3></div>
      <p className="mt-2 text-sm text-muted-foreground">{t('butler.managerRoleHint')}</p></div>
    {canOpenChat && profile && <Button asChild size="sm" variant="secondary" className="self-start"><Link to={butlerChatHref(profile.workspaceId, profile.threadId)}>
      <MessageCircle size={15} />{t('butler.openChat')}</Link></Button>}
  </div>;
}

function TrackingPolicyFields({ value, busy, onChange }: { value: ButlerTrackingPolicy; busy: boolean; onChange: (value: ButlerTrackingPolicy) => void }) {
  const { t } = useTranslation();
  return <fieldset className="space-y-3 rounded-lg border border-border p-3" disabled={busy}>
    <legend className="px-1 text-sm font-medium">{t('butler.trackingPolicy')}</legend>
    <p className="text-xs text-muted-foreground">{t('butler.trackingHint')}</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <Input type="number" min={60} max={86400} step={60} label={t('butler.checkInterval')}
        value={value.defaultCheckIntervalSeconds} onChange={(event) => onChange({ ...value, defaultCheckIntervalSeconds: Number(event.target.value) })} />
      <Input type="number" min={1} max={200} label={t('butler.checkBudget')}
        value={value.checkBudget} onChange={(event) => onChange({ ...value, checkBudget: Number(event.target.value) })} />
      <Input type="number" min={1} max={30} label={t('butler.deadlineDays')}
        value={Math.ceil(value.deadlineSeconds / 86400)} onChange={(event) => onChange({ ...value, deadlineSeconds: Number(event.target.value) * 86400 })} />
    </div>
  </fieldset>;
}

interface ButlerSetupFormProps {
  bots: ButlerBotEndpoint[];
  workspaces: WorkspaceSummary[];
  busy: boolean;
  onConfigure: ButlerSetupCardProps['onConfigure'];
  managerBotId: string;
  managedBotIds: string[];
  sharedChatIds: Record<string, string>;
  managedBotNames: Record<string, string>;
  managerBotNames: Record<string, string>;
  transport: ButlerTransport;
  trackingPolicy: ButlerTrackingPolicy;
  onTransportChange: (transport: ButlerTransport) => void;
  onTrackingPolicyChange: (value: ButlerTrackingPolicy) => void;
  onToggleManaged: (botId: string) => void;
  onSharedChatChange: (botId: string, sharedChatId: string) => void;
  onManagedBotNameChange: (botId: string, name: string) => void;
  onManagerBotNameChange: (botId: string, name: string) => void;
}

function hasValidTrackingPolicy(policy: ButlerTrackingPolicy) {
  return Number.isInteger(policy.defaultCheckIntervalSeconds) && policy.defaultCheckIntervalSeconds >= 60 && policy.defaultCheckIntervalSeconds <= 86400
    && Number.isInteger(policy.checkBudget) && policy.checkBudget >= 1 && policy.checkBudget <= 200
    && Number.isInteger(policy.deadlineSeconds) && policy.deadlineSeconds >= 86400 && policy.deadlineSeconds <= 30 * 86400;
}

function isConnectedBinding(key: string, bots: ButlerBotEndpoint[]) {
  return bots.find((bot) => botSelectionKey(bot) === key)?.connected === true;
}

function canSaveButlerSetup(props: ButlerSetupFormProps) {
  const usesCore = props.transport === 'core';
  const channelWorkersConnected = usesCore || props.managedBotIds.every((key) => isConnectedBinding(key, props.bots));
  const hasChannelRoutes = props.managedBotIds.every((key) => props.sharedChatIds[key]?.trim().startsWith('oc_')
    && props.managedBotNames[key]?.trim() && props.managerBotNames[key]?.trim());
  return Boolean(props.managerBotId && isConnectedBinding(props.managerBotId, props.bots) && channelWorkersConnected
    && props.managedBotIds.length > 0 && hasValidTrackingPolicy(props.trackingPolicy) && (usesCore || hasChannelRoutes));
}

function buildManagedBotInputs(props: ButlerSetupFormProps) {
  return props.managedBotIds.flatMap((key) => {
    const bot = props.bots.find((entry) => botSelectionKey(entry) === key);
    if (!bot) return [];
    return [{ botId: bot.id, bindingId: bot.bindingId, sharedChatId: props.sharedChatIds[key]?.trim() || '',
      managedBotName: props.managedBotNames[key]?.trim() || '', managerBotName: props.managerBotNames[key]?.trim() || '' }];
  });
}

function saveButlerSetup(props: ButlerSetupFormProps) {
  const manager = props.bots.find((bot) => botSelectionKey(bot) === props.managerBotId);
  if (!manager) return;
  void props.onConfigure(manager.id, manager.bindingId, buildManagedBotInputs(props), props.transport, props.trackingPolicy);
}

function ManagedBotsField({ props, usesCore }: { props: ButlerSetupFormProps; usesCore: boolean }) {
  const { t } = useTranslation();
  const managedBots = props.bots.filter((bot) => botSelectionKey(bot) !== props.managerBotId);
  return <>
    <fieldset className="space-y-3 rounded-lg border border-border p-3" disabled={props.busy || !props.managerBotId}>
      <legend className="px-1 text-sm font-medium">{t('butler.managedBots')}</legend>
      {managedBots.map((bot) => <ManagedBotRow key={botSelectionKey(bot)} bot={bot} workspace={props.workspaces.find((entry) => entry.id === bot.workspaceId)}
        transport={props.transport} selected={props.managedBotIds.includes(botSelectionKey(bot))} sharedChatId={props.sharedChatIds[botSelectionKey(bot)] || ''}
        managedBotName={props.managedBotNames[botSelectionKey(bot)] || ''} managerBotName={props.managerBotNames[botSelectionKey(bot)] || ''} busy={props.busy}
        onToggle={props.onToggleManaged} onSharedChatChange={props.onSharedChatChange}
        onManagedBotNameChange={props.onManagedBotNameChange} onManagerBotNameChange={props.onManagerBotNameChange} />)}
      {!usesCore && <p className="text-xs text-muted-foreground">{t('butler.sharedChatHint')}</p>}
    </fieldset>
    {!usesCore && !props.managedBotIds.every((key) => isConnectedBinding(key, props.bots)) && <p className="text-sm text-amber-600 dark:text-amber-400">{t('butler.channelRequiresConnected')}</p>}
  </>;
}

function ButlerSetupForm(props: ButlerSetupFormProps) {
  const { t } = useTranslation();
  const usesCore = props.transport === 'core';
  return <>
    <Select label={t('butler.transport')} value={props.transport} onChange={(event) => props.onTransportChange(event.target.value as ButlerTransport)} disabled={props.busy}>
      <option value="core">{t('butler.transportCore')}</option><option value="channel">{t('butler.transportChannel')}</option>
    </Select>
    <p className="-mt-2 text-xs text-muted-foreground">{t(usesCore ? 'butler.transportCoreHint' : 'butler.transportChannelHint')}</p>
    <ManagedBotsField props={props} usesCore={usesCore} />
    {usesCore && <TrackingPolicyFields value={props.trackingPolicy} busy={props.busy} onChange={props.onTrackingPolicyChange} />}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">{t('butler.configurationStorageHint')}</p>
      <Button disabled={props.busy || !canSaveButlerSetup(props)} loading={props.busy} onClick={() => saveButlerSetup(props)}>{t('butler.setup')}</Button>
    </div>
  </>;
}

const defaultTrackingPolicy: ButlerTrackingPolicy = { defaultCheckIntervalSeconds: 600, checkBudget: 30, deadlineSeconds: 7 * 86400 };

export default function ButlerSetupCard({ profile, bots, workspaces, busy, onConfigure }: ButlerSetupCardProps) {
  const { t } = useTranslation();
  const [managerBotId, setManagerBotId] = useState('');
  const [managedBotIds, setManagedBotIds] = useState<string[]>([]);
  const [sharedChatIds, setSharedChatIds] = useState<Record<string, string>>({});
  const [managedBotNames, setManagedBotNames] = useState<Record<string, string>>({});
  const [managerBotNames, setManagerBotNames] = useState<Record<string, string>>({});
  const [transport, setTransport] = useState<ButlerTransport>('core');
  const [trackingPolicy, setTrackingPolicy] = useState<ButlerTrackingPolicy>(defaultTrackingPolicy);
  useEffect(() => {
    if (!profile) return;
    setManagerBotId(botSelectionKey(profile.managerBot));
    setManagedBotIds(profile.managedBots.map(botSelectionKey));
    setSharedChatIds(Object.fromEntries(profile.managedBots.map((bot) => [botSelectionKey(bot), bot.sharedChatId || ''])));
    setManagedBotNames(Object.fromEntries(profile.managedBots.map((bot) => [botSelectionKey(bot), bot.managedBotName || ''])));
    setManagerBotNames(Object.fromEntries(profile.managedBots.map((bot) => [botSelectionKey(bot), bot.managerBotName || ''])));
    setTransport(profile.transport || 'channel');
    setTrackingPolicy(profile.trackingPolicy || defaultTrackingPolicy);
  }, [profile]);
  const onManagerChange = (botId: string) => {
    setManagerBotId(botId);
    setManagedBotIds((ids) => ids.filter((key) => key !== botId));
  };
  const onToggleManaged = (botId: string) => setManagedBotIds((current) => current.includes(botId)
    ? current.filter((id) => id !== botId) : [...current, botId]);
  const onSharedChatChange = (botId: string, sharedChatId: string) => setSharedChatIds((current) => ({ ...current, [botId]: sharedChatId }));
  const onManagedBotNameChange = (botId: string, name: string) => setManagedBotNames((current) => ({ ...current, [botId]: name }));
  const onManagerBotNameChange = (botId: string, name: string) => setManagerBotNames((current) => ({ ...current, [botId]: name }));
  const { managerBot, choices: managerChoices, statusKey: managerStatus } = resolveManagerBotView(managerBotId, profile, bots);
  const managerWorkspace = managerBot && workspaces.find((workspace) => workspace.id === managerBot.workspaceId);
  return <Card className="app-panel space-y-4">
    <div className="space-y-1"><h2 className="font-semibold">{t('butler.setupTitle')}</h2><p className="text-sm text-muted-foreground">{t('butler.setupHint')}</p></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <ManagerBindingPanel managerBotId={managerBotId} managerBot={managerBot} managerChoices={managerChoices}
        managerWorkspace={managerWorkspace} managerStatus={managerStatus} busy={busy} onManagerChange={onManagerChange} />
      <ManagerRolePanel managerBot={managerBot} profile={profile} />
    </div>
    {bots.length < 2 && <p className="text-sm text-muted-foreground">{t('butler.needBots')}</p>}
    {bots.length >= 2 && <ButlerSetupForm bots={bots} workspaces={workspaces} busy={busy} onConfigure={onConfigure}
      managerBotId={managerBotId} managedBotIds={managedBotIds} sharedChatIds={sharedChatIds} managedBotNames={managedBotNames}
      managerBotNames={managerBotNames} transport={transport} trackingPolicy={trackingPolicy} onTransportChange={setTransport}
      onTrackingPolicyChange={setTrackingPolicy} onToggleManaged={onToggleManaged} onSharedChatChange={onSharedChatChange}
      onManagedBotNameChange={onManagedBotNameChange} onManagerBotNameChange={onManagerBotNameChange} />}
  </Card>;
}
