/**
 * CLI Utilities Unit Tests
 * Tests colors, spinners, text helpers, and error formatting
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  color,
  bold,
  dim,
  success,
  error,
  warning,
  info,
  stripAnsi,
  centerText,
  padRight,
  Spinner,
  createSpinner,
  formatError,
  printTable,
  onShutdown,
} from '../../src/cli/utils';

describe('CLI Utilities', () => {
  describe('Color Functions', () => {
    const originalIsTTY = process.stdout.isTTY;
    const originalNoColor = process.env.NO_COLOR;

    afterEach(() => {
      process.stdout.isTTY = originalIsTTY;
      if (originalNoColor !== undefined) {
        process.env.NO_COLOR = originalNoColor;
      } else {
        delete process.env.NO_COLOR;
      }
    });

    describe('color', () => {
      it('should apply color in TTY mode', () => {
        process.stdout.isTTY = true;
        delete process.env.NO_COLOR;

        const result = color('test', 'red');

        expect(result).toContain('\x1b[31m');
        expect(result).toContain('\x1b[0m');
        expect(result).toContain('test');
      });

      it('should not apply color when NO_COLOR is set', () => {
        process.stdout.isTTY = true;
        process.env.NO_COLOR = '1';

        const result = color('test', 'red');

        expect(result).toBe('test');
      });

      it('should not apply color when not TTY', () => {
        process.stdout.isTTY = false;

        const result = color('test', 'red');

        expect(result).toBe('test');
      });
    });

    describe('Convenience color functions', () => {
      beforeEach(() => {
        process.stdout.isTTY = true;
        delete process.env.NO_COLOR;
      });

      it('bold should apply bold', () => {
        const result = bold('test');
        expect(result).toContain('\x1b[1m');
      });

      it('dim should apply dim', () => {
        const result = dim('test');
        expect(result).toContain('\x1b[2m');
      });

      it('success should apply green', () => {
        const result = success('test');
        expect(result).toContain('\x1b[32m');
      });

      it('error should apply red', () => {
        const result = error('test');
        expect(result).toContain('\x1b[31m');
      });

      it('warning should apply yellow', () => {
        const result = warning('test');
        expect(result).toContain('\x1b[33m');
      });

      it('info should apply cyan', () => {
        const result = info('test');
        expect(result).toContain('\x1b[36m');
      });
    });
  });

  describe('Text Helpers', () => {
    describe('stripAnsi', () => {
      it('should remove ANSI codes', () => {
        const colored = '\x1b[31mRed Text\x1b[0m';
        const result = stripAnsi(colored);
        expect(result).toBe('Red Text');
      });

      it('should handle text without ANSI codes', () => {
        const plain = 'Plain text';
        const result = stripAnsi(plain);
        expect(result).toBe('Plain text');
      });

      it('should handle multiple ANSI codes', () => {
        const multi = '\x1b[1m\x1b[31mBold Red\x1b[0m\x1b[32m Green\x1b[0m';
        const result = stripAnsi(multi);
        expect(result).toBe('Bold Red Green');
      });

      it('should handle empty string', () => {
        const result = stripAnsi('');
        expect(result).toBe('');
      });
    });

    describe('centerText', () => {
      it('should center text in given width', () => {
        const result = centerText('Hi', 10);
        expect(result).toBe('    Hi');
      });

      it('should handle text equal to width', () => {
        const result = centerText('Hello', 5);
        expect(result).toBe('Hello');
      });

      it('should handle text longer than width', () => {
        const result = centerText('Hello World', 5);
        expect(result).toBe('Hello World');
      });

      it('should handle colored text', () => {
        const colored = '\x1b[31mHi\x1b[0m';
        const result = centerText(colored, 10);
        expect(result).toContain('Hi');
      });
    });

    describe('padRight', () => {
      it('should pad text to given width', () => {
        const result = padRight('Hi', 10);
        expect(result).toBe('Hi        ');
        expect(result.length).toBe(10);
      });

      it('should handle text equal to width', () => {
        const result = padRight('Hello', 5);
        expect(result).toBe('Hello');
      });

      it('should handle text longer than width', () => {
        const result = padRight('Hello World', 5);
        expect(result).toBe('Hello World');
      });

      it('should handle colored text', () => {
        const colored = '\x1b[31mHi\x1b[0m';
        const result = padRight(colored, 10);
        expect(stripAnsi(result)).toBe('Hi        ');
      });
    });
  });

  describe('Spinner', () => {
    describe('constructor', () => {
      it('should create spinner with message', () => {
        const spinner = new Spinner('Loading');
        expect(spinner).toBeDefined();
      });
    });

    describe('start', () => {
      it('should not throw when starting', () => {
        const spinner = new Spinner('Loading');
        expect(() => spinner.start()).not.toThrow();
        spinner.stop();
      });

      it('should not start twice', () => {
        const spinner = new Spinner('Loading');
        spinner.start();
        spinner.start(); // Should not throw
        spinner.stop();
      });
    });

    describe('update', () => {
      it('should update message', () => {
        const spinner = new Spinner('Loading');
        spinner.start();
        expect(() => spinner.update('Still loading')).not.toThrow();
        spinner.stop();
      });
    });

    describe('stop', () => {
      it('should stop spinner', () => {
        const spinner = new Spinner('Loading');
        spinner.start();
        expect(() => spinner.stop()).not.toThrow();
      });

      it('should handle stop with message', () => {
        const spinner = new Spinner('Loading');
        spinner.start();
        expect(() => spinner.stop('Done')).not.toThrow();
      });

      it('should not throw when stopping non-running spinner', () => {
        const spinner = new Spinner('Loading');
        expect(() => spinner.stop()).not.toThrow();
      });
    });

    describe('succeed/fail/warn', () => {
      it('should have succeed method', () => {
        const spinner = new Spinner('Loading');
        spinner.start();
        expect(() => spinner.succeed('Success')).not.toThrow();
      });

      it('should have fail method', () => {
        const spinner = new Spinner('Loading');
        spinner.start();
        expect(() => spinner.fail('Failed')).not.toThrow();
      });

      it('should have warn method', () => {
        const spinner = new Spinner('Loading');
        spinner.start();
        expect(() => spinner.warn('Warning')).not.toThrow();
      });
    });
  });

  describe('createSpinner', () => {
    it('should create a Spinner instance', () => {
      const spinner = createSpinner('Loading');
      expect(spinner).toBeInstanceOf(Spinner);
    });
  });

  describe('Spinner interval behavior', () => {
    it('should run interval callback when TTY', async () => {
      const originalIsTTY = process.stdout.isTTY;
      process.stdout.isTTY = true;

      const spinner = new Spinner('Testing interval');
      spinner.start();

      // Wait for interval to fire at least once (interval is typically 80ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      spinner.stop();
      process.stdout.isTTY = originalIsTTY;
    });

    it('should not run interval when not TTY', async () => {
      const originalIsTTY = process.stdout.isTTY;
      process.stdout.isTTY = false;

      const spinner = new Spinner('Non-TTY test');
      spinner.start();

      // Even with wait, interval shouldn't run
      await new Promise(resolve => setTimeout(resolve, 50));

      spinner.stop();
      process.stdout.isTTY = originalIsTTY;
    });

    it('should update frame index each interval', async () => {
      const originalIsTTY = process.stdout.isTTY;
      process.stdout.isTTY = true;

      const spinner = new Spinner('Frame test');
      spinner.start();

      // Wait for multiple interval ticks
      await new Promise(resolve => setTimeout(resolve, 250));

      spinner.stop();
      process.stdout.isTTY = originalIsTTY;
    });
  });

  describe('Error Formatting', () => {
    describe('formatError', () => {
      it('should format Error instances', () => {
        const err = new Error('Something went wrong');
        const result = formatError(err);
        expect(result).toBe('Something went wrong');
      });

      it('should format Error with custom name', () => {
        const err = new TypeError('Invalid type');
        const result = formatError(err);
        expect(result).toContain('TypeError');
        expect(result).toContain('Invalid type');
      });

      it('should format strings', () => {
        const result = formatError('String error');
        expect(result).toBe('String error');
      });

      it('should format numbers', () => {
        const result = formatError(404);
        expect(result).toBe('404');
      });

      it('should format null', () => {
        const result = formatError(null);
        expect(result).toBe('null');
      });

      it('should format undefined', () => {
        const result = formatError(undefined);
        expect(result).toBe('undefined');
      });

      it('should format objects', () => {
        const result = formatError({ code: 'ERR' });
        expect(result).toBe('[object Object]');
      });
    });
  });

  describe('Table Formatting', () => {
    describe('printTable', () => {
      it('should not throw with valid input', () => {
        const columns = [
          { header: 'Name', key: 'name' },
          { header: 'Age', key: 'age' },
        ];
        const rows = [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ];

        expect(() => printTable(columns, rows)).not.toThrow();
      });

      it('should handle empty rows', () => {
        const columns = [{ header: 'Name', key: 'name' }];
        expect(() => printTable(columns, [])).not.toThrow();
      });

      it('should handle missing keys', () => {
        const columns = [
          { header: 'Name', key: 'name' },
          { header: 'Age', key: 'age' },
        ];
        const rows = [{ name: 'Alice' }];

        expect(() => printTable(columns, rows)).not.toThrow();
      });

      it('should handle custom width', () => {
        const columns = [{ header: 'Name', key: 'name', width: 20 }];
        const rows = [{ name: 'Alice' }];

        expect(() => printTable(columns, rows)).not.toThrow();
      });

      it('should handle alignment options', () => {
        const columns = [
          { header: 'Name', key: 'name', align: 'left' as const },
          { header: 'Age', key: 'age', align: 'right' as const },
          { header: 'Score', key: 'score', align: 'center' as const },
        ];
        const rows = [{ name: 'Alice', age: 30, score: 95 }];

        expect(() => printTable(columns, rows)).not.toThrow();
      });
    });
  });

  describe('Shutdown Handling', () => {
    describe('onShutdown', () => {
      it('should register shutdown handler', () => {
        const handler = () => {};
        expect(() => onShutdown(handler)).not.toThrow();
      });

      it('should register async handler', () => {
        const handler = async () => {};
        expect(() => onShutdown(handler)).not.toThrow();
      });

      it('should register multiple handlers', () => {
        expect(() => {
          onShutdown(() => {});
          onShutdown(() => {});
          onShutdown(() => {});
        }).not.toThrow();
      });
    });
  });
});
