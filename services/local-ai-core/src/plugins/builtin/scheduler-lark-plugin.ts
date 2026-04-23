import type {
  ChannelRuntime,
  SchedulerExecutorRuntime,
  SchedulerPlugin,
  SchedulerRuntimeRegistration,
} from '../../../../../packages/plugin-sdk/src/index.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import { LarkScheduleAdapter } from '../../scheduler/lark-schedule-adapter.js';

type BuiltinLarkSchedulerPluginOptions = {
  store: LocalCoreAcpStore;
  getWorkspaceRouter: () => WorkspaceRouter;
  getChannelRuntime: () => ChannelRuntime;
  log?: (message: string) => void;
};

export function createBuiltinLarkSchedulerPlugin(
  options: BuiltinLarkSchedulerPluginOptions,
): SchedulerPlugin {
  return {
    manifest: {
      id: 'builtin.scheduler-lark',
      kind: 'scheduler',
      version: '0.1.0',
      dependsOn: ['builtin.channel-lark'],
      provides: ['scheduler.delivery.lark'],
    },
    capabilities: {
      schedulers: [
        {
          id: 'scheduler.delivery.lark',
          triggerTypes: [],
          deliveryTargets: ['lark'],
          enabled: true,
          displayName: 'Lark Scheduled Delivery',
        },
      ],
    },
    createRuntime(): SchedulerRuntimeRegistration {
      return {
        executors: [
          new LarkScheduleAdapter({
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
