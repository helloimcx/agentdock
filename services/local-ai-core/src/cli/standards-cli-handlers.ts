import { existsSync, readFileSync } from 'node:fs';
import type {
  StandardPackInfo,
  StandardPackMetadata,
  StandardPackScanReport,
  MaterializeStandardsResult,
  RuleIntensityLevel,
  DetectedTechStack,
} from '@cc/superai-contracts/standards';
import type { DesktopStandardsOptions } from '@cc/superai-contracts';
import type { ParsedFlags, StdIo, CliContext } from './cli-helpers.js';
import {
  request,
  resolveContext,
  getFlag,
  getRequiredFlag,
  getBooleanFlag,
  print,
} from './cli-helpers.js';

export async function runRulesDomain(
  action: string,
  maybeId: string,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  json: boolean,
): Promise<number> {
  switch (action) {
    case 'list':
    case 'ls':
      return await handleRulesList(flags, env, io, json);
    case 'add':
    case 'install':
      return await handleRulesAdd(maybeId, flags, env, io, json);
    case 'del':
    case 'delete':
    case 'remove':
    case 'rm':
      return await handleRulesRemove(maybeId, flags, env, io, json);
    case 'scan':
    case 'audit':
      return await handleRulesScan(maybeId, flags, env, io, json);
    case 'materialize':
    case 'apply':
    case 'sync':
      return await handleRulesMaterialize(flags, env, io, json);
    case 'set-intensity':
      return await handleRulesSetIntensity(maybeId, flags, env, io, json);
    case 'detect':
      return await handleRulesDetect(flags, env, io, json);
    default:
      io.stderr.write(
        `Unknown rules action: "${action}". Supported actions: list, add, remove, scan, materialize, set-intensity, detect.\n`,
      );
      return 2;
  }
}

async function handleRulesList(flags: ParsedFlags, env: NodeJS.ProcessEnv, io: StdIo, json: boolean): Promise<number> {
  const context = resolveContext(flags, env);
  const params = new URLSearchParams();
  if (context.workspaceId) params.set('workspaceId', context.workspaceId);
  if (context.workspacePath) params.set('workspacePath', context.workspacePath);
  const query = params.toString() ? `?${params.toString()}` : '';

  const response = await request<{ packs: StandardPackInfo[] }>(context.baseUrl, 'GET', `/standards/packs${query}`);
  const packs = response.packs || [];

  const lines = packs.map((p) => {
    const status = p.enabled ? '[enabled]' : '[disabled]';
    const intensity = p.intensity ? `(${p.intensity})` : '';
    return `${p.id.padEnd(18)} ${p.name.padEnd(26)} ${p.scope.padEnd(10)} ${status.padEnd(11)} ${intensity}`.trim();
  });

  print(
    json,
    io.stdout,
    { packs },
    packs.length === 0
      ? 'No standard packs available.'
      : `ID                 NAME                       SCOPE      STATUS      INTENSITY\n${'-'.repeat(75)}\n${lines.join('\n')}`,
  );
  return 0;
}

async function handleRulesAdd(
  maybeId: string,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  json: boolean,
): Promise<number> {
  const context = resolveContext(flags, env);
  const target = maybeId || getFlag(flags, 'target') || getFlag(flags, 'file') || getFlag(flags, 'repo');
  if (!target) {
    throw new Error('rules add requires a pack path or identifier, e.g. "lac rules add ./my-rules.md" or "lac rules add typescript"');
  }

  const rawScope = getFlag(flags, 'scope') || (flags.has('workspace') ? 'workspace' : 'user');
  const scope: 'user' | 'workspace' = rawScope === 'workspace' ? 'workspace' : 'user';
  const force = getBooleanFlag(flags, 'force', false);

  let rawContent: string | undefined;
  if (existsSync(target)) {
    rawContent = readFileSync(target, 'utf8');
  }

  try {
    const response = await request<{ pack: StandardPackInfo }>(context.baseUrl, 'POST', '/standards/packs', {
      repoOrUrl: target,
      rawContent,
      scope,
      workspacePath: context.workspacePath || undefined,
      workspaceId: context.workspaceId || undefined,
      force,
    });

    print(
      json,
      io.stdout,
      response,
      `Successfully added rule pack: ${response.pack.id} (${response.pack.name}) [scope: ${response.pack.scope}]`,
    );
    return 0;
  } catch (err: any) {
    io.stderr.write(`Failed to add rule pack: ${err.message}\n`);
    return 1;
  }
}

async function handleRulesRemove(
  maybeId: string,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  json: boolean,
): Promise<number> {
  const context = resolveContext(flags, env);
  const packId = maybeId || getRequiredFlag(flags, 'id');
  const rawScope = getFlag(flags, 'scope') || (flags.has('workspace') ? 'workspace' : 'user');
  const scope = rawScope === 'workspace' ? 'workspace' : 'user';

  const params = new URLSearchParams();
  params.set('scope', scope);
  if (context.workspaceId) params.set('workspaceId', context.workspaceId);
  if (context.workspacePath) params.set('workspacePath', context.workspacePath);

  const response = await request<{ ok: boolean; removedPackId: string }>(
    context.baseUrl,
    'DELETE',
    `/standards/packs/${encodeURIComponent(packId)}?${params.toString()}`,
  );

  print(json, io.stdout, response, `Removed rule pack: ${response.removedPackId} [scope: ${scope}]`);
  return 0;
}

async function handleRulesScan(
  maybeId: string,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  json: boolean,
): Promise<number> {
  const context = resolveContext(flags, env);
  const target = maybeId || getFlag(flags, 'file') || getFlag(flags, 'target');
  if (!target) {
    throw new Error('rules scan requires a file path or pack identifier to scan.');
  }

  let content = '';
  let packId = target;
  if (existsSync(target)) {
    content = readFileSync(target, 'utf8');
  } else {
    // Try getting pack from server
    try {
      const pack = await request<StandardPackMetadata>(
        context.baseUrl,
        'GET',
        `/standards/packs/${encodeURIComponent(target)}`,
      );
      content = pack.rawMarkdown || '';
      packId = pack.id;
    } catch {
      content = target;
    }
  }

  const report = await request<StandardPackScanReport>(context.baseUrl, 'POST', '/standards/packs/scan', {
    content,
    packId,
  });

  const lines: string[] = [];
  lines.push(`Pack Scan: ${report.packId}`);
  lines.push(`Result:    ${report.passed ? 'PASSED' : 'FAILED (high-risk findings)'}`);
  lines.push(`Highest:   ${report.highestSeverity}`);
  lines.push(
    `Summary:   Critical: ${report.summary.critical}, High: ${report.summary.high}, Medium: ${report.summary.medium}, Low: ${report.summary.low}`,
  );

  if (report.findings.length > 0) {
    lines.push('\nFindings:');
    for (const f of report.findings) {
      lines.push(`  [${f.severity.toUpperCase()}] ${f.category}: ${f.message} (line ${f.line || '?'})`);
      if (f.snippet) {
        lines.push(`    ${f.snippet}`);
      }
    }
  }

  print(json, io.stdout, report, lines.join('\n'));
  return report.passed ? 0 : 1;
}

async function handleRulesMaterialize(
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  json: boolean,
): Promise<number> {
  const context = resolveContext(flags, env);
  const workspaceId = context.workspaceId || getFlag(flags, 'workspace');
  if (!workspaceId) {
    throw new Error('rules materialize requires a workspace ID. Pass --workspace <id> or set LOCAL_AI_WORKSPACE_ID.');
  }

  const unattended = getBooleanFlag(flags, 'unattended', false);
  const result = await request<MaterializeStandardsResult>(
    context.baseUrl,
    'POST',
    `/workspaces/${encodeURIComponent(workspaceId)}/standards/materialize`,
    { unattended },
  );

  const lines: string[] = [];
  lines.push(`Workspace:    ${result.workspacePath}`);
  lines.push(`Intensity:    ${result.intensity}`);
  lines.push(`Applied:      ${result.appliedPacks.join(', ') || 'none'}`);
  lines.push(`Total Rules:  ${result.totalRules}`);
  lines.push(`Tokens (est): ~${result.tokenEstimate}`);
  lines.push('Target Files:');
  for (const f of result.files) {
    const err = f.error ? ` (error: ${f.error})` : '';
    lines.push(`  - ${f.targetFile}: ${f.action}${err}`);
  }

  print(json, io.stdout, result, lines.join('\n'));
  return 0;
}

async function handleRulesSetIntensity(
  maybeLevel: string,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  json: boolean,
): Promise<number> {
  const context = resolveContext(flags, env);
  const workspaceId = context.workspaceId || getFlag(flags, 'workspace');
  if (!workspaceId) {
    throw new Error('rules set-intensity requires a workspace ID. Pass --workspace <id> or set LOCAL_AI_WORKSPACE_ID.');
  }

  const level = (maybeLevel || getFlag(flags, 'level') || '').toLowerCase();
  if (!['off', 'lite', 'full', 'ultra'].includes(level)) {
    throw new Error(`Invalid intensity level: "${level}". Valid levels: off, lite, full, ultra.`);
  }

  const current = await request<{ standards: DesktopStandardsOptions }>(
    context.baseUrl,
    'GET',
    `/workspaces/${encodeURIComponent(workspaceId)}/standards`,
  );

  const updated = await request<{
    ok: boolean;
    standards: DesktopStandardsOptions;
    materialized?: MaterializeStandardsResult;
  }>(context.baseUrl, 'PUT', `/workspaces/${encodeURIComponent(workspaceId)}/standards`, {
    ...current.standards,
    intensity: level as RuleIntensityLevel,
  });

  print(
    json,
    io.stdout,
    updated,
    `Workspace "${workspaceId}" standards intensity set to: ${level}. Materialization: ${
      updated.materialized ? 'done' : 'skipped'
    }`,
  );
  return 0;
}

async function handleRulesDetect(
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
  json: boolean,
): Promise<number> {
  const context = resolveContext(flags, env);
  const workspaceId = context.workspaceId || getFlag(flags, 'workspace');
  if (!workspaceId) {
    throw new Error('rules detect requires a workspace ID. Pass --workspace <id> or set LOCAL_AI_WORKSPACE_ID.');
  }

  const result = await request<{
    workspaceId: string;
    workspacePath: string;
    detectedStacks: DetectedTechStack;
  }>(context.baseUrl, 'POST', `/workspaces/${encodeURIComponent(workspaceId)}/standards/detect`);

  const stack = result.detectedStacks;
  const lines: string[] = [];
  lines.push(`Workspace:         ${result.workspacePath}`);
  lines.push(`Languages:         ${stack.languages.join(', ') || 'none'}`);
  lines.push(`Frameworks:        ${stack.frameworks.join(', ') || 'none'}`);
  lines.push(`Detected Files:    ${stack.detectedFiles.join(', ') || 'none'}`);
  lines.push(`Recommended Packs: ${stack.recommendedPacks.join(', ') || 'none'}`);

  print(json, io.stdout, result, lines.join('\n'));
  return 0;
}
