/**
 * Logger Interface for the Updater Package
 * Consumers provide a concrete logger implementation via setLogger()
 */

// ---------------------------------------------------------------------------
// Logger Interface
// ---------------------------------------------------------------------------

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(prefix: string): Logger;
}

// ---------------------------------------------------------------------------
// Module-level Logger
// ---------------------------------------------------------------------------

const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() { return noopLogger; },
};

let currentLogger: Logger = noopLogger;

export function setLogger(logger: Logger): void {
  currentLogger = logger;
}

export function getLogger(): Logger {
  return currentLogger;
}
