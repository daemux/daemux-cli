/**
 * Debug Logging System with File Output
 * Supports log levels, file rotation, and sensitive data sanitization
 */

import { mkdir, readdir, unlink, symlink, lstat, rm } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { LogLevel } from '@daemux/types';

// ---------------------------------------------------------------------------
// Logger Configuration
// ---------------------------------------------------------------------------

export interface LoggerConfig {
  level: LogLevel;
  logDir?: string;
  cleanupPeriodDays?: number;
  sessionId?: string;
  enabled?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_PATTERNS = [
  /sk-ant-[a-zA-Z0-9_-]+/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /api[_-]?key[=:]\s*["']?[a-zA-Z0-9_-]+["']?/gi,
  /password[=:]\s*["']?[^"'\s]+["']?/gi,
  /token[=:]\s*["']?[a-zA-Z0-9._-]+["']?/gi,
  /secret[=:]\s*["']?[^"'\s]+["']?/gi,
  /authorization[=:]\s*["']?[^"'\s]+["']?/gi,
];

// ---------------------------------------------------------------------------
// Logger Class
// ---------------------------------------------------------------------------

export class Logger {
  private level: number;
  private logDir: string;
  private cleanupPeriodDays: number;
  private sessionId: string;
  private enabled: boolean;
  private logFile: string | null = null;
  private fileHandle: Bun.FileSink | null = null;
  private initialized = false;

  constructor(config: LoggerConfig) {
    this.level = LOG_LEVELS[config.level];
    this.logDir = config.logDir ?? join(homedir(), '.daemux', 'debug-logs');
    this.cleanupPeriodDays = config.cleanupPeriodDays ?? 7;
    this.sessionId = config.sessionId ?? this.generateSessionId();
    this.enabled = config.enabled ?? true;
  }

  private generateSessionId(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const random = Math.random().toString(36).slice(2, 8);
    return `${timestamp}-${random}`;
  }

  async initialize(): Promise<void> {
    if (this.initialized || !this.enabled) return;

    await mkdir(this.logDir, { recursive: true });

    this.logFile = join(this.logDir, `session-${this.sessionId}.log`);

    const file = Bun.file(this.logFile);
    this.fileHandle = file.writer();

    await this.updateLatestSymlink();
    await this.cleanupOldLogs();

    this.initialized = true;
  }

  private async updateLatestSymlink(): Promise<void> {
    const latestPath = join(this.logDir, 'latest');

    try {
      const stat = await lstat(latestPath);
      if (stat.isSymbolicLink()) {
        await rm(latestPath);
      }
    } catch {
      // File doesn't exist, that's fine
    }

    if (this.logFile) {
      await symlink(this.logFile, latestPath);
    }
  }

  private async cleanupOldLogs(): Promise<void> {
    const cutoffMs = Date.now() - this.cleanupPeriodDays * 24 * 60 * 60 * 1000;

    try {
      const files = await readdir(this.logDir);

      for (const file of files) {
        if (!file.startsWith('session-') || !file.endsWith('.log')) continue;

        const filePath = join(this.logDir, file);
        const bunFile = Bun.file(filePath);

        try {
          const stat = await bunFile.stat();
          if (stat && stat.mtime.getTime() < cutoffMs) {
            await unlink(filePath);
          }
        } catch {
          // Skip files that can't be accessed
        }
      }
    } catch {
      // Log directory might not exist yet
    }
  }

  private sanitize(data: unknown): unknown {
    if (typeof data === 'string') {
      let sanitized = data;
      for (const pattern of SENSITIVE_PATTERNS) {
        sanitized = sanitized.replace(pattern, '[REDACTED]');
      }
      return sanitized;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitize(item));
    }

    if (data !== null && typeof data === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('password') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('token') ||
          lowerKey.includes('key') ||
          lowerKey.includes('authorization')
        ) {
          result[key] = '[REDACTED]';
        } else {
          result[key] = this.sanitize(value);
        }
      }
      return result;
    }

    return data;
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);

    let output = `[${timestamp}] ${levelStr} ${message}`;

    if (data) {
      const sanitized = this.sanitize(data);
      output += ` ${JSON.stringify(sanitized)}`;
    }

    return output;
  }

  private async write(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    if (!this.enabled || LOG_LEVELS[level] < this.level) return;

    const formatted = this.formatMessage(level, message, data);

    // Always write to console for warn/error
    if (level === 'warn') {
      console.warn(formatted);
    } else if (level === 'error') {
      console.error(formatted);
    }

    // Write to file if initialized
    if (this.fileHandle) {
      this.fileHandle.write(formatted + '\n');
      this.fileHandle.flush();
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    void this.write('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    void this.write('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    void this.write('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    void this.write('error', message, data);
  }

  log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    void this.write(level, message, data);
  }

  child(prefix: string): ChildLogger {
    return new ChildLogger(this, prefix);
  }

  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.end();
      this.fileHandle = null;
    }
  }

  getLogFile(): string | null {
    return this.logFile;
  }

  getSessionId(): string {
    return this.sessionId;
  }
}

// ---------------------------------------------------------------------------
// Child Logger (with prefix)
// ---------------------------------------------------------------------------

class ChildLogger {
  private parent: Logger;
  private prefix: string;

  constructor(parent: Logger, prefix: string) {
    this.parent = parent;
    this.prefix = prefix;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.parent.debug(`[${this.prefix}] ${message}`, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.parent.info(`[${this.prefix}] ${message}`, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.parent.warn(`[${this.prefix}] ${message}`, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.parent.error(`[${this.prefix}] ${message}`, data);
  }

  log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    this.parent.log(level, `[${this.prefix}] ${message}`, data);
  }

  child(subPrefix: string): ChildLogger {
    return new ChildLogger(this.parent, `${this.prefix}:${subPrefix}`);
  }
}

// ---------------------------------------------------------------------------
// Global Logger Instance
// ---------------------------------------------------------------------------

let globalLogger: Logger | null = null;

export function createLogger(config: LoggerConfig): Logger {
  globalLogger = new Logger(config);
  return globalLogger;
}

export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger({ level: 'info', enabled: false });
  }
  return globalLogger;
}

export interface InitLoggerOptions {
  level?: LogLevel;
  dataDir?: string;
  sessionId?: string;
}

export async function initLogger(options: InitLoggerOptions = {}): Promise<Logger> {
  const logDir = options.dataDir
    ? join(options.dataDir, 'debug-logs')
    : join(homedir(), '.daemux', 'debug-logs');

  globalLogger = new Logger({
    level: options.level ?? 'info',
    logDir,
    sessionId: options.sessionId,
    enabled: true,
  });

  await globalLogger.initialize();
  return globalLogger;
}
