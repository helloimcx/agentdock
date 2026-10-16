import { useEffect, useState } from 'react';
import { Bot, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ButlerBotEndpoint, ButlerProfile, WorkspaceSummary } from '@cc/superai-contracts';
import { Badge, Button, Card, Input, Select } from '@/components/ui';
import { butlerChatHref } from './butler-page-model';

interface ButlerSetupCardProps {
  profile: ButlerProfile | null;
  bots: ButlerBotEndpoint[];
  workspaces: WorkspaceSummary[];
  busy: boolean;
  onConfigure: (managerBotId: string, managedBots: Array<{ botId: string; sharedChatId: string; managedBotName: string; managerBotName: string }>) => Promise<unknown>;
}

interface ManagedBotRowProps {
  bot: ButlerBotEndpoint;
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

function ManagedBotRow({ bot, selected, sharedChatId, managedBotName, managerBotName, busy, onToggle,
  onSharedChatChange, onManagedBotNameChange, onManagerBotNameChange }: ManagedBotRowProps) {
  const { t } = useTranslation();
  return <div className="grid gap-2 rounded-md border border-border/70 p-3">
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected} onChange={() => onToggle(bot.id)} disabled={busy || !bot.connected} />
      <Bot size={15} />{bot.displayName} · {bot.workspaceId}/{bot.instanceId}{!bot.connected ? ` · ${t('butler.disconnected')}` : ''}</label>
    {selected && <div className="grid gap-2 lg:grid-cols-3">
      <Input aria-label={`${t('butler.managedBotName')} ${bot.displayName}`} label={t('butler.managedBotName')} value={managedBotName}
        onChange={(event) => onManagedBotNameChange(bot.id, event.target.value)} placeholder={bot.displayName} required />
      <Input aria-label={`${t('butler.managerBotName')} ${bot.displayName}`} label={t('butler.managerBotName')} value={managerBotName}
        onChange={(event) => onManagerBotNameChange(bot.id, event.target.value)} placeholder={t('butler.managerBotNamePlaceholder')} required />
      <Input aria-label={`${t('butler.sharedChatId')} ${bot.displayName}`} label={t('butler.sharedChatId')} value={sharedChatId}
        onChange={(event) => onSharedChatChange(bot.id, event.target.value)} placeholder="oc_…" required />
    </div>}
  </div>;
}

interface ButlerSetupFormProps {
  bots: ButlerBotEndpoint[];
  busy: boolean;
  onConfigure: ButlerSetupCardProps['onConfigure'];
  managerBotId: string;
  managedBotIds: string[];
  sharedChatIds: Record<string, string>;
  managedBotNames: Record<string, string>;
  managerBotNames: Record<string, string>;
  onToggleManaged: (botId: string) => void;
  onSharedChatChange: (botId: string, sharedChatId: string) => void;
  onManagedBotNameChange: (botId: string, name: string) => void;
  onManagerBotNameChange: (botId: string, name: string) => void;
}

interface ManagerBotView {
  managerBot?: ButlerBotEndpoint;
  choices: ButlerBotEndpoint[];
  statusKey: string;
}

function resolveManagerBotView(managerBotId: string, profile: ButlerProfile | null, bots: ButlerBotEndpoint[]): ManagerBotView {
  const discovered = bots.find((bot) => bot.id === managerBotId);
  const profileManagerIsSelected = profile?.managerBot.id === managerBotId;
  const managerBot = discovered || (profileManagerIsSelected ? { ...profile.managerBot, connected: false } : undefined);
  const choices = bots.filter((bot) => bot.connected || bot.id === managerBotId);
  if (profileManagerIsSelected && !choices.some((bot) => bot.id === managerBotId)) choices.push({ ...profile.managerBot, connected: false });
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
      <option value="">{t('butler.chooseManagerBot')}</option>{managerChoices.map((bot) => <option value={bot.id} key={bot.id} disabled={!bot.connected}>{bot.displayName} · {bot.workspaceId}/{bot.instanceId}{!bot.connected ? ` · ${t(managerStatus)}` : ''}</option>)}
    </Select>
    {managerBot && <div className="space-y-3 rounded-lg border border-border/70 p-3">
      <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{t('butler.bindingTitle')}</span><Badge variant={managerBot.connected ? 'success' : 'warning'}>{t(managerStatus)}</Badge></div>
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
  const canOpenChat = Boolean(profile && managerBot && profile.managerBot.id === managerBot.id);
  return <div className="flex flex-col justify-between gap-3 rounded-lg border border-primary/20 bg-primary/[0.035] p-4">
    <div><div className="flex items-center gap-2"><Bot size={17} className="text-primary" /><h3 className="font-medium">{managerBot?.displayName || t('butler.managerBot')}</h3></div><p className="mt-2 text-sm text-muted-foreground">{t('butler.managerRoleHint')}</p></div>
    {canOpenChat && profile && <Button asChild size="sm" variant="secondary" className="self-start"><Link to={butlerChatHref(profile.workspaceId, profile.threadId)}><MessageCircle size={15} />{t('butler.openChat')}</Link></Button>}
  </div>;
}

function ButlerSetupForm({ bots, busy, onConfigure, managerBotId, managedBotIds, sharedChatIds, managedBotNames, managerBotNames,
  onToggleManaged, onSharedChatChange, onManagedBotNameChange, onManagerBotNameChange }: ButlerSetupFormProps) {
  const { t } = useTranslation();
  const managedBots = bots.filter((bot) => bot.id !== managerBotId);
  const hasSharedRoutes = managedBotIds.every((botId) => sharedChatIds[botId]?.trim().startsWith('oc_')
    && managedBotNames[botId]?.trim() && managerBotNames[botId]?.trim());
  const submit = () => onConfigure(managerBotId, managedBotIds.map((botId) => ({ botId,
    sharedChatId: sharedChatIds[botId]?.trim() || '', managedBotName: managedBotNames[botId]?.trim() || '',
    managerBotName: managerBotNames[botId]?.trim() || '' })));
  return <>
    <fieldset className="space-y-3 rounded-lg border border-border p-3" disabled={busy || !managerBotId}>
      <legend className="px-1 text-sm font-medium">{t('butler.managedBots')}</legend>
      {managedBots.map((bot) => <ManagedBotRow key={bot.id} bot={bot} selected={managedBotIds.includes(bot.id)} sharedChatId={sharedChatIds[bot.id] || ''}
        managedBotName={managedBotNames[bot.id] || ''} managerBotName={managerBotNames[bot.id] || ''} busy={busy} onToggle={onToggleManaged}
        onSharedChatChange={onSharedChatChange} onManagedBotNameChange={onManagedBotNameChange} onManagerBotNameChange={onManagerBotNameChange} />)}
      <p className="text-xs text-muted-foreground">{t('butler.sharedChatHint')}</p>
    </fieldset>
    <Button disabled={busy || !managerBotId || managedBotIds.length === 0 || !hasSharedRoutes} loading={busy} onClick={() => void submit()}>{t('butler.setup')}</Button>
  </>;
}

export default function ButlerSetupCard({ profile, bots, workspaces, busy, onConfigure }: ButlerSetupCardProps) {
  const { t } = useTranslation();
  const [managerBotId, setManagerBotId] = useState('');
  const [managedBotIds, setManagedBotIds] = useState<string[]>([]);
  const [sharedChatIds, setSharedChatIds] = useState<Record<string, string>>({});
  const [managedBotNames, setManagedBotNames] = useState<Record<string, string>>({});
  const [managerBotNames, setManagerBotNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!profile) return;
    setManagerBotId(profile.managerBot.id);
    setManagedBotIds(profile.managedBots.map((bot) => bot.id));
    setSharedChatIds(Object.fromEntries(profile.managedBots.map((bot) => [bot.id, bot.sharedChatId])));
    setManagedBotNames(Object.fromEntries(profile.managedBots.map((bot) => [bot.id, bot.managedBotName || ''])));
    setManagerBotNames(Object.fromEntries(profile.managedBots.map((bot) => [bot.id, bot.managerBotName || ''])));
  }, [profile]);
  const onManagerChange = (botId: string) => {
    setManagerBotId(botId);
    setManagedBotIds((ids) => ids.filter((id) => id !== botId));
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
        <ManagerBindingPanel managerBotId={managerBotId} managerBot={managerBot} managerChoices={managerChoices} managerWorkspace={managerWorkspace} managerStatus={managerStatus} busy={busy} onManagerChange={onManagerChange} />
        <ManagerRolePanel managerBot={managerBot} profile={profile} />
      </div>
      {bots.length < 2 && <p className="text-sm text-muted-foreground">{t('butler.needBots')}</p>}
      {bots.length >= 2 && <>
      <ButlerSetupForm bots={bots} busy={busy} onConfigure={onConfigure}
        managerBotId={managerBotId} managedBotIds={managedBotIds} sharedChatIds={sharedChatIds} managedBotNames={managedBotNames} managerBotNames={managerBotNames}
        onToggleManaged={onToggleManaged} onSharedChatChange={onSharedChatChange} onManagedBotNameChange={onManagedBotNameChange} onManagerBotNameChange={onManagerBotNameChange} />
      </>}
  </Card>;
}
