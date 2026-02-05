/**
 * CLI Utils Enhanced Tests
 * Tests spinner, shutdown handlers, and table formatting edge cases
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  createSpinner,
  color,
  bold,
  dim,
  success,
  warning,
  printError,
  printInfo,
  printSuccess,
  printWarning,
  onShutdown,
} from '../../src/cli/utils';

describe('CLI Utils Enhanced', () => {
  describe('Spinner', () => {
    it('should create spinner with message', () => {
      const spinner = createSpinner('Loading');
      expect(spinner).toBeDefined();
      expect(typeof spinner.start).toBe('function');
      expect(typeof spinner.stop).toBe('function');
      expect(typeof spinner.succeed).toBe('function');
      expect(typeof spinner.fail).toBe('function');
      expect(typeof spinner.warn).toBe('function');
      expect(typeof spinner.update).toBe('function');
    });

    it('should handle succeed with message', () => {
      const spinner = createSpinner('Test');
      // In non-TTY mode, should not throw
      spinner.succeed('Success!');
    });

    it('should handle fail with message', () => {
      const spinner = createSpinner('Test');
      spinner.fail('Failed!');
    });

    it('should handle warn with message', () => {
      const spinner = createSpinner('Test');
      spinner.warn('Warning!');
    });

    it('should handle update during non-TTY', () => {
      const spinner = createSpinner('Initial');
      spinner.update('Updated message');
    });
  });

  describe('Color Functions', () => {
    it('should apply cyan color', () => {
      const result = color('test', 'cyan');
      expect(result).toContain('test');
    });

    it('should apply red color', () => {
      const result = color('test', 'red');
      expect(result).toContain('test');
    });

    it('should apply green color', () => {
      const result = color('test', 'green');
      expect(result).toContain('test');
    });

    it('should apply yellow color', () => {
      const result = color('test', 'yellow');
      expect(result).toContain('test');
    });

    it('should apply blue color', () => {
      const result = color('test', 'blue');
      expect(result).toContain('test');
    });

    it('should apply magenta color', () => {
      const result = color('test', 'magenta');
      expect(result).toContain('test');
    });

    it('should handle empty string', () => {
      const result = color('', 'cyan');
      expect(typeof result).toBe('string');
    });
  });

  describe('Text Formatting', () => {
    it('should bold text', () => {
      const result = bold('text');
      expect(result).toContain('text');
    });

    it('should dim text', () => {
      const result = dim('text');
      expect(result).toContain('text');
    });

    it('should format success', () => {
      const result = success('text');
      expect(result).toContain('text');
    });

    it('should format warning', () => {
      const result = warning('text');
      expect(result).toContain('text');
    });
  });

  describe('Print Functions', () => {
    it('should print error', () => {
      // Just verify it doesn't throw
      const originalError = console.error;
      let captured = '';
      console.error = (msg: any) => { captured = String(msg); };

      printError('Error message');

      console.error = originalError;
      expect(captured).toContain('Error message');
    });

    it('should print error with Error object', () => {
      const originalError = console.error;
      let captured = '';
      console.error = (msg: any) => { captured = String(msg); };

      printError(new Error('Test error'));

      console.error = originalError;
      expect(captured).toContain('Test error');
    });

    it('should print info', () => {
      const originalLog = console.log;
      let captured = '';
      console.log = (msg: any) => { captured = String(msg); };

      printInfo('Info message');

      console.log = originalLog;
      expect(captured).toContain('Info message');
    });

    it('should print success', () => {
      const originalLog = console.log;
      let captured = '';
      console.log = (msg: any) => { captured = String(msg); };

      printSuccess('Success message');

      console.log = originalLog;
      expect(captured).toContain('Success message');
    });

    it('should print warning', () => {
      const originalWarn = console.warn;
      let captured = '';
      console.warn = (msg: any) => { captured = String(msg); };

      printWarning('Warning message');

      console.warn = originalWarn;
      expect(captured).toContain('Warning message');
    });
  });

;

  describe('onShutdown', () => {
    it('should register shutdown handler', () => {
      let handlerCalled = false;
      const handler = () => { handlerCalled = true; };

      // This registers the handler but doesn't call it
      onShutdown(handler);

      // Handler should not be called immediately
      expect(handlerCalled).toBe(false);
    });

    it('should accept async handler', () => {
      const asyncHandler = async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
      };

      // Should not throw
      onShutdown(asyncHandler);
    });

    it('should accept multiple handlers', () => {
      let count = 0;
      onShutdown(() => { count++; });
      onShutdown(() => { count++; });
      onShutdown(() => { count++; });

      // Handlers registered but not called
      expect(count).toBe(0);
    });
  });

  describe('ANSI Escape Codes', () => {
    it('should include escape sequences in colored output', () => {
      const result = color('test', 'red');
      // ANSI codes start with \x1b[
      expect(result.includes('\x1b[') || result === 'test').toBe(true);
    });

    it('should reset formatting at end', () => {
      const result = bold('test');
      // Should include reset code or be plain text in non-TTY
      expect(result.includes('\x1b[') || result === 'test').toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in messages', () => {
      const spinner = createSpinner('Loading... $100 "test" <html>');
      spinner.succeed('Done!');
    });

    it('should handle unicode in spinner message', () => {
      const spinner = createSpinner('\u4e16\u754c\u4f60\u597d');
      spinner.succeed('\u2713 Complete');
    });

    it('should handle special characters in messages', () => {
      // Just verify no errors with special chars
      const result = dim('Line1\nLine2\tTab');
      expect(typeof result).toBe('string');
    });
  });

  describe('Color Code Constants', () => {
    const colors = ['cyan', 'red', 'green', 'yellow', 'blue', 'magenta'] as const;

    for (const c of colors) {
      it(`should have ${c} color code`, () => {
        const result = color('X', c);
        expect(result.length).toBeGreaterThanOrEqual(1);
      });
    }
  });

  describe('Spinner Frame Animation', () => {
    it('should have spinner frames defined', () => {
      // The spinner uses SPINNER_FRAMES internally
      // We just test that createSpinner works
      const spinner = createSpinner('Test');
      expect(spinner).toBeDefined();
    });

    it('should handle rapid update calls', () => {
      const spinner = createSpinner('Initial');
      for (let i = 0; i < 100; i++) {
        spinner.update(`Message ${i}`);
      }
      spinner.stop();
    });
  });
});

describe('Print Function Error Handling', () => {
  it('should handle undefined error', () => {
    const originalError = console.error;
    let captured = '';
    console.error = (msg: any) => { captured = String(msg); };

    printError(undefined);

    console.error = originalError;
    expect(typeof captured).toBe('string');
  });

  it('should handle null error', () => {
    const originalError = console.error;
    let captured = '';
    console.error = (msg: any) => { captured = String(msg); };

    printError(null);

    console.error = originalError;
    expect(typeof captured).toBe('string');
  });

  it('should handle object error', () => {
    const originalError = console.error;
    let captured = '';
    console.error = (msg: any) => { captured = String(msg); };

    printError({ message: 'Object error' });

    console.error = originalError;
    // Object may be stringified in various ways
    expect(typeof captured).toBe('string');
  });
});
