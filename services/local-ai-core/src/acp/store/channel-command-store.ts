import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Dedup domain is the platform message, never the current thread (/new changes it). */
export class ChannelCommandStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS channel_command_admissions (
      request_key TEXT PRIMARY KEY, digest TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    db.prepare("UPDATE channel_command_admissions SET status = 'unknown' WHERE status = 'processing'").run();
    db.exec(`CREATE TABLE IF NOT EXISTS channel_message_admissions (
      request_key TEXT PRIMARY KEY, digest TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  }

  claimMessage(key: string, text: string): boolean {
    const digest = createHash('sha256').update(text).digest('hex');
    const existing = this.db.prepare('SELECT digest FROM channel_message_admissions WHERE request_key = ?').get(key) as { digest: string } | undefined;
    if (existing) {
      if (existing.digest !== digest) throw new Error('Channel message request identity conflict');
      return false;
    }
    this.db.prepare('INSERT INTO channel_message_admissions VALUES (?, ?, ?)').run(key, digest, new Date().toISOString());
    return true;
  }

  claim(key: string, text: string): boolean {
    const digest = createHash('sha256').update(text).digest('hex');
    const existing = this.db.prepare('SELECT digest FROM channel_command_admissions WHERE request_key = ?').get(key);
    if (existing) {
      if (existing.digest !== digest) throw new Error('Channel command request identity conflict');
      return false;
    }
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO channel_command_admissions VALUES (?, ?, 'processing', ?, ?)").run(key, digest, now, now);
    return true;
  }

  finish(key: string, status: 'completed' | 'unknown'): void {
    this.db.prepare("UPDATE channel_command_admissions SET status = ?, updated_at = ? WHERE request_key = ? AND status = 'processing'")
      .run(status, new Date().toISOString(), key);
  }
}
