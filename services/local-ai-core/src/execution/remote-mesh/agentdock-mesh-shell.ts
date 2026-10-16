import { classifyLacShellCommand, dispatchLacCommand } from './lac-control.js';
import { runCli } from '../../cli/lac.js';
import { realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface ExtractedCommand {
  command: string;
  isVersion?: boolean;
  cwdFile?: string;
}

function stripBashQuotes(str: string): string {
  if ((str.startsWith("'") && str.endsWith("'")) || (str.startsWith('"') && str.endsWith('"'))) {
    const isSingle = str.startsWith("'");
    const unquoted = str.slice(1, -1);
    if (isSingle) {
      return unquoted
        .replaceAll(`'"'"'`, "'")
        .replaceAll(`'\\''`, "'")
        .replaceAll(`'\\'`, "'");
    }
    return unquoted;
  }
  return str;
}

function extractRawCommand(args: string[]): string {
  const cIndex = args.findIndex((arg) => arg === '-c' || /^-[a-zA-Z]*c$/.test(arg));
  if (cIndex !== -1) {
    for (let i = cIndex + 1; i < args.length; i += 1) {
      if (!args[i].startsWith('-')) {
        return args[i];
      }
    }
    return '';
  }
  const firstCmdIndex = args.findIndex((arg) => !arg.startsWith('-'));
  return firstCmdIndex !== -1 ? args.slice(firstCmdIndex).join(' ').trim() : '';
}

function unwrapClaudeCommand(rawCmd: string): ExtractedCommand {
  const snapshotBootstrap = String.raw`(?:source\s+(?:'[^'\\\r\n]*\/\.claude\/shell-snapshots\/[^'\\\r\n]+'|[A-Za-z0-9_./~-]*\/\.claude\/shell-snapshots\/[A-Za-z0-9_.~-]+)\s+2>\/dev\/null\s+\|\|\s+true\s+&&\s+)?`;
  const shoptBootstrap = String.raw`(?:shopt\s+-u\s+extglob\s+2>\/dev\/null\s+\|\|\s+true\s+&&\s+)?`;
  const claudeMatch = rawCmd.match(new RegExp(`^${snapshotBootstrap}${shoptBootstrap}eval\\s+([\\s\\S]*?)(?:\\s*<\\s*\\/dev\\/null)?\\s*&&\\s*pwd\\s+-P\\s*>\\|?\\s*(\\S+)\\s*$`));
  if (claudeMatch) {
    return { command: stripBashQuotes(claudeMatch[1].trim()).trim(), cwdFile: claudeMatch[2] };
  }

  const evalOnlyMatch = rawCmd.match(/^eval\s+([\s\S]+)$/);
  if (evalOnlyMatch) {
    return { command: stripBashQuotes(evalOnlyMatch[1].trim()).trim() };
  }

  return { command: rawCmd };
}

export function parseShellArgv(argv: string[]): ExtractedCommand {
  const args = argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    return { command: '', isVersion: true };
  }
  const rawCmd = extractRawCommand(args);
  if (!rawCmd) {
    return { command: '' };
  }
  return unwrapClaudeCommand(rawCmd);
}

export function extractCommandFromArgv(argv: string[]): string {
  return parseShellArgv(argv).command;
}

interface MeshShellOptions {
  nodeId: string;
  coreUrl: string;
  shellToken: string;
  timeoutMs: number;
}

function resolveShellOptions(env: NodeJS.ProcessEnv): MeshShellOptions | null {
  const nodeId = String(env.AGENTDOCK_MESH_NODE_ID || '').trim();
  if (!nodeId) {
    process.stderr.write('agentdock-mesh-shell: AGENTDOCK_MESH_NODE_ID is not configured.\n');
    return null;
  }
  const rawCoreUrl = String(env.AGENTDOCK_LOCAL_CORE_URL || 'http://127.0.0.1:9831').trim();
  const coreUrl = rawCoreUrl.replace(/\/+$/, '');
  const shellToken = String(env.AGENTDOCK_MESH_SHELL_TOKEN || '').trim();
  const timeoutMs = parseInt(String(env.AGENTDOCK_MESH_TIMEOUT_MS || '120000'), 10) || 120_000;
  return { nodeId, coreUrl, shellToken, timeoutMs };
}

interface MeshExecutionResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

interface MeshExecutionEnvelope {
  ok?: boolean;
  error?: string;
  status?: string;
  data?: { status?: string; error?: string; result?: MeshExecutionResult };
  result?: MeshExecutionResult;
}

async function sendMeshShellRequest(options: MeshShellOptions, command: string): Promise<MeshExecutionResult> {
  const url = `${options.coreUrl}/api/local/v1/mesh/shell/execute`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.shellToken) {
    headers.Authorization = `Bearer ${options.shellToken}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nodeId: options.nodeId,
      capability: 'shell.exec',
      args: {
        program: 'sh',
        arguments: ['-c', command],
      },
      timeoutMs: options.timeoutMs,
    }),
    signal: AbortSignal.timeout(options.timeoutMs + 5_000),
  });

  const envelope = (await response.json()) as MeshExecutionEnvelope;

  if (!response.ok || envelope.ok === false) {
    throw new Error(envelope.error || `HTTP ${response.status}`);
  }

  const execution = envelope.data || envelope;
  if (execution.status && execution.status !== 'completed') {
    throw new Error(execution.error || `Remote execution ${execution.status}`);
  }

  return (execution.result || {}) as MeshExecutionResult;
}

function isWithinDirectory(directory: string, candidate: string): boolean {
  const relativePath = relative(resolve(directory), resolve(candidate));
  return Boolean(relativePath)
    && relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath);
}

function isSessionCwdFile(cwdDir: string, cwdFile: string): boolean {
  try {
    const safeRoot = realpathSync(cwdDir);
    const parent = realpathSync(dirname(resolve(cwdFile)));
    const resolvedTarget = resolve(parent, basename(cwdFile));
    return (parent === safeRoot || isWithinDirectory(safeRoot, parent)) && isWithinDirectory(safeRoot, resolvedTarget);
  } catch {
    return false;
  }
}

function handleSpecialInvocation(parsed: ExtractedCommand, env: NodeJS.ProcessEnv): number | null {
  if (parsed.isVersion) {
    process.stdout.write('GNU bash, version 5.2.0(1)-release (agentdock-mesh-shell)\n');
    return 0;
  }

  const cwdDir = String(env.AGENTDOCK_MESH_CWD_DIR || '').trim();
  if (parsed.cwdFile && cwdDir && isSessionCwdFile(cwdDir, parsed.cwdFile)) {
    try {
      writeFileSync(resolve(parsed.cwdFile), process.cwd(), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch {
      // The runtime may retry with an existing temp path; keep the command remote.
    }
  }

  return null;
}

export async function executeMeshShell(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const parsed = parseShellArgv(argv);
  const specialCode = handleSpecialInvocation(parsed, env);
  if (specialCode !== null) {
    return specialCode;
  }

  if (!parsed.command) {
    return 0;
  }

  const lacCommand = classifyLacShellCommand(parsed.command);
  if (lacCommand.kind === 'unsupported') {
    process.stderr.write(`agentdock-mesh-shell: ${lacCommand.message}\n`);
    return 2;
  }
  if (lacCommand.kind === 'lac') {
    const result = await dispatchLacCommand(lacCommand.argv, env, runCli);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.exitCode;
  }

  const options = resolveShellOptions(env);
  if (!options) {
    return 1;
  }

  try {
    const res = await sendMeshShellRequest(options, parsed.command);
    if (res.stdout) {
      process.stdout.write(res.stdout);
    }
    if (res.stderr) {
      process.stderr.write(res.stderr);
    }
    return res.exitCode ?? 0;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`agentdock-mesh-shell: Remote execution failed: ${msg}\n`);
    return 1;
  }
}

// When executed directly as CLI
const isDirectCli = typeof process !== 'undefined'
  && !process.env.NODE_TEST_CONTEXT
  && Boolean(process.argv?.[1])
  && /(?:agentdock-mesh-shell|mesh-bash|mesh-shell)(?:\.[cm]?[jt]s)?$/.test(process.argv[1]);

if (isDirectCli) {
  executeMeshShell(process.argv)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`agentdock-mesh-shell fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
