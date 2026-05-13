import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openCloudDatabase(filename: string) {
  mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_registry (
      workspace_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      workdir_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_opened_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS threads (
      thread_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace_registry(workspace_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      session_id TEXT NOT NULL,
      live INTEGER NOT NULL DEFAULT 0,
      run_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      kind TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      sandbox_id TEXT,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error_code TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS workspace_files (
      file_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      uri TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cloud_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      run_id TEXT,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      event_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, 'tasks', 'sandbox_id', 'TEXT');
  ensureColumn(db, 'tasks', 'error_code', 'TEXT');
  ensureColumn(db, 'cloud_events', 'task_id', 'TEXT');
  ensureColumn(db, 'cloud_events', 'run_id', 'TEXT');
  ensureColumn(db, 'cloud_events', 'seq', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'cloud_events', 'type', 'TEXT NOT NULL DEFAULT "runtime"');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status_created ON tasks (workspace_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_thread_created ON tasks (thread_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_cloud_events_task_seq ON cloud_events (task_id, seq);
    CREATE INDEX IF NOT EXISTS idx_cloud_events_type ON cloud_events (type);
    CREATE INDEX IF NOT EXISTS idx_workspace_files_task ON workspace_files (task_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_files_workspace ON workspace_files (workspace_id);
    CREATE INDEX IF NOT EXISTS idx_threads_workspace_updated ON threads (workspace_id, updated_at);
  `);
  return db;
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
