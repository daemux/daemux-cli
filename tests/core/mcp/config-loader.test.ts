/**
 * MCP Config Loader Tests
 * Covers loadFromSettings, loadFromProjectMcpJson, and loadMCPConfigs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  loadFromSettings,
  loadFromProjectMcpJson,
  loadMCPConfigs,
} from '../../../src/core/mcp/config-loader';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mcp-config-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadFromSettings
// ---------------------------------------------------------------------------

describe('loadFromSettings', () => {
  it('should load mcpServers from settings.json', async () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({
      mcpServers: {
        'my-server': { command: 'node', args: ['server.js'] },
      },
    }));

    const result = loadFromSettings(settingsPath);
    expect(result).toEqual({
      'my-server': { command: 'node', args: ['server.js'] },
    });
  });

  it('should return empty object when file does not exist', () => {
    const result = loadFromSettings(path.join(tempDir, 'nonexistent.json'));
    expect(result).toEqual({});
  });

  it('should return empty object for malformed JSON', async () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    await writeFile(settingsPath, '{not valid json');

    const result = loadFromSettings(settingsPath);
    expect(result).toEqual({});
  });

  it('should return empty object when mcpServers key is missing', async () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({ channels: {} }));

    const result = loadFromSettings(settingsPath);
    expect(result).toEqual({});
  });

  it('should return empty object when mcpServers is null', async () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({ mcpServers: null }));

    const result = loadFromSettings(settingsPath);
    expect(result).toEqual({});
  });

  it('should skip non-object values in mcpServers', async () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({
      mcpServers: {
        'valid': { command: 'node' },
        'invalid-string': 'not-an-object',
        'invalid-number': 42,
        'invalid-null': null,
      },
    }));

    const result = loadFromSettings(settingsPath);
    expect(result).toEqual({ 'valid': { command: 'node' } });
  });

  it('should load multiple servers', async () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({
      mcpServers: {
        'server-a': { command: 'node', args: ['a.js'] },
        'server-b': { url: 'http://localhost:3000', type: 'http' },
      },
    }));

    const result = loadFromSettings(settingsPath);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['server-a']!.command).toBe('node');
    expect(result['server-b']!.url).toBe('http://localhost:3000');
  });
});

// ---------------------------------------------------------------------------
// loadFromProjectMcpJson
// ---------------------------------------------------------------------------

describe('loadFromProjectMcpJson', () => {
  it('should load Claude Code format (mcpServers key)', async () => {
    await writeFile(path.join(tempDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'claude-server': { command: 'npx', args: ['server'] },
      },
    }));

    const result = loadFromProjectMcpJson(tempDir);
    expect(result).toEqual({
      'claude-server': { command: 'npx', args: ['server'] },
    });
  });

  it('should load plugin format (servers key)', async () => {
    await writeFile(path.join(tempDir, '.mcp.json'), JSON.stringify({
      servers: {
        'plugin-server': { command: 'bun', args: ['run', 'server.ts'] },
      },
    }));

    const result = loadFromProjectMcpJson(tempDir);
    expect(result).toEqual({
      'plugin-server': { command: 'bun', args: ['run', 'server.ts'] },
    });
  });

  it('should load direct format (values with command/url/type)', async () => {
    await writeFile(path.join(tempDir, '.mcp.json'), JSON.stringify({
      'direct-server': { command: 'python', args: ['-m', 'server'] },
      'http-server': { url: 'http://localhost:8080', type: 'http' },
    }));

    const result = loadFromProjectMcpJson(tempDir);
    expect(result).toEqual({
      'direct-server': { command: 'python', args: ['-m', 'server'] },
      'http-server': { url: 'http://localhost:8080', type: 'http' },
    });
  });

  it('should prefer mcpServers over servers key', async () => {
    await writeFile(path.join(tempDir, '.mcp.json'), JSON.stringify({
      mcpServers: { 'from-mcp': { command: 'node' } },
      servers: { 'from-servers': { command: 'bun' } },
    }));

    const result = loadFromProjectMcpJson(tempDir);
    expect(result).toEqual({ 'from-mcp': { command: 'node' } });
  });

  it('should return empty object when file does not exist', () => {
    const result = loadFromProjectMcpJson(path.join(tempDir, 'nonexistent'));
    expect(result).toEqual({});
  });

  it('should return empty object for malformed JSON', async () => {
    await writeFile(path.join(tempDir, '.mcp.json'), 'not json at all');

    const result = loadFromProjectMcpJson(tempDir);
    expect(result).toEqual({});
  });

  it('should return empty object for empty JSON object', async () => {
    await writeFile(path.join(tempDir, '.mcp.json'), '{}');

    const result = loadFromProjectMcpJson(tempDir);
    expect(result).toEqual({});
  });

  it('should skip non-config-like entries in direct format', async () => {
    await writeFile(path.join(tempDir, '.mcp.json'), JSON.stringify({
      'valid-server': { command: 'node', args: ['index.js'] },
      'metadata': { version: '1.0', name: 'test' },
    }));

    const result = loadFromProjectMcpJson(tempDir);
    expect(result).toEqual({
      'valid-server': { command: 'node', args: ['index.js'] },
    });
  });
});

// ---------------------------------------------------------------------------
// loadMCPConfigs (merge)
// ---------------------------------------------------------------------------

describe('loadMCPConfigs', () => {
  it('should merge user settings and project configs', async () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    const projectDir = path.join(tempDir, 'project');
    await mkdir(projectDir, { recursive: true });

    await writeFile(settingsPath, JSON.stringify({
      mcpServers: {
        'user-server': { command: 'node', args: ['user.js'] },
      },
    }));
    await writeFile(path.join(projectDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'project-server': { command: 'bun', args: ['project.ts'] },
      },
    }));

    const result = loadMCPConfigs(settingsPath, projectDir);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['user-server']!.command).toBe('node');
    expect(result['project-server']!.command).toBe('bun');
  });

  it('should let project configs override user settings on conflict', async () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    const projectDir = path.join(tempDir, 'project');
    await mkdir(projectDir, { recursive: true });

    await writeFile(settingsPath, JSON.stringify({
      mcpServers: {
        'shared-name': { command: 'node', args: ['user-version.js'] },
      },
    }));
    await writeFile(path.join(projectDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'shared-name': { command: 'bun', args: ['project-version.ts'] },
      },
    }));

    const result = loadMCPConfigs(settingsPath, projectDir);
    expect(result['shared-name']!.command).toBe('bun');
    expect(result['shared-name']!.args).toEqual(['project-version.ts']);
  });

  it('should return empty when both sources are missing', () => {
    const result = loadMCPConfigs(
      path.join(tempDir, 'no-settings.json'),
      path.join(tempDir, 'no-project'),
    );
    expect(result).toEqual({});
  });

  it('should return only user configs when project file is missing', async () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({
      mcpServers: { 'only-user': { command: 'node' } },
    }));

    const result = loadMCPConfigs(settingsPath, path.join(tempDir, 'no-project'));
    expect(result).toEqual({ 'only-user': { command: 'node' } });
  });

  it('should return only project configs when settings file is missing', async () => {
    const projectDir = path.join(tempDir, 'project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, '.mcp.json'), JSON.stringify({
      servers: { 'only-project': { url: 'http://localhost:9000' } },
    }));

    const result = loadMCPConfigs(path.join(tempDir, 'no-settings.json'), projectDir);
    expect(result).toEqual({ 'only-project': { url: 'http://localhost:9000' } });
  });

  it('should handle malformed JSON in both files gracefully', async () => {
    const settingsPath = path.join(tempDir, 'settings.json');
    const projectDir = path.join(tempDir, 'project');
    await mkdir(projectDir, { recursive: true });

    await writeFile(settingsPath, 'broken{json');
    await writeFile(path.join(projectDir, '.mcp.json'), '%%%not-json%%%');

    const result = loadMCPConfigs(settingsPath, projectDir);
    expect(result).toEqual({});
  });
});
