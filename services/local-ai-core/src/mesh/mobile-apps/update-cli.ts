import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openSync, closeSync, mkdirSync } from 'node:fs';

export async function runNodeUpdateCli(): Promise<void> {
  const logDir = join(homedir(), '.agentdock');
  const logFile = join(logDir, 'update.log');
  const lockFile = join(logDir, 'update.lock');

  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    // Best-effort
  }

  console.log('[agentdock-update] 正在启动脱离后台自更新任务...');

  const updateScript = [
    `lock="${lockFile}"`,
    'if [ -f "$lock" ]; then',
    '  echo "⚠️ 检测到已有正在进行的更新任务，请勿重复执行。"',
    '  exit 0',
    'fi',
    'touch "$lock"',
    'trap \'rm -f "$lock"\' EXIT INT TERM',
    'sleep 1',
    'echo "=== [agentdock-update] 开始更新 ==="',
    'npm install -g --registry=https://registry.npmmirror.com @kafca/agentdock@latest',
    'if [ -f /sdcard/run-agentdock.sh ]; then',
    '  bash /sdcard/run-agentdock.sh restart',
    'elif command -v pm2 >/dev/null 2>&1; then',
    '  pm2 restart agentdock || true',
    'fi',
    'echo "=== [agentdock-update] 更新完成 ==="',
    'rm -f "$lock"',
  ].join('\n');

  try {
    const outFd = openSync(logFile, 'a');
    try {
      const child = spawn('sh', ['-c', updateScript], {
        detached: true,
        stdio: ['ignore', outFd, outFd],
      });
      child.unref();
    } finally {
      closeSync(outFd);
    }

    console.log('[agentdock-update] ✅ 后台更新任务已成功脱离主进程启动！');
    console.log(`[agentdock-update] 日志记录于: ${logFile}`);
    console.log('[agentdock-update] 客户端将在 3-5 秒内完成包更新并自动重新连接服务端。');
  } catch (error) {
    console.error(`[agentdock-update] 启动更新失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
