import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft, Filter } from 'lucide-react';
import { Card, Button, Badge, PageHeader, Select } from '@/components/ui';
import { getLogs } from '@/api/status';

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
  const [entries, setEntries] = useState<any[]>([]);
  const [level, setLevel] = useState('sys');
  const [limit, setLimit] = useState('100');
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getLogs({ level, limit });
      setEntries(data.entries || []);
    } finally {
      setLoading(false);
    }
  }, [level, limit]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

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
      <div className="flex flex-wrap items-center gap-3">
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
      </div>

      {/* Log entries */}
      <Card>
        {loading ? (
          <div className="text-muted-foreground animate-pulse text-sm">Loading...</div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{t('common.noData')}</p>
        ) : (
          <div className="space-y-1 max-h-[65vh] overflow-y-auto font-mono text-xs">
            {entries.map((entry, i) => (
              <div key={i} className="flex items-start gap-3 py-1.5 border-b last:border-0">
                <span className="text-muted-foreground shrink-0 w-36">{entry.time?.slice(0, 19)}</span>
                <Badge variant={levelBadge[entry.level] || 'default'}>{entry.level}</Badge>
                <span className={`${levelColors[entry.level] || 'text-gray-500'} flex-1`}>{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
