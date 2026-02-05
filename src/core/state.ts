/**
 * State Abstraction Layer
 * Provides scoped key-value storage with prefix support for plugins
 */

import type { Database } from '../infra/database';

// ---------------------------------------------------------------------------
// State Manager Interface
// ---------------------------------------------------------------------------

export interface StateManager {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): boolean;
  list(prefix?: string): Array<{ key: string; value: unknown }>;
  clear(prefix?: string): number;
  has(key: string): boolean;
  scoped(prefix: string): ScopedState;
}

// ---------------------------------------------------------------------------
// Scoped State Interface
// ---------------------------------------------------------------------------

export interface ScopedState {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): boolean;
  list(): Array<{ key: string; value: unknown }>;
  clear(): number;
  has(key: string): boolean;
  prefix: string;
}

// ---------------------------------------------------------------------------
// State Manager Implementation
// ---------------------------------------------------------------------------

export class StateManagerImpl implements StateManager {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  get<T>(key: string): T | undefined {
    return this.db.state.get<T>(key);
  }

  set<T>(key: string, value: T): void {
    this.db.state.set(key, value);
  }

  delete(key: string): boolean {
    return this.db.state.delete(key);
  }

  list(prefix?: string): Array<{ key: string; value: unknown }> {
    return this.db.state.list(prefix);
  }

  clear(prefix?: string): number {
    const items = this.list(prefix);
    for (const item of items) {
      this.delete(item.key);
    }
    return items.length;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Create a scoped state manager with automatic key prefixing
   * Useful for isolating plugin state
   */
  scoped(prefix: string): ScopedState {
    return new ScopedStateImpl(this, prefix);
  }
}

// ---------------------------------------------------------------------------
// Scoped State Implementation
// ---------------------------------------------------------------------------

class ScopedStateImpl implements ScopedState {
  private parent: StateManager;
  readonly prefix: string;

  constructor(parent: StateManager, prefix: string) {
    this.parent = parent;
    this.prefix = prefix.endsWith(':') ? prefix : `${prefix}:`;
  }

  private scopedKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private unscopedKey(scopedKey: string): string {
    return scopedKey.slice(this.prefix.length);
  }

  get<T>(key: string): T | undefined {
    return this.parent.get<T>(this.scopedKey(key));
  }

  set<T>(key: string, value: T): void {
    this.parent.set(this.scopedKey(key), value);
  }

  delete(key: string): boolean {
    return this.parent.delete(this.scopedKey(key));
  }

  list(): Array<{ key: string; value: unknown }> {
    const items = this.parent.list(this.prefix);
    return items.map(item => ({
      key: this.unscopedKey(item.key),
      value: item.value,
    }));
  }

  clear(): number {
    const items = this.list();
    for (const item of items) {
      this.delete(item.key);
    }
    return items.length;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}

// ---------------------------------------------------------------------------
// In-Memory State Implementation (for testing or standalone use)
// ---------------------------------------------------------------------------

export class InMemoryStateManager implements StateManager {
  private store: Map<string, unknown> = new Map();

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, value);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  list(prefix?: string): Array<{ key: string; value: unknown }> {
    const result: Array<{ key: string; value: unknown }> = [];
    for (const [key, value] of this.store.entries()) {
      if (!prefix || key.startsWith(prefix)) {
        result.push({ key, value });
      }
    }
    return result;
  }

  clear(prefix?: string): number {
    if (!prefix) {
      const count = this.store.size;
      this.store.clear();
      return count;
    }

    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  scoped(prefix: string): ScopedState {
    return new ScopedStateImpl(this, prefix);
  }
}

// ---------------------------------------------------------------------------
// Global State Instance
// ---------------------------------------------------------------------------

let globalState: StateManager | null = null;

export function createStateManager(db: Database): StateManager {
  globalState = new StateManagerImpl(db);
  return globalState;
}

export function getStateManager(): StateManager {
  if (!globalState) {
    // Return in-memory fallback if no database configured
    globalState = new InMemoryStateManager();
  }
  return globalState;
}
