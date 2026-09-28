import { AcpStdioServer } from '../acp/server/acp-stdio-server.js';
import { LocalCoreApiClient } from '../acp/server/local-core-client.js';
import type { ParsedFlags, StdIo } from './cli-helpers.js';
import { getFlag, resolveContext } from './cli-helpers.js';

export async function runAcpDomain(
  action: string,
  flags: ParsedFlags,
  env: NodeJS.ProcessEnv,
  io: StdIo,
): Promise<number> {
  if (action !== 'serve') {
    printAcpUsage(io);
    return 2;
  }
  const context = resolveContext(flags, env);
  const workspaceId = getFlag(flags, 'workspace') || context.workspaceId;
  if (!workspaceId) {
    throw new Error('acp serve requires a workspace context. Set LOCAL_AI_WORKSPACE_ID or pass --workspace.');
  }
  const client = new LocalCoreApiClient({ baseUrl: context.baseUrl });
  const server = new AcpStdioServer({
    workspaceId,
    client,
    input: process.stdin,
    output: { write: (chunk: string) => io.stdout.write(chunk) },
    log: (message: string) => io.stderr.write(`[lac acp] ${message}\n`),
  });
  await server.serve();
  return 0;
}

function printAcpUsage(io: StdIo) {
  io.stderr.write([
    'Usage:',
    '  lac acp serve --workspace <id> [--base-url <url>]',
    '',
    'Serves an Agent Client Protocol (ACP) agent-side adapter on stdio so ACP',
    'clients such as the Zed editor can drive an AgentDock workspace agent.',
    'Each ACP session maps to a thread created in the bound workspace.',
  ].join('\n') + '\n');
}
