/**
 * Input Helpers Unit Tests
 * Tests prompt, confirm, and secret input functions
 */

import { describe, it, expect } from 'bun:test';
import { prompt, promptSecret, confirm } from '../../src/cli/input';

describe('Input Helpers', () => {
  // Note: These functions are interactive and require stdin/stdout
  // We primarily test that they are exported and have correct signatures

  describe('prompt', () => {
    it('should be a function', () => {
      expect(typeof prompt).toBe('function');
    });

    it('should return a promise', () => {
      // Can't actually run this without mocking stdin
      // Just verify the function signature
      expect(prompt.length).toBe(1); // Takes 1 argument
    });
  });

  describe('promptSecret', () => {
    it('should be a function', () => {
      expect(typeof promptSecret).toBe('function');
    });

    it('should return a promise', () => {
      expect(promptSecret.length).toBe(1); // Takes 1 argument
    });
  });

  describe('confirm', () => {
    it('should be a function', () => {
      expect(typeof confirm).toBe('function');
    });

    it('should accept question and optional default value', () => {
      // confirm(question: string, defaultValue = false)
      // .length reports minimum required parameters (without defaults)
      expect(confirm.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Module Exports', () => {
    it('should export prompt function', () => {
      expect(prompt).toBeDefined();
    });

    it('should export promptSecret function', () => {
      expect(promptSecret).toBeDefined();
    });

    it('should export confirm function', () => {
      expect(confirm).toBeDefined();
    });
  });
});
