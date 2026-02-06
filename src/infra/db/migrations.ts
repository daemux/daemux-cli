/**
 * Database Schema Migrations
 */

import type { Database as BunSQLite } from 'bun:sqlite';

export function runMigrations(db: BunSQLite, vecEnabled: boolean): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const currentVersion = getCurrentSchemaVersion(db);

  if (currentVersion < 1) {
    applyMigrationV1(db, vecEnabled);
  }
  if (currentVersion < 2) {
    applyMigrationV2(db);
  }
}

function getCurrentSchemaVersion(db: BunSQLite): number {
  const row = db.query('SELECT MAX(version) as version FROM schema_version').get() as {
    version: number | null;
  } | null;
  return row?.version ?? 0;
}

function applyMigrationV1(db: BunSQLite, vecEnabled: boolean): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_activity INTEGER NOT NULL,
      compaction_count INTEGER DEFAULT 0,
      total_tokens_used INTEGER DEFAULT 0,
      queue_mode TEXT DEFAULT 'steer',
      active_channel_id TEXT,
      current_task_id TEXT,
      flags TEXT DEFAULT '{}'
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(last_activity DESC)');

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      uuid TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_uuid TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      token_count INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)');

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      active_form TEXT,
      status TEXT DEFAULT 'pending',
      owner TEXT,
      blocked_by TEXT DEFAULT '[]',
      blocks TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');

  db.run(`
    CREATE TABLE IF NOT EXISTS subagents (
      id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      parent_id TEXT,
      task_description TEXT NOT NULL,
      pid INTEGER,
      status TEXT DEFAULT 'running',
      spawned_at INTEGER NOT NULL,
      completed_at INTEGER,
      timeout_ms INTEGER NOT NULL,
      result TEXT,
      tokens_used INTEGER,
      tool_uses INTEGER
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_subagents_status ON subagents(status)');

  db.run(`
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      context TEXT,
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      decision TEXT,
      decided_at_ms INTEGER,
      decided_by TEXT
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(expires_at_ms)');

  db.run(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      expression TEXT NOT NULL,
      timezone TEXT DEFAULT 'UTC',
      task_template TEXT NOT NULL,
      next_run_ms INTEGER NOT NULL,
      last_run_ms INTEGER,
      enabled INTEGER DEFAULT 1
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_schedules_next ON schedules(next_run_ms)');

  db.run(`
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL
    )
  `);

  if (vecEnabled) {
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[1536]
      )
    `);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      user_id TEXT,
      agent_id TEXT,
      result TEXT NOT NULL,
      details TEXT
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit(timestamp DESC)');

  db.run('INSERT INTO schema_version (version, applied_at) VALUES (1, ?)', [Date.now()]);
}

function applyMigrationV2(db: BunSQLite): void {
  db.run('ALTER TABLE sessions ADD COLUMN thinking_level TEXT');
  db.run('INSERT INTO schema_version (version, applied_at) VALUES (2, ?)', [Date.now()]);
}
