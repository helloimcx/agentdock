export interface WorkspaceSummary {
  id: string;
  name: string;
  agentType: string;
  platforms: string[];
  sessionsCount: number;
  heartbeatEnabled: boolean;
}

export type WorkspaceRegistryHealthStatus = 'healthy' | 'warning' | 'error' | 'unknown';
export type WorkspaceRegistryIssueSeverity = 'info' | 'warning' | 'error';

export interface WorkspaceGitSummary {
  isRepo: boolean;
  branch?: string;
  remote?: string;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  lastCommit?: {
    sha: string;
    message: string;
    authorName?: string;
    committedAt?: string;
  };
  error?: string;
}

export interface WorkspaceRegistryIssue {
  code: string;
  severity: WorkspaceRegistryIssueSeverity;
  message: string;
  help?: string;
}

export interface WorkspaceHealthSummary {
  status: WorkspaceRegistryHealthStatus;
  summary: string;
  issues: WorkspaceRegistryIssue[];
  checkedAt?: string;
}

export interface WorkspaceRegistryEntry {
  workspaceId: string;
  displayName: string;
  path: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  defaultRuntimeId?: string;
  git?: WorkspaceGitSummary;
  health: WorkspaceHealthSummary;
  activeTaskCount: number;
  recentTaskIds: string[];
  metadata?: Record<string, unknown>;
}

export interface WorkspaceRegistryCreateInput {
  displayName: string;
  path: string;
  defaultRuntimeId?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceRegistryUpdateInput {
  displayName?: string;
  path?: string;
  defaultRuntimeId?: string | null;
  metadata?: Record<string, unknown>;
}
