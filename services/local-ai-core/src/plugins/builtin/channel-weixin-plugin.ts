import type { DesktopConnectConfig } from '../../../../../packages/contracts/src/index.js';
import type { ChannelPlugin } from '../../../../../packages/plugin-sdk/src/index.js';
import { LocalCoreWeixinGateway } from '../../channel/weixin/local-core-weixin-gateway.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import { createBuiltinChannelPlugin } from '../../channel/shared/plugin.js';

export function createBuiltinWeixinChannelPlugin(options: {
  store: LocalCoreAcpStore;
  readConfig: () => Promise<DesktopConnectConfig | null | undefined>;
  getWorkspaceRouter: () => WorkspaceRouter;
  log?: (message: string) => void;
}): ChannelPlugin {
  return createBuiltinChannelPlugin({
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
    channels: [
      {
        id: 'channel.weixin',
        platform: 'weixin',
        routeType: 'channel.chat',
        displayName: 'LocalCore WeChat',
      },
    ],
    createChannel: (ctx) => new LocalCoreWeixinGateway({
      store: options.store,
      readConfig: options.readConfig,
      getWorkspaceRouter: options.getWorkspaceRouter,
      eventBus: ctx.bus,
      log: options.log,
    }),
  });
}
