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

// Rules supplied via SkillRouterOptions come from the reviewed builtin set or
// workspace-owned configuration and may use regex syntax. Rules derived from
// third-party skill frontmatter are untrusted: their terms never compile to
// RegExp (prompt-injection / ReDoS vector) and only ever match literally.
interface SourcedRule {
  rule: SkillRoutingRule;
  trusted: boolean;
}

const REGEX_CACHE_LIMIT = 512;
const REGEX_CACHE = new Map<string, RegExp | null>();

function getCachedRegExp(source: string, flags = 'i'): RegExp | null {
  const key = `${flags}\u0000${source}`;
  const cached = REGEX_CACHE.get(key);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  try {
    compiled = new RegExp(source, flags);
  } catch {
    compiled = null;
  }
  if (REGEX_CACHE.size >= REGEX_CACHE_LIMIT) REGEX_CACHE.clear();
  REGEX_CACHE.set(key, compiled);
  return compiled;
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
    const ruleEntries = this.collectRulesForSkill(skill);
    if (isSkillNegated(query, ruleEntries)) {
      return null;
    }

    let highestScore = 0;
    const matchedRuleNotes: string[] = [];
    const requiredToolsSet = new Set<string>();

    for (const { rule, trusted } of ruleEntries) {
      if (rule.requiresTools) {
        for (const t of rule.requiresTools) requiredToolsSet.add(t);
      }

      const evaluation = evaluateRule(query, rule, trusted);
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

  private collectRulesForSkill(skill: SkillInfo): SourcedRule[] {
    const entries: SourcedRule[] = [];

    for (const r of this.rules) {
      if (r.skillId === skill.id) {
        entries.push({ rule: r, trusted: true });
      }
    }

    if (Array.isArray(skill.metadata?.rules)) {
      for (const r of skill.metadata.rules) {
        entries.push({ rule: { ...r, skillId: skill.id }, trusted: false });
      }
    }

    const inferred = inferMetadataRule(skill);
    if (inferred) {
      entries.push({ rule: inferred, trusted: false });
    }

    return entries;
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

function isSkillNegated(query: string, entries: SourcedRule[]): boolean {
  for (const { rule, trusted } of entries) {
    if (rule.negativePatterns && isNegativeMatched(query, rule.negativePatterns, trusted)) {
      return true;
    }
  }
  return false;
}

function isNegativeMatched(query: string, patterns: string[], trusted: boolean): boolean {
  const lowerQuery = query.toLowerCase();
  for (const neg of patterns) {
    if (!trusted) {
      if (lowerQuery.includes(neg.toLowerCase())) return true;
      continue;
    }
    const compiled = getCachedRegExp(neg);
    if (compiled ? compiled.test(query) : lowerQuery.includes(neg.toLowerCase())) return true;
  }
  return false;
}

function evaluateRule(
  query: string,
  rule: SkillRoutingRule,
  trusted: boolean,
): { score: number; matchedNotes: string[] } {
  const lowerQuery = query.toLowerCase();
  let score = 0;
  const matchedNotes: string[] = [];

  if (rule.requiredGroups && rule.requiredGroups.length > 0) {
    if (!checkRequiredGroups(query, lowerQuery, rule.requiredGroups, trusted)) {
      return { score: 0, matchedNotes: [] };
    }
    score += 10;
    matchedNotes.push('required_groups');
  }

  const terms = scoreTerms(query, lowerQuery, rule, trusted);
  score += terms.score;
  matchedNotes.push(...terms.matchedNotes);

  if (score >= 5 && typeof rule.priority === 'number') {
    score += rule.priority;
  }

  return { score, matchedNotes };
}

function checkRequiredGroups(query: string, lowerQuery: string, groups: string[][], trusted: boolean): boolean {
  for (const group of groups) {
    const matched = group.some((item) => matchTerm(item, query, lowerQuery, trusted));
    if (!matched) return false;
  }
  return true;
}

function scoreTerms(
  query: string,
  lowerQuery: string,
  rule: SkillRoutingRule,
  trusted: boolean,
): { score: number; matchedNotes: string[] } {
  let score = 0;
  const matchedNotes: string[] = [];

  if (rule.patterns) {
    for (const pattern of rule.patterns) {
      if (matchesRuleTerm(pattern, query, lowerQuery, trusted)) {
        score += 10;
        matchedNotes.push(`pattern:${pattern.slice(0, 30)}`);
      }
    }
  }

  if (rule.keywords) {
    for (const kw of rule.keywords) {
      if (kw && matchTerm(kw, query, lowerQuery, trusted)) {
        score += 5;
        matchedNotes.push(`keyword:${kw}`);
      }
    }
  }

  if (rule.domains) {
    for (const domain of rule.domains) {
      if (domain && matchTerm(domain, query, lowerQuery, trusted)) {
        score += 3;
        matchedNotes.push(`domain:${domain}`);
      }
    }
  }

  return { score, matchedNotes };
}

function matchesRuleTerm(term: string, query: string, lowerQuery: string, trusted: boolean): boolean {
  if (trusted) {
    const compiled = getCachedRegExp(term);
    if (compiled) return compiled.test(query);
    return lowerQuery.includes(term.toLowerCase());
  }
  return lowerQuery.includes(term.toLowerCase());
}

function matchTerm(term: string, query: string, lowerQuery: string, trusted: boolean): boolean {
  if (!term) return false;
  if (/^[a-zA-Z0-9_-]+$/.test(term)) {
    const compiled = getCachedRegExp(`\\b${term}\\b`);
    return compiled ? compiled.test(query) : lowerQuery.includes(term.toLowerCase());
  }
  return matchesRuleTerm(term, query, lowerQuery, trusted);
}
