import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { collectFilesRecursive } from '../kernel/fs-walk.js';
import type {
  SkillScanCategory,
  SkillScanFinding,
  SkillScanReport,
  SkillScanSeverity,
  SkillScanSummary,
  SkillScope,
  SkillSecurityAuditResult,
} from '@cc/superai-contracts/skills';

export interface SecurityRule {
  id: string;
  category: SkillScanCategory;
  severity: SkillScanSeverity;
  message: string;
  pattern: RegExp;
}

export const SKILL_SECURITY_RULES: SecurityRule[] = [
  // T01: Instruction Hijacking & Prompt Injection
  {
    id: 'T01-01',
    category: 'T01_INSTRUCTION_HIJACK',
    severity: 'high',
    message: 'Prompt injection: Attempt to override or ignore system instructions.',
    pattern: /\b(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|system|above)\s+(?:instructions|prompts|rules|directives)\b/i,
  },
  {
    id: 'T01-02',
    category: 'T01_INSTRUCTION_HIJACK',
    severity: 'high',
    message: 'Prompt injection: Jailbreak roleplay or bypass directives detected.',
    pattern: /\b(?:you\s+are\s+now|act\s+as)\s+(?:an?\s+unrestricted|a\s+jailbroken|DAN|an?\s+evil)\b/i,
  },
  {
    id: 'T01-03',
    category: 'T01_INSTRUCTION_HIJACK',
    severity: 'high',
    message: 'Prompt injection: Explicit directive to bypass safety or security policies.',
    pattern: /\b(?:do\s+not\s+follow|bypass)\s+(?:any\s+)?(?:safety|security|system)\s+(?:filters|guidelines|policies|rules)\b/i,
  },
  {
    id: 'T01-04',
    category: 'T01_INSTRUCTION_HIJACK',
    severity: 'medium',
    message: 'Hidden prompt injection: Markdown comment containing directive override.',
    pattern: /<!--\s*(?:system|prompt|instruction|override|ignore)\s*:[^>]*-->/i,
  },

  // T02: Memory Poisoning
  {
    id: 'T02-01',
    category: 'T02_MEMORY_POISONING',
    severity: 'high',
    message: 'Memory poisoning: Directive to force persistent untrusted trust or rule bypass in memory.',
    pattern: /\b(?:always\s+remember\s+that|persistently\s+record\s+that|update\s+(?:workspace\s+)?memory\s+to\s+always)\s+.*(?:trust\s+untrusted|bypass\s+auth|ignore\s+security)\b/i,
  },
  {
    id: 'T02-02',
    category: 'T02_MEMORY_POISONING',
    severity: 'high',
    message: 'Memory injection: Attempt to inject malicious rules into handoff or memory context.',
    pattern: /\b(?:write|save|inject)\s+(?:to\s+)?(?:memory|handoff)\s*[:=].*(?:malicious|backdoor|exfiltrat)\b/i,
  },

  // T03: Remote Payload Download & Execution
  {
    id: 'T03-01',
    category: 'T03_REMOTE_PAYLOAD',
    severity: 'critical',
    message: 'Remote payload: Downloading and piping network content directly to shell.',
    pattern: /\b(?:curl|wget|fetch)\b[^\n|;&]*\|\s*(?:ba|z|c|da|k|t)?sh\b/i,
  },
  {
    id: 'T03-02',
    category: 'T03_REMOTE_PAYLOAD',
    severity: 'critical',
    message: 'Remote payload: Downloading network content and piping to interpreter.',
    pattern: /\b(?:curl|wget)\s+[^\n]*\|\s*(?:python\d?|node|perl|ruby)\b/i,
  },
  {
    id: 'T03-03',
    category: 'T03_REMOTE_PAYLOAD',
    severity: 'critical',
    message: 'Remote payload: Dynamic evaluation of downloaded network string.',
    pattern: /\beval\s*\(\s*(?:await\s+)?(?:`|"|')?(?:curl|wget|fetch|axios|http)/i,
  },
  {
    id: 'T03-04',
    category: 'T03_REMOTE_PAYLOAD',
    severity: 'critical',
    message: 'Remote payload: Python exec of fetched network request.',
    pattern: /\b(?:urllib\.request|requests\.get|urllib3)\b[^\n]*\bexec\s*\(/i,
  },

  // T04: Embedded Malicious Code & Destructive Calls
  {
    id: 'T04-01',
    category: 'T04_MALICIOUS_CODE',
    severity: 'critical',
    message: 'Reverse shell: Interactive shell redirected over TCP/network socket.',
    pattern: /\b(?:bash|sh|zsh)\s+-i\s+>&?\s*\/dev\/tcp\/[0-9a-zA-Z.-]+\/[0-9]+/i,
  },
  {
    id: 'T04-02',
    category: 'T04_MALICIOUS_CODE',
    severity: 'critical',
    message: 'Reverse shell: Netcat spawned shell execution.',
    pattern: /\bnc\s+(?:-e|-[a-z]*e[a-z]*)\s+\/(?:bin\/)?(?:ba|z)?sh\b/i,
  },
  {
    id: 'T04-03',
    category: 'T04_MALICIOUS_CODE',
    severity: 'critical',
    message: 'Destructive system command: Unbounded recursive file removal.',
    pattern: /\brm\s+(-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\s+(?:\/|~|\$HOME|\*|\/\*|\.\/|\.)(?:\s|$)/,
  },
  {
    id: 'T04-04',
    category: 'T04_MALICIOUS_CODE',
    severity: 'critical',
    message: 'Denial of Service: Fork bomb pattern detected.',
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  },
  {
    id: 'T04-05',
    category: 'T04_MALICIOUS_CODE',
    severity: 'critical',
    message: 'Obfuscated execution: Base64 decoded shell execution.',
    pattern: /\b(?:echo|printf)\s+['"][A-Za-z0-9+/=]{16,}['"]\s*\|\s*base64\s+-(?:d|D|-decode)\s*\|\s*(?:ba|z)?sh\b/i,
  },
  {
    id: 'T04-06',
    category: 'T04_MALICIOUS_CODE',
    severity: 'critical',
    message: 'Destructive disk format command detected.',
    pattern: /\b(?:mkfs(?:\.[a-z0-9]+)?\s+\/dev\/|dd\s+if=[^\s]+\s+of=\/dev\/(?:sd[a-z]|nvme[0-9]n[0-9]|disk[0-9]))/i,
  },

  // T05: Privilege Escalation & Credential Theft
  {
    id: 'T05-01',
    category: 'T05_PRIVILEGE_ESCALATION',
    severity: 'high',
    message: 'Privilege escalation: sudo shell invocation or permissions bypass.',
    pattern: /\bsudo\s+(?:su\b|-i\b|bash\b|sh\b|chmod\b|chown\b|visudo\b)/i,
  },
  {
    id: 'T05-02',
    category: 'T05_PRIVILEGE_ESCALATION',
    severity: 'high',
    message: 'Privilege escalation: SUID bit setting detected.',
    pattern: /\bchmod\s+(?:[+]s|4755|4777)\b/i,
  },
  {
    id: 'T05-03',
    category: 'T05_PRIVILEGE_ESCALATION',
    severity: 'critical',
    message: 'Credential theft: Accessing system shadow/passwd or private keys.',
    pattern: /\b(?:cat|head|tail|grep|less|more|cp)\s+[^\n]*(?:\/etc\/shadow|\/etc\/gshadow|\.ssh\/id_[a-z0-9]+|\.aws\/credentials|\.netrc|\.gnupg\/secring)/i,
  },
  {
    id: 'T05-04',
    category: 'T05_PRIVILEGE_ESCALATION',
    severity: 'critical',
    message: 'Credential theft: Exfiltrating environment secrets over network.',
    pattern: /\b(?:cat|grep)\s+[^\n]*\.env\b[^\n]*\|\s*(?:curl|wget|nc|http)/i,
  },
  {
    id: 'T05-05',
    category: 'T05_PRIVILEGE_ESCALATION',
    severity: 'high',
    message: 'Credential theft: System keychain or secret vault extraction command.',
    pattern: /\b(?:security\s+find-generic-password|security\s+find-internet-password|op\s+read|op\s+item\s+get|vault\s+kv\s+get)\b/i,
  },

  // T06: System Persistence
  {
    id: 'T06-01',
    category: 'T06_PERSISTENCE',
    severity: 'high',
    message: 'Persistence: Appending instructions to user shell startup rc files.',
    pattern: /(?:>>|>|\btee\s+(?:-a\s+)?)\s*(?:~|\$HOME|\/home\/[^\s\/]+|\/root)\/\.(?:bashrc|zshrc|profile|bash_profile|zprofile)\b/i,
  },
  {
    id: 'T06-02',
    category: 'T06_PERSISTENCE',
    severity: 'high',
    message: 'Persistence: Modifying cron jobs or crontab schedule.',
    pattern: /(?:>>|>|\btee\b)\s*\/etc\/cron(?:d|\.d|\.daily|\.hourly)?\/|\bcrontab\s+-[elr]\b/i,
  },
  {
    id: 'T06-03',
    category: 'T06_PERSISTENCE',
    severity: 'high',
    message: 'Persistence: Creating systemd or launchd startup daemons.',
    pattern: /(?:>>|>|\btee\b)\s*(?:\/etc\/systemd\/system|\/Library\/LaunchDaemons|\/Library\/LaunchAgents|~\/Library\/LaunchAgents)\/|\b(?:systemctl\s+enable|launchctl\s+load)\b/i,
  },

  // T07: Tool Hijacking & Forgery
  {
    id: 'T07-01',
    category: 'T07_TOOL_HIJACK',
    severity: 'high',
    message: 'Tool hijacking: Prepending insecure directory to PATH.',
    pattern: /\bexport\s+PATH=(?:\/tmp|\.\/|\.\b|~?\/\.tmp)[^:\n]*:\$PATH\b/i,
  },
  {
    id: 'T07-02',
    category: 'T07_TOOL_HIJACK',
    severity: 'high',
    message: 'Tool hijacking: Overriding core system or CLI tools via alias.',
    pattern: /\balias\s+(?:git|ssh|sudo|curl|node|python|docker|lac)=/i,
  },

  // T08: Insecure Dependencies
  {
    id: 'T08-01',
    category: 'T08_INSECURE_DEPENDENCIES',
    severity: 'medium',
    message: 'Insecure dependency: Installing packages from unencrypted HTTP repository.',
    pattern: /\b(?:pip\s+install\s+[^\n]*--extra-index-url\s+http:\/\/|npm\s+install\s+[^\n]*--registry\s+http:\/\/)/i,
  },
  {
    id: 'T08-02',
    category: 'T08_INSECURE_DEPENDENCIES',
    severity: 'medium',
    message: 'Insecure dependency: Unverified remote package list dynamic download.',
    pattern: /\bcurl\s+[^\n]+\s+>\s+requirements\.txt\s*(?:&&|;)\s*pip\s+install/i,
  },

  // T09: Insecure Coding Practices & Exposed Secrets
  {
    id: 'T09-01',
    category: 'T09_INSECURE_PRACTICES',
    severity: 'medium',
    message: 'Insecure coding: Disabling TLS/SSL certificate verification.',
    pattern: /\b(?:curl\s+[^\n]*(?:-k\b|--insecure\b)|wget\s+[^\n]*--no-check-certificate\b|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0['"]?|verify\s*=\s*False\b|rejectUnauthorized\s*:\s*false\b)/i,
  },
  {
    id: 'T09-02',
    category: 'T09_INSECURE_PRACTICES',
    severity: 'medium',
    message: 'Insecure coding: Overly permissive file permissions (777/666/a+rwx).',
    pattern: /\bchmod\s+(?:-R\s+)?(?:777|666|a\+rwx)\b/i,
  },
  {
    id: 'T09-03',
    category: 'T09_INSECURE_PRACTICES',
    severity: 'high',
    message: 'Exposed secret: Hardcoded private key in source.',
    pattern: /-----BEGIN\s+(?:RSA|OPENSSH|EC|DSA|PRIVATE)?\s*KEY-----/,
  },
  {
    id: 'T09-04',
    category: 'T09_INSECURE_PRACTICES',
    severity: 'high',
    message: 'Exposed secret: Hardcoded API key or token pattern.',
    pattern: /\b(?:sk-[a-zA-Z0-9_-]{24,}|ghp_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}|AKIA[0-9A-Z]{16})\b/,
  },
];

const SEVERITY_RANKS: Record<SkillScanSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export function compareSeverity(a: SkillScanSeverity | 'none', b: SkillScanSeverity | 'none'): number {
  const rankA = a === 'none' ? -1 : SEVERITY_RANKS[a];
  const rankB = b === 'none' ? -1 : SEVERITY_RANKS[b];
  return rankA - rankB;
}

export function scanSkillContent(content: string, relativePath: string = 'SKILL.md'): SkillScanFinding[] {
  const findings: SkillScanFinding[] = [];
  const lines = content.split('\n');

  for (let idx = 0; idx < lines.length; idx++) {
    const lineContent = lines[idx];
    const lineNumber = idx + 1;

    for (const rule of SKILL_SECURITY_RULES) {
      if (rule.pattern.test(lineContent)) {
        findings.push({
          id: rule.id,
          category: rule.category,
          severity: rule.severity,
          message: rule.message,
          snippet: lineContent.trim(),
          file: relativePath,
          line: lineNumber,
        });
      }
    }
  }

  // Multi-line scan for full block patterns
  for (const rule of SKILL_SECURITY_RULES) {
    if (rule.id === 'T09-03') {
      if (rule.pattern.test(content)) {
        const alreadyFound = findings.some((f) => f.id === rule.id && f.file === relativePath);
        if (!alreadyFound) {
          findings.push({
            id: rule.id,
            category: rule.category,
            severity: rule.severity,
            message: rule.message,
            file: relativePath,
          });
        }
      }
    }
  }

  return findings;
}

export function scanSkillDirectory(skillDir: string, skillId: string = 'skill', scope?: SkillScope): SkillScanReport {
  const findings: SkillScanFinding[] = [];
  const resolvedDir = resolve(skillDir);

  if (existsSync(resolvedDir)) {
    const filesToScan = collectFilesRecursive(resolvedDir, isScannableFile);

    for (const file of filesToScan) {
      try {
        const content = readFileSync(file, 'utf8');
        const rel = relative(resolvedDir, file).replace(/\\/g, '/');
        const fileFindings = scanSkillContent(content, rel);
        findings.push(...fileFindings);
      } catch {
        // Skip unreadable files
      }
    }
  }

  const summary = summarizeFindings(findings);
  const highestSeverity = calculateHighestSeverity(findings);
  const passed = summary.critical === 0 && summary.high === 0;

  return {
    skillId,
    scope,
    path: resolvedDir,
    scannedAt: new Date().toISOString(),
    passed,
    highestSeverity,
    findings,
    summary,
  };
}

const SCANNABLE_EXTENSIONS = new Set([
  '.md', '.sh', '.bash', '.py', '.js', '.ts', '.mjs', '.json', '.yaml', '.yml', '.txt',
]);

function isScannableFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === 'skill') return true;
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx === -1) return false;
  return SCANNABLE_EXTENSIONS.has(lower.slice(dotIdx));
}

export function summarizeFindings(findings: SkillScanFinding[]): SkillScanSummary {
  const summary: SkillScanSummary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  for (const finding of findings) {
    if (finding.severity in summary) {
      summary[finding.severity]++;
    }
  }

  return summary;
}

export function calculateHighestSeverity(findings: SkillScanFinding[]): SkillScanSeverity | 'none' {
  if (findings.length === 0) return 'none';
  let highest: SkillScanSeverity = 'info';
  for (const finding of findings) {
    if (compareSeverity(finding.severity, highest) > 0) {
      highest = finding.severity;
    }
  }
  return highest;
}

export function aggregateAuditResults(reports: SkillScanReport[]): SkillSecurityAuditResult {
  const totalSkills = reports.length;
  let passedSkills = 0;
  let failedSkills = 0;
  let highestSeverity: SkillScanSeverity | 'none' = 'none';

  const totalSummary: SkillScanSummary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  for (const report of reports) {
    if (report.passed) {
      passedSkills++;
    } else {
      failedSkills++;
    }

    if (report.highestSeverity && compareSeverity(report.highestSeverity, highestSeverity) > 0) {
      highestSeverity = report.highestSeverity;
    }

    totalSummary.critical += report.summary.critical;
    totalSummary.high += report.summary.high;
    totalSummary.medium += report.summary.medium;
    totalSummary.low += report.summary.low;
    totalSummary.info += report.summary.info;
  }

  return {
    totalSkills,
    passedSkills,
    failedSkills,
    highestSeverity,
    reports,
    summary: totalSummary,
  };
}

export class SkillSecurityError extends Error {
  readonly report: SkillScanReport;

  constructor(message: string, report: SkillScanReport) {
    super(message);
    this.name = 'SkillSecurityError';
    this.report = report;
  }
}
