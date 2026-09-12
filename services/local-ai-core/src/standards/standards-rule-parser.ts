import type {
  RuleIntensityLevel,
  StandardRule,
  StandardPackMetadata,
} from '@cc/superai-contracts/standards';
import type { RenderStandardsOptions } from './standards-types.js';

const SAFETY_CARVE_OUT_REGEX =
  /\b(?:security|credential|secret|token|auth|sanitize|sanitization|validation|privilege|safety|data\s+loss|accessibility|a11y)\b/i;

const INTENSITY_ORDER: Record<RuleIntensityLevel, number> = {
  off: 0,
  lite: 1,
  full: 2,
  ultra: 3,
};

export function parseStandardPack(markdownContent: string): StandardPackMetadata {
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdownContent);
  const rawMetadata: Record<string, unknown> = {};
  let body = markdownContent;

  if (frontmatterMatch) {
    const yamlLines = frontmatterMatch[1].split('\n');
    for (const line of yamlLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        let val = trimmed.slice(colonIdx + 1).trim();
        if (val.startsWith('[') && val.endsWith(']')) {
          const items = val
            .slice(1, -1)
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
          rawMetadata[key] = items;
        } else {
          rawMetadata[key] = val.replace(/^['"]|['"]$/g, '');
        }
      }
    }
    body = frontmatterMatch[2];
  }

  const id = String(rawMetadata.id || 'standard-pack').trim();
  const name = String(rawMetadata.name || id).trim();
  const language = String(rawMetadata.language || 'general').trim();
  const version = String(rawMetadata.version || '1.0.0').trim();
  const description = String(rawMetadata.description || '').trim();
  const author = rawMetadata.author ? String(rawMetadata.author).trim() : undefined;
  const tags = Array.isArray(rawMetadata.tags) ? rawMetadata.tags.map(String) : undefined;

  const rules = extractRulesFromBody(body, id, language);

  return {
    id,
    name,
    language,
    version,
    description,
    author,
    tags,
    rules,
    rawMarkdown: markdownContent,
  };
}

function resolveMinIntensity(title: string, content: string, condition?: string): RuleIntensityLevel {
  if (condition?.includes('intensity >= ultra') || /\[ultra\]/i.test(title) || /ultra\s+only/i.test(content)) {
    return 'ultra';
  }
  if (condition?.includes('intensity >= full') || /\[full\]/i.test(title)) {
    return 'full';
  }
  return 'lite';
}

function parseRuleSection(
  section: { title: string; lines: string[] },
  packId: string,
  ruleIdx: number,
): StandardRule | null {
  const content = section.lines.join('\n').trim();
  if (!content) return null;

  let condition: string | undefined;
  const condMatch = /<important\s+if=["']([^"']+)["']>([\s\S]*?)<\/important>/i.exec(content);
  let ruleContent = content;

  if (condMatch) {
    condition = condMatch[1].trim();
    const hasSurroundingText = content.replace(condMatch[0], '').trim().length > 0;
    ruleContent = hasSurroundingText
      ? content.replace(condMatch[0], condMatch[2].trim()).trim()
      : condMatch[2].trim();
  }

  const minIntensity = resolveMinIntensity(section.title, content, condition);
  const isSafety =
    SAFETY_CARVE_OUT_REGEX.test(section.title) ||
    SAFETY_CARVE_OUT_REGEX.test(content) ||
    Boolean(condition && SAFETY_CARVE_OUT_REGEX.test(condition));

  return {
    id: `${packId}-rule-${ruleIdx}`,
    title: section.title,
    condition,
    content: ruleContent,
    minIntensity,
    isSafetyCarveOut: isSafety,
  };
}

function extractRulesFromBody(body: string, packId: string, language: string): StandardRule[] {
  const lines = body.split('\n');
  const sections: { title: string; lines: string[] }[] = [];
  let currentTitle = 'General Principles';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = /^#{2,4}\s+(.+)$/.exec(line);
    if (headingMatch) {
      if (currentLines.length > 0) {
        sections.push({ title: currentTitle, lines: currentLines });
      }
      currentTitle = headingMatch[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    sections.push({ title: currentTitle, lines: currentLines });
  }

  const rules: StandardRule[] = [];
  let ruleIdx = 1;
  for (const section of sections) {
    const rule = parseRuleSection(section, packId, ruleIdx);
    if (rule) {
      rules.push(rule);
      ruleIdx++;
    }
  }
  return rules;
}

export function renderPonytailDecisionLadder(intensity: RuleIntensityLevel): string {
  if (intensity === 'off') return '';

  return [
    '## Ponytail Decision Ladder (Priority Order When Trade-offs Conflict)',
    '1. **Level 1: System Integrity & Security** — Trust boundary validation, auth/permissions, credential protection, prevent data loss. (Non-negotiable Safety Carve-Out)',
    '2. **Level 2: Correctness & Architecture Boundaries** — Single-direction dependencies, contractual consistency, explicit domain error handling.',
    '3. **Level 3: Simplicity & Minimal Diff** — YAGNI: standard library first, reuse existing codebase functions, keep diff minimal.',
    '4. **Level 4: Measurable Performance** — Measure before optimizing; do not sacrifice safety or maintainability for premature micro-optimizations.',
    '5. **Level 5: Style & Formatting** — Follow project ESLint/Prettier rules and language idiomatic conventions.',
    '',
    '> **Safety Carve-Out Invariant**: Input sanitization, credential leak protection, authorization checks, and accessibility requirements MUST NEVER be reduced or omitted.',
  ].join('\n');
}

function isRuleAllowedByCondition(rule: StandardRule, packLanguage: string, currentLevel: number): boolean {
  if (!rule.condition) return true;
  const cond = rule.condition.trim();
  const langMatch = /^lang:([a-z0-9_-]+)$/i.exec(cond);
  if (langMatch && langMatch[1].toLowerCase() !== packLanguage.toLowerCase()) {
    return false;
  }
  const intensityMatch = /^intensity\s*>=\s*([a-z]+)$/i.exec(cond);
  if (intensityMatch) {
    const reqLevel = INTENSITY_ORDER[intensityMatch[1].toLowerCase() as RuleIntensityLevel] || 1;
    if (currentLevel < reqLevel) return false;
  }
  return true;
}

function filterApplicableRules(rules: StandardRule[], currentLevel: number, packLanguage: string): StandardRule[] {
  const result: StandardRule[] = [];
  for (const rule of rules) {
    if (!isRuleAllowedByCondition(rule, packLanguage, currentLevel)) continue;
    const ruleLevel = INTENSITY_ORDER[rule.minIntensity] || 1;
    if (currentLevel < ruleLevel && !rule.isSafetyCarveOut) continue;
    result.push(rule);
  }
  return result;
}

function renderPackRules(pack: StandardPackMetadata, applicableRules: StandardRule[]): string[] {
  const lines: string[] = [`## ${pack.name} (${pack.language})`];
  if (pack.description) {
    lines.push(`> ${pack.description}\n`);
  }
  for (const rule of applicableRules) {
    lines.push(`### ${rule.title}`);
    const isDynamicCondition =
      rule.condition &&
      !rule.condition.startsWith('lang:') &&
      !rule.condition.startsWith('intensity');

    if (isDynamicCondition) {
      lines.push(`<important if="${rule.condition}">\n${rule.content}\n</important>\n`);
    } else {
      lines.push(`${rule.content}\n`);
    }
  }
  return lines;
}

export function renderStandardsContent(options: RenderStandardsOptions): string {
  const { intensity, packs, customRules, unattended } = options;
  if (intensity === 'off' || packs.length === 0) {
    return '';
  }

  const currentLevel = INTENSITY_ORDER[intensity] || INTENSITY_ORDER.full;
  const sections: string[] = [
    '# Managed Coding Standards & Architecture Invariants',
    '',
    renderPonytailDecisionLadder(intensity),
    '',
  ];

  if (unattended) {
    sections.push(
      '<important if="unattended">\n- Mode: Unattended Automation. Minimize verbose explanations, avoid interactive questions, verify all changes with automated tests.\n</important>\n',
    );
  }

  for (const pack of packs) {
    const applicableRules = filterApplicableRules(pack.rules || [], currentLevel, pack.language);
    if (applicableRules.length > 0) {
      sections.push(...renderPackRules(pack, applicableRules));
    }
  }

  if (customRules && customRules.trim()) {
    sections.push('## Workspace Custom Rules');
    sections.push(customRules.trim());
    sections.push('');
  }

  return sections.join('\n').trim() + '\n';
}
