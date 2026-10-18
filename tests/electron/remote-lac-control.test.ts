import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLacShellCommand,
  dispatchLacCommand,
  invokeLacControlTool,
  LAC_CONTROL_TOOLS,
} from '../../apps/daemon/src/execution/remote-mesh/lac-control.js';
import type { StdIo } from '../../apps/daemon/src/cli/cli-helpers.js';
import { executeMeshShell } from '../../apps/daemon/src/execution/remote-mesh/agentdock-mesh-shell.js';
import { createServer } from 'node:http';

const noEnv = { AGENTDOCK_LOCAL_CORE_URL: 'http://127.0.0.1:9831', LOCAL_AI_WORKSPACE_ID: 'workspace:test' };

test('classifyLacShellCommand routes a single quoted lac command with argv preserved', () => {
  assert.deepEqual(classifyLacShellCommand('lac memory query "market | alerts" --limit 5'), {
    kind: 'lac',
    argv: ['lac', 'memory', 'query', 'market | alerts', '--limit', '5'],
  });
});

test('classifyLacShellCommand keeps unrelated commands remote', () => {
  assert.deepEqual(classifyLacShellCommand('git status --short'), { kind: 'remote' });
  assert.deepEqual(classifyLacShellCommand('echo "lac is the CLI"'), { kind: 'remote' });
  assert.deepEqual(classifyLacShellCommand('grep lac README.md'), { kind: 'remote' });
  assert.deepEqual(classifyLacShellCommand('echo lac | cat'), { kind: 'remote' });
  assert.deepEqual(classifyLacShellCommand('git log --oneline | grep lac'), { kind: 'remote' });
  assert.deepEqual(classifyLacShellCommand("false && eval 'lac memory del decisions/example'"), { kind: 'remote' });
});

test('classifyLacShellCommand fails closed for lac mixed with shell syntax', () => {
  for (const command of [
    'lac scheduler list && git status',
    'echo ready; lac scheduler list',
    'lac memory query "$(whoami)"',
    'lac memory query foo | cat',
    'LOCAL_AI_WORKSPACE_ID=other lac scheduler list',
  ]) {
    assert.equal(classifyLacShellCommand(command).kind, 'unsupported', command);
  }
});

test('dispatchLacCommand permits allowlisted operations and keeps caller output/exit code', async () => {
  let call: { argv: string[]; env: NodeJS.ProcessEnv } | undefined;
  const runCli = async (argv: string[], env: NodeJS.ProcessEnv, io: StdIo) => {
    call = { argv, env };
    io.stdout.write('{"jobs":[]}\n');
    io.stderr.write('');
    return 0;
  };
  const result = await dispatchLacCommand(
    ['lac', 'scheduler', 'list', '--json'],
    { ...noEnv, LOCAL_AI_THREAD_ID: 'thread:workspace:test:123' },
    runCli,
  );
  assert.deepEqual(result, { stdout: '{"jobs":[]}\n', stderr: '', exitCode: 0 });
  assert.deepEqual(call?.argv, ['scheduler', 'list', '--json']);
  assert.equal(call?.env.LOCAL_AI_WORKSPACE_ID, 'workspace:test');
  assert.equal(call?.env.LOCAL_AI_THREAD_ID, 'thread:workspace:test:123');
  assert.equal(call?.env.LOCAL_AI_CORE_BASE, 'http://127.0.0.1:9831/api/local/v1');
});

test('dispatchLacCommand rejects context overrides, files, unknown operations, and extra flags', async () => {
  let calls = 0;
  const runCli = async () => { calls += 1; return 0; };
  for (const argv of [
    ['lac', 'scheduler', 'list', '--workspace', 'workspace:other'],
    ['lac', 'memory', 'write', '--slug', 'x', '--title', 'x', '--file', '/etc/passwd'],
    ['lac', 'rules', 'add', 'typescript'],
    ['lac', 'scheduler', 'list', '--base-url', 'https://example.invalid'],
  ]) {
    const result = await dispatchLacCommand(argv, noEnv, runCli);
    assert.notEqual(result.exitCode, 0, argv.join(' '));
    assert.match(result.stderr, /not allowed|unsupported|remote file/i, argv.join(' '));
  }
  assert.equal(calls, 0);
});

test('MCP exposes structured read tools and rejects caller-supplied context', async () => {
  assert.deepEqual(LAC_CONTROL_TOOLS.map((tool) => tool.name), [
    'memory_query', 'memory_list', 'scheduler_list', 'monitor_list', 'automation_list',
  ]);
  let call: string[] | undefined;
  const runCli = async (argv: string[], _env: NodeJS.ProcessEnv, io: StdIo) => {
    call = argv;
    io.stdout.write('{"jobs":[]}\n');
    return 0;
  };
  const response = await invokeLacControlTool('scheduler_list', {}, noEnv, runCli);
  assert.equal(response.isError, false);
  assert.deepEqual(response.structuredContent, { jobs: [] });
  assert.deepEqual(call, ['scheduler', 'list', '--json']);

  const forged = await invokeLacControlTool('scheduler_list', { workspace: 'workspace:other' }, noEnv, runCli);
  assert.equal(forged.isError, true);
  assert.match(forged.content[0].text, /unknown argument/i);
  assert.deepEqual(call, ['scheduler', 'list', '--json']);
});


test('executeMeshShell sends standalone lac commands to the host Core', async () => {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url || '');
    if (req.url?.startsWith('/api/local/v1/scheduler/jobs')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { jobs: [] } }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const lacCode = await executeMeshShell(
      ['node', 'agentdock-mesh-shell.js', '-c', 'lac scheduler list --json'],
      { AGENTDOCK_LOCAL_CORE_URL: `http://127.0.0.1:${port}`, LOCAL_AI_WORKSPACE_ID: 'workspace:test' },
    );
    assert.equal(lacCode, 0);
    assert.ok(requests.some((url) => url.startsWith('/api/local/v1/scheduler/jobs?workspace_id=workspace%3Atest')));
  } finally {
    server.close();
  }
});

test('remote Butler workers can only send reports through the host Core using the trusted thread and run context', async () => {
  let received: { url?: string; headers: NodeJS.Dict<string | string[]>; body: any } | undefined;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    received = { url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data: { accepted: true } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const code = await executeMeshShell(['node', 'agentdock-mesh-shell.js', '-c',
      'lac butler report --phase checkpoint --outcome waiting_external --summary "Download task created" --request-id report:download:1 --external-refs \'[{"kind":"download","system":"fnos","id":"DL-8021"}]\' --json'], {
      AGENTDOCK_LOCAL_CORE_URL: `http://127.0.0.1:${port}`,
      AGENTDOCK_SANDBOX_RUN_ID: 'run:thread:fnos:acp-001:1792231500000',
      AGENTDOCK_BUTLER_CONTEXT_TOKEN: 'opaque-core-issued-capability',
      LOCAL_AI_THREAD_ID: 'thread:fnos::f8ef0f59-d9af-4abc-923f-fb2a87f1b3dd',
      LOCAL_AI_WORKSPACE_ID: 'fnos',
    });
    assert.equal(code, 0);
    assert.equal(received?.url, '/api/local/v1/butler/agent');
    assert.equal((received?.body as any)?.report?.phase, 'checkpoint');
    assert.equal(received?.headers['x-agentdock-thread-id'], 'thread:fnos::f8ef0f59-d9af-4abc-923f-fb2a87f1b3dd');
    assert.equal(received?.headers['x-agentdock-run-id'], 'run:thread:fnos:acp-001:1792231500000');
    assert.equal(received?.headers['x-agentdock-butler-capability'], 'opaque-core-issued-capability');
    assert.equal(received?.body.action, 'report');
    assert.equal(received?.body.report.externalRefs[0].id, 'DL-8021');
  } finally { server.close(); }
});
