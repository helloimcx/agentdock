import type {
  Budget,
  BudgetCreateInput,
  BudgetUpdateInput,
} from '@cc/superai-contracts/budgets';
import { coreRequest } from './request.js';

export function listBudgets(workspaceId?: string) {
  const search = new URLSearchParams();
  if (workspaceId) search.set('workspaceId', workspaceId);
  const q = search.toString();
  return coreRequest<{ budgets: Budget[] }>('GET', `/budgets${q ? `?${q}` : ''}`);
}

export function getBudget(id: string) {
  return coreRequest<Budget>('GET', `/budgets/${encodeURIComponent(id)}`);
}

export function createBudget(input: BudgetCreateInput) {
  return coreRequest<Budget>('POST', '/budgets', input);
}

export function updateBudget(id: string, input: BudgetUpdateInput) {
  return coreRequest<Budget>('PUT', `/budgets/${encodeURIComponent(id)}`, input);
}

export function deleteBudget(id: string) {
  return coreRequest<{ deleted: boolean }>('DELETE', `/budgets/${encodeURIComponent(id)}`);
}
