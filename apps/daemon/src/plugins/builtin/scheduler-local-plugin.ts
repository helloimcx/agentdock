import type {
  SchedulerExecutorRuntime,
  SchedulerPlugin,
  SchedulerRuntimeRegistration,
} from '@cc/plugin-sdk';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import { LocalScheduleAdapter } from '../../scheduler/local-schedule-adapter.js';

type BuiltinLocalSchedulerPluginOptions = {
  store: LocalCoreAcpStore;
  getWorkspaceRouter: () => WorkspaceRouter;
};

export function createBuiltinLocalSchedulerPlugin(
  options: BuiltinLocalSchedulerPluginOptions,
): SchedulerPlugin {
  return {
    manifest: {
      id: 'builtin.scheduler-local',
      kind: 'scheduler',
      version: '0.1.0',
      provides: ['scheduler.delivery.local'],
    },
    capabilities: {
      schedulers: [
        {
          id: 'scheduler.delivery.local',
          triggerTypes: [],
          deliveryTargets: ['local'],
          enabled: true,
          displayName: 'Local Scheduled Execution',
        },
      ],
    },
    createRuntime(): SchedulerRuntimeRegistration {
      return {
        executors: [
          new LocalScheduleAdapter({
            store: options.store,
            getWorkspaceRouter: options.getWorkspaceRouter,
          }) as SchedulerExecutorRuntime,
        ],
      };
    },
  };
}
