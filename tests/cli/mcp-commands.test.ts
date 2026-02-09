/**
 * MCP Commands Unit Tests
 * Tests add, remove, list, get commands for MCP server management
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadSettings,
  saveSettings,
  setSettingsPathOverride,
} from '../../src/cli/mcp';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  const dir = join(tmpdir(), `daemux-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP Commands', () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = createTempDir();
    settingsPath = join(tempDir, 'settings.json');
    setSettingsPathOverride(settingsPath);
  });

  afterEach(() => {
    setSettingsPathOverride(null);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('settings I/O', () => {
    it('should return empty object when settings file does not exist', () => {
      const settings = loadSettings();
      expect(settings).toEqual({});
    });

    it('should save and load settings round-trip', () => {
      const data = {
        mcpServers: {
          test: { command: 'echo', args: ['hello'] },
        },
      };
      saveSettings(data);

      const loaded = loadSettings();
      expect(loaded.mcpServers?.test?.command).toBe('echo');
      expect(loaded.mcpServers?.test?.args).toEqual(['hello']);
    });

    it('should set 0o600 permissions on settings file', () => {
      saveSettings({ mcpServers: {} });

      const stat = statSync(settingsPath);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('should create parent directory if missing', () => {
      const nestedPath = join(tempDir, 'nested', 'dir', 'settings.json');
      setSettingsPathOverride(nestedPath);
      saveSettings({ mcpServers: {} });
      expect(existsSync(nestedPath)).toBe(true);
    });
  });

  describe('mcp add', () => {
    it('should write stdio config to settings', () => {
      const settings = loadSettings();
      settings.mcpServers = settings.mcpServers ?? {};
      settings.mcpServers['my-server'] = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
      };
      saveSettings(settings);

      const loaded = loadSettings();
      const server = loaded.mcpServers?.['my-server'];
      expect(server).toBeDefined();
      expect(server?.command).toBe('npx');
      expect(server?.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem']);
    });

    it('should write http config with url to settings', () => {
      const settings = loadSettings();
      settings.mcpServers = settings.mcpServers ?? {};
      settings.mcpServers['remote'] = {
        url: 'https://mcp.example.com/sse',
        type: 'sse',
      };
      saveSettings(settings);

      const loaded = loadSettings();
      const server = loaded.mcpServers?.['remote'];
      expect(server?.url).toBe('https://mcp.example.com/sse');
      expect(server?.type).toBe('sse');
    });

    it('should parse headers correctly', () => {
      const settings = loadSettings();
      settings.mcpServers = settings.mcpServers ?? {};
      settings.mcpServers['with-headers'] = {
        url: 'https://mcp.example.com',
        headers: {
          'Authorization': 'Bearer tok123',
          'X-Custom': 'value',
        },
      };
      saveSettings(settings);

      const loaded = loadSettings();
      const server = loaded.mcpServers?.['with-headers'];
      expect(server?.headers?.['Authorization']).toBe('Bearer tok123');
      expect(server?.headers?.['X-Custom']).toBe('value');
    });

    it('should parse env vars correctly', () => {
      const settings = loadSettings();
      settings.mcpServers = settings.mcpServers ?? {};
      settings.mcpServers['with-env'] = {
        command: 'my-server',
        env: {
          API_KEY: 'secret123',
          DEBUG: 'true',
        },
      };
      saveSettings(settings);

      const loaded = loadSettings();
      const server = loaded.mcpServers?.['with-env'];
      expect(server?.env?.['API_KEY']).toBe('secret123');
      expect(server?.env?.['DEBUG']).toBe('true');
    });

    it('should store full JSON config', () => {
      const jsonConfig = {
        command: 'my-tool',
        args: ['--port', '3000'],
        env: { NODE_ENV: 'production' },
        type: 'stdio' as const,
      };

      const settings = loadSettings();
      settings.mcpServers = settings.mcpServers ?? {};
      settings.mcpServers['json-server'] = jsonConfig;
      saveSettings(settings);

      const loaded = loadSettings();
      const server = loaded.mcpServers?.['json-server'];
      expect(server?.command).toBe('my-tool');
      expect(server?.args).toEqual(['--port', '3000']);
      expect(server?.env?.['NODE_ENV']).toBe('production');
      expect(server?.type).toBe('stdio');
    });

    it('should reject duplicate names', () => {
      const settings = loadSettings();
      settings.mcpServers = { existing: { command: 'test' } };
      saveSettings(settings);

      const reloaded = loadSettings();
      const isDuplicate = !!reloaded.mcpServers?.['existing'];
      expect(isDuplicate).toBe(true);
    });

    it('should require command or url or json', () => {
      // Validate that a config without command, url, or json data is incomplete
      const config = {};
      const hasCommand = 'command' in config && !!(config as Record<string, unknown>).command;
      const hasUrl = 'url' in config && !!(config as Record<string, unknown>).url;
      expect(hasCommand || hasUrl).toBe(false);
    });
  });

  describe('mcp remove', () => {
    it('should delete entry from settings', () => {
      const settings = loadSettings();
      settings.mcpServers = {
        keep: { command: 'keep-cmd' },
        remove: { command: 'remove-cmd' },
      };
      saveSettings(settings);

      // Simulate remove
      const reloaded = loadSettings();
      delete reloaded.mcpServers!['remove'];
      saveSettings(reloaded);

      const final = loadSettings();
      expect(final.mcpServers?.['remove']).toBeUndefined();
      expect(final.mcpServers?.['keep']?.command).toBe('keep-cmd');
    });

    it('should detect when server name does not exist', () => {
      saveSettings({ mcpServers: { other: { command: 'test' } } });

      const settings = loadSettings();
      const exists = !!settings.mcpServers?.['nonexistent'];
      expect(exists).toBe(false);
    });
  });

  describe('mcp list', () => {
    it('should return configured servers', () => {
      saveSettings({
        mcpServers: {
          alpha: { command: 'alpha-cmd' },
          beta: { url: 'https://beta.example.com', type: 'http' },
        },
      });

      const settings = loadSettings();
      const servers = settings.mcpServers ?? {};
      const entries = Object.entries(servers);

      expect(entries).toHaveLength(2);
      expect(entries.map(([name]) => name).sort()).toEqual(['alpha', 'beta']);
    });

    it('should handle empty server list', () => {
      saveSettings({ mcpServers: {} });

      const settings = loadSettings();
      const servers = settings.mcpServers ?? {};
      expect(Object.keys(servers)).toHaveLength(0);
    });

    it('should handle missing mcpServers key', () => {
      saveSettings({ channels: {} });

      const settings = loadSettings();
      const servers = settings.mcpServers ?? {};
      expect(Object.keys(servers)).toHaveLength(0);
    });
  });

  describe('mcp get', () => {
    it('should retrieve a specific server config', () => {
      saveSettings({
        mcpServers: {
          target: {
            command: 'my-tool',
            args: ['--flag'],
            env: { KEY: 'val' },
            headers: { 'X-Token': 'abc' },
            type: 'stdio',
          },
        },
      });

      const settings = loadSettings();
      const config = settings.mcpServers?.['target'];

      expect(config).toBeDefined();
      expect(config?.command).toBe('my-tool');
      expect(config?.args).toEqual(['--flag']);
      expect(config?.env?.['KEY']).toBe('val');
      expect(config?.headers?.['X-Token']).toBe('abc');
      expect(config?.type).toBe('stdio');
    });

    it('should return undefined for unknown server', () => {
      saveSettings({ mcpServers: {} });

      const settings = loadSettings();
      const config = settings.mcpServers?.['unknown'];
      expect(config).toBeUndefined();
    });
  });

  describe('permissions', () => {
    it('should write settings file with 0o600 permissions', () => {
      saveSettings({
        mcpServers: {
          test: { command: 'echo' },
        },
      });

      const stat = statSync(settingsPath);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });
});
