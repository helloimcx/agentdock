import { useState } from 'react';
import {
  ArrowRight,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  FileCode,
  HelpCircle,
  ListChecks,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SessionHandoffCardProps {
  fromAgent: string;
  toAgent?: string;
  body: string;
  className?: string;
}

interface ParsedHandoff {
  summary: string;
  decisions: string[];
  artifacts: string[];
  openQuestions: string[];
  nextSteps: string[];
}

function parseHandoffBody(body: string): ParsedHandoff {
  const lines = body.split('\n');
  let summary = '';
  const decisions: string[] = [];
  const artifacts: string[] = [];
  const openQuestions: string[] = [];
  const nextSteps: string[] = [];

  let currentSection: 'none' | 'decisions' | 'artifacts' | 'questions' | 'steps' = 'none';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('Summary:')) {
      summary = line.replace('Summary:', '').trim();
      currentSection = 'none';
      continue;
    }
    if (line.startsWith('Key Decisions:')) {
      currentSection = 'decisions';
      continue;
    }
    if (line.startsWith('Artifacts & Modified Files:')) {
      currentSection = 'artifacts';
      continue;
    }
    if (line.startsWith('Open Questions / Pending Issues:')) {
      currentSection = 'questions';
      continue;
    }
    if (line.startsWith('Suggested Next Steps:')) {
      currentSection = 'steps';
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      const item = line.slice(2).trim();
      if (currentSection === 'decisions') decisions.push(item);
      else if (currentSection === 'artifacts') artifacts.push(item);
      else if (currentSection === 'questions') openQuestions.push(item);
      else if (currentSection === 'steps') nextSteps.push(item);
      else if (!summary) summary = item;
    }
  }

  return { summary, decisions, artifacts, openQuestions, nextSteps };
}

function SessionHandoffDetails({ parsed }: { parsed: ParsedHandoff }) {
  return (
    <div className="border-t border-primary/15 px-3.5 py-3 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
      {parsed.summary ? (
        <div className="mb-2.5 flex items-start gap-2">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-primary" />
          <div>
            <p className="font-semibold text-slate-900 dark:text-slate-100">交接提炼摘要</p>
            <p className="mt-0.5 text-slate-600 dark:text-slate-300">{parsed.summary}</p>
          </div>
        </div>
      ) : null}

      {parsed.decisions.length > 0 ? (
        <div className="mb-2.5">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
            <ListChecks size={13} className="text-emerald-500" />
            <span>关键技术决策</span>
          </div>
          <ul className="list-inside list-disc space-y-0.5 pl-1 text-slate-600 dark:text-slate-300">
            {parsed.decisions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {parsed.artifacts.length > 0 ? (
        <div className="mb-2.5">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
            <FileCode size={13} className="text-blue-500" />
            <span>修改文件与产物</span>
          </div>
          <div className="flex flex-wrap gap-1.5 pl-1">
            {parsed.artifacts.map((a, i) => (
              <span
                key={i}
                className="rounded bg-slate-200/70 px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-white/10 dark:text-slate-200"
              >
                {a}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {parsed.openQuestions.length > 0 ? (
        <div className="mb-2.5">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
            <HelpCircle size={13} className="text-amber-500" />
            <span>未决问题与风险</span>
          </div>
          <ul className="list-inside list-disc space-y-0.5 pl-1 text-slate-600 dark:text-slate-300">
            {parsed.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {parsed.nextSteps.length > 0 ? (
        <div>
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
            <ArrowRight size={13} className="text-primary" />
            <span>建议下一步</span>
          </div>
          <ul className="list-inside list-disc space-y-0.5 pl-1 text-slate-600 dark:text-slate-300">
            {parsed.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function SessionHandoffCard({
  fromAgent,
  toAgent,
  body,
  className,
}: SessionHandoffCardProps) {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseHandoffBody(body);

  return (
    <div
      data-testid="session-handoff-card"
      className={cn(
        'mb-3 overflow-hidden rounded-[16px] border border-primary/20 bg-primary/5 dark:border-primary/20 dark:bg-primary/[0.04]',
        className,
      )}
    >
      <div
        className="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 transition hover:bg-primary/10 dark:hover:bg-primary/[0.08]"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary dark:text-primary">
            <ArrowRightLeft size={13} />
          </span>
          <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-slate-200">
            <span className="truncate">跨 Agent 会话交接</span>
            <span className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:bg-white/10 dark:text-slate-300">
              {fromAgent}
            </span>
            {toAgent ? (
              <>
                <ArrowRight size={11} className="text-slate-400" />
                <span className="rounded bg-primary/20 px-1.5 py-0.5 font-mono text-[10px] text-primary dark:text-primary">
                  {toAgent}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {expanded ? '收起交接上下文' : '查看交接上下文'}
          </span>
          <button
            type="button"
            aria-expanded={expanded}
            className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </div>

      {expanded ? <SessionHandoffDetails parsed={parsed} /> : null}
    </div>
  );
}
