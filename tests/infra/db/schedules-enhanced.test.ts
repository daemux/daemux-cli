/**
 * Schedules Repository Enhanced Tests
 * Tests edge cases for schedule operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { Database } from '../../../src/infra/database';

describe('Schedules Repository Enhanced', () => {
  let db: Database;
  const testDbPath = join(import.meta.dir, 'test-schedules-enhanced.sqlite');

  beforeEach(async () => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    db = new Database({ path: testDbPath, enableVec: false });
    await db.initialize();
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('create', () => {
    it('should create schedule with type "at"', () => {
      const schedule = db.schedules.create({
        type: 'at',
        expression: '2025-12-25 09:00',
        timezone: 'UTC',
        taskTemplate: { subject: 'Christmas task', description: 'Holiday task' },
        nextRunMs: Date.now() + 86400000,
        enabled: true,
      });

      expect(schedule.id).toBeDefined();
      expect(schedule.type).toBe('at');
    });

    it('should create schedule with type "every"', () => {
      const schedule = db.schedules.create({
        type: 'every',
        expression: '30m',
        timezone: 'UTC',
        taskTemplate: { subject: 'Periodic task', description: 'Runs every 30 minutes' },
        nextRunMs: Date.now() + 1800000,
        enabled: true,
      });

      expect(schedule.type).toBe('every');
      expect(schedule.expression).toBe('30m');
    });

    it('should create schedule with type "cron"', () => {
      const schedule = db.schedules.create({
        type: 'cron',
        expression: '0 9 * * MON',
        timezone: 'America/New_York',
        taskTemplate: { subject: 'Monday task', description: 'Weekly Monday task' },
        nextRunMs: Date.now() + 604800000,
        enabled: true,
      });

      expect(schedule.type).toBe('cron');
      expect(schedule.timezone).toBe('America/New_York');
    });

    it('should create disabled schedule', () => {
      const schedule = db.schedules.create({
        type: 'every',
        expression: '1h',
        taskTemplate: { subject: 'Disabled', description: 'Not running' },
        nextRunMs: Date.now(),
        enabled: false,
      });

      expect(schedule.enabled).toBe(false);
    });

    it('should assign unique IDs', () => {
      const schedule1 = db.schedules.create({
        type: 'at',
        expression: 'test1',
        taskTemplate: { subject: 'Test 1', description: 'D1' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      const schedule2 = db.schedules.create({
        type: 'at',
        expression: 'test2',
        taskTemplate: { subject: 'Test 2', description: 'D2' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      expect(schedule1.id).not.toBe(schedule2.id);
    });
  });

  describe('get', () => {
    it('should return schedule by id', () => {
      const created = db.schedules.create({
        type: 'every',
        expression: '1h',
        taskTemplate: { subject: 'Test', description: 'Test' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      const retrieved = db.schedules.get(created.id);
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return null for non-existent id', () => {
      const result = db.schedules.get('nonexistent-id');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update nextRunMs', () => {
      const schedule = db.schedules.create({
        type: 'at',
        expression: 'test',
        taskTemplate: { subject: 'Test', description: 'Test' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      const newNextRun = Date.now() + 3600000;
      const updated = db.schedules.update(schedule.id, { nextRunMs: newNextRun });

      expect(updated.nextRunMs).toBe(newNextRun);
    });

    it('should update lastRunMs', () => {
      const schedule = db.schedules.create({
        type: 'every',
        expression: '1h',
        taskTemplate: { subject: 'Test', description: 'Test' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      const lastRun = Date.now();
      const updated = db.schedules.update(schedule.id, { lastRunMs: lastRun });

      expect(updated.lastRunMs).toBe(lastRun);
    });

    it('should toggle enabled status', () => {
      const schedule = db.schedules.create({
        type: 'cron',
        expression: '0 * * * *',
        taskTemplate: { subject: 'Test', description: 'Test' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      const disabled = db.schedules.update(schedule.id, { enabled: false });
      expect(disabled.enabled).toBe(false);

      const enabled = db.schedules.update(schedule.id, { enabled: true });
      expect(enabled.enabled).toBe(true);
    });

    it('should update expression', () => {
      const schedule = db.schedules.create({
        type: 'cron',
        expression: '0 * * * *',
        taskTemplate: { subject: 'Test', description: 'Test' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      const updated = db.schedules.update(schedule.id, { expression: '*/30 * * * *' });
      expect(updated.expression).toBe('*/30 * * * *');
    });
  });

  describe('list', () => {
    it('should list all schedules', () => {
      db.schedules.create({
        type: 'at',
        expression: 'test1',
        taskTemplate: { subject: 'T1', description: 'D1' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      db.schedules.create({
        type: 'every',
        expression: 'test2',
        taskTemplate: { subject: 'T2', description: 'D2' },
        nextRunMs: Date.now(),
        enabled: false,
      });

      const all = db.schedules.list();
      expect(all.length).toBe(2);
    });

    it('should filter by enabled status', () => {
      db.schedules.create({
        type: 'at',
        expression: 'test1',
        taskTemplate: { subject: 'Enabled', description: 'D1' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      db.schedules.create({
        type: 'every',
        expression: 'test2',
        taskTemplate: { subject: 'Disabled', description: 'D2' },
        nextRunMs: Date.now(),
        enabled: false,
      });

      const enabledOnly = db.schedules.list({ enabled: true });
      expect(enabledOnly.length).toBe(1);
      expect(enabledOnly[0]?.taskTemplate.subject).toBe('Enabled');

      const disabledOnly = db.schedules.list({ enabled: false });
      expect(disabledOnly.length).toBe(1);
      expect(disabledOnly[0]?.taskTemplate.subject).toBe('Disabled');
    });

    it('should return empty array when no schedules', () => {
      const schedules = db.schedules.list();
      expect(schedules).toEqual([]);
    });
  });

  describe('getDue', () => {
    it('should return schedules that are due', () => {
      const pastSchedule = db.schedules.create({
        type: 'at',
        expression: 'past',
        taskTemplate: { subject: 'Due', description: 'D' },
        nextRunMs: Date.now() - 1000,
        enabled: true,
      });

      db.schedules.create({
        type: 'at',
        expression: 'future',
        taskTemplate: { subject: 'Not Due', description: 'D' },
        nextRunMs: Date.now() + 100000,
        enabled: true,
      });

      const due = db.schedules.getDue();
      expect(due.length).toBe(1);
      expect(due[0]?.id).toBe(pastSchedule.id);
    });

    it('should not return disabled schedules', () => {
      db.schedules.create({
        type: 'at',
        expression: 'past-disabled',
        taskTemplate: { subject: 'Due but disabled', description: 'D' },
        nextRunMs: Date.now() - 1000,
        enabled: false,
      });

      const due = db.schedules.getDue();
      expect(due.length).toBe(0);
    });

    it('should return empty when no due schedules', () => {
      db.schedules.create({
        type: 'at',
        expression: 'future',
        taskTemplate: { subject: 'Future', description: 'D' },
        nextRunMs: Date.now() + 100000,
        enabled: true,
      });

      const due = db.schedules.getDue();
      expect(due.length).toBe(0);
    });
  });

  describe('delete', () => {
    it('should delete existing schedule', () => {
      const schedule = db.schedules.create({
        type: 'at',
        expression: 'test',
        taskTemplate: { subject: 'Test', description: 'D' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      const deleted = db.schedules.delete(schedule.id);
      expect(deleted).toBe(true);

      const retrieved = db.schedules.get(schedule.id);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent schedule', () => {
      const deleted = db.schedules.delete('nonexistent-id');
      expect(deleted).toBe(false);
    });

    it('should not affect other schedules', () => {
      const schedule1 = db.schedules.create({
        type: 'at',
        expression: 'test1',
        taskTemplate: { subject: 'T1', description: 'D1' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      const schedule2 = db.schedules.create({
        type: 'at',
        expression: 'test2',
        taskTemplate: { subject: 'T2', description: 'D2' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      db.schedules.delete(schedule1.id);

      const remaining = db.schedules.list();
      expect(remaining.length).toBe(1);
      expect(remaining[0]?.id).toBe(schedule2.id);
    });
  });

  describe('Edge Cases', () => {
    it('should handle timezone with DST', () => {
      const schedule = db.schedules.create({
        type: 'cron',
        expression: '0 9 * * *',
        timezone: 'America/New_York',
        taskTemplate: { subject: 'DST aware', description: 'D' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      expect(schedule.timezone).toBe('America/New_York');
    });

    it('should handle complex task template', () => {
      const template = {
        subject: 'Complex task',
        description: 'A task with special chars: <>&"\'',
      };

      const schedule = db.schedules.create({
        type: 'every',
        expression: '1h',
        taskTemplate: template,
        nextRunMs: Date.now(),
        enabled: true,
      });

      const retrieved = db.schedules.get(schedule.id);
      expect(retrieved?.taskTemplate).toEqual(template);
    });

    it('should handle zero nextRunMs', () => {
      const schedule = db.schedules.create({
        type: 'at',
        expression: 'immediate',
        taskTemplate: { subject: 'Immediate', description: 'D' },
        nextRunMs: 0,
        enabled: true,
      });

      expect(schedule.nextRunMs).toBe(0);

      // Should be in getDue since 0 < Date.now()
      const due = db.schedules.getDue();
      expect(due.some(s => s.id === schedule.id)).toBe(true);
    });
  });
});
