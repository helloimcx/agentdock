import type {
  AutomationMonitor,
  AutomationMonitorCreateInput,
  AutomationMonitorRun,
  AutomationMonitorUpdateInput,
} from '@cc/superai-contracts';
import {
  createAutomationMonitor,
  deleteAutomationMonitor,
  listAutomationMonitorRuns,
  listAutomationMonitors,
  listWorkspaces,
  runAutomationMonitor,
  updateAutomationMonitor,
} from '@cc/core-sdk';

export type Monitor = AutomationMonitor;
export type MonitorRun = AutomationMonitorRun;
export type MonitorCreateInput = AutomationMonitorCreateInput;
export type MonitorUpdateInput = AutomationMonitorUpdateInput;

export const listMonitors = (workspaceId?: string) => listAutomationMonitors(workspaceId);
export const createMonitor = (body: MonitorCreateInput) => createAutomationMonitor(body);
export const updateMonitor = (id: string, body: MonitorUpdateInput) => updateAutomationMonitor(id, body);
export const deleteMonitor = (id: string) => deleteAutomationMonitor(id);
export const runMonitorNow = (id: string) => runAutomationMonitor(id);
export const listMonitorRuns = (id: string) => listAutomationMonitorRuns(id);
export const listMonitorWorkspaces = () => listWorkspaces().then((data) => data.workspaces);

