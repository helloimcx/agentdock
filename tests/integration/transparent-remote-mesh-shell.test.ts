import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  resolvePlatformHint,
  buildDeviceClaudeMd,
  buildDeviceSystemPrompt,
} from '../../apps/daemon/src/execution/remote-mesh/device-environment.js';
import {
  extractCommandFromArgv,
  parseShellArgv,
  executeMeshShell,
} from '../../apps/daemon/src/execution/remote-mesh/agentdock-mesh-shell.js';
import { readFileSync, unlinkSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { classifyLacShellCommand } from '../../apps/daemon/src/execution/remote-mesh/lac-control.js';

test('device-environment resolves platform hints accurately without hardcoding', () => {
  const androidHint = resolvePlatformHint('android');
  assert.ok(androidHint.includes('Android / Termux'));
  assert.ok(androidHint.includes('termux-*'));

  const linuxHint = resolvePlatformHint('linux');
  assert.ok(linuxHint.includes('Linux POSIX'));

  const darwinHint = resolvePlatformHint('darwin');
  assert.ok(darwinHint.includes('macOS'));

  const winHint = resolvePlatformHint('win32');
  assert.ok(winHint.includes('Windows'));

  const customHint = resolvePlatformHint('freebsd');
  assert.ok(customHint.includes('freebsd'));
});

test('device-environment generates dynamic CLAUDE.md and system prompts', () => {
  const claudeMd = buildDeviceClaudeMd({
    label: 'Raspberry-Pi-5',
    platform: 'linux',
  });
  assert.ok(claudeMd.includes('Raspberry-Pi-5'));
  assert.ok(claudeMd.includes('Platform: linux'));
  assert.ok(claudeMd.includes('There is no need for ADB'));

  const prompt = buildDeviceSystemPrompt({
    label: 'Office-MacBook',
    platform: 'darwin',
  });
  assert.ok(prompt.includes('Office-MacBook'));
  assert.ok(prompt.includes('darwin'));
  assert.ok(!prompt.includes('Xiaomi'));
});

test('parseShellArgv handles --version and keeps snapshot initialization on the remote shell path', () => {
  assert.deepEqual(parseShellArgv(['node', 'agentdock-mesh-shell.js', '--version']), {
    command: '',
    isVersion: true,
  });

  assert.deepEqual(parseShellArgv(['node', 'agentdock-mesh-shell.js', '-c', '-l', 'SNAPSHOT_FILE=/tmp/snap.sh source ~/.bashrc']), {
    command: 'SNAPSHOT_FILE=/tmp/snap.sh source ~/.bashrc',
  });

  const injected = parseShellArgv([
    'node', 'agentdock-mesh-shell.js', '-c',
    'SNAPSHOT_FILE=x; touch /tmp/host-command-must-not-run',
  ]);
  assert.equal(injected.command, 'SNAPSHOT_FILE=x; touch /tmp/host-command-must-not-run');
  assert.equal(classifyLacShellCommand(injected.command).kind, 'remote');
});

test('SNAPSHOT_FILE commands are sent to the Mesh node without host shell evaluation', async () => {
  const markerDir = resolve(tmpdir(), `agentdock-snapshot-boundary-${Date.now()}`);
  const markerFile = resolve(markerDir, 'host-command-ran');
  mkdirSync(markerDir, { recursive: true });
  let receivedBody: any;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    receivedBody = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data: { status: 'completed', result: { exitCode: 0 } } }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as any).port;
  const command = `SNAPSHOT_FILE=x; touch ${markerFile}`;
  try {
    const exitCode = await executeMeshShell(
      ['node', 'agentdock-mesh-shell.js', '-c', command],
      { AGENTDOCK_MESH_NODE_ID: 'node:test-device', AGENTDOCK_LOCAL_CORE_URL: `http://127.0.0.1:${port}` },
    );
    assert.equal(exitCode, 0);
    assert.equal(receivedBody.args.arguments[1], command);
    assert.equal(existsSync(markerFile), false);
  } finally {
    server.close();
    rmSync(markerDir, { recursive: true, force: true });
  }
});

test('extractCommandFromArgv and parseShellArgv unwraps Claude Code eval and pwd wrapping', () => {
  assert.equal(
    extractCommandFromArgv(['node', 'agentdock-mesh-shell.js', '-c', 'df -h /data']),
    'df -h /data',
  );

  assert.equal(
    extractCommandFromArgv(['node', 'agentdock-mesh-shell.js', '-lc', 'df -h /data']),
    'df -h /data',
  );

  assert.equal(
    extractCommandFromArgv(['node', 'agentdock-mesh-shell.js', '-l', '-c', 'uname -a']),
    'uname -a',
  );

  assert.equal(
    extractCommandFromArgv(['node', 'agentdock-mesh-shell.js', 'df', '-h', '/data']),
    'df -h /data',
  );

  assert.equal(
    extractCommandFromArgv(['node', 'agentdock-mesh-shell.js']),
    '',
  );

  // Claude Code wrapping pattern
  const claudeWrapped = parseShellArgv([
    'node',
    'agentdock-mesh-shell.js',
    '-c',
    '-l',
    "source /home/ubuntu/.claude/shell-snapshots/snap.sh 2>/dev/null || true && shopt -u extglob 2>/dev/null || true && eval 'df -h 2>/dev/null | head -20' < /dev/null && pwd -P >| /tmp/claude-test-cwd",
  ]);
  assert.equal(claudeWrapped.command, 'df -h 2>/dev/null | head -20');
  assert.equal(claudeWrapped.cwdFile, '/tmp/claude-test-cwd');

  // Claude Code with escaped single quotes
  const escapedWrapped = parseShellArgv([
    'node',
    'agentdock-mesh-shell.js',
    '-c',
    "eval 'echo '\\''hello world'\\''' < /dev/null && pwd -P >| /tmp/claude-test-cwd",
  ]);
  assert.equal(escapedWrapped.command, "echo 'hello world'");
  assert.equal(escapedWrapped.cwdFile, '/tmp/claude-test-cwd');

  // Claude Code single quote escaping with '"'"'
  const claudeQuoteEscaped = parseShellArgv([
    'node',
    'agentdock-mesh-shell.js',
    '-c',
    "eval 'echo '\"'\"'hello world'\"'\"'' < /dev/null && pwd -P >| /tmp/claude-test-cwd",
  ]);
  assert.equal(claudeQuoteEscaped.command, "echo 'hello world'");

  // Claude Code multiline heredoc with Python and single quotes
  const claudeHeredoc = parseShellArgv([
    'node',
    'agentdock-mesh-shell.js',
    '-c',
    "eval 'python3 - <<'\"'\"'EOF'\"'\"'\nif c == b'\"'\"'d'\"'\"':\n    print('\"'\"'ok'\"'\"')\nEOF' < /dev/null && pwd -P >| /tmp/claude-test-cwd",
  ]);
  assert.equal(
    claudeHeredoc.command,
    "python3 - <<'EOF'\nif c == b'd':\n    print('ok')\nEOF",
  );
});

test('Claude wrapper parsing does not strip arbitrary conditional prefixes before LAC routing', () => {
  const command = "false && eval 'lac memory del decisions/example' && pwd -P >| /tmp/claude-test-cwd";
  const parsed = parseShellArgv(['node', 'agentdock-mesh-shell.js', '-c', command]);
  assert.equal(parsed.command, command);
  assert.equal(parsed.cwdFile, undefined);
});

test('conditional eval containing lac stays on the remote shell route', async () => {
  const requestedPaths: string[] = [];
  const command = "false && eval 'lac memory del decisions/example' && pwd -P >| /tmp/claude-test-cwd";
  const server = createServer((req, res) => {
    requestedPaths.push(req.url || '');
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { status: 'completed', result: { stdout: '', stderr: '', exitCode: 0 } } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const exitCode = await executeMeshShell(
      ['node', 'agentdock-mesh-shell.js', '-c', command],
      { AGENTDOCK_MESH_NODE_ID: 'node:test-device', AGENTDOCK_LOCAL_CORE_URL: `http://127.0.0.1:${port}` },
    );
    assert.equal(exitCode, 0);
    assert.deepEqual(requestedPaths, ['/api/local/v1/mesh/shell/execute']);
  } finally {
    server.close();
  }
});

test('snapshot bootstrap paths cannot smuggle shell operators before host LAC dispatch', async () => {
  const requestedPaths: string[] = [];
  const command = "source /x/.claude/shell-snapshots/x&&exit 2>/dev/null || true && eval 'lac memory del decisions/example' && pwd -P > /tmp/claude-test-cwd";
  const parsed = parseShellArgv(['node', 'agentdock-mesh-shell.js', '-c', command]);
  assert.equal(parsed.command, command);
  assert.equal(parsed.cwdFile, undefined);

  const server = createServer((req, res) => {
    requestedPaths.push(req.url || '');
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { status: 'completed', result: { stdout: '', stderr: '', exitCode: 0 } } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const exitCode = await executeMeshShell(
      ['node', 'agentdock-mesh-shell.js', '-c', command],
      { AGENTDOCK_MESH_NODE_ID: 'node:test-device', AGENTDOCK_LOCAL_CORE_URL: `http://127.0.0.1:${port}` },
    );
    assert.equal(exitCode, 0);
    assert.deepEqual(requestedPaths, ['/api/local/v1/mesh/shell/execute']);
  } finally {
    server.close();
  }
});

test('executeMeshShell errors when AGENTDOCK_MESH_NODE_ID is missing', async () => {
  const exitCode = await executeMeshShell(['node', 'agentdock-mesh-shell.js', '-c', 'ls'], {
    AGENTDOCK_MESH_NODE_ID: '',
  });
  assert.equal(exitCode, 1);
});

test('executeMeshShell forwards command to mesh endpoint and captures output', async () => {
  let receivedBody: any = null;

  const server = createServer(async (req, res) => {
    if (req.url === '/api/local/v1/mesh/shell/execute' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      receivedBody = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          status: 'completed',
          result: {
            stdout: 'Filesystem Size Used Avail Use% Mounted on\n/dev/block/dm-50 216G 132G 84G 62% /data\n',
            stderr: '',
            exitCode: 0,
          },
        },
      }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  try {
    const exitCode = await executeMeshShell(
      ['node', 'agentdock-mesh-shell.js', '-c', 'df -h /data'],
      {
        AGENTDOCK_MESH_NODE_ID: 'node:test-phone-123',
        AGENTDOCK_LOCAL_CORE_URL: `http://127.0.0.1:${port}`,
        AGENTDOCK_MESH_SHELL_TOKEN: 'test-scoped-shell-token',
      },
    );

    assert.equal(exitCode, 0);
    assert.ok(receivedBody);
    assert.equal(receivedBody.nodeId, 'node:test-phone-123');
    assert.equal(receivedBody.capability, 'shell.exec');
    assert.deepEqual(receivedBody.args, {
      program: 'sh',
      arguments: ['-c', 'df -h /data'],
    });
  } finally {
    server.close();
  }
});

test('executeMeshShell returns non-zero when remote execution times out or fails', async () => {
  const server = createServer(async (req, res) => {
    if (req.url === '/api/local/v1/mesh/shell/execute' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          id: 'mesh-req:timed-out',
          status: 'timed_out',
          error: 'Remote execution timed out after 120000ms',
        },
      }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  try {
    const exitCode = await executeMeshShell(
      ['node', 'agentdock-mesh-shell.js', '-c', 'sleep 100'],
      {
        AGENTDOCK_MESH_NODE_ID: 'node:test-phone-123',
        AGENTDOCK_LOCAL_CORE_URL: `http://127.0.0.1:${port}`,
        AGENTDOCK_MESH_SHELL_TOKEN: 'test-scoped-shell-token',
      },
    );

    assert.equal(exitCode, 1);
  } finally {
    server.close();
  }
});

test('executeMeshShell handles Claude Code wrapping and writes cwd only inside the session temp directory', async () => {
  let receivedBody: any = null;
  const sessionTempDir = resolve(tmpdir(), `agentdock-claude-cwd-${Date.now()}`);
  const testCwdFile = resolve(sessionTempDir, 'claude-cwd');
  mkdirSync(sessionTempDir, { recursive: true });

  const server = createServer(async (req, res) => {
    if (req.url === '/api/local/v1/mesh/shell/execute' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      receivedBody = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          status: 'completed',
          result: {
            stdout: 'Filesystem Size Used Avail Use% Mounted on\n/dev/fuse 462G 280G 183G 61% /storage/emulated\n',
            stderr: '',
            exitCode: 0,
          },
        },
      }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  try {
    const exitCode = await executeMeshShell(
      [
        'node',
        'agentdock-mesh-shell.js',
        '-c',
        '-l',
        `source /home/ubuntu/.claude/shell-snapshots/snap.sh 2>/dev/null || true && eval 'df -h /storage/emulated' < /dev/null && pwd -P >| ${testCwdFile}`,
      ],
      {
        AGENTDOCK_MESH_NODE_ID: 'node:test-phone-123',
        AGENTDOCK_LOCAL_CORE_URL: `http://127.0.0.1:${port}`,
        AGENTDOCK_MESH_SHELL_TOKEN: 'test-scoped-shell-token',
        AGENTDOCK_MESH_CWD_DIR: sessionTempDir,
      },
    );

    assert.equal(exitCode, 0);
    assert.ok(receivedBody);
    // Verified: only the inner unwrapped command was sent to the remote device!
    assert.deepEqual(receivedBody.args, {
      program: 'sh',
      arguments: ['-c', 'df -h /storage/emulated'],
    });

    // Verified: the local cwd file expected by Claude Code was created on the host!
    assert.ok(existsSync(testCwdFile));
    assert.equal(readFileSync(testCwdFile, 'utf8'), process.cwd());
  } finally {
    if (existsSync(testCwdFile)) {
      unlinkSync(testCwdFile);
    }
    rmSync(sessionTempDir, { recursive: true, force: true });
    server.close();
  }
});

test('executeMeshShell ignores cwd output paths outside the session temp directory', async () => {
  const outsideDir = resolve(tmpdir(), `agentdock-outside-cwd-${Date.now()}`);
  const outsideFile = resolve(outsideDir, 'cwd');
  const sessionTempDir = resolve(tmpdir(), `agentdock-safe-cwd-${Date.now()}`);
  const symlinkDir = resolve(sessionTempDir, 'linked-outside');
  const symlinkFile = resolve(symlinkDir, 'cwd');
  mkdirSync(outsideDir, { recursive: true });
  mkdirSync(sessionTempDir, { recursive: true });
  symlinkSync(outsideDir, symlinkDir, 'dir');
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { status: 'completed', result: { exitCode: 0 } } }));
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as any).port;
  try {
    const exitCode = await executeMeshShell(
      ['node', 'agentdock-mesh-shell.js', '-c', `eval 'echo remote' < /dev/null && pwd -P >| ${outsideFile}`],
      {
        AGENTDOCK_MESH_NODE_ID: 'node:test-phone-123',
        AGENTDOCK_LOCAL_CORE_URL: `http://127.0.0.1:${port}`,
        AGENTDOCK_MESH_CWD_DIR: sessionTempDir,
      },
    );
    assert.equal(exitCode, 0);
    assert.equal(existsSync(outsideFile), false);
    await executeMeshShell(
      ['node', 'agentdock-mesh-shell.js', '-c', `eval 'echo remote' < /dev/null && pwd -P >| ${symlinkFile}`],
      {
        AGENTDOCK_MESH_NODE_ID: 'node:test-phone-123',
        AGENTDOCK_LOCAL_CORE_URL: `http://127.0.0.1:${port}`,
        AGENTDOCK_MESH_CWD_DIR: sessionTempDir,
      },
    );
    assert.equal(existsSync(symlinkFile), false);
  } finally {
    server.close();
    rmSync(outsideDir, { recursive: true, force: true });
    rmSync(sessionTempDir, { recursive: true, force: true });
  }
});
