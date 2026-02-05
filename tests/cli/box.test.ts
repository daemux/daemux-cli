/**
 * Box Drawing Utilities Unit Tests
 * Tests terminal box rendering and dimension helpers
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  BOX_CHARS,
  getTerminalWidth,
  getTerminalHeight,
  drawBox,
} from '../../src/cli/box';

describe('Box Drawing Utilities', () => {
  describe('BOX_CHARS', () => {
    it('should export all box characters', () => {
      expect(BOX_CHARS.topLeft).toBe('\u256D');
      expect(BOX_CHARS.topRight).toBe('\u256E');
      expect(BOX_CHARS.bottomLeft).toBe('\u2570');
      expect(BOX_CHARS.bottomRight).toBe('\u256F');
      expect(BOX_CHARS.horizontal).toBe('\u2500');
      expect(BOX_CHARS.vertical).toBe('\u2502');
      expect(BOX_CHARS.teeRight).toBe('\u251C');
      expect(BOX_CHARS.teeLeft).toBe('\u2524');
      expect(BOX_CHARS.teeDown).toBe('\u252C');
      expect(BOX_CHARS.teeUp).toBe('\u2534');
      expect(BOX_CHARS.cross).toBe('\u253C');
    });

    it('should be single Unicode characters', () => {
      for (const char of Object.values(BOX_CHARS)) {
        expect(char.length).toBe(1);
      }
    });
  });

  describe('getTerminalWidth', () => {
    it('should return a number', () => {
      const width = getTerminalWidth();
      expect(typeof width).toBe('number');
    });

    it('should return at least 80', () => {
      const width = getTerminalWidth();
      expect(width).toBeGreaterThanOrEqual(80);
    });

    it('should return process.stdout.columns or default', () => {
      const width = getTerminalWidth();
      const expected = process.stdout.columns ?? 80;
      expect(width).toBe(expected);
    });
  });

  describe('getTerminalHeight', () => {
    it('should return a number', () => {
      const height = getTerminalHeight();
      expect(typeof height).toBe('number');
    });

    it('should return at least 24', () => {
      const height = getTerminalHeight();
      expect(height).toBeGreaterThanOrEqual(24);
    });

    it('should return process.stdout.rows or default', () => {
      const height = getTerminalHeight();
      const expected = process.stdout.rows ?? 24;
      expect(height).toBe(expected);
    });
  });

  describe('drawBox', () => {
    it('should draw a simple box', () => {
      const result = drawBox(['Hello'], { width: 20 });

      expect(result).toContain(BOX_CHARS.topLeft);
      expect(result).toContain(BOX_CHARS.topRight);
      expect(result).toContain(BOX_CHARS.bottomLeft);
      expect(result).toContain(BOX_CHARS.bottomRight);
      expect(result).toContain('Hello');
    });

    it('should include title if provided', () => {
      const result = drawBox(['Content'], { width: 30, title: 'Title' });

      expect(result).toContain('Title');
      expect(result).toContain('Content');
    });

    it('should handle multiple lines', () => {
      const result = drawBox(['Line 1', 'Line 2', 'Line 3'], { width: 20 });

      expect(result).toContain('Line 1');
      expect(result).toContain('Line 2');
      expect(result).toContain('Line 3');
    });

    it('should truncate long lines', () => {
      const longLine = 'x'.repeat(100);
      const result = drawBox([longLine], { width: 20 });

      expect(result).toContain('\u2026');
    });

    it('should respect padding', () => {
      const result = drawBox(['Test'], { width: 20, padding: 2 });

      const lines = result.split('\n');
      const contentLine = lines.find(l => l.includes('Test'));
      expect(contentLine).toContain('  Test');
    });

    it('should handle empty content', () => {
      const result = drawBox([], { width: 20 });

      const lines = result.split('\n');
      expect(lines.length).toBe(2);
    });

    it('should use default width if not specified', () => {
      const result = drawBox(['Test']);

      expect(result).toContain('Test');
    });

    it('should center title in top border', () => {
      const result = drawBox(['Content'], { width: 40, title: 'Title' });
      const lines = result.split('\n');
      const topLine = lines[0];

      expect(topLine).toContain(' Title ');
      expect(topLine?.startsWith(BOX_CHARS.topLeft)).toBe(true);
      expect(topLine?.endsWith(BOX_CHARS.topRight)).toBe(true);
    });

    it('should handle unicode content', () => {
      const result = drawBox(['Hello \u4e16\u754c'], { width: 30 });

      expect(result).toContain('\u4e16\u754c');
    });

    it('should handle empty strings in content', () => {
      const result = drawBox(['Line 1', '', 'Line 3'], { width: 20 });

      expect(result).toContain('Line 1');
      expect(result).toContain('Line 3');
    });

    it('should properly close box', () => {
      const result = drawBox(['Test'], { width: 20 });
      const lines = result.split('\n');

      const topLine = lines[0];
      const bottomLine = lines[lines.length - 1];

      expect(topLine?.startsWith(BOX_CHARS.topLeft)).toBe(true);
      expect(topLine?.endsWith(BOX_CHARS.topRight)).toBe(true);
      expect(bottomLine?.startsWith(BOX_CHARS.bottomLeft)).toBe(true);
      expect(bottomLine?.endsWith(BOX_CHARS.bottomRight)).toBe(true);
    });

    it('should have consistent line lengths', () => {
      const result = drawBox(['Short', 'A much longer line'], { width: 30 });
      const lines = result.split('\n');

      const firstLength = lines[0]?.length;
      for (const line of lines) {
        expect(line.length).toBe(firstLength);
      }
    });
  });
});
