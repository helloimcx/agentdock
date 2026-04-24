import type {
  ChannelRuntime,
  SchedulerPlugin,
  SchedulerRuntimeRegistration,
} from '../../../../../packages/plugin-sdk/src/index.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import { WeixinScheduleAdapter } from '../../scheduler/weixin-schedule-adapter.js';
import type { SchedulerExecutorRuntime } from '../../scheduler/adapters.js';

type BuiltinWeixinSchedulerPluginOptions = {
  store: LocalCoreAcpStore;
  getWorkspaceRouter: () => WorkspaceRouter;
  getChannelRuntime: () => ChannelRuntime;
  log?: (message: string) => void;
};

export function createBuiltinWeixinSchedulerPlugin(
  options: BuiltinWeixinSchedulerPluginOptions,
): SchedulerPlugin {
  return {
    manifest: {
      id: 'builtin.scheduler-weixin',
      kind: 'scheduler',
      version: '0.1.0',
      dependsOn: ['builtin.channel-weixin'],
      provides: ['scheduler.delivery.weixin'],
    },
    capabilities: {
      schedulers: [
        {
          id: 'scheduler.delivery.weixin',
          triggerTypes: [],
          deliveryTargets: ['weixin'],
          enabled: true,
          displayName: 'WeChat Scheduled Delivery',
        },
      ],
    },
    createRuntime(): SchedulerRuntimeRegistration {
      return {
        executors: [
          new WeixinScheduleAdapter({
            store: options.store,
            getWorkspaceRouter: options.getWorkspaceRouter,
            getChannelRuntime: options.getChannelRuntime,
            log: options.log,
          }) as SchedulerExecutorRuntime,
        ],
      };
    },
  };
}
