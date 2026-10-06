import { MobileUiClient, validateScreenDuration } from './client.js';
import { formatElementsCompact } from './formatter.js';
import type { ClickOptions, InputOptions, ScrollOptions, ActionOptions } from './types.js';

interface ParsedArgs {
  subcommand: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

const BOOLEAN_FLAGS = new Set(['json', 'dry-run', 'no-clear', 'interactive-only']);

function parseCliArgs(argv: string[]): ParsedArgs {
  const cleanArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const subcommand = cleanArgv[0] || 'help';
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < cleanArgv.length; i++) {
    const arg = cleanArgv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const flagName = arg.slice(2);
        if (BOOLEAN_FLAGS.has(flagName)) {
          flags[flagName] = true;
        } else if (i + 1 < cleanArgv.length && !cleanArgv[i + 1].startsWith('--')) {
          flags[flagName] = cleanArgv[++i];
        } else {
          flags[flagName] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }

  return { subcommand, positional, flags };
}

async function handleStatusCommand(client: MobileUiClient, flags: Record<string, string | boolean>, dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log('[dry-run] GET /api/status');
    return;
  }
  const status = await client.getStatus();
  if (flags.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log(`Service enabled: ${status.serviceEnabled}`);
    console.log(`Current package: ${status.currentPackage || 'none'}`);
    console.log(`Current activity: ${status.currentActivity || 'none'}`);
    console.log(`Screen: ${status.screenWidth}x${status.screenHeight}`);
  }
}

async function handleDumpCommand(client: MobileUiClient, flags: Record<string, string | boolean>, dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log('[dry-run] GET /api/dump');
    return;
  }
  const interactiveOnly = flags['interactive-only'] !== undefined
    ? flags['interactive-only'] !== 'false' && flags['interactive-only'] !== false
    : undefined;
  const dump = await client.dump(interactiveOnly !== undefined ? { interactiveOnly } : undefined);
  if (flags.json) {
    console.log(JSON.stringify(dump, null, 2));
  } else {
    console.log(formatElementsCompact(dump));
  }
}

async function handleClickCommand(client: MobileUiClient, target: string, flags: Record<string, string | boolean>, dryRun: boolean): Promise<void> {
  const options: ClickOptions = {};
  if (flags.id) {
    options.id = String(flags.id);
  } else if (target && /^\d+$/.test(target)) {
    options.index = parseInt(target, 10);
  } else if (target && /^\d+\s*,\s*\d+$/.test(target.trim())) {
    const [x, y] = target.split(',').map(s => parseInt(s.trim(), 10));
    options.point = [x, y];
  } else if (target) {
    options.text = target;
  } else {
    throw new Error('Please specify an element index, text, or --id to click.');
  }

  if (dryRun) {
    console.log(`[dry-run] POST /api/click index=${options.index ?? ''} with ${JSON.stringify(options)}`);
    return;
  }
  const res = await client.click(options);
  console.log(JSON.stringify(res));
}

async function handleInputCommand(client: MobileUiClient, text: string, flags: Record<string, string | boolean>, dryRun: boolean): Promise<void> {
  if (!text) {
    throw new Error('Please provide text to input: mobile-ui input <text>');
  }
  const targetStr = (flags.target || flags.index) as string | undefined;
  let index: number | undefined;
  if (targetStr !== undefined) {
    const parsed = parseInt(String(targetStr), 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      throw new Error(`Invalid target index "${targetStr}". Must be a valid element index.`);
    }
    index = parsed;
  }
  const options: InputOptions = {
    text,
    index,
    clear: !flags['no-clear'],
  };

  if (dryRun) {
    console.log(`[dry-run] POST /api/input with ${JSON.stringify(options)}`);
    return;
  }
  const res = await client.input(options);
  console.log(JSON.stringify(res));
}

async function handleScrollCommand(client: MobileUiClient, directionArg: string, dryRun: boolean): Promise<void> {
  const dir = (directionArg || 'down').toLowerCase();
  const valid = ['down', 'up', 'left', 'right'];
  if (!valid.includes(dir)) {
    throw new Error(`Invalid scroll direction "${dir}". Valid: down, up, left, right.`);
  }
  const options: ScrollOptions = { direction: dir as any };
  if (dryRun) {
    console.log(`[dry-run] POST /api/scroll ${dir} direction=${dir}`);
    return;
  }
  const res = await client.scroll(options);
  console.log(JSON.stringify(res));
}

async function handleActionCommand(client: MobileUiClient, action: 'back' | 'home', dryRun: boolean): Promise<void> {
  const options: ActionOptions = { action };
  if (dryRun) {
    console.log(`[dry-run] POST /api/action ${action}`);
    return;
  }
  const res = await client.action(options);
  console.log(JSON.stringify(res));
}

async function handleWaitCommand(client: MobileUiClient, text: string, flags: Record<string, string | boolean>, dryRun: boolean): Promise<void> {
  const id = flags.id ? String(flags.id) : undefined;
  if (!text && !id) {
    throw new Error('Please specify text or --id to wait for: mobile-ui wait <text> [--id=<viewId>]');
  }
  let timeoutSec = 5;
  if (flags.timeout) {
    const parsed = parseInt(String(flags.timeout), 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new Error(`Invalid timeout "${flags.timeout}". Must be a positive integer.`);
    }
    timeoutSec = parsed;
  }
  if (dryRun) {
    console.log(`[dry-run] Wait for "${text || id}" timeout=${timeoutSec}s`);
    return;
  }
  const found = await client.wait({ text, id, timeoutSeconds: timeoutSec });
  console.log(`Found element: [${found.index}] "${found.text || found.desc || found.id}"`);
}

function parseScreenCommand(action: string | undefined, flags: Record<string, string | boolean>) {
  const command = action || 'status';
  if (!['status', 'keep-awake', 'renew', 'release'].includes(command)) {
    throw new Error('Usage: mobile-ui screen status|keep-awake|renew|release [--duration=<1..600>] [--owner=<runId>]');
  }
  const duration = flags.duration === undefined ? 120 : Number(flags.duration);
  if (command === 'keep-awake' || command === 'renew') {
    if (typeof flags.duration === 'boolean') throw new Error('Screen duration requires a number.');
    validateScreenDuration(duration);
  }
  const owner = flags.owner === undefined ? undefined : String(flags.owner);
  if (flags.owner === true || owner === '' || (owner && owner.length > 256)) throw new Error('Screen owner requires 1..256 characters.');
  return { command, duration, owner };
}

async function executeScreenCommand(client: MobileUiClient, command: string, duration: number, owner?: string) {
  if (command === 'status') return client.getScreenStatus(owner);
  if (command === 'release') return client.releaseScreen(owner);
  if (command === 'renew') return client.renewScreenAwake(duration, owner);
  return client.keepScreenAwake(duration, owner);
}

async function handleScreenCommand(
  client: MobileUiClient, action: string | undefined,
  flags: Record<string, string | boolean>, dryRun: boolean,
): Promise<void> {
  const { command, duration, owner } = parseScreenCommand(action, flags);
  if (dryRun) {
    console.log(`[dry-run] ${command === 'status' ? 'GET' : 'POST'} /api/screen ${command}`);
    return;
  }
  console.log(JSON.stringify({ ...await executeScreenCommand(client, command, duration, owner), cliProtocol: 2 }));
}

const HELP_TEXT = `AgentDock Mobile UI Bridge
Usage:
  mobile-ui screen status|keep-awake|renew|release [--duration=<1..600>] [--owner=<runId>] [--dry-run]
  mobile-ui status [--json]
  mobile-ui dump [--json] [--dry-run]
  mobile-ui click <index | "text" | x,y> [--id=<viewId>] [--dry-run]
  mobile-ui input <text> [--target=<index>] [--no-clear] [--dry-run]
  mobile-ui scroll [down|up|left|right] [--dry-run]
  mobile-ui back [--dry-run]
  mobile-ui home [--dry-run]
  mobile-ui wait <text> [--timeout=<sec>] [--dry-run]
`;

export async function runMobileUiCli(argv = process.argv.slice(2)): Promise<void> {
  const { subcommand, positional, flags } = parseCliArgs(argv);
  const dryRun = Boolean(flags['dry-run']);

  if (['help', '--help', '-h'].includes(subcommand)) {
    console.log(HELP_TEXT);
    return;
  }

  const client = new MobileUiClient({
    baseUrl: (flags['base-url'] as string) || process.env.AGENTDOCK_A11Y_URL,
  });

  switch (subcommand) {
    case 'screen':
      await handleScreenCommand(client, positional[0], flags, dryRun);
      break;
    case 'status':
      await handleStatusCommand(client, flags, dryRun);
      break;
    case 'dump':
      await handleDumpCommand(client, flags, dryRun);
      break;
    case 'click':
      await handleClickCommand(client, positional[0], flags, dryRun);
      break;
    case 'input':
      await handleInputCommand(client, positional[0], flags, dryRun);
      break;
    case 'scroll':
      await handleScrollCommand(client, positional[0], dryRun);
      break;
    case 'back':
      await handleActionCommand(client, 'back', dryRun);
      break;
    case 'home':
      await handleActionCommand(client, 'home', dryRun);
      break;
    case 'wait':
      await handleWaitCommand(client, positional[0], flags, dryRun);
      break;
    default:
      console.log(`Unknown command: ${subcommand}\n\n${HELP_TEXT}`);
      process.exitCode = 1;
  }
}
