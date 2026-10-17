import type { ButlerBotEndpoint, ButlerFollowupInput, ButlerProfile, ButlerProfileInput, ButlerTask, ButlerTaskCreateInput, ButlerTaskDelegateInput } from '@cc/superai-contracts';
import { buildQuery, coreRequest } from './request.js';

export function getButlerProfile() {
  return coreRequest<ButlerProfile | null>('GET', '/butler/profile');
}

export function listButlerBots() {
  return coreRequest<{ bots: ButlerBotEndpoint[] }>('GET', '/butler/bots');
}

export function setButlerProfile(input: ButlerProfileInput) {
  return coreRequest<ButlerProfile>('PUT', '/butler/profile', input);
}

export function listButlerTasks(ownerThreadId: string) {
  return coreRequest<{ tasks: ButlerTask[] }>('GET', `/butler/tasks${buildQuery({ owner_thread_id: ownerThreadId })}`);
}

export function getButlerTask(taskId: string, ownerThreadId: string) {
  return coreRequest<ButlerTask>('GET', `/butler/tasks/${encodeURIComponent(taskId)}${buildQuery({ owner_thread_id: ownerThreadId })}`);
}

export function createButlerTask(input: ButlerTaskCreateInput) {
  return coreRequest<ButlerTask>('POST', '/butler/tasks', input);
}

export function delegateButlerTask(taskId: string, input: ButlerTaskDelegateInput) {
  return coreRequest<ButlerTask>('POST', `/butler/tasks/${encodeURIComponent(taskId)}/delegations`, input);
}

export function followupButlerTask(taskId: string, input: ButlerFollowupInput) {
  return coreRequest<ButlerTask>('POST', `/butler/tasks/${encodeURIComponent(taskId)}/followup`, input);
}

export function cancelButlerTask(taskId: string, ownerThreadId: string) {
  return coreRequest<ButlerTask>('POST', `/butler/tasks/${encodeURIComponent(taskId)}/cancel`, { ownerThreadId });
}

export function completeButlerTask(taskId: string, ownerThreadId: string, summary: string) {
  return coreRequest<ButlerTask>('POST', `/butler/tasks/${encodeURIComponent(taskId)}/complete`, { ownerThreadId, summary });
}
