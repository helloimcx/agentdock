import { execSync } from 'node:child_process';
import { listMobileApps, getMobileApp, buildAmStartCommand, buildDirectIntentCommand } from './builder.js';

function printHelp(): void {
  console.log(`mobile-apps: Android 常用 App 语义快捷指令工具

用法:
  mobile-apps list [--json]                    # 列出所有支持的应用与动作
  mobile-apps open <app> [action] [options]    # 打开指定应用或直达功能
  mobile-apps intent <uri> [--dry-run]         # 打开自定义 URL Scheme
  mobile-apps help                             # 查看帮助文档

常见场景:
  mobile-apps open alipay pay                  # 支付宝付款码
  mobile-apps open alipay scan                 # 支付宝扫一扫
  mobile-apps open alipay ride                 # 支付宝乘车码
  mobile-apps open wechat scan                 # 微信扫一扫
  mobile-apps open wechat pay                  # 微信收付款
  mobile-apps open amap navigate --destination="广州塔" # 高德地图直接导航
  mobile-apps open meituan search --keyword="咖啡"     # 美团搜索
  mobile-apps open system settings             # 系统设置
  mobile-apps open system wifi                 # WiFi 设置

调试标志:
  --dry-run   仅打印生成的 am start 命令行，不实际在终端执行
`);
}

function handleList(isJson: boolean): void {
  const apps = listMobileApps();
  if (isJson) {
    console.log(JSON.stringify(apps, null, 2));
    return;
  }
  console.log('=== 支持的移动应用与动作列表 ===\n');
  for (const app of apps) {
    console.log(`📱 ${app.displayName} [${app.id}] (包名: ${app.packageName})`);
    for (const [actionId, action] of Object.entries(app.actions)) {
      const isDefault = actionId === app.defaultActionId ? ' (默认)' : '';
      const paramsDesc = (action.parameters || []).map((p) => `--${p.name}=<${p.description}>`).join(' ');
      console.log(`   * ${actionId}${isDefault}: ${action.description} ${paramsDesc}`);
    }
    console.log('');
  }
}

function parseCliArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  let isDryRun = false;
  let isJson = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      continue;
    }
    if (arg === '--dry-run') {
      isDryRun = true;
      continue;
    }
    if (arg === '--json') {
      isJson = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = 'true';
        }
      }
      continue;
    }
    positional.push(arg);
  }

  return { flags, positional, isDryRun, isJson };
}

function executeOrDryRun(cmd: string, isDryRun: boolean): void {
  if (isDryRun) {
    console.log(cmd);
    return;
  }
  console.log(`[mobile-apps] 执行: ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (error) {
    console.error(`[mobile-apps] 启动失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

export async function runMobileAppsCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { flags, positional, isDryRun, isJson } = parseCliArgs(argv);
  const command = positional[0] || 'help';

  if (command === 'list') {
    handleList(isJson);
    return;
  }

  if (command === 'intent') {
    const uri = positional[1];
    if (!uri) {
      console.error('错误: 请提供目标 URI。示例: mobile-apps intent "snssdk1128://"');
      process.exitCode = 1;
      return;
    }
    executeOrDryRun(buildDirectIntentCommand(uri), isDryRun);
    return;
  }

  if (command === 'open') {
    const appId = positional[1];
    if (!appId) {
      console.error('错误: 请提供应用 ID。使用 `mobile-apps list` 查看支持的应用。');
      process.exitCode = 1;
      return;
    }
    const actionId = positional[2];
    try {
      const cmd = buildAmStartCommand(appId, actionId, flags);
      executeOrDryRun(cmd, isDryRun);
    } catch (error) {
      console.error(`[mobile-apps] 错误: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
    return;
  }

  printHelp();
}
