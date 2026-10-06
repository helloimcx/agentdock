import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { MobileUiClient } from '../../services/local-ai-core/src/mesh/mobile-ui/client.js';
import { formatElementsCompact } from '../../services/local-ai-core/src/mesh/mobile-ui/formatter.js';
import { runMobileUiCli } from '../../services/local-ai-core/src/mesh/mobile-ui/cli.js';

const ready = { ok: true, interactive: true, locked: false, keepAwake: true, remainingMs: 120000, ownerRemainingMs: 120000, cliProtocol: 2, screenProtocol: 2 };

async function withBridge(
  respond: (path: string, method: string, body: any) => [number, unknown],
  run: (client: MobileUiClient, baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const [status, value] = respond(req.url!, req.method!, body ? JSON.parse(body) : undefined);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await run(new MobileUiClient({ baseUrl }), baseUrl); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

test('UI commands check unlocked state without creating a residual manual hold', async () => {
  const requests: string[] = [];
  await withBridge((path, method, body) => {
    requests.push(`${method} ${path}`);
    if (path === '/api/screen') {
      assert.equal(method, 'GET');
      assert.equal(body, undefined);
      return [200, ready];
    }
    return [200, { ok: true, elements: [] }];
  }, async client => {
    await client.dump(); await client.click({ index: 1 });
    await client.input({ text: '搜索' }); await client.scroll({ direction: 'down' });
    await client.action({ action: 'back' });
  });
  assert.equal(requests.length, 10);
  for (let i = 0; i < requests.length; i += 2) assert.equal(requests[i], 'GET /api/screen');
});

test('screen lock and screen-off fail before UI interaction, including wait', async () => {
  for (const state of [{ interactive: true, locked: true }, { interactive: false, locked: false }]) {
    await withBridge(path => {
      assert.equal(path, '/api/screen');
      return [200, { ...ready, ...state, ok: false, code: 'USER_UNLOCK_REQUIRED', error: 'Unlock the phone' }];
    }, async client => {
      await assert.rejects(client.click({ point: [20, 30] }), /Unlock/);
      await assert.rejects(client.wait({ text: '搜索', timeoutSeconds: 1 }), /Unlock/);
    });
  }
});

test('only missing screen endpoint falls back to legacy operation', async () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = msg => warnings.push(String(msg));
  try {
    await withBridge(path => path === '/api/screen' ? [404, { error: 'Not Found' }] : [200, { ok: true }],
      async client => { await client.click({ index: 1 }); });
    assert.match(warnings.join(''), /keep-awake.*unavailable/i);
  } finally { console.warn = originalWarn; }
  for (const response of [[500, { error: 'broken bridge' }], [200, { ok: false, error: 'overlay failed' }], [200, { ok: true }]] as [number, unknown][]) {
    await withBridge(path => { assert.equal(path, '/api/screen'); return response; },
      async client => { await assert.rejects(client.dump()); });
  }
});

test('status does not renew and explicit screen release uses no acquire', async () => {
  const requests: unknown[] = [];
  await withBridge((path, method, body) => {
    requests.push({ path, method, body }); return [200, { ...ready, keepAwake: false }];
  }, async client => {
    await client.getStatus(); await client.getScreenStatus(); await client.releaseScreen();
    for (const duration of [0, -1, 601, 1.5, NaN]) await assert.rejects(client.keepScreenAwake(duration), /duration/i);
  });
  assert.deepEqual(requests, [
    { path: '/api/status', method: 'GET', body: undefined },
    { path: '/api/screen', method: 'GET', body: undefined },
    { path: '/api/screen', method: 'POST', body: { action: 'release' } },
  ]);
});

test('screen CLI validates durations, honors dry-run and sends explicit lifecycle commands', async () => {
  const calls: unknown[] = [];
  await withBridge((path, method, body) => {
    calls.push({ path, method, body });
    return [200, body?.action === 'release' ? { ...ready, keepAwake: false, remainingMs: 0 } : ready];
  }, async (_, baseUrl) => {
    await runMobileUiCli(['screen', 'keep-awake', '--duration', '600', '--base-url', baseUrl]);
    await runMobileUiCli(['screen', 'release', '--base-url', baseUrl]);
    await runMobileUiCli(['screen', 'keep-awake', '--dry-run', '--base-url', baseUrl]);
    for (const value of ['0', '601', '1.5', '2abc']) {
      await assert.rejects(runMobileUiCli(['screen', 'keep-awake', '--duration', value, '--dry-run']), /duration/i);
    }
  });
  assert.deepEqual(calls, [
    { path: '/api/screen', method: 'POST', body: { action: 'acquire', durationSeconds: 600 } },
    { path: '/api/screen', method: 'POST', body: { action: 'release' } },
  ]);
});

test('manual lock racing with a prepared UI request is surfaced, not swallowed by wait', async () => {
  await withBridge(path => path === '/api/screen' ? [200, ready] : [200, {
    ok: false, code: 'USER_UNLOCK_REQUIRED', error: 'Unlock the phone',
  }], async client => {
    await assert.rejects(client.click({ index: 1 }), /Unlock/);
    await assert.rejects(client.wait({ text: '搜索', timeoutSeconds: 1 }), /Unlock/);
  });
});

test('a release response still reporting a hold is not accepted as success', async () => {
  await withBridge(() => [200, ready], async client => {
    await assert.rejects(client.releaseScreen(), /release screen hold/i);
  });
});

test('filtered dump indices remain unchanged through formatting and subsequent click', async () => {
  await withBridge((path, _, body) => {
    if (path === '/api/screen') return [200, ready];
    if (path.startsWith('/api/dump')) return [200, {
      ok: true, package: 'com.taobao.taobao', screenWidth: 1080, screenHeight: 2400, count: 1,
      elements: [{ index: 3, text: '搜索', className: 'android.widget.Button', bounds: [100, 120, 200, 160],
        center: [150, 140], clickable: true, editable: false, scrollable: false }],
    }];
    assert.equal(path, '/api/click');
    assert.equal(body.index, 3);
    return [200, { ok: true }];
  }, async client => {
    const dump = await client.dump();
    assert.match(formatElementsCompact(dump), /\[3\] \[Button\]/);
    await client.click({ index: dump.elements[0].index });
  });
});


test('owned renewal and release preserve other owners and carry the run identifier', async () => {
  const owner = 'run:agentdock::b9e9e75b-50cd-4d81-835f-5277daa91cc3:1791108000000';
  const calls: unknown[] = [];
  await withBridge((_, method, body) => {
    calls.push(body);
    return [200, { ...ready, owner: body.owner, ownerRemainingMs: body.action === 'release' ? 0 : 120000 }];
  }, async client => {
    await client.keepScreenAwake(120, owner);
    await client.renewScreenAwake(120, owner);
    await client.releaseScreen(owner);
  });
  assert.deepEqual(calls, [
    { action: 'status', owner },
    { action: 'acquire', durationSeconds: 120, owner },
    { action: 'renew', durationSeconds: 120, owner },
    { action: 'release', owner },
  ]);
});
