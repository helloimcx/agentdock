import type { DesktopConnectConfig } from '@cc/superai-contracts';
import type { ChannelPlugin } from '@cc/plugin-sdk';
import { LocalCoreLarkGateway } from '../../channel/lark/local-core-lark-gateway.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import { createBuiltinChannelPlugin } from '../../channel/shared/plugin.js';

export function createBuiltinLarkChannelPlugin(options: {
  store: LocalCoreAcpStore;
  readConfig: () => Promise<DesktopConnectConfig | null | undefined>;
  getWorkspaceRouter: () => WorkspaceRouter;
  log?: (message: string) => void;
}): ChannelPlugin {
  return createBuiltinChannelPlugin({
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
    channels: [
      {
        id: 'channel.lark',
        platform: 'lark',
        routeType: 'channel.chat',
        displayName: 'LocalCore Lark',
      },
    ],
    createChannel: (ctx) => new LocalCoreLarkGateway({
      store: options.store,
      readConfig: options.readConfig,
      getWorkspaceRouter: options.getWorkspaceRouter,
      eventBus: ctx.bus,
      log: options.log,
    }),
  });
}
