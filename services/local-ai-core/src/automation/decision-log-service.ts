import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  AutomationDecisionRecord,
} from '@cc/superai-contracts';

// Completed decisions beyond MAX_COMPLETED_DECISIONS are evicted (newest
// kept); everything is additionally capped at MAX_RETAINED_DECISIONS so
// never-retrospected (pending) decisions cannot grow the log unbounded.
const MAX_COMPLETED_DECISIONS = 100;
const MAX_RETAINED_DECISIONS = 200;
// Mirrors the retro bullet rendered by appendRetrospectiveSection; the
// two-space indent keeps free-form agent text (thesis, lessons) that merely
// mentions "Status: completed" from being classified as a completed retro.
const COMPLETED_RETRO_PATTERN = /^ {2}- Status: completed/m;

export interface DecisionLogServiceOptions {
  rootDir?: string;
  getWorkspacePath?: (workspaceId: string) => string | undefined;
  store?: { getWorkspaceRegistryEntry?: (workspaceId: string) => { path?: string } | undefined };
}

export class DecisionLogService {
  private readonly rootDir?: string;
  private readonly getWorkspacePath?: (workspaceId: string) => string | undefined;
  private readonly memoryRecords = new Map<string, AutomationDecisionRecord[]>();

  constructor(options: DecisionLogServiceOptions | { getWorkspaceRegistryEntry?: (workspaceId: string) => { path?: string } | undefined } = {}) {
    if ('getWorkspaceRegistryEntry' in options && typeof options.getWorkspaceRegistryEntry === 'function') {
      this.getWorkspacePath = (id) => options.getWorkspaceRegistryEntry?.(id)?.path;
    } else {
      const opts = options as DecisionLogServiceOptions;
      this.rootDir = opts.rootDir;
      this.getWorkspacePath = opts.getWorkspacePath
        || (opts.store?.getWorkspaceRegistryEntry
          ? (id) => opts.store!.getWorkspaceRegistryEntry!(id)?.path
          : undefined);
    }
  }

  resolveDecisionsDir(workspaceId?: string, explicitWorkspacePath?: string): string {
    const base = explicitWorkspacePath
      || (workspaceId && this.getWorkspacePath ? this.getWorkspacePath(workspaceId) : undefined)
      || this.rootDir
      || process.cwd();
    return join(base, '.agentdock', 'decisions');
  }

  resolveFilePath(monitorId: string, workspaceId?: string, explicitWorkspacePath?: string): string {
    const dir = this.resolveDecisionsDir(workspaceId, explicitWorkspacePath);
    const safeId = monitorId.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return join(dir, `${safeId}.md`);
  }

  async appendDecision(record: AutomationDecisionRecord, explicitWorkspacePath?: string): Promise<void> {
    const list = this.memoryRecords.get(record.monitorId) || [];
    list.unshift(record);
    this.memoryRecords.set(record.monitorId, trimDecisionRecords(list));

    const filePath = this.resolveFilePath(record.monitorId, record.workspaceId, explicitWorkspacePath);
    let existing = '';
    try {
      existing = readFileSync(filePath, 'utf8');
    } catch {
      existing = '';
    }

    const parsed = existing.trim()
      ? splitDecisionSections(existing)
      : { header: `# Decision Log: ${record.monitorId}`, sections: [] as string[] };
    const section = renderDecisionMarkdownSection(record);
    const retained = retainDecisionSections([...parsed.sections, section]);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, [parsed.header, ...retained].join('\n\n') + '\n', 'utf8');
  }

  async recordRetrospective(
    monitorId: string,
    decisionId: string,
    outcome: NonNullable<AutomationDecisionRecord['retrospectiveOutcome']>,
    explicitWorkspacePath?: string,
  ): Promise<void> {
    const list = this.memoryRecords.get(monitorId) || [];
    const index = list.findIndex((item) => item.id === decisionId);
    const now = new Date().toISOString();

    if (index >= 0) {
      list[index] = {
        ...list[index],
        retrospectiveStatus: 'completed',
        retrospectiveEvaluatedAt: now,
        retrospectiveOutcome: outcome,
      };
      this.memoryRecords.set(monitorId, trimDecisionRecords(list));
    }

    const filePath = this.resolveFilePath(monitorId, list[0]?.workspaceId, explicitWorkspacePath);
    if (!existsSync(filePath)) return;

    let content = readFileSync(filePath, 'utf8');
    const decisionHeader = `## Decision \`${decisionId}\``;
    const headerPos = content.indexOf(decisionHeader);

    if (headerPos >= 0) {
      const nextHeaderPos = content.indexOf('\n## Decision `', headerPos + decisionHeader.length);
      const sectionContent = nextHeaderPos >= 0
        ? content.slice(headerPos, nextHeaderPos)
        : content.slice(headerPos);

      const retroSection = [
        `- **Retrospective**:`,
        `  - Status: completed (Accuracy: ${outcome.accuracy})`,
        `  - Evaluated At: ${now}`,
        `  - Realized Outcome: ${outcome.realizedOutcome}`,
        `  - Reflection: ${outcome.reflection}`,
        `  - Lessons:`,
        ...(outcome.lessons.map((l) => `    - ${l}`)),
      ].join('\n');

      const updatedSection = sectionContent.replace(
        /- \*\*Retrospective\*\*:\s*[\s\S]*?(?=(\n- \*\*|\n## |\n$|$))/,
        () => `${retroSection}\n`,
      );

      content = nextHeaderPos >= 0
        ? content.slice(0, headerPos) + updatedSection + content.slice(nextHeaderPos)
        : content.slice(0, headerPos) + updatedSection;

      writeFileSync(filePath, content, 'utf8');
    }
  }

  async listDecisions(monitorId: string, workspaceId?: string, explicitWorkspacePath?: string): Promise<AutomationDecisionRecord[]> {
    const fromMemory = this.memoryRecords.get(monitorId);
    if (fromMemory && fromMemory.length > 0) return fromMemory;

    // Parse from disk if available
    const filePath = this.resolveFilePath(monitorId, workspaceId, explicitWorkspacePath);
    if (!existsSync(filePath)) return [];

    try {
      const content = readFileSync(filePath, 'utf8');
      return parseDecisionsFromMarkdown(content, monitorId);
    } catch {
      return [];
    }
  }

  async getPriorLessons(monitorId: string, workspaceId?: string, explicitWorkspacePath?: string): Promise<string[]> {
    const decisions = await this.listDecisions(monitorId, workspaceId, explicitWorkspacePath);
    const lessons: string[] = [];
    for (const d of decisions) {
      if (d.retrospectiveOutcome?.lessons) {
        lessons.push(...d.retrospectiveOutcome.lessons);
      }
    }
    return lessons.slice(0, 10);
  }
}

function appendBulletList(lines: string[], heading: string, items?: string[]): void {
  if (!items || items.length === 0) return;
  lines.push(`- **${heading}**:`);
  for (const item of items) {
    lines.push(`  - ${item}`);
  }
}

function appendRetrospectiveSection(lines: string[], record: AutomationDecisionRecord): void {
  lines.push('- **Retrospective**:');
  const outcome = record.retrospectiveOutcome;
  if (record.retrospectiveStatus === 'completed' && outcome) {
    lines.push(`  - Status: completed (Accuracy: ${outcome.accuracy})`);
    lines.push(`  - Realized Outcome: ${outcome.realizedOutcome}`);
    lines.push(`  - Reflection: ${outcome.reflection}`);
    appendBulletList(lines, 'Lessons', outcome.lessons);
    return;
  }
  lines.push('  - Status: pending');
}

function appendDataSnapshot(lines: string[], snapshot: Record<string, unknown>): void {
  lines.push('- **Grounded Data Snapshot**:');
  for (const [k, v] of Object.entries(snapshot)) {
    lines.push(`  - ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
}

function renderDecisionMarkdownSection(record: AutomationDecisionRecord): string {
  const lines: string[] = [
    `## Decision \`${record.id}\` - ${record.createdAt}`,
    `- **Action**: ${record.action} (Confidence: ${record.confidence}%)`,
    `- **Thesis**: ${record.thesis}`,
  ];

  appendBulletList(lines, 'Bull Case', record.bullPoints);
  appendBulletList(lines, 'Bear Case', record.bearPoints);
  appendBulletList(lines, 'Key Assumptions', record.keyAssumptions);
  appendBulletList(lines, 'Invalidation Triggers', record.invalidationTriggers);
  appendDataSnapshot(lines, record.dataSnapshot);
  appendRetrospectiveSection(lines, record);

  return lines.join('\n');
}

function parseRetrospectiveOutcome(sec: string): AutomationDecisionRecord['retrospectiveOutcome'] | undefined {
  if (!COMPLETED_RETRO_PATTERN.test(sec)) {
    return undefined;
  }
  const accuracyMatch = sec.match(/Accuracy:\s*(correct|incorrect|neutral)/);
  const accuracy = (accuracyMatch?.[1] || 'neutral') as 'correct' | 'incorrect' | 'neutral';
  const outcomeMatch = sec.match(/Realized Outcome:\s*([^\n]+)/);
  const reflectionMatch = sec.match(/Reflection:\s*([^\n]+)/);
  const lessonsMatch = sec.match(/Lessons:\s*\n((?:\s*-\s*[^\n]+\n?)+)/);
  const lessons = lessonsMatch
    ? lessonsMatch[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
    : [];

  return {
    accuracy,
    realizedOutcome: outcomeMatch?.[1]?.trim() || '',
    reflection: reflectionMatch?.[1]?.trim() || '',
    lessons,
  };
}

function splitDecisionSections(content: string): { header: string; sections: string[] } {
  const chunks = content.split(/\n(?=## Decision `)/);
  if (chunks[0]?.startsWith('## Decision `')) {
    return { header: '', sections: chunks.map((chunk) => chunk.trim()) };
  }
  return { header: (chunks[0] || '').trim(), sections: chunks.slice(1).map((chunk) => chunk.trim()) };
}

function retainDecisionSections(chronologicalSections: string[]): string[] {
  const retained: string[] = [];
  let completed = 0;
  for (let index = chronologicalSections.length - 1; index >= 0; index--) {
    const section = chronologicalSections[index].trim();
    if (retained.length >= MAX_RETAINED_DECISIONS) break;
    const isCompleted = COMPLETED_RETRO_PATTERN.test(section);
    if (isCompleted) {
      if (completed >= MAX_COMPLETED_DECISIONS) continue;
      completed++;
    }
    retained.unshift(section);
  }
  return retained;
}

function trimDecisionRecords(newestFirst: AutomationDecisionRecord[]): AutomationDecisionRecord[] {
  const retained: AutomationDecisionRecord[] = [];
  let completed = 0;
  for (const record of newestFirst) {
    if (retained.length >= MAX_RETAINED_DECISIONS) break;
    if (record.retrospectiveStatus === 'completed') {
      if (completed >= MAX_COMPLETED_DECISIONS) continue;
      completed++;
    }
    retained.push(record);
  }
  return retained;
}

function parseDecisionsFromMarkdown(content: string, monitorId: string): AutomationDecisionRecord[] {
  const records: AutomationDecisionRecord[] = [];

  for (const sec of splitDecisionSections(content).sections) {
    const headerMatch = sec.match(/^## Decision `([^`]+)`\s*-\s*([^\n]+)/);
    if (!headerMatch) continue;

    const id = headerMatch[1];
    const createdAt = headerMatch[2].trim();
    const actionMatch = sec.match(/- \*\*Action\*\*:\s*([A-Z]+)\s*\(Confidence:\s*(\d+)%\)/);
    const action = (actionMatch?.[1] || 'WATCH') as AutomationDecisionRecord['action'];
    const confidence = Number(actionMatch?.[2] || '50');
    const thesisMatch = sec.match(/- \*\*Thesis\*\*:\s*([^\n]+)/);
    const thesis = thesisMatch?.[1]?.trim() || '';

    const retrospectiveOutcome = parseRetrospectiveOutcome(sec);
    const retrospectiveStatus: AutomationDecisionRecord['retrospectiveStatus'] = retrospectiveOutcome
      ? 'completed'
      : 'pending';

    records.push({
      id,
      monitorId,
      workspaceId: '',
      action,
      confidence,
      thesis,
      bullPoints: [],
      bearPoints: [],
      keyAssumptions: [],
      dataSnapshot: {},
      createdAt,
      retrospectiveStatus,
      retrospectiveOutcome,
    });
  }

  return records.reverse();
}
