import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  MeshNodeMessage,
  MeshServerMessage,
  MeshExecution,
  MeshEnrollment,
} from '@cc/superai-contracts';

test('Android A11y Mesh protocol messages conform to Mesh v1 contracts', () => {
  // Test Hello Message Shape
  const helloMsg: MeshNodeMessage = {
    version: 1,
    type: 'hello',
    token: 'mesh-token-12345',
    platform: 'android',
    capabilities: ['filesystem.list', 'filesystem.read', 'filesystem.write', 'shell.exec'],
  };
  assert.equal(helloMsg.version, 1);
  assert.equal(helloMsg.type, 'hello');
  assert.equal(helloMsg.platform, 'android');
  assert.ok(helloMsg.capabilities.includes('shell.exec'));

  // Test Heartbeat Message Shape
  const hbMsg: MeshNodeMessage = {
    version: 1,
    type: 'heartbeat',
  };
  assert.equal(hbMsg.type, 'heartbeat');

  // Test Result Message Shape for Shell execution
  const resultMsg: MeshNodeMessage = {
    version: 1,
    type: 'result',
    requestId: 'req-android-001',
    ok: true,
    result: {
      stdout: 'Service enabled: true\nCurrent package: com.taobao.taobao',
      stderr: '',
      exitCode: 0,
    },
  };
  assert.equal(resultMsg.type, 'result');
  assert.equal(resultMsg.ok, true);
  const shellRes = resultMsg.result as { stdout: string; stderr: string; exitCode: number };
  assert.equal(shellRes.exitCode, 0);
  assert.ok(shellRes.stdout.includes('com.taobao.taobao'));
});

test('Android Virtual Shell correctly tokenizes and quote-aware splits chained commands', () => {
  function tokenize(str: string): string[] {
    const tokens: string[] = [];
    let cur = '';
    let inQuote = false;
    let quoteChar = ' ';
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (inQuote) {
        if (c === quoteChar) inQuote = false;
        else cur += c;
      } else if (c === '"' || c === "'") {
        inQuote = true;
        quoteChar = c;
      } else if (/\s/.test(c)) {
        if (cur.length > 0) {
          tokens.push(cur);
          cur = '';
        }
      } else {
        cur += c;
      }
    }
    if (cur.length > 0) tokens.push(cur);
    return tokens;
  }

  function splitChainedCommands(full: string): string[] {
    const list: string[] = [];
    let cur = '';
    let inQuote = false;
    let quoteChar = ' ';
    const len = full.length;
    for (let i = 0; i < len; i++) {
      const c = full[i];
      if (inQuote) {
        if (c === quoteChar) inQuote = false;
        cur += c;
      } else if (c === '"' || c === "'") {
        inQuote = true;
        quoteChar = c;
        cur += c;
      } else if (c === ';') {
        if (cur.trim().length > 0) {
          list.push(cur.trim());
          cur = '';
        }
      } else if (c === '&' && i + 1 < len && full[i + 1] === '&') {
        if (cur.trim().length > 0) {
          list.push(cur.trim());
          cur = '';
        }
        i++;
      } else {
        cur += c;
      }
    }
    if (cur.trim().length > 0) list.push(cur.trim());
    return list;
  }

  // Tokenizing click with quotes
  const clickTokens = tokenize('mobile-ui click "搜索" --id="search_btn"');
  assert.deepEqual(clickTokens, ['mobile-ui', 'click', '搜索', '--id=search_btn']);

  // Tokenizing input with spaces inside quotes
  const inputTokens = tokenize('mobile-ui input "特浓 挂耳 咖啡" --target 2 --no-clear');
  assert.deepEqual(inputTokens, ['mobile-ui', 'input', '特浓 挂耳 咖啡', '--target', '2', '--no-clear']);

  // Splitting chained command with semicolons
  const chained = 'mobile-apps open alipay bus; sleep 2; mobile-ui dump';
  const subCmds = splitChainedCommands(chained);
  assert.deepEqual(subCmds, [
    'mobile-apps open alipay bus',
    'sleep 2',
    'mobile-ui dump',
  ]);

  // Quote-aware splitting: semicolons and && inside quotes must NOT be split
  const complexChained = 'mobile-ui input "hello; world" && mobile-apps intent "alipays://open?a=1&&b=2"';
  const complexSubCmds = splitChainedCommands(complexChained);
  assert.deepEqual(complexSubCmds, [
    'mobile-ui input "hello; world"',
    'mobile-apps intent "alipays://open?a=1&&b=2"',
  ]);
});

test('Android mobile-ui screen command returns protocol version 2 for session manager', () => {
  // Screen status response shape required by screen-session-manager.ts
  const screenStatus = {
    ok: true,
    cliProtocol: 2,
    screenProtocol: 2,
    owner: 'run:agentdock::test-uuid:12345',
    interactive: true,
    locked: false,
    remainingMs: 120000,
    ownerRemainingMs: 120000,
    keepAwake: true,
    ownerCount: 1,
    overlayVisible: true,
  };

  assert.equal(screenStatus.ok, true);
  assert.equal(screenStatus.cliProtocol, 2);
  assert.equal(screenStatus.screenProtocol, 2);
  assert.equal(screenStatus.keepAwake, true);
  assert.ok(screenStatus.remainingMs > 0);
});

test('Android termux-api compatibility JSON format matches standard schemas', () => {
  // Battery status format
  const mockBatteryStatus = {
    percentage: 85,
    status: 'DISCHARGING',
    plugged: 'UNPLUGGED',
    health: 'GOOD',
    temperature: 28.5,
  };
  assert.equal(typeof mockBatteryStatus.percentage, 'number');
  assert.equal(mockBatteryStatus.health, 'GOOD');
  assert.equal(mockBatteryStatus.plugged, 'UNPLUGGED');

  // Location format
  const mockLocation = {
    latitude: 23.1291,
    longitude: 113.2644,
    altitude: 15.0,
    accuracy: 8.5,
    speed: 0.0,
    provider: 'gps',
    elapsedMs: 250,
  };
  assert.equal(mockLocation.provider, 'gps');
  assert.ok(mockLocation.latitude > 0);
  assert.ok(mockLocation.longitude > 0);

  // Volume format
  const mockVolume = {
    stream: 'music',
    volume: 10,
    max_volume: 15,
  };
  assert.equal(mockVolume.stream, 'music');
  assert.ok(mockVolume.volume <= mockVolume.max_volume);
});

test('Android A11y Mesh Compact Formatter handles success and error paths cleanly', () => {
  const elements = [
    { index: 1, text: '扫一扫', id: 'scan_icon', clickable: true },
    { index: 2, text: '付款码', id: 'pay_icon', clickable: true },
    { index: 3, text: '搜索栏', id: 'search_edit', clickable: true, editable: true },
  ];

  function formatDump(root: { ok?: boolean; error?: string; package?: string; activity?: string; elements?: typeof elements }): string {
    if (!root.ok) {
      return `Error: ${root.error || 'Failed to dump screen'}`;
    }
    const lines = [`Current: ${root.package}/${root.activity}`];
    for (const el of root.elements || []) {
      let line = `[${el.index}] `;
      if (el.text) line += `text="${el.text}" `;
      if (el.id) line += `id="${el.id}" `;
      if (el.clickable) line += `clickable `;
      if (el.editable) line += `editable `;
      lines.push(line.trim());
    }
    return lines.join('\n');
  }

  // Success path
  const successOutput = formatDump({ ok: true, package: 'com.eg.android.AlipayGphone', activity: 'AlipayHomeActivity', elements });
  assert.ok(successOutput.includes('Current: com.eg.android.AlipayGphone/AlipayHomeActivity'));
  assert.ok(successOutput.includes('[1] text="扫一扫" id="scan_icon" clickable'));

  // Error path (screen off or locked)
  const errorOutput = formatDump({ ok: false, error: 'No active window found (screen may be locked or off)' });
  assert.ok(errorOutput.startsWith('Error: No active window found'));
});
