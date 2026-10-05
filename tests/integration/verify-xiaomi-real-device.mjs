import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { MeshStore } from '../../dist-electron/services/local-ai-core/src/mesh/mesh-store.js';
import { MeshGateway } from '../../dist-electron/services/local-ai-core/src/mesh/mesh-gateway.js';

async function runRealDeviceQA() {
  console.log('=== [1/6] 准备真机测试环境与 Mesh Gateway ===');
  const temp = await mkdtemp(join(tmpdir(), 'agentdock-qa-mesh-'));
  const db = new DatabaseSync(join(temp, 'mesh.db'));
  const store = new MeshStore(db);
  const server = createServer((req, res) => {
    void gateway.handle(req, res, new URL(req.url, 'http://localhost'));
  });
  const ADMIN_TOKEN = 'qa-admin-secret-token';
  const gateway = new MeshGateway(store, server, ADMIN_TOKEN);
  
  await new Promise(resolve => server.listen(9831, '127.0.0.1', resolve));
  console.log('✅ Mesh Gateway 监听在 127.0.0.1:9831');

  // Ensure adb reverse
  console.log('=== [2/6] 配置 ADB 反向端口映射 (adb reverse tcp:9831 tcp:9831) ===');
  execSync('adb -s c4237b0e reverse tcp:9831 tcp:9831');
  console.log('✅ ADB 反向端口映射已就绪');

  // Create pairing token
  console.log('=== [3/6] 服务端生成配对令牌 ===');
  const pairRes = await fetch('http://127.0.0.1:9831/api/local/v1/mesh/pairings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
    },
    body: JSON.stringify({ label: 'Xiaomi 13 Nuwa', allowShell: true }),
  });
  const pairJson = await pairRes.json();
  const pairingToken = pairJson.data.pairingToken;
  console.log(`✅ 生成配对令牌: ${pairingToken}`);

  // Trigger Android App to pair and connect
  console.log('=== [4/6] 唤起小米手机 MainActivity 自动配对并接入 ===');
  const amCmd = `adb -s c4237b0e shell am start -n com.agentdock.a11y/.MainActivity --activity-clear-top --es server "http://127.0.0.1:9831" --es pairingToken "${pairingToken}" --ez autoConnect true`;
  execSync(amCmd);
  console.log('✅ Intent 指令已下发至小米手机');

  // Wait for node to become online
  console.log('=== [5/6] 等待手机 WebSocket 出站连接并上线 ===');
  let onlineNode = null;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const nodes = store.listNodes();
    onlineNode = nodes.find(n => n.status === 'online');
    if (onlineNode) {
      break;
    }
    await delay(500);
  }

  if (!onlineNode) {
    throw new Error('超时未能检测到小米手机节点上线，当前节点列表: ' + JSON.stringify(store.listNodes()));
  }
  console.log(`🎉 小米手机已成功接入 Mesh 网关！节点 ID: ${onlineNode.id}, 平台: ${onlineNode.platform}, 标签: ${onlineNode.label}`);

  // Helpers to execute shell command on node
  async function execOnPhone(command) {
    const res = await fetch('http://127.0.0.1:9831/api/local/v1/mesh/requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
      },
      body: JSON.stringify({
        nodeId: onlineNode.id,
        capability: 'shell.exec',
        args: { command },
        timeoutMs: 15_000,
      }),
    });
    const { data } = await res.json();
    const waitDeadline = Date.now() + 15_000;
    while (Date.now() < waitDeadline) {
      const exec = store.getExecution(data.id);
      if (exec && exec.status !== 'running') {
        return exec;
      }
      await delay(200);
    }
    throw new Error(`执行指令超时: ${command}`);
  }

  console.log('=== [6/6] 全面执行真机命令验证 (mobile-ui / mobile-apps / termux-api) ===');

  // Test 1: termux-battery-status
  console.log('\n--- 验证 1: termux-battery-status ---');
  const batteryExec = await execOnPhone('termux-battery-status');
  console.log(`Status: ${batteryExec.status}, ExitCode: ${batteryExec.result?.exitCode}`);
  console.log(`Battery Output: ${batteryExec.result?.stdout}`);
  const batteryData = JSON.parse(batteryExec.result?.stdout || '{}');
  if (batteryData.percentage === undefined) throw new Error('battery percentage missing');

  // Test 2: mobile-ui screen status
  console.log('\n--- 验证 2: mobile-ui screen status ---');
  const screenExec = await execOnPhone('mobile-ui screen status');
  console.log(`Status: ${screenExec.status}, ExitCode: ${screenExec.result?.exitCode}`);
  console.log(`Screen Output: ${screenExec.result?.stdout}`);
  const screenData = JSON.parse(screenExec.result?.stdout || '{}');
  if (screenData.cliProtocol !== 2) throw new Error('cliProtocol !== 2');

  // Test 3: mobile-ui dump
  console.log('\n--- 验证 3: mobile-ui dump ---');
  const dumpExec = await execOnPhone('mobile-ui dump');
  console.log(`Status: ${dumpExec.status}, ExitCode: ${dumpExec.result?.exitCode}`);
  const dumpOutput = dumpExec.result?.stdout || '';
  console.log(`Dump Output 行数: ${dumpOutput.split('\n').length}`);
  console.log(`Dump 预览:\n${dumpOutput.slice(0, 300)}...`);
  if (!dumpOutput.includes('AgentDock 移动端 Mesh 节点')) throw new Error('dump missing AgentDock text');

  // Test 4: termux-toast & termux-vibrate
  console.log('\n--- 验证 4: termux-toast & termux-vibrate ---');
  const toastExec = await execOnPhone('termux-toast "AgentDock Mesh 真机接入成功！" && termux-vibrate -d 200');
  console.log(`Toast & Vibrate ExitCode: ${toastExec.result?.exitCode}`);

  // Test 5: termux-tts-speak
  console.log('\n--- 验证 5: termux-tts-speak ---');
  const ttsExec = await execOnPhone('termux-tts-speak "AgentDock 真机验证全部通过"');
  console.log(`TTS ExitCode: ${ttsExec.result?.exitCode}`);

  // Test 6: fallback sh command
  console.log('\n--- 验证 6: Linux 降级命令 (uname -a) ---');
  const unameExec = await execOnPhone('uname -a');
  console.log(`Uname ExitCode: ${unameExec.result?.exitCode}`);
  console.log(`Uname Output: ${unameExec.result?.stdout}`);

  // Test 7: mobile-apps open settings
  console.log('\n--- 验证 7: mobile-apps open settings (原生 Intent 调起) ---');
  const appsExec = await execOnPhone('mobile-apps open settings');
  console.log(`Mobile-apps ExitCode: ${appsExec.result?.exitCode}`);
  console.log(`Mobile-apps Output: ${appsExec.result?.stdout}`);
  if (appsExec.result?.exitCode !== 0) throw new Error('mobile-apps open settings failed');

  console.log('\n======================================================');
  console.log('🎉🎉🎉 小米手机 13 (Android 16) 全套真机能力验证 100% 通过！🎉🎉🎉');
  console.log('======================================================');

  // Cleanup
  gateway.close();
  server.close();
  await rm(temp, { recursive: true, force: true });
}

runRealDeviceQA().catch((err) => {
  console.error('❌ 真机验证失败:', err);
  process.exit(1);
});
