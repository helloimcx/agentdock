import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDesktopLogs, getRuntimePluginDiagnostics, getRuntimeStatus, readConfigFile } from '@/api/desktop';
import { cn } from '@/lib/utils';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-violet-950 dark:text-white">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600 dark:text-violet-200/70">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn('p-0', className)}>
      {(title || description || actions) && (
        <div className="flex flex-col gap-3 border-b border-violet-100 px-5 py-4 dark:border-violet-400/10 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold text-slate-950 dark:text-white">{title}</h2> : null}
            {description ? <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-violet-200/60">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </Card>
  );
}

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const statusToneClasses: Record<StatusTone, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300',
  success: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-200',
  warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200',
  danger: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200',
  info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-200',
};

export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: StatusTone }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium', statusToneClasses[tone])}>
      {children}
    </span>
  );
}

function formatRaw(raw?: string) {
  return raw?.trim() ? raw : 'No config file content available.';
}

export function AdvancedDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [runtime, setRuntime] = useState<any>(null);
  const [raw, setRaw] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [plugins, setPlugins] = useState<any>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [runtimeResult, configResult, logResult, pluginResult] = await Promise.allSettled([
        getRuntimeStatus(),
        readConfigFile(),
        getDesktopLogs(40),
        getRuntimePluginDiagnostics(),
      ]);
      if (runtimeResult.status === 'fulfilled') setRuntime(runtimeResult.value);
      if (configResult.status === 'fulfilled') setRaw(configResult.value.raw || '');
      if (logResult.status === 'fulfilled') setLogs(logResult.value || []);
      if (pluginResult.status === 'fulfilled') setPlugins(pluginResult.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close advanced diagnostics"
        className="absolute inset-0 bg-violet-950/20 backdrop-blur-[2px] dark:bg-black/45"
        onClick={onClose}
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-violet-100 bg-white shadow-2xl shadow-violet-950/15 dark:border-violet-400/10 dark:bg-[#090311]">
        <div className="flex items-start justify-between gap-4 border-b border-violet-100 px-5 py-4 dark:border-violet-400/10">
          <div>
            <h2 className="text-base font-semibold text-violet-950 dark:text-white">Advanced diagnostics</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-violet-200/60">Read-only runtime details for troubleshooting.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close advanced diagnostics">
            <X size={16} />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {error ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200">
              {error}
            </div>
          ) : null}

          <SectionCard title="Runtime" description={loading ? 'Loading diagnostics...' : 'Current local runtime state.'}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500 dark:text-violet-200/55">Phase</p>
                <p className="mt-1 font-medium text-slate-950 dark:text-white">{runtime?.phase || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-violet-200/55">Restart</p>
                <p className="mt-1 font-medium text-slate-950 dark:text-white">{runtime?.pendingRestart ? 'needed' : 'not needed'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-slate-500 dark:text-violet-200/55">Config path</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-700 dark:text-violet-100/80">
                  {runtime?.settings?.configPath || runtime?.configFile?.path || '-'}
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Plugin health" description={plugins ? `${plugins.enabledPluginCount}/${plugins.pluginCount} enabled` : 'No plugin diagnostics loaded.'}>
            <div className="space-y-2">
              {(plugins?.plugins || []).slice(0, 8).map((plugin: any) => (
                <div key={plugin.pluginId} className="flex items-center justify-between gap-3 rounded-lg border border-violet-100 px-3 py-2 dark:border-violet-400/10">
                  <span className="min-w-0 truncate text-sm text-slate-700 dark:text-violet-100">{plugin.pluginId}</span>
                  <Badge variant={plugin.health?.status === 'healthy' ? 'success' : plugin.health?.status === 'failed' ? 'danger' : 'warning'}>
                    {plugin.health?.status || 'unknown'}
                  </Badge>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Raw config" description="Read-only TOML snapshot. Edit it outside the daily UI when needed.">
            <pre className="max-h-72 overflow-auto rounded-lg border border-violet-100 bg-violet-50/60 p-3 font-mono text-xs leading-5 text-slate-700 dark:border-violet-400/10 dark:bg-black/20 dark:text-violet-100/80">
              {formatRaw(raw)}
            </pre>
          </SectionCard>

          <SectionCard
            title="Recent logs"
            actions={(
              <Link to="/system/logs" onClick={onClose}>
                <Button size="sm" variant="secondary">Open logs</Button>
              </Link>
            )}
          >
            <div className="space-y-1">
              {logs.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-violet-200/60">No logs available.</p>
              ) : logs.slice(0, 8).map((line, index) => (
                <p key={`${index}-${line}`} className="truncate font-mono text-xs text-slate-600 dark:text-violet-100/70">{line}</p>
              ))}
            </div>
          </SectionCard>
        </div>
      </aside>
    </div>
  );
}
