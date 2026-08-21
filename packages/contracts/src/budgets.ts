export type BudgetScopeKind = 'workspace' | 'agent' | 'channel' | 'automation' | 'global';
export type BudgetPeriodKind = 'daily' | 'weekly' | 'monthly';
export type BudgetAction = 'alert' | 'alert_and_skip' | 'alert_and_kill';
export type BudgetStatus = 'normal' | 'soft_warning' | 'hard_exceeded';

export interface Budget {
  id: string;
  workspaceId: string;
  name: string;
  scopeKind: BudgetScopeKind;
  scopeId?: string | null;
  periodKind: BudgetPeriodKind;
  limitUsd: number;
  softThreshold: number;
  hardThreshold: number;
  action: BudgetAction;
  enabled: boolean;
  currentSpendUsd?: number;
  status?: BudgetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCreateInput {
  id?: string;
  workspaceId: string;
  name: string;
  scopeKind: BudgetScopeKind;
  scopeId?: string | null;
  periodKind: BudgetPeriodKind;
  limitUsd: number;
  softThreshold?: number;
  hardThreshold?: number;
  action?: BudgetAction;
  enabled?: boolean;
}

export interface BudgetUpdateInput {
  name?: string;
  scopeKind?: BudgetScopeKind;
  scopeId?: string | null;
  periodKind?: BudgetPeriodKind;
  limitUsd?: number;
  softThreshold?: number;
  hardThreshold?: number;
  action?: BudgetAction;
  enabled?: boolean;
}

export interface BudgetPreflightResult {
  allowed: boolean;
  reason?: string;
  budget?: Budget;
  currentSpendUsd?: number;
  limitUsd?: number;
}
