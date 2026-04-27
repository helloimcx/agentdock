import type { CommandRiskClassification, SecurityPermissionScope } from '../../../../packages/contracts/src/index.js';

export function classifyCommandRisk(command: string): CommandRiskClassification {
  const normalized = command.trim();
  const lower = normalized.toLowerCase();
  const scopes = new Set<SecurityPermissionScope>(['command.execute']);
  const reasons: string[] = [];
  let riskLevel: CommandRiskClassification['riskLevel'] = 'low';

  const highRiskPatterns = [
    /\brm\s+(-[^\s]*r|-[^\s]*f|-rf|-fr)\b/,
    /\bsudo\b/,
    /\bchmod\s+(-?R\s+)?(777|[+]s)\b/,
    /\bchown\s+(-?R\s+)?/,
    /\bgit\s+(reset|clean|push|rebase)\b/,
    /\bmkfs\b|\bdd\s+if=/,
    /\b(security|pass|op|vault)\b.*\b(read|show|get)\b/,
  ];
  const mediumRiskPatterns = [
    /\bnpm\s+(install|i|update)\b/,
    /\bpnpm\s+(add|install|update)\b/,
    /\byarn\s+(add|install|upgrade)\b/,
    /\bcurl\b|\bwget\b/,
    /\bgit\s+(checkout|merge|commit|pull)\b/,
    /\bpython\d?\s+.*-m\s+pip\s+install\b/,
  ];

  if (highRiskPatterns.some((pattern) => pattern.test(lower))) {
    riskLevel = 'high';
    reasons.push('Command matches high-risk mutation, privilege, secret, or Git state rules.');
  } else if (mediumRiskPatterns.some((pattern) => pattern.test(lower))) {
    riskLevel = 'medium';
    reasons.push('Command may modify dependencies, network state, or Git working state.');
  } else {
    reasons.push('Command does not match the current medium or high-risk rules.');
  }

  if (/\bcurl\b|\bwget\b|\bnpm\b|\bpnpm\b|\byarn\b|\bpip\b/.test(lower)) {
    scopes.add('network.access');
  }
  if (/\bgit\s+(reset|clean|push|rebase|checkout|merge|commit|pull)\b/.test(lower)) {
    scopes.add('git.modify');
  }
  if (/\brm\b|\bmv\b|\bcp\b|\bchmod\b|\bchown\b|\btouch\b|>\s*[^&]|\btee\b/.test(lower)) {
    scopes.add('workspace.write');
  }
  if (/\b(secret|token|api[_-]?key|password|vault|op\s+read|pass\s+show)\b/.test(lower)) {
    scopes.add('secrets.access');
  }

  return {
    command: normalized,
    riskLevel,
    scopes: [...scopes],
    reasons,
    requiresApproval: riskLevel !== 'low',
  };
}
