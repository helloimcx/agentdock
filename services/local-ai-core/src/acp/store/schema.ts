import type { DatabaseSync } from 'node:sqlite';

export function ensureLocalCoreAcpSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      bridge_session_key TEXT NOT NULL,
      title TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      history_count INTEGER NOT NULL DEFAULT 0,
      excerpt TEXT NOT NULL DEFAULT '',
      acp_session_id TEXT,
      acp_supports_load INTEGER NOT NULL DEFAULT 0,
      agent_mode TEXT NOT NULL DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_threads_workspace_updated ON threads (workspace_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_call_json TEXT,
      bridge_kind TEXT,
      bridge_status TEXT,
      timestamp TEXT NOT NULL,
      kind TEXT NOT NULL,
      seq INTEGER NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_thread_seq ON messages (thread_id, seq ASC);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_runs_thread_updated ON runs (thread_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS run_spans (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      parent_span_id TEXT,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_ms INTEGER,
      input_json TEXT,
      output_json TEXT,
      usage_json TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_run_spans_run_started ON run_spans (run_id, started_at ASC);
    CREATE TABLE IF NOT EXISTS platform_pairings (
      code TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_platform_pairings_workspace_status ON platform_pairings (workspace_id, status, expires_at DESC);
    CREATE TABLE IF NOT EXISTS platform_users (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      thread_id TEXT,
      authorized_at TEXT NOT NULL,
      UNIQUE(workspace_id, platform, platform_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_platform_users_workspace_platform ON platform_users (workspace_id, platform);
    CREATE TABLE IF NOT EXISTS platform_thread_bindings (
      workspace_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      last_platform_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, platform, chat_id, platform_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_platform_thread_bindings_thread ON platform_thread_bindings (thread_id);
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      route_type TEXT NOT NULL,
      route_config TEXT NOT NULL,
      execution_mode TEXT NOT NULL DEFAULT 'same-thread',
      trigger_type TEXT NOT NULL,
      cron_expr TEXT,
      run_at TEXT,
      prompt_template TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      concurrency_policy TEXT NOT NULL DEFAULT 'skip_if_running',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT,
      last_status TEXT,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_workspace_updated ON scheduled_jobs (workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled ON scheduled_jobs (enabled, trigger_type, run_at);
    CREATE TABLE IF NOT EXISTS scheduled_job_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error TEXT,
      thread_id TEXT,
      run_id TEXT,
      platform_message_id TEXT,
      platform_message_ids_json TEXT,
      delivery_mode TEXT,
      delivery_status TEXT,
      delivery_error TEXT,
      last_bridge_event_at TEXT,
      FOREIGN KEY (job_id) REFERENCES scheduled_jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_job_triggered ON scheduled_job_runs (job_id, triggered_at DESC);
    CREATE TABLE IF NOT EXISTS automation_monitors (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_config_json TEXT NOT NULL DEFAULT '{}',
      condition_json TEXT NOT NULL,
      prompt_template TEXT NOT NULL,
      platform TEXT NOT NULL,
      route_type TEXT NOT NULL,
      route_config TEXT NOT NULL,
      execution_mode TEXT NOT NULL DEFAULT 'side-thread',
      enabled INTEGER NOT NULL DEFAULT 1,
      cooldown_ms INTEGER NOT NULL DEFAULT 900000,
      concurrency_policy TEXT NOT NULL DEFAULT 'skip_if_running',
      last_state_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_triggered_at TEXT,
      last_status TEXT,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_automation_monitors_workspace_updated ON automation_monitors (workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_automation_monitors_enabled ON automation_monitors (enabled, source_type);
    CREATE TABLE IF NOT EXISTS automation_monitor_runs (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL,
      status TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error TEXT,
      event_snapshot_json TEXT,
      thread_id TEXT,
      run_id TEXT,
      delivery_mode TEXT,
      delivery_status TEXT,
      delivery_error TEXT,
      last_bridge_event_at TEXT,
      FOREIGN KEY (monitor_id) REFERENCES automation_monitors(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_automation_monitor_runs_monitor_triggered ON automation_monitor_runs (monitor_id, triggered_at DESC);
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      health TEXT NOT NULL,
      blocked_reason TEXT,
      activation_json TEXT NOT NULL,
      condition_json TEXT NOT NULL,
      action_json TEXT NOT NULL,
      delivery_json TEXT NOT NULL,
      policies_json TEXT NOT NULL,
      last_successful_match INTEGER,
      last_evaluation_at TEXT,
      last_triggered_at TEXT,
      consecutive_evaluation_failures INTEGER NOT NULL DEFAULT 0,
      next_check_at TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'native',
      legacy_metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_automations_workspace_updated ON automations (workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_automations_enabled_next_check ON automations (enabled, next_check_at);
    CREATE INDEX IF NOT EXISTS idx_automations_health ON automations (health);
    CREATE INDEX IF NOT EXISTS idx_automations_origin ON automations (origin_kind);
    CREATE TABLE IF NOT EXISTS automation_evaluations (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      activation_kind TEXT NOT NULL,
      script_version_id TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      evaluation_json TEXT NOT NULL,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_automation_evaluations_automation_started
      ON automation_evaluations (automation_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      evaluation_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      run_json TEXT NOT NULL,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE,
      FOREIGN KEY (evaluation_id) REFERENCES automation_evaluations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_created
      ON automation_runs (automation_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_evaluation_unique ON automation_runs (evaluation_id);
    CREATE TABLE IF NOT EXISTS automation_scripts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_automation_scripts_workspace_updated
      ON automation_scripts (workspace_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS automation_script_versions (
      id TEXT PRIMARY KEY,
      script_id TEXT NOT NULL,
      status TEXT NOT NULL,
      package_sha256 TEXT NOT NULL,
      package_path TEXT NOT NULL,
      shebang TEXT NOT NULL,
      interpreter_path TEXT NOT NULL,
      interpreter_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version_json TEXT NOT NULL,
      FOREIGN KEY (script_id) REFERENCES automation_scripts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_automation_script_versions_script_created
      ON automation_script_versions (script_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_automation_script_versions_hash
      ON automation_script_versions (script_id, package_sha256);
    CREATE TABLE IF NOT EXISTS workspace_registry (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      path TEXT NOT NULL,
      device_id TEXT NOT NULL,
      default_runtime_id TEXT,
      git_json TEXT NOT NULL DEFAULT '{}',
      health_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_opened_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_registry_updated ON workspace_registry (updated_at DESC);
    CREATE TABLE IF NOT EXISTS model_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT,
      base_url TEXT,
      model TEXT,
      models_json TEXT NOT NULL DEFAULT '[]',
      thinking TEXT,
      env_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_model_providers_name ON model_providers (name);
    CREATE TABLE IF NOT EXISTS external_projects (
      user_id TEXT NOT NULL,
      external_project_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      display_name TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, external_project_id),
      UNIQUE(workspace_id)
    );
    CREATE TABLE IF NOT EXISTS external_threads (
      user_id TEXT NOT NULL,
      external_project_id TEXT NOT NULL,
      external_thread_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, external_project_id, external_thread_id),
      UNIQUE(thread_id),
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_external_threads_thread ON external_threads (thread_id);
    CREATE INDEX IF NOT EXISTS idx_external_threads_workspace ON external_threads (workspace_id);
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      thread_id TEXT,
      run_id TEXT,
      title TEXT NOT NULL,
      prompt TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      queued_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      summary TEXT,
      error TEXT,
      timeline_json TEXT NOT NULL DEFAULT '[]',
      logs_json TEXT NOT NULL DEFAULT '[]',
      artifacts_json TEXT NOT NULL DEFAULT '[]',
      approval_ids_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_workspace_updated ON agent_tasks (workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_status_updated ON agent_tasks (status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_run ON agent_tasks (run_id);
    CREATE TABLE IF NOT EXISTS workspace_security_settings (
      workspace_id TEXT PRIMARY KEY,
      permissions_json TEXT NOT NULL,
      allow_paths_json TEXT NOT NULL DEFAULT '[]',
      deny_paths_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      task_id TEXT,
      thread_id TEXT,
      run_id TEXT,
      device_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      requested_action TEXT NOT NULL,
      command TEXT,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      options_json TEXT NOT NULL DEFAULT '[]',
      requested_by TEXT,
      resolved_by TEXT,
      resolution TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      expires_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_approval_requests_workspace_updated ON approval_requests (workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_approval_requests_status_updated ON approval_requests (status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_approval_requests_task ON approval_requests (task_id);
    CREATE INDEX IF NOT EXISTS idx_approval_requests_run ON approval_requests (run_id);
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      workspace_id TEXT,
      task_id TEXT,
      approval_id TEXT,
      actor TEXT,
      summary TEXT NOT NULL,
      risk_level TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_audit_events_workspace_created ON audit_events (workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_task_created ON audit_events (task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_type_created ON audit_events (type, created_at DESC);
    CREATE TABLE IF NOT EXISTS runtime_config (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      base_dir TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, 'messages', 'tool_call_json', 'TEXT');
  ensureColumn(db, 'messages', 'bridge_kind', 'TEXT');
  ensureColumn(db, 'messages', 'bridge_status', 'TEXT');
  ensureColumn(db, 'platform_thread_bindings', 'preferred_agent_type', 'TEXT');
  ensureColumn(db, 'scheduled_jobs', 'execution_mode', "TEXT NOT NULL DEFAULT 'same-thread'");
  ensureColumn(db, 'scheduled_job_runs', 'platform_message_ids_json', 'TEXT');
  ensureColumn(db, 'scheduled_job_runs', 'delivery_mode', 'TEXT');
  ensureColumn(db, 'scheduled_job_runs', 'delivery_status', 'TEXT');
  ensureColumn(db, 'scheduled_job_runs', 'delivery_error', 'TEXT');
  ensureColumn(db, 'scheduled_job_runs', 'last_bridge_event_at', 'TEXT');
  ensureColumn(db, 'threads', 'agent_mode', "TEXT NOT NULL DEFAULT 'default'");
  ensureColumn(db, 'automations', 'legacy_metadata_json', 'TEXT');
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
