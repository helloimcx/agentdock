import type { AutomationDefinition, AutomationEvaluation, AutomationRun } from '@cc/superai-contracts';

export type LocalThreadRow = {
  id: string;
  workspace_id: string;
  session_id: string;
  bridge_session_key: string;
  title: string;
  agent_type: string;
  created_at: string;
  updated_at: string;
  history_count: number;
  excerpt: string;
  acp_session_id: string | null;
  acp_supports_load: number;
  agent_mode: string;
};

export type LocalMessageRow = {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_call_json: string | null;
  bridge_kind: string | null;
  bridge_status: string | null;
  timestamp: string;
  kind: 'final' | 'progress' | 'system';
  seq: number;
};

export type LocalRunRow = {
  id: string;
  thread_id: string;
  status: 'queued' | 'running' | 'awaiting_input' | 'completed' | 'failed' | 'interrupted';
  started_at: string;
  updated_at: string;
};

export type LocalScheduledJobRow = {
  id: string;
  workspace_id: string;
  platform: string;
  route_type: string;
  route_config: string;
  execution_mode: 'same-thread' | 'side-thread';
  trigger_type: 'cron' | 'once';
  cron_expr: string | null;
  run_at: string | null;
  prompt_template: string;
  description: string;
  enabled: number;
  concurrency_policy: 'skip_if_running';
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | null;
  last_error: string | null;
};

export type LocalScheduledJobRunRow = {
  id: string;
  job_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  triggered_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  thread_id: string | null;
  run_id: string | null;
  platform_message_id: string | null;
  platform_message_ids_json: string | null;
  delivery_mode: string | null;
  delivery_status: string | null;
  delivery_error: string | null;
  last_bridge_event_at: string | null;
};

export type LocalAutomationMonitorRow = {
  id: string;
  workspace_id: string;
  title: string;
  source_type: string;
  source_config_json: string;
  condition_json: string;
  prompt_template: string;
  platform: string;
  route_type: string;
  route_config: string;
  execution_mode: 'same-thread' | 'side-thread';
  enabled: number;
  cooldown_ms: number;
  concurrency_policy: 'skip_if_running';
  last_state_json: string | null;
  created_at: string;
  updated_at: string;
  last_triggered_at: string | null;
  last_status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | null;
  last_error: string | null;
};

export type LocalAutomationMonitorRunRow = {
  id: string;
  monitor_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  triggered_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  event_snapshot_json: string | null;
  thread_id: string | null;
  run_id: string | null;
  delivery_mode: string | null;
  delivery_status: string | null;
  delivery_error: string | null;
  last_bridge_event_at: string | null;
};

export type LocalAutomationRow = {
  id: string;
  workspace_id: string;
  title: string;
  enabled: number;
  health: AutomationDefinition['health'];
  blocked_reason: string | null;
  activation_json: string;
  condition_json: string;
  action_json: string;
  delivery_json: string;
  policies_json: string;
  last_successful_match: number | null;
  last_evaluation_at: string | null;
  last_triggered_at: string | null;
  consecutive_evaluation_failures: number;
  next_check_at: string | null;
  origin_kind: NonNullable<AutomationDefinition['originKind']>;
  legacy_metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type LocalAutomationEvaluationRow = {
  id: string;
  automation_id: string;
  status: AutomationEvaluation['status'];
  activation_kind: AutomationEvaluation['activationKind'];
  script_version_id: string | null;
  started_at: string;
  finished_at: string | null;
  evaluation_json: string;
};

export type LocalAutomationRunRow = {
  id: string;
  automation_id: string;
  evaluation_id: string;
  status: AutomationRun['status'];
  created_at: string;
  run_json: string;
};

export type LocalModelProviderRow = {
  id: string;
  name: string;
  api_key: string | null;
  base_url: string | null;
  model: string | null;
  models_json: string;
  thinking: string | null;
  env_json: string;
  created_at: string;
  updated_at: string;
};

export type LocalWorkspaceRegistryRow = {
  id: string;
  display_name: string;
  path: string;
  device_id: string;
  default_runtime_id: string | null;
  git_json: string;
  health_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
};

export type LocalAgentTaskRow = {
  id: string;
  workspace_id: string;
  device_id: string;
  runtime_id: string;
  thread_id: string | null;
  run_id: string | null;
  title: string;
  prompt: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  summary: string | null;
  error: string | null;
  timeline_json: string;
  logs_json: string;
  artifacts_json: string;
  approval_ids_json: string;
  metadata_json: string;
};

export type LocalWorkspaceSecuritySettingsRow = {
  workspace_id: string;
  permissions_json: string;
  allow_paths_json: string;
  deny_paths_json: string;
  updated_at: string;
  updated_by: string | null;
};

export type LocalApprovalRequestRow = {
  id: string;
  workspace_id: string;
  task_id: string | null;
  thread_id: string | null;
  run_id: string | null;
  device_id: string;
  kind: string;
  status: string;
  risk_level: string;
  title: string;
  description: string;
  requested_action: string;
  command: string | null;
  scopes_json: string;
  options_json: string;
  requested_by: string | null;
  resolved_by: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  expires_at: string | null;
  metadata_json: string;
};

export type LocalAuditEventRow = {
  id: string;
  type: string;
  workspace_id: string | null;
  task_id: string | null;
  approval_id: string | null;
  actor: string | null;
  summary: string;
  risk_level: string | null;
  created_at: string;
  metadata_json: string;
};

export type LocalPlatformPairingRow = {
  code: string;
  workspace_id: string;
  platform: string;
  platform_user_id: string;
  chat_id: string;
  display_name: string;
  requested_at: string;
  expires_at: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
};

export type LocalPlatformUserRow = {
  id: string;
  workspace_id: string;
  platform: string;
  platform_user_id: string;
  chat_id: string;
  display_name: string;
  thread_id: string | null;
  authorized_at: string;
};

export type LocalPlatformThreadBindingRow = {
  workspace_id: string;
  platform: string;
  chat_id: string;
  platform_user_id: string;
  thread_id: string;
  last_platform_message_id: string | null;
  preferred_agent_type?: string | null;
  created_at: string;
  updated_at: string;
};
