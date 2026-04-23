import type { DesktopConnectConfig } from '../../../../../packages/contracts/src/index.js';
import type { ChannelPlugin, ChannelRuntimeRegistration, PluginContext } from '../../../../../packages/plugin-sdk/src/index.js';
import { LocalCoreLarkGateway } from '../../gateway/local-core-lark-gateway.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';

export function createBuiltinLarkChannelPlugin(options: {
  store: LocalCoreAcpStore;
  readConfig: () => Promise<DesktopConnectConfig | null | undefined>;
  getWorkspaceRouter: () => WorkspaceRouter;
  onStateChanged?: () => void;
  log?: (message: string) => void;
}): ChannelPlugin {
  let runtime: ChannelRuntimeRegistration | null = null;

  return {
    manifest: {
      id: 'builtin.channel-lark',
      kind: 'channel',
      version: '0.1.0',
      provides: [
        'channel:lark',
      ],
    },
    capabilities: {
      channels: [
        {
          id: 'channel.lark',
          platform: 'lark',
          routeType: 'channel.chat',
          displayName: 'LocalCore Lark',
        },
      ],
    },
    createRuntime(_ctx: PluginContext) {
      if (!runtime) {
        runtime = {
          channel: new LocalCoreLarkGateway({
            store: options.store,
            readConfig: options.readConfig,
            getWorkspaceRouter: options.getWorkspaceRouter,
            onStateChanged: options.onStateChanged,
            log: options.log,
          }),
        };
      }
      return runtime;
    },
    async start() {
      await runtime?.channel.refreshBindings?.();
    },
    async stop() {
      runtime?.channel.close?.();
    },
  };
}
