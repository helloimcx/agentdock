import type {
  SkillInfo,
  SkillSource,
  SkillScope,
  UpdateSkillResult,
  VerifySkillResult,
  SkillScanReport,
  SkillSecurityAuditResult,
} from '@cc/superai-contracts/skills';
import type { ParsedFlags, StdIo, CliContext } from './cli-helpers.js';
import { request, resolveContext, getFlag, getRequiredFlag, getBooleanFlag, print } from './cli-helpers.js';

export async function runSkillDomain(
  action: string,
  maybeId: string,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  json: boolean,
): Promise<number> {
  switch (action) {
    case 'add':
    case 'install':
      return await handleSkillAdd(maybeId, flags, env, io, json);
    case 'list':
    case 'ls':
      return await handleSkillList(flags, env, io, json);
    case 'update':
    case 'up':
      return await handleSkillUpdate(maybeId, flags, env, io, json);
    case 'del':
    case 'delete':
    case 'remove':
    case 'rm':
      return await handleSkillDelete(maybeId, flags, env, io, json);
    case 'verify':
    case 'check':
      return await handleSkillVerify(maybeId, flags, env, io, json);
    case 'scan':
    case 'audit':
      return await handleSkillScan(maybeId, flags, env, io, json);
    default:
      io.stderr.write(`Unknown skill action: "${action}". Supported actions: add, list, update, remove, verify, scan.\n`);
      return 2;
  }
}

async function handleSkillAdd(maybeId: string, flags: ParsedFlags, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  const context = resolveContext(flags, env);
  const target = maybeId || getFlag(flags, 'repo') || getFlag(flags, 'url');
  if (!target) {
    throw new Error('skill add requires a repository target, e.g. "lac skill add mattpocock/skills" or "lac skill add owner/repo@ref".');
  }

  const rawScope = getFlag(flags, 'scope') || (flags.has('workspace') ? 'workspace' : 'user');
  const targetScope: 'user' | 'workspace' = rawScope === 'workspace' ? 'workspace' : 'user';
  const ref = getFlag(flags, 'ref') || undefined;
  const skillsDir = getFlag(flags, 'skills-dir') || undefined;
  const force = getBooleanFlag(flags, 'force', false);

  const result = await request<{ installed: SkillInfo[]; skipped: string[]; source?: SkillSource }>(
    context.baseUrl,
    'POST',
    '/skills/add',
    {
      repo: target,
      ref,
      skillsDir,
      targetScope,
      workspacePath: context.workspacePath || undefined,
      workspaceId: context.workspaceId || undefined,
      force,
    },
  );

  const names = result.installed.map((s) => s.id).join(', ');
  const securityWarnings = result.installed
    .flatMap((s) => s.scanReport?.findings || [])
    .map((f) => `  [Warning: ${f.severity.toUpperCase()}] ${f.category}: ${f.message} (${f.file})`);

  const msg = [
    `Installed ${result.installed.length} skill(s) into ${targetScope} scope:`,
    ...result.installed.map((s) => `  - ${s.id} (${s.name}) -> ${s.path}`),
    result.skipped.length ? `Skipped: ${result.skipped.join(', ')}` : '',
    securityWarnings.length ? `Security Notice:\n${securityWarnings.join('\n')}` : '',
  ].filter(Boolean).join('\n');

  print(json, io.stdout, result, msg);
  return 0;
}

async function handleSkillList(flags: ParsedFlags, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  const context = resolveContext(flags, env);
  const params = new URLSearchParams();
  if (context.workspacePath) params.set('workspacePath', context.workspacePath);
  if (context.workspaceId) params.set('workspaceId', context.workspaceId);
  const query = params.toString() ? `?${params.toString()}` : '';

  const response = await request<{ skills: SkillInfo[] }>(context.baseUrl, 'GET', `/skills${query}`);
  const skills = response.skills || [];

  const installedOnly = getBooleanFlag(flags, 'installed', false);
  const filtered = installedOnly ? skills.filter((s) => s.scope !== 'builtin' && s.source) : skills;

  print(
    json,
    io.stdout,
    { skills: filtered },
    filtered.length === 0 ? 'No skills found.' : filtered.map(formatSkillLine).join('\n'),
  );
  return 0;
}

async function handleSkillUpdate(maybeId: string, flags: ParsedFlags, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  const context = resolveContext(flags, env);
  const isAll = maybeId === 'all' || getBooleanFlag(flags, 'all', false) || !maybeId;
  const id = isAll ? undefined : (maybeId || getFlag(flags, 'id'));
  const force = getBooleanFlag(flags, 'force', false);

  const result = await request<UpdateSkillResult>(
    context.baseUrl,
    'POST',
    '/skills/update',
    {
      id,
      all: isAll,
      force,
      workspacePath: context.workspacePath || undefined,
      workspaceId: context.workspaceId || undefined,
    },
  );

  const lines: string[] = [];
  if (result.updated.length > 0) {
    lines.push(`Updated ${result.updated.length} skill(s): ${result.updated.map((s) => s.id).join(', ')}`);
  }
  if (result.unchanged.length > 0) {
    lines.push(`Unchanged: ${result.unchanged.join(', ')}`);
  }
  if (result.conflicts.length > 0) {
    lines.push('Conflicts (locally-modified):');
    for (const c of result.conflicts) {
      lines.push(`  - ${c.id}: ${c.reason}`);
    }
  }
  if (lines.length === 0) {
    lines.push('No skills were updated.');
  }

  print(json, io.stdout, result, lines.join('\n'));
  return result.conflicts.length > 0 && !force ? 1 : 0;
}

async function handleSkillDelete(maybeId: string, flags: ParsedFlags, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  const context = resolveContext(flags, env);
  const id = maybeId || getRequiredFlag(flags, 'id');
  const rawScope = getFlag(flags, 'scope') || (flags.has('workspace') ? 'workspace' : 'user');
  const scope: 'user' | 'workspace' = rawScope === 'workspace' ? 'workspace' : 'user';

  const result = await request<{ success: boolean }>(
    context.baseUrl,
    'DELETE',
    '/skills',
    {
      id,
      scope,
      workspacePath: context.workspacePath || undefined,
      workspaceId: context.workspaceId || undefined,
    },
  );

  print(json, io.stdout, result, `Deleted skill "${id}" from ${scope} scope.`);
  return 0;
}

async function handleSkillVerify(maybeId: string, flags: ParsedFlags, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  const context = resolveContext(flags, env);
  const skillId = maybeId || getFlag(flags, 'id') || getFlag(flags, 'skill') || undefined;
  const params = new URLSearchParams();
  if (context.workspacePath) params.set('workspacePath', context.workspacePath);
  if (context.workspaceId) params.set('workspaceId', context.workspaceId);
  if (skillId) params.set('skillId', skillId);
  const query = params.toString() ? `?${params.toString()}` : '';

  const result = await request<VerifySkillResult>(context.baseUrl, 'GET', `/skills/verify${query}`);
  const items = result.skills || [];

  if (items.length === 0) {
    print(json, io.stdout, result, 'No tracked skill sources to verify.');
    return 0;
  }

  const lines = items.map((item) => {
    const src = item.sourceRef ? `${item.sourceRepo}@${item.sourceRef}` : item.sourceRepo;
    return `${item.id.padEnd(24)} | ${item.scope.padEnd(9)} | ${src.padEnd(30)} | ${item.status}`;
  });

  print(json, io.stdout, result, lines.join('\n'));
  return 0;
}

async function handleSkillScan(maybeId: string, flags: ParsedFlags, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  const context = resolveContext(flags, env);
  const skillId = maybeId || getFlag(flags, 'id') || getFlag(flags, 'skill') || undefined;
  const isAll = getBooleanFlag(flags, 'all', false) || !skillId;

  const params = new URLSearchParams();
  if (context.workspacePath) params.set('workspacePath', context.workspacePath);
  if (context.workspaceId) params.set('workspaceId', context.workspaceId);
  if (skillId && !isAll) params.set('skillId', skillId);

  const query = params.toString() ? `?${params.toString()}` : '';
  const result = await request<SkillScanReport | SkillSecurityAuditResult>(
    context.baseUrl,
    'GET',
    `/skills/scan${query}`,
  );

  if ('reports' in result) {
    const lines = formatAuditSummaryLines(result as SkillSecurityAuditResult);
    print(json, io.stdout, result, lines.join('\n'));
    return (result as SkillSecurityAuditResult).failedSkills > 0 ? 1 : 0;
  }

  const report = 'report' in (result as unknown as { report: SkillScanReport })
    ? (result as unknown as { report: SkillScanReport }).report
    : (result as SkillScanReport);
  const lines = formatSingleReportLines(report);
  print(json, io.stdout, report, lines.join('\n'));
  return report.passed ? 0 : 1;
}

function formatAuditSummaryLines(result: SkillSecurityAuditResult): string[] {
  const lines: string[] = [
    `Security Audit Summary (${result.totalSkills} skills scanned):`,
    `  Passed: ${result.passedSkills}, Failed/High-Risk: ${result.failedSkills}, Highest Severity: ${result.highestSeverity.toUpperCase()}`,
    `  Findings: Critical: ${result.summary.critical}, High: ${result.summary.high}, Medium: ${result.summary.medium}, Low: ${result.summary.low}`,
    '',
  ];

  for (const report of result.reports) {
    const statusIcon = report.passed ? 'PASS' : 'FAIL';
    const sev = report.highestSeverity || 'none';
    lines.push(`${report.skillId.padEnd(24)} | ${statusIcon.padEnd(6)} | ${sev.toUpperCase().padEnd(8)} | ${report.findings.length} findings`);
    for (const finding of report.findings) {
      lines.push(`    - [${finding.severity.toUpperCase()}] [${finding.category}] ${finding.message} (${finding.file}${finding.line ? `:${finding.line}` : ''})`);
    }
  }
  return lines;
}

function formatSingleReportLines(report: SkillScanReport): string[] {
  const statusIcon = report.passed ? 'PASSED' : 'FAILED';
  const lines: string[] = [
    `Security Scan for "${report.skillId}": ${statusIcon} (Highest: ${report.highestSeverity?.toUpperCase() || 'NONE'})`,
    `Findings: ${report.findings.length} total (Critical: ${report.summary.critical}, High: ${report.summary.high}, Medium: ${report.summary.medium}, Low: ${report.summary.low})`,
  ];

  if (report.findings.length > 0) {
    lines.push('');
    for (const f of report.findings) {
      lines.push(`  - [${f.severity.toUpperCase()}] [${f.category}] ${f.message}`);
      lines.push(`    File: ${f.file}${f.line ? `:${f.line}` : ''}`);
      if (f.snippet) {
        lines.push(`    Evidence: "${f.snippet}"`);
      }
    }
  }
  return lines;
}

function formatSkillLine(skill: SkillInfo): string {
  const src = skill.source
    ? (skill.source.sourceRef ? `${skill.source.sourceRepo}@${skill.source.sourceRef}` : skill.source.sourceRepo)
    : (skill.scope === 'builtin' ? 'builtin' : 'local');
  const status = skill.source?.status || (skill.scope === 'builtin' ? 'builtin' : 'clean');
  const enabledStr = skill.enabled ? 'enabled' : 'disabled';
  return `${skill.id.padEnd(24)} | ${skill.scope.padEnd(9)} | ${enabledStr.padEnd(8)} | ${src.padEnd(30)} | ${status.padEnd(16)} | ${skill.name || skill.id}`;
}
