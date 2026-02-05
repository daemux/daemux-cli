/**
 * Shared CLI Utilities
 * Spinners, colors, error formatting, text helpers
 */

// Re-export box drawing utilities for backward compatibility
export { BOX_CHARS, getTerminalWidth, getTerminalHeight, drawBox } from './box';
export type { BoxOptions } from './box';

// Re-export input utilities for backward compatibility
export { prompt, promptSecret, confirm } from './input';

// ---------------------------------------------------------------------------
// ANSI Colors
// ---------------------------------------------------------------------------

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
} as const;

export type ColorName = keyof typeof COLORS;

export function color(text: string, colorName: ColorName): string {
  const isColorEnabled = process.stdout.isTTY && !process.env.NO_COLOR;
  if (!isColorEnabled) return text;
  return `${COLORS[colorName]}${text}${COLORS.reset}`;
}

// Color convenience functions
export const bold = (text: string) => color(text, 'bold');
export const dim = (text: string) => color(text, 'dim');
export const success = (text: string) => color(text, 'green');
export const error = (text: string) => color(text, 'red');
export const warning = (text: string) => color(text, 'yellow');
export const info = (text: string) => color(text, 'cyan');

// ---------------------------------------------------------------------------
// Text Helpers
// ---------------------------------------------------------------------------

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

export function centerText(text: string, width: number): string {
  const visibleLength = stripAnsi(text).length;
  const padding = Math.max(0, Math.floor((width - visibleLength) / 2));
  return ' '.repeat(padding) + text;
}

export function padRight(text: string, width: number): string {
  const visibleLength = stripAnsi(text).length;
  const padding = Math.max(0, width - visibleLength);
  return text + ' '.repeat(padding);
}

// ---------------------------------------------------------------------------
// Progress Spinner
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 80;

export class Spinner {
  private message: string;
  private frameIndex = 0;
  private intervalId: Timer | null = null;
  private isRunning = false;

  constructor(message: string) {
    this.message = message;
  }

  start(): void {
    if (this.isRunning) return;

    if (!process.stdout.isTTY) {
      process.stdout.write(`${this.message}...\n`);
      return;
    }

    this.isRunning = true;
    process.stdout.write('\x1b[?25l');

    this.intervalId = setInterval(() => {
      const frame = SPINNER_FRAMES[this.frameIndex] ?? '⠋';
      process.stdout.write(`\r${color(frame, 'cyan')} ${this.message}`);
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
    }, SPINNER_INTERVAL);
  }

  update(message: string): void {
    this.message = message;
    if (!process.stdout.isTTY) {
      process.stdout.write(`${this.message}...\n`);
    }
  }

  stop(finalMessage?: string): void {
    if (!this.isRunning) return;

    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;

    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[K\x1b[?25h'); // Clear line and show cursor
    }

    if (finalMessage) console.log(finalMessage);
    this.isRunning = false;
  }

  succeed = (message?: string) => this.stop(`${success('✓')} ${message ?? this.message}`);
  fail = (message?: string) => this.stop(`${error('✗')} ${message ?? this.message}`);
  warn = (message?: string) => this.stop(`${warning('!')} ${message ?? this.message}`);
}

export const createSpinner = (message: string) => new Spinner(message);

// ---------------------------------------------------------------------------
// Error Formatting
// ---------------------------------------------------------------------------

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name !== 'Error' ? `${err.name}: ` : '';
    return `${name}${err.message}`;
  }
  return String(err);
}

// Print functions with prefix
export const printError = (err: unknown) => console.error(`${error('Error:')} ${formatError(err)}`);
export const printWarning = (message: string) => console.warn(`${warning('Warning:')} ${message}`);
export const printSuccess = (message: string) => console.log(`${success('Success:')} ${message}`);
export const printInfo = (message: string) => console.log(`${info('Info:')} ${message}`);

// ---------------------------------------------------------------------------
// Table Formatting
// ---------------------------------------------------------------------------

interface TableColumn {
  header: string;
  key: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
}

function padString(str: string, width: number, align: 'left' | 'right' | 'center'): string {
  const truncated = str.length > width ? `${str.slice(0, width - 1)}…` : str;
  const padding = width - truncated.length;

  if (align === 'right') return ' '.repeat(padding) + truncated;
  if (align === 'center') {
    const left = Math.floor(padding / 2);
    return ' '.repeat(left) + truncated + ' '.repeat(padding - left);
  }
  return truncated + ' '.repeat(padding);
}

export function printTable(columns: TableColumn[], rows: Record<string, unknown>[]): void {
  const widths = columns.map((col) => {
    if (col.width) return col.width;
    const maxContent = Math.max(col.header.length, ...rows.map((row) => String(row[col.key] ?? '').length));
    return Math.min(maxContent, 50);
  });

  const headerLine = columns.map((col, i) => padString(col.header, widths[i] ?? 10, col.align ?? 'left')).join('  ');
  console.log(bold(headerLine));

  console.log(widths.map((w) => '-'.repeat(w)).join('  '));

  for (const row of rows) {
    const line = columns.map((col, i) => padString(String(row[col.key] ?? ''), widths[i] ?? 10, col.align ?? 'left')).join('  ');
    console.log(line);
  }
}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

const shutdownHandlers: Array<() => Promise<void> | void> = [];
let shutdownRegistered = false;

export function onShutdown(handler: () => Promise<void> | void): void {
  shutdownHandlers.push(handler);

  if (!shutdownRegistered) {
    shutdownRegistered = true;

    const handleShutdown = async (signal: string) => {
      console.log(`\n${dim(`Received ${signal}, shutting down...`)}`);

      for (const h of shutdownHandlers) {
        try {
          await h();
        } catch {
          // Ignore shutdown errors
        }
      }

      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  }
}
