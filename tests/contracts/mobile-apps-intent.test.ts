import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOBILE_APPS_REGISTRY,
  listMobileApps,
  getMobileApp,
  buildAmStartCommand,
  buildDirectIntentCommand,
} from '../../services/local-ai-core/src/mesh/mobile-apps/index.js';
import { runMobileAppsCli } from '../../services/local-ai-core/src/mesh/mobile-apps/cli.js';
import {
  buildDeviceClaudeMd,
  buildDeviceSystemPrompt,
} from '../../services/local-ai-core/src/execution/remote-mesh/device-environment.js';

test('Mobile Apps Registry contains at least 30 supported actions across key applications', () => {
  const apps = listMobileApps();
  assert.ok(apps.length >= 8, `Expected at least 8 apps, got ${apps.length}`);

  let totalActions = 0;
  for (const app of apps) {
    totalActions += Object.keys(app.actions).length;
  }
  assert.ok(totalActions >= 30, `Expected at least 30 actions, got ${totalActions}`);

  // Must include core apps
  const appIds = apps.map((a) => a.id);
  assert.ok(appIds.includes('alipay'), 'Must include alipay');
  assert.ok(appIds.includes('wechat'), 'Must include wechat');
  assert.ok(appIds.includes('amap'), 'Must include amap');
  assert.ok(appIds.includes('meituan'), 'Must include meituan');
  assert.ok(appIds.includes('taobao'), 'Must include taobao');
  assert.ok(appIds.includes('system'), 'Must include system');
});

test('Alipay actions produce valid am start commands', () => {
  const payCmd = buildAmStartCommand('alipay', 'pay');
  assert.match(payCmd, /^am start -a android\.intent\.action\.VIEW -d ['"]alipayqr:\/\/platformapi\/startapp\?saId=20000056['"]/);

  const scanCmd = buildAmStartCommand('alipay', 'scan');
  assert.match(scanCmd, /^am start -a android\.intent\.action\.VIEW -d ['"]alipayqr:\/\/platformapi\/startapp\?saId=10000007['"]/);

  const rideCmd = buildAmStartCommand('alipay', 'ride');
  assert.match(rideCmd, /^am start -a android\.intent\.action\.VIEW -d ['"]alipays:\/\/platformapi\/startapp\?appId=20000193['"]/);
});

test('Navigation actions validate and encode parameters', () => {
  const navCmd = buildAmStartCommand('amap', 'navigate', { destination: '广州塔' });
  assert.ok(navCmd.includes('amapuri://route/plan'));
  assert.ok(navCmd.includes(encodeURIComponent('广州塔')));

  // Throws on missing required parameter
  assert.throws(
    () => buildAmStartCommand('amap', 'navigate', {}),
    /Missing required parameter: destination/,
  );
});

test('Search actions validate parameters and prevent shell injection', () => {
  const maliciousInput = "test'; rm -rf /; echo 'hacked";
  const searchCmd = buildAmStartCommand('meituan', 'search', { keyword: maliciousInput });
  assert.ok(searchCmd.startsWith('am start'));
  // Semicolon and single quotes should be safely escaped or URL-encoded
  assert.ok(!searchCmd.includes('; rm -rf /;'));
});

test('Default action opens main app component or default uri', () => {
  const alipayMain = buildAmStartCommand('alipay');
  assert.ok(alipayMain.startsWith('am start'));

  const wechatMain = buildAmStartCommand('wechat');
  assert.ok(wechatMain.includes('com.tencent.mm'));
});

test('buildDirectIntentCommand safely builds custom uri intent and preserves & query params', () => {
  const direct = buildDirectIntentCommand('snssdk1128://feed?tab=1&sub=2');
  assert.equal(direct, "am start -a android.intent.action.VIEW -d 'snssdk1128://feed?tab=1&sub=2'");

  // Prevents shell escape
  assert.throws(
    () => buildDirectIntentCommand("weixin://dl/scan'; id"),
    /Invalid characters in intent URI/,
  );
});

test('runMobileAppsCli handles space-separated flags and dry-run output', async () => {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(' '));
  try {
    await runMobileAppsCli(['open', 'amap', 'navigate', '--destination', '广州塔', '--dry-run']);
    assert.ok(logs.some((l) => l.includes('amapuri://route/plan') && l.includes(encodeURIComponent('广州塔'))));

    logs.length = 0;
    await runMobileAppsCli(['list', '--json']);
    const parsed = JSON.parse(logs[0]);
    assert.ok(Array.isArray(parsed) && parsed.length >= 8);

    logs.length = 0;
    await runMobileAppsCli(['intent', 'snssdk1128://feed?tab=1&sub=2', '--dry-run']);
    assert.ok(logs[0].includes('snssdk1128://feed?tab=1&sub=2'));
  } finally {
    console.log = origLog;
  }
});

test('device-environment prompts inject mobile-apps on Android only', () => {
  const androidMd = buildDeviceClaudeMd({ platform: 'android', label: 'Xiaomi-13-Pro' });
  assert.ok(androidMd.includes('mobile-apps'), 'Android CLAUDE.md must mention mobile-apps');
  assert.ok(androidMd.includes('alipay pay'), 'Android CLAUDE.md must give mobile-apps examples');

  const macMd = buildDeviceClaudeMd({ platform: 'darwin', label: 'MacBook' });
  assert.ok(!macMd.includes('mobile-apps'), 'Mac CLAUDE.md should not mention mobile-apps');

  const androidPrompt = buildDeviceSystemPrompt({ platform: 'android', label: 'Xiaomi-13-Pro' });
  assert.ok(androidPrompt.includes('mobile-apps'), 'Android system prompt must mention mobile-apps');

  const macPrompt = buildDeviceSystemPrompt({ platform: 'darwin', label: 'MacBook' });
  assert.ok(!macPrompt.includes('mobile-apps'), 'Mac system prompt should not mention mobile-apps');
});
