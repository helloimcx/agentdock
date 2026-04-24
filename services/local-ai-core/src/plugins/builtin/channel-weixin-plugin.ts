import type { DesktopConnectConfig } from '../../../../../packages/contracts/src/index.js';
import type { ChannelPlugin, ChannelRuntimeRegistration, PluginContext } from '../../../../../packages/plugin-sdk/src/index.js';
import { LocalCoreWeixinGateway } from '../../gateway/local-core-weixin-gateway.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';

export function createBuiltinWeixinChannelPlugin(options: {
  store: LocalCoreAcpStore;
  readConfig: () => Promise<DesktopConnectConfig | null | undefined>;
  getWorkspaceRouter: () => WorkspaceRouter;
  log?: (message: string) => void;
}): ChannelPlugin {
  let runtime: ChannelRuntimeRegistration | null = null;
  let unsubscribeBridgeEvents: (() => void) | null = null;

  return {
    manifest: {
      id: 'builtin.channel-weixin',
      kind: 'channel',
      version: '0.1.0',
      provides: [
        'channel:weixin',
      ],
      configSchema: {
        fields: [],
      },
    },
    capabilities: {
      channels: [
        {
          id: 'channel.weixin',
          platform: 'weixin',
          routeType: 'channel.chat',
          displayName: 'LocalCore WeChat',
        },
      ],
    },
    createRuntime(ctx: PluginContext) {
      if (!runtime) {
        runtime = {
          channel: new LocalCoreWeixinGateway({
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
