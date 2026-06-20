import type {
  ChannelCapability,
  ChannelPlugin,
  ChannelRuntime,
  ChannelRuntimeRegistration,
  PluginContext,
  PluginManifest,
} from '@cc/plugin-sdk';

export function createBuiltinChannelPlugin(options: {
  manifest: PluginManifest & { kind: 'channel' };
  channels: ChannelCapability[];
  createChannel: (ctx: PluginContext) => ChannelRuntime;
}): ChannelPlugin {
  let runtime: ChannelRuntimeRegistration | null = null;
  let unsubscribeBridgeEvents: (() => void) | null = null;

  return {
    manifest: options.manifest,
    capabilities: {
      channels: options.channels,
    },
    createRuntime(ctx: PluginContext) {
      if (!runtime) {
        const channel = options.createChannel(ctx);
        runtime = { channel };
        unsubscribeBridgeEvents = ctx.bus.on('platform.bridge.updated', (event) => {
          void channel.onBridgeEvent?.(event);
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
