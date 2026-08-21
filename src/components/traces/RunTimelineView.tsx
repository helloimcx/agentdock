import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Coins,
  Cpu,
  Database,
  FileJson,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Zap,
  Box,
} from 'lucide-react';
import { traces as tracesApi } from '@cc/core-sdk';
import type { RunSpan, RunTraceSummary, RunSpanKind } from '@cc/superai-contracts/traces';
import { cn } from '@/lib/utils';
import { Badge, StatusPill } from '@/components/ui';

export interface RunTimelineViewProps {
  runId: string;
  className?: string;
}

export function RunTimelineView({ runId, className }: RunTimelineViewProps) {
  const [summary, setSummary] = useState<RunTraceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedSpanIds, setExpandedSpanIds] = useState<Set<string>>(new Set());

  const fetchTrace = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await tracesApi.getRunTrace(runId);
      setSummary(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (runId) {
      fetchTrace();
    }
  }, [runId, fetchTrace]);

  const toggleExpand = (spanId: string) => {
    setExpandedSpanIds((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  };

  if (loading) {
    return <div className="py-12 text-center text-xs text-muted-foreground">正在加载 ACP Trace 轨迹数据...</div>;
  }

  if (error || !summary) {
    return (
      <div className="rounded-md border border-rose-500/20 bg-rose-500/5 p-4 text-xs text-rose-600 dark:text-rose-400">
        <AlertCircle className="mr-1.5 inline h-4 w-4" />
        无法加载 Run Trace ({runId}): {error || '未查找到 Trace 记录'}
      </div>
    );
  }

  const maxDuration = Math.max(1, summary.durationMs || 1);

  return (
    <div className={cn('space-y-4 text-xs', className)}>
      {/* Top Metrics Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">执行状态</div>
          <div className="mt-1 font-semibold flex items-center gap-1.5">
            <StatusPill tone={summary.status === 'completed' ? 'success' : summary.status === 'failed' ? 'danger' : 'warning'}>
              {summary.status}
            </StatusPill>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">总耗时</div>
          <div className="mt-1 font-semibold text-foreground flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-primary" />
            {summary.durationMs ? `${(summary.durationMs / 1000).toFixed(2)}s` : '< 1s'}
          </div>
        </div>

        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">Span 节点总数</div>
          <div className="mt-1 font-semibold text-foreground flex items-center gap-1">
            <Box className="h-3.5 w-3.5 text-indigo-500" />
            {summary.totalSpans} 个阶段
          </div>
        </div>

        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">Token 用量</div>
          <div className="mt-1 font-semibold text-foreground flex items-center gap-1">
            <Cpu className="h-3.5 w-3.5 text-amber-500" />
            {summary.totalTokens ? summary.totalTokens.toLocaleString() : '0'} tokens
          </div>
        </div>

        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">预估成本</div>
          <div className="mt-1 font-semibold text-foreground flex items-center gap-1">
            <Coins className="h-3.5 w-3.5 text-emerald-500" />
            {summary.totalCostUsd !== undefined ? `$${summary.totalCostUsd.toFixed(4)}` : '$0.0000'}
          </div>
        </div>
      </div>

      {/* Spans Gantt & Timeline List */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="font-semibold text-foreground flex items-center justify-between border-b pb-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <span>ACP 执行轨迹 Timeline</span>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">Run ID: {summary.runId}</span>
        </div>

        {summary.spans.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">该 Run 暂未记录详细 Span 节点</div>
        ) : (
          <div className="space-y-2">
            {summary.spans.map((span) => {
              const isExpanded = expandedSpanIds.has(span.id);
              const durationStr = span.durationMs ? `${span.durationMs}ms` : '进行中';
              const percent = Math.min(100, Math.max(5, ((span.durationMs || 10) / maxDuration) * 100));

              return (
                <div
                  key={span.id}
                  className={cn(
                    'rounded-md border bg-muted/20 p-2.5 transition-colors',
                    span.parentSpanId && 'ml-4 border-l-2 border-l-primary/40'
                  )}
                >
                  <div
                    className="flex cursor-pointer items-center justify-between gap-2"
                    onClick={() => toggleExpand(span.id)}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <button className="text-muted-foreground hover:text-foreground">
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                      <SpanKindBadge kind={span.kind} />
                      <span className="font-medium text-foreground truncate">{span.name}</span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {/* Visual Gantt Bar */}
                      <div className="w-24 bg-muted h-2 rounded-full overflow-hidden hidden sm:block">
                        <div
                          className={cn(
                            'h-full transition-all',
                            span.kind === 'thought' && 'bg-purple-500',
                            span.kind === 'plan' && 'bg-blue-500',
                            span.kind === 'tool_call' && 'bg-amber-500',
                            span.kind === 'model_call' && 'bg-emerald-500'
                          )}
                          style={{ width: `${percent}%` }}
                        />
                      </div>

                      <span className="font-mono text-[11px] text-muted-foreground min-w-[50px] text-right">
                        {durationStr}
                      </span>
                    </div>
                  </div>

                  {/* Expanded Detail Panel */}
                  {isExpanded && (
                    <div className="mt-3 space-y-2 border-t pt-2.5 text-[11px] font-mono">
                      {span.usageJson && (
                        <div className="flex items-center gap-2 rounded bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">
                          <Cpu className="h-3.5 w-3.5" />
                          <span>Input Tokens: {span.usageJson.inputTokens || 0}</span>
                          <span>| Output Tokens: {span.usageJson.outputTokens || 0}</span>
                          <span>| Cache: {span.usageJson.cacheTokens || 0}</span>
                        </div>
                      )}

                      {span.inputJson && (
                        <div className="space-y-1">
                          <div className="text-muted-foreground font-semibold flex items-center gap-1">
                            <FileJson className="h-3 w-3" /> Input Payload:
                          </div>
                          <pre className="overflow-x-auto rounded bg-muted/60 p-2 text-[10px] leading-relaxed">
                            {typeof span.inputJson === 'string' ? span.inputJson : JSON.stringify(span.inputJson, null, 2)}
                          </pre>
                        </div>
                      )}

                      {span.outputJson && (
                        <div className="space-y-1">
                          <div className="text-muted-foreground font-semibold flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Output / Result:
                          </div>
                          <pre className="overflow-x-auto rounded bg-muted/60 p-2 text-[10px] leading-relaxed">
                            {typeof span.outputJson === 'string' ? span.outputJson : JSON.stringify(span.outputJson, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SpanKindBadge({ kind }: { kind: RunSpanKind }) {
  switch (kind) {
    case 'thought':
      return (
        <span className="inline-flex items-center rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400 border border-purple-500/20">
          <Sparkles className="mr-1 h-3 w-3" /> Thought
        </span>
      );
    case 'plan':
      return (
        <span className="inline-flex items-center rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 border border-blue-500/20">
          <Zap className="mr-1 h-3 w-3" /> Plan
        </span>
      );
    case 'tool_call':
      return (
        <span className="inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 border border-amber-500/20">
          <Activity className="mr-1 h-3 w-3" /> Tool Call
        </span>
      );
    case 'model_call':
      return (
        <span className="inline-flex items-center rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <Cpu className="mr-1 h-3 w-3" /> Model
        </span>
      );
    default:
      return null;
  }
}
