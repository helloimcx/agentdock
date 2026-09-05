import { useState } from 'react';
import { Sparkles, CheckCircle2, AlertTriangle, Search, Wrench } from 'lucide-react';
import { Button, Input, Modal } from '@/components/ui';
import { skills as skillsApi } from '@cc/core-sdk';
import type { SkillRouteMatch, SkillRouteResult } from '@cc/superai-contracts/skills';

interface SkillRouteDebugModalProps {
  open: boolean;
  onClose: () => void;
}

export function SkillRouteDebugModal({ open, onClose }: SkillRouteDebugModalProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SkillRouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await skillsApi.routeSkills({ query: query.trim() });
      setResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="技能路由与工具检测调试 (Skill Route Debugger)">
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground text-xs">
          输入用户任务或消息，测试确定性路由层（#122）的打分、规则命中情况与宿主机外部工具（Tool-Index）就绪状态。
        </p>

        <div className="flex gap-2">
          <Input
            placeholder="输入测试提示词，例如：帮我盯一下茅台 600519 的股价 / 创建条件自动化任务"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTest();
            }}
          />
          <Button onClick={handleTest} disabled={loading || !query.trim()} className="shrink-0">
            <Search className="mr-1.5 h-4 w-4" />
            {loading ? '计算中…' : '测试路由'}
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}

        {result && <RouteResultView result={result} />}

        <div className="flex justify-end pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RouteResultView({ result }: { result: SkillRouteResult }) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">路由判定结果</span>
        <span className="text-muted-foreground">
          命中技能数: {result.selectedSkills.length} / 候选数: {result.matches.length}
        </span>
      </div>

      {result.selectedSkills.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted-foreground">
          未达到选择阈值或无规则命中。该提示词将走通用 Agent 对话，不会注入专属 Skill 块。
        </div>
      ) : (
        <div className="space-y-2">
          {result.selectedSkills.map((match) => (
            <RouteMatchCard key={match.skillId} match={match} />
          ))}
        </div>
      )}
    </div>
  );
}

function RouteMatchCard({ match }: { match: SkillRouteMatch }) {
  return (
    <div className="rounded-md border bg-background p-3 shadow-xs space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <span className="font-medium text-foreground">{match.name}</span>
          <span className="font-mono text-[10px] text-muted-foreground">({match.skillId})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
            得分: {match.score}
          </span>
          {match.available ? (
            <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              工具就绪
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              缺少依赖工具
            </span>
          )}
        </div>
      </div>

      {match.matchedRules.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          <span className="text-muted-foreground">命中规则:</span>
          {match.matchedRules.map((rule, idx) => (
            <span
              key={idx}
              className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px]"
            >
              {rule}
            </span>
          ))}
        </div>
      )}

      {match.requiresTools.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" />
          <span>依赖工具:</span>
          <span className="font-mono text-foreground">{match.requiresTools.join(', ')}</span>
          {match.missingTools.length > 0 && (
            <span className="text-red-500 font-mono text-[11px]">
              (PATH 未发现: {match.missingTools.join(', ')})
            </span>
          )}
        </div>
      )}
    </div>
  );
}
