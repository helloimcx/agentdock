import { existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createMeshClient } from '@cc/core-sdk/mesh';
import { NodeAgent, enrollNode, meshUrl } from './node-agent.js';
import { createPrivateJson, readPrivateJson, writePrivateJson } from './node-credentials.js';
import { executionInput, text } from './mesh-validation.js';

function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  for (let index = 1; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    if (['--allow-shell', '--allow-insecure'].includes(key)) flags[key.slice(2)] = 'true';
    else {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
      flags[key.slice(2)] = value;
    }
  }
  return { command: argv[0] || 'help', flags };
}

const HELP = `AgentDock Mesh
Usage:
  agentdock-node pair --server <https://host> --label <device> --output <pairing.json> [--allow-shell]
  agentdock-node connect --server <https://host> --root <directory> [--pairing-file <pairing.json>] [--state <credentials.json>] [--allow-shell]
  agentdock-node list --server <https://host>
  agentdock-node execute --server <https://host> --node <id> --capability <name> --args <JSON> [--timeout <ms>]
  agentdock-node requests --server <https://host>
  agentdock-node status --server <https://host> --request <id>
  agentdock-node cancel --server <https://host> --request <id>
  agentdock-node revoke --server <https://host> --node <id>

Administrative commands use AGENTDOCK_MESH_ADMIN_TOKEN. Pairing files and node
credentials use mode 0600. HTTPS is required outside loopback; --allow-insecure
is an explicit opt-in for a trusted private network. Shell requires opt-in on
both pairing and connect; it runs as your user and is not an OS sandbox.
`;

async function connect(flags: Record<string, string>) {
  const server = text(flags.server);
  const root = await realpath(text(flags.root));
  if (!(await stat(root)).isDirectory()) throw new Error('Approved root must be a directory.');
  const state = flags.state || join(homedir(), '.agentdock', 'mesh-node.json');
  const allowInsecure = flags['allow-insecure'] === 'true';
  const savedServer = meshUrl(server, allowInsecure).href;
  let credentials;
  if (existsSync(state)) {
    const value = await readPrivateJson(state);
    credentials = { server: text(value.server), nodeId: text(value.nodeId, 100), token: text(value.token, 128) };
    if (credentials.server !== savedServer) throw new Error('Credentials belong to a different server. Use a separate --state file.');
  } else {
    // Reserve the file before consuming a single-use pairing token.
    const pairing = flags['pairing-file'] ? await readPrivateJson(flags['pairing-file']) : undefined;
    const pairingToken = text(pairing?.pairingToken || process.env.AGENTDOCK_MESH_PAIRING_TOKEN, 128);
    if (pairing?.server && meshUrl(text(pairing.server), allowInsecure).href !== savedServer) throw new Error('Pairing file belongs to a different server.');
    credentials = await createPrivateJson(state, async () => ({ ...await enrollNode(server, pairingToken, allowInsecure), server: savedServer }));
  }
  const agent = new NodeAgent({
    server, credentials, root, allowInsecure, allowShell: flags['allow-shell'] === 'true',
    platform: process.env.TERMUX_VERSION ? 'android' : process.platform,
    onStatus: status => {
      console.log(`[mesh] ${credentials.nodeId}: ${status}`);
      if (status === 'rejected') { agent.stop(); process.exitCode = 1; }
    },
  });
  process.once('SIGINT', () => agent.stop());
  process.once('SIGTERM', () => agent.stop());
  agent.start();
}

async function manage(command: string, flags: Record<string, string>) {
  const base = meshUrl(text(flags.server), flags['allow-insecure'] === 'true');
  const client = createMeshClient(text(process.env.AGENTDOCK_MESH_ADMIN_TOKEN, 4096), base.href.slice(0, -'/mesh'.length));
  if (command === 'list') return client.listNodes();
  if (command === 'requests') return client.listRequests();
  if (command === 'status') return client.getRequest(text(flags.request, 100));
  if (command === 'cancel') return client.cancelRequest(text(flags.request, 100));
  if (command === 'revoke') return client.revokeNode(text(flags.node, 100));
  if (command === 'execute') return client.execute(executionInput({
    nodeId: flags.node, capability: flags.capability, args: JSON.parse(flags.args || '{}'),
    timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
  }));
  if (command !== 'pair') throw new Error('Unknown mesh command.');
  const output = text(flags.output);
  if (existsSync(output)) throw new Error('Pairing output already exists; choose a new path.');
  const pairing = await client.createPairing({ label: text(flags.label, 100), allowShell: flags['allow-shell'] === 'true' });
  await writePrivateJson(output, { ...pairing, server: flags.server });
  return { nodeId: pairing.nodeId, expiresAt: pairing.expiresAt, output };
}

export async function runNodeCli(argv = process.argv.slice(2)) {
  const { command, flags } = parseArgs(argv);
  if (['help', '--help', '-h'].includes(command)) { console.log(HELP); return; }
  if (command === 'connect') { await connect(flags); return; }
  console.log(JSON.stringify(await manage(command, flags), null, 2));
}
