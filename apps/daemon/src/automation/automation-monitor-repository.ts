import type {
  AutomationMonitor,
  AutomationMonitorCreateInput,
  AutomationMonitorRun,
  AutomationMonitorStatus,
  AutomationMonitorUpdateInput,
} from '@cc/superai-contracts';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';

export type ResolvedAutomationMonitorCreateInput = AutomationMonitorCreateInput & {
  platform: NonNullable<AutomationMonitorCreateInput['platform']>;
  route: NonNullable<AutomationMonitorCreateInput['route']>;
};

export class AutomationMonitorRepository {
  constructor(private readonly store: LocalCoreAcpStore) {}

  list(workspaceId?: string) {
    return this.store.listAutomationMonitors(workspaceId);
  }

  get(monitorId: string) {
    return this.store.getAutomationMonitor(monitorId);
  }

  create(input: ResolvedAutomationMonitorCreateInput) {
    return this.store.createAutomationMonitor(input);
  }

  update(monitorId: string, input: AutomationMonitorUpdateInput) {
    return this.store.updateAutomationMonitor(monitorId, input);
  }

  updateState(monitorId: string, input: {
    lastState?: Record<string, unknown>;
    lastTriggeredAt?: string;
    lastStatus?: AutomationMonitorStatus;
    lastError?: string;
    enabled?: boolean;
  }) {
    return this.store.updateAutomationMonitorState(monitorId, input);
  }

  delete(monitorId: string) {
    return this.store.deleteAutomationMonitor(monitorId);
  }

  listRuns(monitorId: string) {
    return this.store.listAutomationMonitorRuns(monitorId);
  }

  createRun(monitorId: string, status: AutomationMonitorStatus, input: Partial<AutomationMonitorRun> = {}) {
    return this.store.createAutomationMonitorRun(monitorId, status, input);
  }

  updateRun(runId: string, input: Partial<AutomationMonitorRun>) {
    return this.store.updateAutomationMonitorRun(runId, input);
  }

  getPlatformThreadBindingByThreadId(threadId: string) {
    return this.store.getPlatformThreadBindingByThreadId(threadId);
  }
}

