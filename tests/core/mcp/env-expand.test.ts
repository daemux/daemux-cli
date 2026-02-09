/**
 * Environment Variable Expansion Tests
 * Covers expandEnvValue, expandEnvInRecord, and expandMCPConfig.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { expandEnvValue, expandEnvInRecord, expandMCPConfig } from '../../../src/core/mcp/env-expand';

describe('expandEnvValue', () => {
  const SAVED: Record<string, string | undefined> = {};

  beforeEach(() => {
    SAVED['TEST_VAR'] = process.env['TEST_VAR'];
    SAVED['OTHER_VAR'] = process.env['OTHER_VAR'];
    SAVED['EMPTY_VAR'] = process.env['EMPTY_VAR'];
    process.env['TEST_VAR'] = 'hello';
    process.env['OTHER_VAR'] = 'world';
    process.env['EMPTY_VAR'] = '';
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(SAVED)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it('should resolve ${VAR} to its env value', () => {
    expect(expandEnvValue('${TEST_VAR}')).toBe('hello');
  });

  it('should resolve missing variable to empty string', () => {
    expect(expandEnvValue('${NONEXISTENT_XYZ_123}')).toBe('');
  });

  it('should use default when variable is missing', () => {
    expect(expandEnvValue('${NONEXISTENT_XYZ_123:-fallback}')).toBe('fallback');
  });

  it('should use default when variable is empty', () => {
    expect(expandEnvValue('${EMPTY_VAR:-fallback}')).toBe('fallback');
  });

  it('should use actual value when present (ignoring default)', () => {
    expect(expandEnvValue('${TEST_VAR:-fallback}')).toBe('hello');
  });

  it('should expand multiple variables in one string', () => {
    expect(expandEnvValue('--key ${TEST_VAR} --name ${OTHER_VAR}'))
      .toBe('--key hello --name world');
  });

  it('should handle mixed present and missing variables', () => {
    expect(expandEnvValue('${TEST_VAR}-${NONEXISTENT_XYZ_123:-default}'))
      .toBe('hello-default');
  });

  it('should return plain strings unchanged', () => {
    expect(expandEnvValue('no variables here')).toBe('no variables here');
  });

  it('should return empty string unchanged', () => {
    expect(expandEnvValue('')).toBe('');
  });

  it('should allow empty default value', () => {
    expect(expandEnvValue('${NONEXISTENT_XYZ_123:-}')).toBe('');
  });
});

describe('expandEnvInRecord', () => {
  beforeEach(() => {
    process.env['REC_VAR'] = 'rec_value';
  });

  afterEach(() => {
    delete process.env['REC_VAR'];
  });

  it('should expand env vars in all record values', () => {
    const input = { key1: '${REC_VAR}', key2: 'static' };
    const result = expandEnvInRecord(input);
    expect(result).toEqual({ key1: 'rec_value', key2: 'static' });
  });

  it('should not mutate the original record', () => {
    const input = { key1: '${REC_VAR}' };
    const result = expandEnvInRecord(input);
    expect(input['key1']).toBe('${REC_VAR}');
    expect(result['key1']).toBe('rec_value');
  });

  it('should handle empty record', () => {
    expect(expandEnvInRecord({})).toEqual({});
  });
});

describe('expandMCPConfig', () => {
  const SAVED: Record<string, string | undefined> = {};

  beforeEach(() => {
    SAVED['MCP_CMD'] = process.env['MCP_CMD'];
    SAVED['MCP_TOKEN'] = process.env['MCP_TOKEN'];
    SAVED['MCP_HOST'] = process.env['MCP_HOST'];
    process.env['MCP_CMD'] = '/usr/bin/node';
    process.env['MCP_TOKEN'] = 'secret-token';
    process.env['MCP_HOST'] = 'example.com';
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(SAVED)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it('should expand command', () => {
    const result = expandMCPConfig({ command: '${MCP_CMD}' });
    expect(result.command).toBe('/usr/bin/node');
  });

  it('should expand each arg', () => {
    const result = expandMCPConfig({ args: ['--token', '${MCP_TOKEN}', '--verbose'] });
    expect(result.args).toEqual(['--token', 'secret-token', '--verbose']);
  });

  it('should expand url', () => {
    const result = expandMCPConfig({ url: 'https://${MCP_HOST}/api' });
    expect(result.url).toBe('https://example.com/api');
  });

  it('should expand env record values', () => {
    const result = expandMCPConfig({ env: { API_KEY: '${MCP_TOKEN}' } });
    expect(result.env).toEqual({ API_KEY: 'secret-token' });
  });

  it('should expand header values', () => {
    const result = expandMCPConfig({ headers: { Authorization: 'Bearer ${MCP_TOKEN}' } });
    expect(result.headers).toEqual({ Authorization: 'Bearer secret-token' });
  });

  it('should not mutate the original config', () => {
    const original = {
      command: '${MCP_CMD}',
      args: ['--token', '${MCP_TOKEN}'],
      url: 'https://${MCP_HOST}',
      env: { SECRET: '${MCP_TOKEN}' },
      headers: { Auth: '${MCP_TOKEN}' },
      type: 'stdio' as const,
    };
    const originalCopy = JSON.parse(JSON.stringify(original));
    expandMCPConfig(original);
    expect(original).toEqual(originalCopy);
  });

  it('should preserve type field unchanged', () => {
    const result = expandMCPConfig({ type: 'sse', command: '${MCP_CMD}' });
    expect(result.type).toBe('sse');
  });

  it('should handle config with no expandable fields', () => {
    const result = expandMCPConfig({ type: 'http' });
    expect(result).toEqual({ type: 'http' });
  });

  it('should handle config with undefined optional fields', () => {
    const result = expandMCPConfig({});
    expect(result).toEqual({});
  });

  it('should use defaults for missing env vars in config', () => {
    const result = expandMCPConfig({
      url: '${MISSING_MCP_URL:-http://localhost:8080}',
      headers: { 'X-Key': '${MISSING_KEY:-none}' },
    });
    expect(result.url).toBe('http://localhost:8080');
    expect(result.headers).toEqual({ 'X-Key': 'none' });
  });
});
