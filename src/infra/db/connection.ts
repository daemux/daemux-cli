/**
 * SQLite Database Connection Management
 */

import { Database as BunSQLite } from 'bun:sqlite';

export interface DatabaseConfig {
  path: string;
  enableVec?: boolean;
}

export class DatabaseConnection {
  private db: BunSQLite;
  private vecEnabled = false;

  constructor(config: DatabaseConfig) {
    this.db = new BunSQLite(config.path, { create: true, strict: true });
    this.db.run('PRAGMA foreign_keys = ON');
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA synchronous = NORMAL');

    if (config.enableVec) {
      this.loadVecExtension();
    }
  }

  private loadVecExtension(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sqliteVec = require('sqlite-vec');
      sqliteVec.load(this.db);
      this.vecEnabled = true;
    } catch {
      console.warn('[database] sqlite-vec extension not available, vector search disabled');
    }
  }

  get raw(): BunSQLite {
    return this.db;
  }

  get hasVec(): boolean {
    return this.vecEnabled;
  }

  close(): void {
    this.db.close();
  }

  async checkIntegrity(): Promise<boolean> {
    const result = this.db.query('PRAGMA integrity_check').get() as { integrity_check: string };
    return result.integrity_check === 'ok';
  }
}
