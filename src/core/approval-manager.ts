/**
 * Approval Manager - Promise-based Approval Queue with DB Checkpoint
 * Implements a hybrid Promise + DB Checkpoint pattern for restart recovery.
 * Pending approvals are held in-memory as Promises and persisted to DB.
 */

import type { ApprovalDecision, ApprovalRequest } from './types';
import type { Database } from '../infra/database';
import type { EventBus } from './event-bus';
import { getLogger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Pending Entry (in-memory state for each inflight approval)
// ---------------------------------------------------------------------------

interface PendingEntry {
  resolve: (decision: ApprovalDecision | null) => void;
  timeout: ReturnType<typeof setTimeout>;
  request: ApprovalRequest;
}

// ---------------------------------------------------------------------------
// Approval Manager Class
// ---------------------------------------------------------------------------

export class ApprovalManager {
  private pending = new Map<string, PendingEntry>();
  private db: Database;
  private eventBus: EventBus;
  private timeoutMs: number;

  constructor(options: { db: Database; eventBus: EventBus; timeoutMs?: number }) {
    this.db = options.db;
    this.eventBus = options.eventBus;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Request approval for a command. Returns a Promise that resolves with
   * the decision when someone calls resolveApproval(), or null on timeout.
   */
  requestApproval(command: string, context?: Record<string, unknown>): Promise<ApprovalDecision | null> {
    const now = Date.now();
    const expiresAtMs = now + this.timeoutMs;

    const record = this.db.approvals.create({
      command,
      context,
      createdAtMs: now,
      expiresAtMs,
      decision: null,
    });

    const logger = getLogger();
    logger.info('Approval requested', { id: record.id, command });

    return new Promise<ApprovalDecision | null>((resolve) => {
      const timeout = setTimeout(() => {
        this.handleTimeout(record.id);
      }, this.timeoutMs);

      this.pending.set(record.id, { resolve, timeout, request: record });

      void this.eventBus.emit('approval:request', {
        id: record.id,
        command,
      });
    });
  }

  /**
   * Resolve a pending approval with a decision. Clears the timeout,
   * persists the decision to DB, and resolves the waiting Promise.
   */
  resolveApproval(id: string, decision: ApprovalDecision, decidedBy?: string): void {
    const entry = this.pending.get(id);
    if (!entry) {
      getLogger().warn('Attempted to resolve unknown or already-resolved approval', { id });
      return;
    }

    clearTimeout(entry.timeout);
    this.pending.delete(id);

    const decidedAtMs = Date.now();

    this.db.approvals.update(id, { decision, decidedAtMs, decidedBy });

    getLogger().info('Approval decided', { id, decision, decidedBy });

    void this.eventBus.emit('approval:decision', { id, decision });

    entry.resolve(decision);
  }

  /**
   * Recover stale/expired approvals on startup. Marks them as 'timeout'
   * in the DB and cleans any orphaned in-memory entries.
   */
  async recoverPending(): Promise<void> {
    const logger = getLogger();

    const expired = this.db.approvals.getExpired();
    const orphaned = this.db.approvals.getPending().filter((r) => !this.pending.has(r.id));
    const stale = [...expired, ...orphaned];

    for (const request of stale) {
      this.db.approvals.update(request.id, {
        decision: 'timeout',
        decidedAtMs: Date.now(),
      });
      logger.info('Recovered stale approval', { id: request.id, command: request.command });
      void this.eventBus.emit('approval:timeout', { id: request.id });
    }

    logger.info('Approval recovery complete', {
      expiredCount: expired.length,
      orphanedCount: orphaned.length,
    });
  }

  /**
   * Return a snapshot of currently pending approval requests (for UI/CLI display).
   */
  getPending(): ApprovalRequest[] {
    return Array.from(this.pending.values()).map((entry) => entry.request);
  }

  /**
   * Gracefully shut down: clear all pending timers and resolve remaining
   * Promises with null so callers are never left hanging.
   */
  shutdown(): void {
    const logger = getLogger();
    const count = this.pending.size;

    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timeout);
      entry.resolve(null);

      logger.debug('Shutdown: resolved pending approval with null', { id });
    }

    this.pending.clear();
    logger.info('ApprovalManager shut down', { clearedCount: count });
  }

  /**
   * Handle a single approval timing out. Updates DB, emits event, resolves Promise.
   */
  private handleTimeout(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;

    this.pending.delete(id);

    this.db.approvals.update(id, {
      decision: 'timeout',
      decidedAtMs: Date.now(),
    });

    getLogger().info('Approval timed out', { id, command: entry.request.command });

    void this.eventBus.emit('approval:timeout', { id });

    entry.resolve(null);
  }
}

// ---------------------------------------------------------------------------
// Global ApprovalManager Instance
// ---------------------------------------------------------------------------

let globalApprovalManager: ApprovalManager | null = null;

export function createApprovalManager(options: {
  db: Database;
  eventBus: EventBus;
  timeoutMs?: number;
}): ApprovalManager {
  globalApprovalManager = new ApprovalManager(options);
  return globalApprovalManager;
}

export function getApprovalManager(): ApprovalManager {
  if (!globalApprovalManager) {
    throw new Error('ApprovalManager not initialized. Call createApprovalManager first.');
  }
  return globalApprovalManager;
}
