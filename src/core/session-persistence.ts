/**
 * JSONL Session Persistence
 * Exports conversation transcripts to JSONL files for archival and replay
 */

import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs';
import type { Message } from './types';
import { getLogger } from '../infra/logger';

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionFileInfo {
  id: string;
  createdAt: number;
  lastActivity: number;
  size: number;
}

// ---------------------------------------------------------------------------
// Session Persistence Class
// ---------------------------------------------------------------------------

export class SessionPersistence {
  private sessionsDir: string;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? join(homedir(), '.daemux', 'sessions');
  }

  /**
   * Append one or more messages as JSONL lines to the session file.
   * Creates the sessions directory and file if they do not exist.
   */
  async appendTurn(sessionId: string, messages: Message[]): Promise<void> {
    if (messages.length === 0) return;

    this.ensureDir();
    const filePath = this.sessionPath(sessionId);

    try {
      const file = Bun.file(filePath);
      const writer = file.writer();

      for (const message of messages) {
        writer.write(JSON.stringify(message) + '\n');
      }

      writer.flush();
      writer.end();
    } catch (err) {
      getLogger().error('Failed to append turn to JSONL', {
        sessionId,
        error: toErrorMessage(err),
      });
    }
  }

  /**
   * Load all messages from a session JSONL file.
   * Returns an empty array if the file does not exist.
   */
  async loadSession(sessionId: string): Promise<Message[]> {
    const filePath = this.sessionPath(sessionId);

    if (!existsSync(filePath)) {
      return [];
    }

    try {
      const file = Bun.file(filePath);
      const text = await file.text();
      const lines = text.split('\n').filter((line) => line.trim().length > 0);
      const messages: Message[] = [];

      for (const line of lines) {
        try {
          messages.push(JSON.parse(line) as Message);
        } catch {
          getLogger().warn('Skipping malformed JSONL line', { sessionId });
        }
      }

      return messages;
    } catch (err) {
      getLogger().error('Failed to load session JSONL', {
        sessionId,
        error: toErrorMessage(err),
      });
      return [];
    }
  }

  /**
   * List all session files with metadata, sorted by lastActivity descending.
   */
  async listSessions(): Promise<SessionFileInfo[]> {
    if (!existsSync(this.sessionsDir)) {
      return [];
    }

    try {
      const entries = readdirSync(this.sessionsDir);
      const sessions: SessionFileInfo[] = [];

      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;

        const id = entry.replace(/\.jsonl$/, '');
        const filePath = join(this.sessionsDir, entry);

        try {
          const stat = statSync(filePath);
          sessions.push({
            id,
            createdAt: stat.birthtimeMs,
            lastActivity: stat.mtimeMs,
            size: stat.size,
          });
        } catch {
          // Skip files that cannot be accessed
        }
      }

      sessions.sort((a, b) => b.lastActivity - a.lastActivity);
      return sessions;
    } catch (err) {
      getLogger().error('Failed to list sessions', { error: toErrorMessage(err) });
      return [];
    }
  }

  /**
   * Delete a session JSONL file.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const filePath = this.sessionPath(sessionId);

    if (!existsSync(filePath)) return;

    try {
      unlinkSync(filePath);
      getLogger().debug('Deleted session file', { sessionId });
    } catch (err) {
      getLogger().error('Failed to delete session file', {
        sessionId,
        error: toErrorMessage(err),
      });
    }
  }

  /**
   * Get the directory where session files are stored.
   */
  getSessionsDir(): string {
    return this.sessionsDir;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private sessionPath(sessionId: string): string {
    const safeName = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.sessionsDir, `${safeName}.jsonl`);
  }

  private ensureDir(): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSessionPersistence(
  sessionsDir?: string
): SessionPersistence {
  return new SessionPersistence(sessionsDir);
}
