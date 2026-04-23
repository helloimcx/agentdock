import type { DesktopConnectConfig } from '../../../../../packages/contracts/src/index.js';
import type { ChannelPlugin, ChannelRuntimeRegistration, PluginContext } from '../../../../../packages/plugin-sdk/src/index.js';
import { LocalCoreLarkGateway } from '../../gateway/local-core-lark-gateway.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';

export function createBuiltinLarkChannelPlugin(options: {
  store: LocalCoreAcpStore;
  readConfig: () => Promise<DesktopConnectConfig | null | undefined>;
  getWorkspaceRouter: () => WorkspaceRouter;
  log?: (message: string) => void;
}): ChannelPlugin {
  let runtime: ChannelRuntimeRegistration | null = null;
  let unsubscribeBridgeEvents: (() => void) | null = null;

  return {
    manifest: {
      id: 'builtin.channel-lark',
      kind: 'channel',
      version: '0.1.0',
      provides: [
        'channel:lark',
      ],
      configSchema: {
        fields: [
          { key: 'appId', type: 'string', label: 'App ID' },
          { key: 'appSecret', type: 'string', label: 'App Secret' },
        ],
      },
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
    createRuntime(ctx: PluginContext) {
      if (!runtime) {
        runtime = {
          channel: new LocalCoreLarkGateway({
            store: options.store,
            readConfig: options.readConfig,
            getWorkspaceRouter: options.getWorkspaceRouter,
            eventBus: ctx.bus,
            log: options.log,
          }),
        };
        unsubscribeBridgeEvents = ctx.bus.on('platform.bridge.updated', (event) => {
          void runtime?.channel.onBridgeEvent?.(event);
        });
      }
      return runtime;
    },
    async start() {
      await runtime?.channel.refreshBindings?.();
    },
    async stop() {
      unsubscribeBridgeEvents?.();
      unsubscribeBridgeEvents = null;
      runtime?.channel.close?.();
    },
  };
}
