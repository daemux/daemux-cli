/**
 * Approval Commands
 * List and resolve pending approval requests from a separate CLI invocation
 */

import { Command } from 'commander';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { Database as BunSQLite } from 'bun:sqlite';
import {
  bold,
  dim,
  success,
  error,
  warning,
  printError,
  printWarning,
  printInfo,
  printTable,
} from './utils';
import type { ApprovalDecision } from '../core/types';
import type { ApprovalRow } from '../infra/db/types';

// ---------------------------------------------------------------------------
// Database Helpers
// ---------------------------------------------------------------------------

function getDefaultDbPath(): string {
  return join(homedir(), '.daemux', 'agent.db');
}

function withDb<T>(dbPath: string, fn: (db: BunSQLite) => T): T {
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}. Is the agent running?`);
  }
  const db = new BunSQLite(dbPath, { readonly: false, strict: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// List Pending Approvals
// ---------------------------------------------------------------------------

function formatCountdown(expiresAtMs: number): string {
  const remainingMs = expiresAtMs - Date.now();
  if (remainingMs <= 0) return error('expired');

  const seconds = Math.floor(remainingMs / 1000);
  if (seconds < 60) return warning(`${seconds}s`);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return warning(`${minutes}m ${secs}s`);
}

async function listApprovals(options: { db?: string; json?: boolean }): Promise<void> {
  const dbPath = options.db ?? getDefaultDbPath();

  try {
    withDb(dbPath, (db) => {
      const rows = db.query(
        'SELECT * FROM approvals WHERE decision IS NULL ORDER BY created_at_ms ASC'
      ).all() as ApprovalRow[];

      if (rows.length === 0) {
        if (options.json) {
          console.log(JSON.stringify([]));
        } else {
          printInfo('No pending approval requests.');
        }
        return;
      }

      if (options.json) {
        const items = rows.map(row => ({
          id: row.id,
          command: row.command,
          createdAtMs: row.created_at_ms,
          expiresAtMs: row.expires_at_ms,
          remainingMs: Math.max(0, row.expires_at_ms - Date.now()),
        }));
        console.log(JSON.stringify(items, null, 2));
        return;
      }

      console.log(bold('\nPending Approval Requests\n'));

      const tableRows = rows.map(row => ({
        id: row.id.slice(0, 8),
        fullId: row.id,
        command: row.command.length > 60 ? row.command.slice(0, 57) + '...' : row.command,
        countdown: formatCountdown(row.expires_at_ms),
      }));

      printTable(
        [
          { header: 'ID', key: 'id', width: 10 },
          { header: 'Command', key: 'command', width: 62 },
          { header: 'Expires', key: 'countdown', width: 12 },
        ],
        tableRows
      );

      console.log(dim(`\nUse: daemux approve <id> allow-once|allow-always|deny`));
    });
  } catch (err) {
    printError(err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Resolve Approval
// ---------------------------------------------------------------------------

const VALID_DECISIONS = new Set<ApprovalDecision>(['allow-once', 'allow-always', 'deny']);

async function resolveApproval(
  id: string,
  decision: string,
  options: { db?: string }
): Promise<void> {
  if (!VALID_DECISIONS.has(decision as ApprovalDecision)) {
    printError(`Invalid decision "${decision}". Must be one of: allow-once, allow-always, deny`);
    process.exit(1);
  }

  const dbPath = options.db ?? getDefaultDbPath();

  try {
    withDb(dbPath, (db) => {
      const matchingRows = db.query(
        'SELECT * FROM approvals WHERE id LIKE ? AND decision IS NULL'
      ).all(`${id}%`) as ApprovalRow[];

      if (matchingRows.length === 0) {
        printWarning(`No pending approval found matching "${id}".`);
        process.exit(1);
      }

      if (matchingRows.length > 1) {
        printWarning(`Ambiguous ID "${id}" matches ${matchingRows.length} approvals. Use a longer prefix.`);
        process.exit(1);
      }

      const row = matchingRows[0]!;
      const now = Date.now();

      if (row.expires_at_ms < now) {
        printWarning(`Approval ${row.id.slice(0, 8)} has already expired.`);
        process.exit(1);
      }

      db.run(
        'UPDATE approvals SET decision = ?, decided_at_ms = ?, decided_by = ? WHERE id = ?',
        [decision, now, 'cli', row.id]
      );

      console.log(`${success('v')} Approval ${bold(row.id.slice(0, 8))} resolved: ${bold(decision)}`);
      printInfo(`Command: ${row.command}`);
    });
  } catch (err) {
    printError(err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerApprovalCommands(program: Command): void {
  const approve = program
    .command('approve')
    .description('Manage pending approval requests');

  approve
    .command('list')
    .description('List pending approval requests with countdown timers')
    .option('--db <path>', 'Path to agent database')
    .option('--json', 'Output as JSON')
    .action(listApprovals);

  approve
    .command('resolve <id> <decision>')
    .description('Resolve an approval (allow-once|allow-always|deny)')
    .option('--db <path>', 'Path to agent database')
    .action(resolveApproval);
}
