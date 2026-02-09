/**
 * CLI Commands for MCP Server Configuration
 * daemux mcp add <name>    - add an MCP server
 * daemux mcp remove <name> - remove an MCP server
 * daemux mcp list          - list configured servers
 * daemux mcp get <name>    - show server details
 */

import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { MCPConfig, MCPTransport } from '@daemux/mcp-client';
import {
  bold,
  dim,
  printError,
  printSuccess,
  printTable,
} from './utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettingsFile {
  mcpServers?: Record<string, MCPConfig>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Settings I/O
// ---------------------------------------------------------------------------

/** Visible for testing: override to use a temp directory. */
export let settingsPathOverride: string | null = null;

export function setSettingsPathOverride(path: string | null): void {
  settingsPathOverride = path;
}

function getSettingsPath(): string {
  return settingsPathOverride ?? join(homedir(), '.daemux', 'settings.json');
}

export function loadSettings(): SettingsFile {
  const path = getSettingsPath();
  if (!existsSync(path)) return {};
  try {
    chmodSync(path, 0o600);
    return JSON.parse(readFileSync(path, 'utf-8')) as SettingsFile;
  } catch {
    return {};
  }
}

export function saveSettings(settings: SettingsFile): void {
  const path = getSettingsPath();
  const dir = join(path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Option Parsers
// ---------------------------------------------------------------------------

function parseKeyValues(
  values: string[],
  separator: string,
  label: string,
  expectedFormat: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values) {
    const idx = value.indexOf(separator);
    if (idx === -1) {
      printError(`Invalid ${label} format: "${value}". Expected "${expectedFormat}".`);
      process.exit(1);
    }
    const key = value.slice(0, idx).trim();
    const val = separator === ':' ? value.slice(idx + 1).trim() : value.slice(idx + 1);
    if (!key) {
      printError(`Empty ${label} key in: "${value}".`);
      process.exit(1);
    }
    result[key] = val;
  }
  return result;
}

function parseHeaders(values: string[]): Record<string, string> {
  return parseKeyValues(values, ':', 'header', 'Key: Value');
}

function parseEnvVars(values: string[]): Record<string, string> {
  return parseKeyValues(values, '=', 'env var', 'KEY=VALUE');
}

function inferTransportType(config: MCPConfig): MCPTransport {
  if (config.type) return config.type;
  if (config.command) return 'stdio';
  if (config.url) return 'http';
  return 'stdio';
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

interface AddOptions {
  command?: string;
  args?: string;
  url?: string;
  type?: MCPTransport;
  header?: string[];
  env?: string[];
  json?: string;
}

function addServer(name: string, opts: AddOptions): void {
  const settings = loadSettings();
  settings.mcpServers = settings.mcpServers ?? {};

  if (settings.mcpServers[name]) {
    printError(`MCP server "${name}" already exists. Remove it first or use a different name.`);
    process.exit(1);
  }

  let config: MCPConfig;

  if (opts.json) {
    try {
      config = JSON.parse(opts.json) as MCPConfig;
    } catch {
      printError('Invalid JSON provided to --json option.');
      process.exit(1);
    }
  } else {
    if (!opts.command && !opts.url) {
      printError('At least --command or --url is required (or use --json for full config).');
      process.exit(1);
    }

    config = {};

    if (opts.command) config.command = opts.command;
    if (opts.args) config.args = opts.args.split(' ');
    if (opts.url) config.url = opts.url;
    if (opts.type) config.type = opts.type;
    if (opts.header && opts.header.length > 0) config.headers = parseHeaders(opts.header);
    if (opts.env && opts.env.length > 0) config.env = parseEnvVars(opts.env);
  }

  settings.mcpServers[name] = config;
  saveSettings(settings);
  printSuccess(`MCP server "${name}" added.`);
}

function removeServer(name: string): void {
  const settings = loadSettings();
  settings.mcpServers = settings.mcpServers ?? {};

  if (!settings.mcpServers[name]) {
    printError(`MCP server "${name}" not found.`);
    process.exit(1);
  }

  delete settings.mcpServers[name];
  saveSettings(settings);
  printSuccess(`MCP server "${name}" removed.`);
}

interface ListOptions {
  json?: boolean;
}

function listServers(opts: ListOptions): void {
  const settings = loadSettings();
  const servers = settings.mcpServers ?? {};
  const entries = Object.entries(servers);

  if (entries.length === 0) {
    if (opts.json) {
      console.log('{}');
    } else {
      console.log(dim('\nNo MCP servers configured.\n'));
      console.log('To add a server:');
      console.log(dim('  daemux mcp add <name> --command <cmd>\n'));
    }
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(servers, null, 2));
    return;
  }

  console.log(bold('\nMCP Servers\n'));
  const rows = entries.map(([name, config]) => ({
    name,
    type: inferTransportType(config),
    target: config.command ?? config.url ?? '-',
  }));

  printTable(
    [
      { header: 'Name', key: 'name' },
      { header: 'Type', key: 'type' },
      { header: 'Command/URL', key: 'target', width: 50 },
    ],
    rows,
  );
  console.log();
}

interface GetOptions {
  json?: boolean;
}

function getServer(name: string, opts: GetOptions): void {
  const settings = loadSettings();
  const servers = settings.mcpServers ?? {};
  const config = servers[name];

  if (!config) {
    printError(`MCP server "${name}" not found.`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  console.log(bold(`\nMCP Server: ${name}\n`));
  console.log(`  Type:     ${inferTransportType(config)}`);
  if (config.command) console.log(`  Command:  ${config.command}`);
  if (config.args && config.args.length > 0) console.log(`  Args:     ${config.args.join(' ')}`);
  if (config.url) console.log(`  URL:      ${config.url}`);

  if (config.headers && Object.keys(config.headers).length > 0) {
    console.log('  Headers:');
    for (const [key, val] of Object.entries(config.headers)) {
      console.log(`    ${key}: ${val}`);
    }
  }

  if (config.env && Object.keys(config.env).length > 0) {
    console.log('  Env:');
    for (const [key, val] of Object.entries(config.env)) {
      const masked = val.length > 8 ? `${val.slice(0, 4)}...${val.slice(-4)}` : '********';
      console.log(`    ${key}=${masked}`);
    }
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerMCPCommands(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('Manage MCP server configurations');

  mcp
    .command('add <name>')
    .description('Add an MCP server configuration')
    .option('-c, --command <cmd>', 'stdio command to run')
    .option('-a, --args <args>', 'command arguments (space-separated)')
    .option('-u, --url <url>', 'HTTP/SSE endpoint URL')
    .option('-t, --type <type>', 'transport type (stdio, http, sse, websocket)')
    .option('-H, --header <value...>', 'HTTP header (Key: Value), repeatable')
    .option('-e, --env <value...>', 'environment variable (KEY=VALUE), repeatable')
    .option('--json <config>', 'full config as JSON string')
    .action((name: string, opts: AddOptions) => addServer(name, opts));

  mcp
    .command('remove <name>')
    .description('Remove an MCP server configuration')
    .action((name: string) => removeServer(name));

  mcp
    .command('list')
    .description('List configured MCP servers')
    .option('--json', 'output as JSON')
    .action((opts: ListOptions) => listServers(opts));

  mcp
    .command('get <name>')
    .description('Show details of an MCP server')
    .option('--json', 'output as JSON')
    .action((name: string, opts: GetOptions) => getServer(name, opts));
}
