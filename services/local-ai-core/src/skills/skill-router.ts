import type {
  SkillInfo,
  SkillRoutingRule,
  SkillRouteMatch,
  SkillRouteResult,
} from '@cc/superai-contracts/skills';
import { BUILTIN_SKILL_RULES } from './builtin-rules.js';
import { ToolIndex } from './tool-index.js';

export interface SkillRouterOptions {
  rules?: SkillRoutingRule[];
  toolIndex?: ToolIndex;
  scoreThreshold?: number;
  maxMatches?: number;
}

export class SkillRouter {
  private readonly rules: SkillRoutingRule[];
  private readonly toolIndex: ToolIndex;
  private readonly scoreThreshold: number;
  private readonly maxMatches: number;

  constructor(options: SkillRouterOptions = {}) {
    this.rules = options.rules || BUILTIN_SKILL_RULES;
    this.toolIndex = options.toolIndex || new ToolIndex();
    this.scoreThreshold = options.scoreThreshold ?? 5;
    this.maxMatches = options.maxMatches ?? 2;
  }

  route(query: string, skills: SkillInfo[]): SkillRouteResult {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return { query, matches: [], selectedSkills: [] };
    }

    const matches: SkillRouteMatch[] = [];
    for (const skill of skills) {
      if (!skill.enabled) continue;
      const match = this.evaluateSkill(normalizedQuery, skill);
      if (match) {
        matches.push(match);
      }
    }

    matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const selectedSkills = matches
      .filter((m) => m.score >= this.scoreThreshold)
      .slice(0, this.maxMatches);

    return { query, matches, selectedSkills };
  }

  private evaluateSkill(query: string, skill: SkillInfo): SkillRouteMatch | null {
    const ruleList = this.collectRulesForSkill(skill);
    if (isSkillNegated(query, ruleList)) {
      return null;
    }

    let highestScore = 0;
    const matchedRuleNotes: string[] = [];
    const requiredToolsSet = new Set<string>();

    for (const rule of ruleList) {
      if (rule.requiresTools) {
        for (const t of rule.requiresTools) requiredToolsSet.add(t);
      }

      const evaluation = evaluateRule(query, rule);
      if (evaluation.score > highestScore) {
        highestScore = evaluation.score;
      }
      if (evaluation.matchedNotes.length > 0) {
        matchedRuleNotes.push(...evaluation.matchedNotes);
      }
    }

    if (highestScore <= 0) {
      return null;
    }

    const requiredTools = Array.from(requiredToolsSet);
    const toolCheck = this.toolIndex.checkTools(requiredTools);
    return {
      skillId: skill.id,
      name: skill.name,
      score: highestScore,
      matchedRules: Array.from(new Set(matchedRuleNotes)),
      requiresTools: requiredTools,
      missingTools: toolCheck.missing,
      available: toolCheck.missing.length === 0,
    };
  }

  private collectRulesForSkill(skill: SkillInfo): SkillRoutingRule[] {
    const rules: SkillRoutingRule[] = [];

    for (const r of this.rules) {
      if (r.skillId === skill.id) {
        rules.push(r);
      }
    }

    if (Array.isArray(skill.metadata?.rules)) {
      for (const r of skill.metadata.rules) {
        rules.push({ ...r, skillId: skill.id });
      }
    }

    const inferred = inferMetadataRule(skill);
    if (inferred) {
      rules.push(inferred);
    }

    return rules;
  }
}

function inferMetadataRule(skill: SkillInfo): SkillRoutingRule | null {
  const triggers = Array.isArray(skill.metadata?.triggers) ? (skill.metadata?.triggers as string[]) : [];
  const domains = Array.isArray(skill.metadata?.domains) ? (skill.metadata?.domains as string[]) : [];
  const requiresTools = Array.isArray(skill.metadata?.requiresTools)
    ? (skill.metadata?.requiresTools as string[])
    : [];

  if (triggers.length === 0 && domains.length === 0 && requiresTools.length === 0) {
    return null;
  }

  return {
    skillId: skill.id,
    keywords: triggers,
    domains,
    requiresTools,
    priority: typeof skill.metadata?.priority === 'number' ? skill.metadata.priority : 0,
  };
}

function isSkillNegated(query: string, rules: SkillRoutingRule[]): boolean {
  for (const rule of rules) {
    if (rule.negativePatterns && isNegativeMatched(query, rule.negativePatterns)) {
      return true;
    }
  }
  return false;
}

function isNegativeMatched(query: string, patterns: string[]): boolean {
  const lowerQuery = query.toLowerCase();
  for (const neg of patterns) {
    try {
      if (new RegExp(neg, 'i').test(query)) return true;
    } catch {
      if (lowerQuery.includes(neg.toLowerCase())) return true;
    }
  }
  return false;
}

function evaluateRule(query: string, rule: SkillRoutingRule): { score: number; matchedNotes: string[] } {
  const lowerQuery = query.toLowerCase();
  let score = 0;
  const matchedNotes: string[] = [];

  if (rule.requiredGroups && rule.requiredGroups.length > 0) {
    if (!checkRequiredGroups(query, lowerQuery, rule.requiredGroups)) {
      return { score: 0, matchedNotes: [] };
    }
    score += 10;
    matchedNotes.push('required_groups');
  }

  const terms = scoreTerms(query, lowerQuery, rule);
  score += terms.score;
  matchedNotes.push(...terms.matchedNotes);

  if (score >= 5 && typeof rule.priority === 'number') {
    score += rule.priority;
  }

  return { score, matchedNotes };
}

function checkRequiredGroups(query: string, lowerQuery: string, groups: string[][]): boolean {
  for (const group of groups) {
    const matched = group.some((item) => matchTerm(item, query, lowerQuery));
    if (!matched) return false;
  }
  return true;
}

function scoreTerms(
  query: string,
  lowerQuery: string,
  rule: SkillRoutingRule,
): { score: number; matchedNotes: string[] } {
  let score = 0;
  const matchedNotes: string[] = [];

  if (rule.patterns) {
    for (const pattern of rule.patterns) {
      try {
        if (new RegExp(pattern, 'i').test(query)) {
          score += 10;
          matchedNotes.push(`pattern:${pattern.slice(0, 30)}`);
        }
      } catch {}
    }
  }

  if (rule.keywords) {
    for (const kw of rule.keywords) {
      if (kw && matchTerm(kw, query, lowerQuery)) {
        score += 5;
        matchedNotes.push(`keyword:${kw}`);
      }
    }
  }

  if (rule.domains) {
    for (const domain of rule.domains) {
      if (domain && matchTerm(domain, query, lowerQuery)) {
        score += 3;
        matchedNotes.push(`domain:${domain}`);
      }
    }
  }

  return { score, matchedNotes };
}

function matchTerm(term: string, query: string, lowerQuery: string): boolean {
  if (!term) return false;
  if (/^[a-zA-Z0-9_-]+$/.test(term)) {
    return new RegExp(`\\b${term}\\b`, 'i').test(query);
  }
  try {
    return new RegExp(term, 'i').test(query);
  } catch {
    return lowerQuery.includes(term.toLowerCase());
  }
}
