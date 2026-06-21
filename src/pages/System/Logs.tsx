import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft, Filter, Search } from 'lucide-react';
import { Card, Button, Badge, PageHeader, Select, Input } from '@/components/ui';
import { listCoreLogEntries, type CoreLogEntry } from '@cc/core-sdk/runtime';

const levelColors: Record<string, string> = {
  sys: 'text-gray-300',
  debug: 'text-gray-400',
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const levelBadge: Record<string, 'default' | 'info' | 'warning' | 'danger'> = {
  sys: 'default',
  debug: 'default',
  info: 'info',
  warn: 'warning',
  error: 'danger',
};

export default function SystemLogs() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<CoreLogEntry[]>([]);
  const [level, setLevel] = useState('sys');
  const [limit, setLimit] = useState('100');
  const [query, setQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listCoreLogEntries(level, Number(limit));
      setEntries(data.entries || []);
    } finally {
      setLoading(false);
    }
  }, [level, limit]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => {
      void fetchLogs();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, fetchLogs]);

  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => [entry.level, entry.time, entry.message].join(' ').toLowerCase().includes(needle));
  }, [entries, query]);

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title={t('system.logs')}
        description="Filtered runtime logs for troubleshooting."
        actions={(
          <Link to="/system">
            <Button variant="secondary" size="sm"><ArrowLeft size={14} /> {t('nav.system')}</Button>
          </Link>
        )}
      />

      {/* Filters */}
      <div className="app-toolbar flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-muted-foreground" />
          <Select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="w-auto"
          >
            <option value="sys">Sys</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </Select>
        </div>
        <Select
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="w-auto"
        >
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="500">500</option>
          <option value="1000">1000</option>
        </Select>
        <Button size="sm" variant="secondary" onClick={fetchLogs}>{t('common.refresh')}</Button>
        <Button
          size="sm"
          variant={autoRefresh ? 'primary' : 'secondary'}
          onClick={() => setAutoRefresh((current) => !current)}
        >
          Auto
        </Button>
        <div className="relative min-w-[16rem] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search logs"
            aria-label="Search logs"
            className="pl-9"
          />
        </div>
      </div>

      {/* Log entries */}
      <Card className="app-panel">
        {loading ? (
          <div className="text-muted-foreground animate-pulse text-sm">Loading...</div>
        ) : filteredEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{t('common.noData')}</p>
        ) : (
          <div className="max-h-[65vh] overflow-auto font-mono text-xs [scrollbar-gutter:stable]">
            {filteredEntries.map((entry, i) => (
              <div key={i} className="grid min-w-[760px] grid-cols-[9rem_5rem_minmax(0,1fr)] items-start gap-3 border-b py-2 last:border-0">
                <span className="text-muted-foreground shrink-0 w-36">{entry.time?.slice(0, 19)}</span>
                <Badge variant={levelBadge[entry.level] || 'default'}>{entry.level}</Badge>
                <span className={`${levelColors[entry.level] || 'text-gray-500'} whitespace-pre-wrap break-words`}>{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
