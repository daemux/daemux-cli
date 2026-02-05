/**
 * Logger Unit Tests
 * Tests logging functionality and sanitization
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Logger, createLogger, getLogger, initLogger } from '../src/infra/logger';
import { join } from 'path';
import { rmSync, existsSync, readFileSync } from 'fs';

describe('Logger', () => {
  const testLogDir = join(import.meta.dir, 'test-logs');

  afterEach(() => {
    if (existsSync(testLogDir)) {
      rmSync(testLogDir, { recursive: true });
    }
  });

  describe('Logger Creation', () => {
    it('should create logger with config', () => {
      const logger = new Logger({
        level: 'info',
        logDir: testLogDir,
        enabled: false,
      });

      expect(logger).toBeDefined();
      expect(logger.getSessionId()).toBeDefined();
    });

    it('should generate unique session IDs', () => {
      const logger1 = new Logger({ level: 'info', enabled: false });
      const logger2 = new Logger({ level: 'info', enabled: false });

      expect(logger1.getSessionId()).not.toBe(logger2.getSessionId());
    });

    it('should use provided session ID', () => {
      const logger = new Logger({
        level: 'info',
        sessionId: 'custom-session-id',
        enabled: false,
      });

      expect(logger.getSessionId()).toBe('custom-session-id');
    });
  });

  describe('Log Levels', () => {
    it('should have debug method', () => {
      const logger = new Logger({ level: 'debug', enabled: false });
      expect(() => logger.debug('Test message')).not.toThrow();
    });

    it('should have info method', () => {
      const logger = new Logger({ level: 'info', enabled: false });
      expect(() => logger.info('Test message')).not.toThrow();
    });

    it('should have warn method', () => {
      const logger = new Logger({ level: 'warn', enabled: false });
      expect(() => logger.warn('Test message')).not.toThrow();
    });

    it('should have error method', () => {
      const logger = new Logger({ level: 'error', enabled: false });
      expect(() => logger.error('Test message')).not.toThrow();
    });

    it('should have generic log method', () => {
      const logger = new Logger({ level: 'info', enabled: false });
      expect(() => logger.log('info', 'Test message')).not.toThrow();
    });
  });

  describe('Data Sanitization', () => {
    it('should redact API keys in strings', async () => {
      const logger = new Logger({
        level: 'debug',
        logDir: testLogDir,
        enabled: true,
      });

      await logger.initialize();
      logger.debug('Test', { key: 'sk-ant-api03-secretkey123' });

      // Give time for write
      await new Promise(resolve => setTimeout(resolve, 100));
      await logger.close();

      const logFile = logger.getLogFile();
      if (logFile) {
        const content = readFileSync(logFile, 'utf-8');
        expect(content).not.toContain('secretkey123');
        expect(content).toContain('[REDACTED]');
      }
    });

    it('should redact OAuth tokens', async () => {
      const logger = new Logger({
        level: 'debug',
        logDir: testLogDir,
        enabled: true,
      });

      await logger.initialize();
      logger.debug('Test', { token: 'sk-ant-oat01-verysecrettoken123' });

      await new Promise(resolve => setTimeout(resolve, 100));
      await logger.close();

      const logFile = logger.getLogFile();
      if (logFile) {
        const content = readFileSync(logFile, 'utf-8');
        expect(content).not.toContain('verysecrettoken123');
      }
    });

    it('should redact password fields', async () => {
      const logger = new Logger({
        level: 'debug',
        logDir: testLogDir,
        enabled: true,
      });

      await logger.initialize();
      logger.debug('Test', { password: 'mysecretpassword' });

      await new Promise(resolve => setTimeout(resolve, 100));
      await logger.close();

      const logFile = logger.getLogFile();
      if (logFile) {
        const content = readFileSync(logFile, 'utf-8');
        expect(content).not.toContain('mysecretpassword');
        expect(content).toContain('[REDACTED]');
      }
    });

    it('should redact nested sensitive data', async () => {
      const logger = new Logger({
        level: 'debug',
        logDir: testLogDir,
        enabled: true,
      });

      await logger.initialize();
      logger.debug('Test', {
        config: {
          apiKey: 'secret123',
          user: {
            token: 'usertoken456',
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      await logger.close();

      const logFile = logger.getLogFile();
      if (logFile) {
        const content = readFileSync(logFile, 'utf-8');
        expect(content).not.toContain('secret123');
        expect(content).not.toContain('usertoken456');
      }
    });

    it('should sanitize arrays', async () => {
      const logger = new Logger({
        level: 'debug',
        logDir: testLogDir,
        enabled: true,
      });

      await logger.initialize();
      logger.debug('Test', {
        items: [
          { name: 'item1', secret: 'secret1' },
          { name: 'item2', secret: 'secret2' },
        ],
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      await logger.close();

      const logFile = logger.getLogFile();
      if (logFile) {
        const content = readFileSync(logFile, 'utf-8');
        expect(content).toContain('item1');
        expect(content).toContain('item2');
        expect(content).toContain('[REDACTED]');
      }
    });
  });

  describe('Child Logger', () => {
    it('should create child logger with prefix', () => {
      const logger = new Logger({ level: 'info', enabled: false });
      const child = logger.child('module');

      expect(child).toBeDefined();
    });

    it('should have all log methods', () => {
      const logger = new Logger({ level: 'info', enabled: false });
      const child = logger.child('test');

      expect(() => child.debug('debug')).not.toThrow();
      expect(() => child.info('info')).not.toThrow();
      expect(() => child.warn('warn')).not.toThrow();
      expect(() => child.error('error')).not.toThrow();
      expect(() => child.log('info', 'log')).not.toThrow();
    });

    it('should create nested child loggers', () => {
      const logger = new Logger({ level: 'info', enabled: false });
      const child = logger.child('parent');
      const grandchild = child.child('child');

      expect(grandchild).toBeDefined();
    });
  });

  describe('File Operations', () => {
    it('should initialize and create log file', async () => {
      const logger = new Logger({
        level: 'info',
        logDir: testLogDir,
        enabled: true,
      });

      await logger.initialize();

      const logFile = logger.getLogFile();
      expect(logFile).not.toBeNull();
      expect(logFile).toContain(testLogDir);

      await logger.close();
    });

    it('should write to log file', async () => {
      const logger = new Logger({
        level: 'debug',
        logDir: testLogDir,
        enabled: true,
      });

      await logger.initialize();
      logger.info('Test message');
      logger.debug('Debug message', { key: 'value' });

      // Wait for writes
      await new Promise(resolve => setTimeout(resolve, 100));
      await logger.close();

      const logFile = logger.getLogFile();
      if (logFile && existsSync(logFile)) {
        const content = readFileSync(logFile, 'utf-8');
        expect(content).toContain('Test message');
        expect(content).toContain('Debug message');
      }
    });

    it('should close logger properly', async () => {
      const logger = new Logger({
        level: 'info',
        logDir: testLogDir,
        enabled: true,
      });

      await logger.initialize();
      await logger.close();

      // Should not throw
      expect(() => logger.info('After close')).not.toThrow();
    });
  });

  describe('Disabled Logger', () => {
    it('should not write when disabled', async () => {
      const logger = new Logger({
        level: 'debug',
        logDir: testLogDir,
        enabled: false,
      });

      logger.debug('Should not write');
      logger.info('Should not write');

      const logFile = logger.getLogFile();
      expect(logFile).toBeNull();
    });

    it('should not initialize when disabled', async () => {
      const logger = new Logger({
        level: 'info',
        logDir: testLogDir,
        enabled: false,
      });

      await logger.initialize();

      expect(logger.getLogFile()).toBeNull();
    });
  });

  describe('Global Logger Functions', () => {
    it('should create global logger', () => {
      const logger = createLogger({ level: 'info', enabled: false });
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should get global logger', () => {
      const created = createLogger({ level: 'info', enabled: false });
      const retrieved = getLogger();
      expect(retrieved).toBe(created);
    });

    it('should create default logger if not initialized', () => {
      // This gets the existing global or creates a disabled one
      const logger = getLogger();
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should init logger with options', async () => {
      const logger = await initLogger({
        level: 'debug',
        dataDir: testLogDir,
      });

      expect(logger).toBeInstanceOf(Logger);
      expect(logger.getLogFile()).not.toBeNull();

      await logger.close();
    });
  });

  describe('Log Level Filtering', () => {
    it('should filter messages below configured level', async () => {
      const logger = new Logger({
        level: 'warn', // Only warn and error
        logDir: testLogDir,
        enabled: true,
      });

      await logger.initialize();
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      await new Promise(resolve => setTimeout(resolve, 100));
      await logger.close();

      const logFile = logger.getLogFile();
      if (logFile && existsSync(logFile)) {
        const content = readFileSync(logFile, 'utf-8');
        expect(content).not.toContain('Debug message');
        expect(content).not.toContain('Info message');
        expect(content).toContain('Warn message');
        expect(content).toContain('Error message');
      }
    });
  });
});
