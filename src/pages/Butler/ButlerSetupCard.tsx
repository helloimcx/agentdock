import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ButlerBotEndpoint, ButlerProfile } from '@cc/superai-contracts';
import { Button, Card, Input, Select } from '@/components/ui';

interface ButlerSetupCardProps {
  profile: ButlerProfile | null;
  bots: ButlerBotEndpoint[];
  busy: boolean;
  onConfigure: (managerBotId: string, managedBots: Array<{ botId: string; sharedChatId: string }>) => Promise<void>;
}

interface ManagedBotRowProps {
  bot: ButlerBotEndpoint;
  selected: boolean;
  sharedChatId: string;
  busy: boolean;
  onToggle: (botId: string) => void;
  onSharedChatChange: (botId: string, sharedChatId: string) => void;
}

function ManagedBotRow({ bot, selected, sharedChatId, busy, onToggle, onSharedChatChange }: ManagedBotRowProps) {
  const { t } = useTranslation();
  return <div className="grid gap-2 rounded-md border border-border/70 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)] sm:items-center">
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected} onChange={() => onToggle(bot.id)} disabled={busy || !bot.connected} />
      <Bot size={15} />{bot.displayName} · {bot.workspaceId}/{bot.instanceId}{!bot.connected ? ` · ${t('butler.disconnected')}` : ''}</label>
    {selected && <Input aria-label={`${t('butler.sharedChatId')} ${bot.displayName}`} label={t('butler.sharedChatId')} value={sharedChatId}
      onChange={(event) => onSharedChatChange(bot.id, event.target.value)} placeholder="oc_…" required />}
  </div>;
}

interface ButlerSetupFormProps extends ButlerSetupCardProps {
  managerBotId: string;
  managedBotIds: string[];
  sharedChatIds: Record<string, string>;
  onManagerChange: (botId: string) => void;
  onToggleManaged: (botId: string) => void;
  onSharedChatChange: (botId: string, sharedChatId: string) => void;
}

function ButlerSetupForm({ bots, busy, onConfigure, managerBotId, managedBotIds, sharedChatIds, onManagerChange, onToggleManaged, onSharedChatChange }: ButlerSetupFormProps) {
  const { t } = useTranslation();
  const managedBots = bots.filter((bot) => bot.id !== managerBotId);
  const hasSharedRoutes = managedBotIds.every((botId) => sharedChatIds[botId]?.trim().startsWith('oc_'));
  const submit = () => onConfigure(managerBotId, managedBotIds.map((botId) => ({ botId, sharedChatId: sharedChatIds[botId]?.trim() || '' })));
  return <>
    <Select aria-label={t('butler.managerBot')} label={t('butler.managerBot')} value={managerBotId} onChange={(event) => onManagerChange(event.target.value)} disabled={busy}>
      <option value="">{t('butler.chooseManagerBot')}</option>{bots.filter((bot) => bot.connected).map((bot) => <option value={bot.id} key={bot.id}>{bot.displayName} · {bot.workspaceId}/{bot.instanceId}</option>)}
    </Select>
    <fieldset className="space-y-3 rounded-lg border border-border p-3" disabled={busy || !managerBotId}>
      <legend className="px-1 text-sm font-medium">{t('butler.managedBots')}</legend>
      {managedBots.map((bot) => <ManagedBotRow key={bot.id} bot={bot} selected={managedBotIds.includes(bot.id)} sharedChatId={sharedChatIds[bot.id] || ''} busy={busy} onToggle={onToggleManaged} onSharedChatChange={onSharedChatChange} />)}
      <p className="text-xs text-muted-foreground">{t('butler.sharedChatHint')}</p>
    </fieldset>
    <Button disabled={busy || !managerBotId || managedBotIds.length === 0 || !hasSharedRoutes} loading={busy} onClick={() => void submit()}>{t('butler.setup')}</Button>
  </>;
}

export default function ButlerSetupCard({ profile, bots, busy, onConfigure }: ButlerSetupCardProps) {
  const { t } = useTranslation();
  const [managerBotId, setManagerBotId] = useState('');
  const [managedBotIds, setManagedBotIds] = useState<string[]>([]);
  const [sharedChatIds, setSharedChatIds] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!profile) return;
    setManagerBotId(profile.managerBot.id);
    setManagedBotIds(profile.managedBots.map((bot) => bot.id));
    setSharedChatIds(Object.fromEntries(profile.managedBots.map((bot) => [bot.id, bot.sharedChatId])));
  }, [profile]);
  const onManagerChange = (botId: string) => {
    setManagerBotId(botId);
    setManagedBotIds((ids) => ids.filter((id) => id !== botId));
  };
  const onToggleManaged = (botId: string) => setManagedBotIds((current) => current.includes(botId)
    ? current.filter((id) => id !== botId) : [...current, botId]);
  const onSharedChatChange = (botId: string, sharedChatId: string) => setSharedChatIds((current) => ({ ...current, [botId]: sharedChatId }));
  return <Card className="app-panel space-y-4">
    <h2 className="font-semibold">{t('butler.setupTitle')}</h2><p className="text-sm text-muted-foreground">{t('butler.setupHint')}</p>
    {bots.length < 2 ? <p className="text-sm">{t('butler.needBots')}</p> : <ButlerSetupForm profile={profile} bots={bots} busy={busy} onConfigure={onConfigure}
      managerBotId={managerBotId} managedBotIds={managedBotIds} sharedChatIds={sharedChatIds} onManagerChange={onManagerChange} onToggleManaged={onToggleManaged} onSharedChatChange={onSharedChatChange} />}
  </Card>;
}
