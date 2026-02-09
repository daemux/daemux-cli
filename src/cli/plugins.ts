/**
 * Plugin and Provider Management Commands
 * List, install, uninstall, and inspect plugins
 * List and configure LLM providers
 */

import { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, cpSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { execSync, spawnSync } from 'child_process';
import { createSpinner, printError, printInfo, printTable, bold, dim, success, warning } from './utils';
import { createProviderManager, hasProviderManager, getProviderManager } from '../core/provider-manager';
import { createPluginLoader } from '../core/plugin-loader';

// ---------------------------------------------------------------------------
// Types and Constants
// ---------------------------------------------------------------------------

const PLUGIN_MANIFEST = '.claude-plugin/plugin.json';

interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  agents?: string | string[];
  commands?: string | string[];
  mcp?: string;
}

interface InstalledPlugin {
  name: string;
  version: string;
  description?: string;
  location: 'user' | 'project';
  path: string;
  hasAgents: boolean;
  hasCommands: boolean;
  hasMcp: boolean;
}

type SpinnerInterface = { succeed: (m: string) => void; fail: (m: string) => void; update: (m: string) => void };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getUserPluginsDir = () => join(homedir(), '.daemux', 'plugins');
const getProjectPluginsDir = () => join(process.cwd(), '.daemux', 'plugins');

const loadPluginManifest = (pluginPath: string): PluginManifest | null => {
  const manifestPath = join(pluginPath, PLUGIN_MANIFEST);
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest;
  } catch {
    return null;
  }
};

const checkPathExists = (basePath: string, pathOrPaths: string | string[] | undefined, defaultPath: string): boolean => {
  if (!pathOrPaths) return existsSync(join(basePath, defaultPath));

  const paths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths];
  return paths.some(p => existsSync(join(basePath, p))) || existsSync(join(basePath, defaultPath));
};

function discoverPluginsInDir(dir: string, location: 'user' | 'project', seen: Set<string>): InstalledPlugin[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const path = join(dir, entry.name);
      return { path, manifest: loadPluginManifest(path) };
    })
    .filter(({ manifest }) => manifest && !seen.has(manifest.name))
    .map(({ path, manifest }) => {
      seen.add(manifest!.name);
      return {
        name: manifest!.name,
        version: manifest!.version,
        description: manifest!.description,
        location,
        path,
        hasAgents: checkPathExists(path, manifest!.agents, 'agents'),
        hasCommands: checkPathExists(path, manifest!.commands, 'commands'),
        hasMcp: existsSync(join(path, manifest!.mcp ?? '.mcp.json')),
      };
    });
}

const discoverPlugins = (): InstalledPlugin[] => {
  const seen = new Set<string>();
  const userPlugins = discoverPluginsInDir(getUserPluginsDir(), 'user', seen);
  const projectPlugins = discoverPluginsInDir(getProjectPluginsDir(), 'project', seen);
  return [...userPlugins, ...projectPlugins].sort((a, b) => a.name.localeCompare(b.name));
};

/** Strip npm scope prefix (e.g. "@daemux/foo" -> "foo") for filesystem paths. */
const stripScope = (name: string) => name.replace(/^@[^/]+\//, '');

const isLocalPath = (path: string) =>
  path.startsWith('/') || path.startsWith('./') || path.startsWith('../') || existsSync(path);

const listMdFiles = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.replace('.md', '')) : [];

const getFeatureList = (
  pluginPath: string,
  pathOrPaths: string | string[] | undefined,
  defaultPath: string
): string => {
  if (Array.isArray(pathOrPaths)) {
    return pathOrPaths.map(p => p.replace(/^.*\//, '').replace('.md', '')).join(', ') || dim('none');
  }
  const featureDir = join(pluginPath, pathOrPaths ?? defaultPath);
  return listMdFiles(featureDir).join(', ') || dim('none');
};

// ---------------------------------------------------------------------------
// List Command
// ---------------------------------------------------------------------------

async function listPlugins(options: { json?: boolean }): Promise<void> {
  const plugins = discoverPlugins();

  if (plugins.length === 0) {
    console.log(dim('\nNo plugins installed.\n'));
    console.log('To install a plugin, run:');
    console.log(dim('  daemux plugins install <name-or-path>'));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(plugins, null, 2));
    return;
  }

  console.log(bold('\nInstalled Plugins\n'));
  printTable(
    [
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Version', key: 'version', width: 12 },
      { header: 'Location', key: 'location', width: 10 },
      { header: 'Features', key: 'features', width: 20 },
    ],
    plugins.map(p => ({
      name: p.name,
      version: p.version,
      location: p.location,
      features: [p.hasAgents && 'agents', p.hasCommands && 'commands', p.hasMcp && 'mcp']
        .filter(Boolean)
        .join(', ') || dim('none'),
    }))
  );
  console.log();
}

// ---------------------------------------------------------------------------
// Install Command
// ---------------------------------------------------------------------------

async function installFromLocal(sourcePath: string, targetDir: string, spinner: SpinnerInterface): Promise<void> {
  const absPath = resolve(sourcePath);
  if (!existsSync(absPath)) throw new Error(`Path not found: ${absPath}`);

  const manifest = loadPluginManifest(absPath);
  if (!manifest) throw new Error(`Not a valid plugin: missing ${PLUGIN_MANIFEST}`);

  const destPath = join(targetDir, stripScope(manifest.name));
  if (existsSync(destPath)) throw new Error(`Plugin ${manifest.name} is already installed`);

  spinner.update(`Copying ${manifest.name}`);
  cpSync(absPath, destPath, { recursive: true });
  spinner.succeed(`Installed ${manifest.name}@${manifest.version}`);
  printInfo(`Location: ${destPath}`);
}

async function installFromNpm(packageName: string, targetDir: string, spinner: SpinnerInterface): Promise<void> {
  spinner.update(`Fetching ${packageName} from npm`);
  const tempDir = join(targetDir, '.temp-install');
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

  try {
    if (!existsSync(join(tempDir, 'package.json'))) {
      execSync('bun init -y', { cwd: tempDir, stdio: 'pipe' });
    }

    const result = spawnSync('bun', ['add', packageName], { cwd: tempDir, stdio: 'pipe' });
    if (result.status !== 0) throw new Error(`npm install failed: ${result.stderr?.toString() || 'Unknown error'}`);

    const nodeModulesPath = join(tempDir, 'node_modules', packageName);
    const manifest = loadPluginManifest(nodeModulesPath);
    if (!manifest) throw new Error(`Package ${packageName} is not a valid daemux plugin`);

    const destPath = join(targetDir, stripScope(manifest.name));
    if (existsSync(destPath)) throw new Error(`Plugin ${manifest.name} is already installed`);

    cpSync(nodeModulesPath, destPath, { recursive: true });
    spinner.succeed(`Installed ${manifest.name}@${manifest.version}`);
    printInfo(`Location: ${destPath}`);
  } finally {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  }
}

async function installPlugin(nameOrPath: string, options: { global?: boolean }): Promise<void> {
  const targetDir = options.global ? getUserPluginsDir() : getProjectPluginsDir();
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  const spinner = createSpinner(`Installing ${nameOrPath}`);
  spinner.start();

  try {
    if (isLocalPath(nameOrPath)) {
      await installFromLocal(nameOrPath, targetDir, spinner);
    } else {
      await installFromNpm(nameOrPath, targetDir, spinner);
    }
  } catch (err) {
    spinner.fail(`Failed to install ${nameOrPath}`);
    printError(err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Uninstall Command
// ---------------------------------------------------------------------------

async function uninstallPlugin(name: string, options: { global?: boolean }): Promise<void> {
  const spinner = createSpinner(`Uninstalling ${name}`);
  spinner.start();

  const plugin = discoverPlugins().find(p => p.name === name);
  if (!plugin) {
    spinner.fail(`Plugin ${name} is not installed`);
    process.exit(1);
  }

  const expectedLocation = options.global ? 'user' : 'project';
  if (plugin.location !== expectedLocation) {
    spinner.fail(`Plugin ${name} is installed in ${plugin.location}, not ${expectedLocation}`);
    printInfo(options.global ? 'Remove --global flag' : 'Add --global flag');
    process.exit(1);
  }

  try {
    rmSync(plugin.path, { recursive: true, force: true });
    spinner.succeed(`Uninstalled ${name}`);
  } catch (err) {
    spinner.fail(`Failed to uninstall ${name}`);
    printError(err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Info Command
// ---------------------------------------------------------------------------

async function showPluginInfo(name: string): Promise<void> {
  const plugin = discoverPlugins().find(p => p.name === name);
  if (!plugin) {
    printError(`Plugin ${name} is not installed`);
    process.exit(1);
  }

  const manifest = loadPluginManifest(plugin.path);
  if (!manifest) {
    printError('Failed to load plugin manifest');
    process.exit(1);
  }

  console.log(bold(`\n${manifest.name}\n`));
  console.log(`Version:     ${manifest.version}`);
  console.log(`Description: ${manifest.description ?? dim('N/A')}`);
  console.log(`Author:      ${manifest.author ?? dim('N/A')}`);
  console.log(`Homepage:    ${manifest.homepage ?? dim('N/A')}`);
  console.log(`Location:    ${plugin.location}`);
  console.log(`Path:        ${plugin.path}\n`);

  console.log(bold('Features:'));

  const agents = plugin.hasAgents ? getFeatureList(plugin.path, manifest.agents, 'agents') : dim('none');
  console.log(`  ${plugin.hasAgents ? success('✓') : dim('-')} Agents: ${agents}`);

  const commands = plugin.hasCommands ? getFeatureList(plugin.path, manifest.commands, 'commands') : dim('none');
  console.log(`  ${plugin.hasCommands ? success('✓') : dim('-')} Commands: ${commands}`);

  console.log(`  ${plugin.hasMcp ? success('✓') : dim('-')} MCP Configuration\n`);
}

// ---------------------------------------------------------------------------
// Provider Commands
// ---------------------------------------------------------------------------

const SETTINGS_FILE_PATH = join(homedir(), '.daemux', 'settings.json');

interface SettingsFile {
  model?: string;
  defaultProvider?: string;
  [key: string]: unknown;
}

function loadSettings(): SettingsFile {
  if (!existsSync(SETTINGS_FILE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE_PATH, 'utf-8')) as SettingsFile;
  } catch {
    return {};
  }
}

function saveSettings(settings: SettingsFile): void {
  const dir = join(homedir(), '.daemux');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2));
}

async function initProvidersFromPlugins(): Promise<void> {
  const loader = createPluginLoader();
  const plugins = await loader.discoverAll();

  if (!hasProviderManager()) {
    createProviderManager();
  }

  // Load providers from plugin instances
  for (const plugin of plugins) {
    if (plugin.instance?.activate) {
      // Minimal stub API -- only registerProvider does real work
      const providerManager = getProviderManager();
      const notAvailable = () => { throw new Error('Not available in CLI context'); };
      const minimalApi = {
        registerProvider: (_id: string, provider: unknown) => {
          providerManager.registerProvider(provider as import('../core/plugin-api-types').LLMProvider);
        },
        registerChannel: () => {},
        registerMCP: () => {},
        registerAgent: () => {},
        registerMemory: () => {},
        registerTranscription: () => {},
        registerTool: () => {},
        getProvider: () => null,
        spawnSubagent: async () => notAvailable(),
        listAgents: () => [],
        getAgent: () => undefined,
        createTask: async () => notAvailable(),
        updateTask: async () => notAvailable(),
        listTasks: async () => [],
        getTask: async () => null,
        on: () => {},
        sendMessage: async () => notAvailable(),
        searchMemory: async () => [],
        getState: async () => undefined,
        setState: async () => {},
        log: () => {},
      };
      try {
        await plugin.instance.activate(minimalApi as unknown as import('../core/plugin-api-types').PluginAPI);
      } catch {
        // Ignore activation errors for provider listing
      }
    }
  }
}

async function listProviders(options: { json?: boolean }): Promise<void> {
  const spinner = createSpinner('Loading providers from plugins');
  spinner.start();

  try {
    await initProvidersFromPlugins();
    spinner.succeed('Loaded providers');
  } catch (err) {
    spinner.fail('Failed to load providers');
    printError(err);
    return;
  }

  const providerManager = getProviderManager();
  const providers = providerManager.listProviders();
  const settings = loadSettings();
  const defaultProviderId = settings.defaultProvider;

  if (providers.length === 0) {
    console.log(dim('\nNo LLM providers available.\n'));
    console.log('Install a provider plugin:');
    console.log(dim('  daemux plugins install @daemux/anthropic-provider'));
    return;
  }

  if (options.json) {
    const data = providers.map(p => ({
      id: p.id,
      name: p.name,
      isDefault: p.id === defaultProviderId,
      capabilities: p.capabilities,
      models: p.listModels(),
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(bold('\nAvailable LLM Providers\n'));
  printTable(
    [
      { header: 'ID', key: 'id', width: 15 },
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Default', key: 'isDefault', width: 10 },
      { header: 'Models', key: 'modelCount', width: 10 },
      { header: 'Capabilities', key: 'caps', width: 30 },
    ],
    providers.map(p => ({
      id: p.id,
      name: p.name,
      isDefault: p.id === defaultProviderId ? success('yes') : dim('no'),
      modelCount: p.listModels().length.toString(),
      caps: [
        p.capabilities.streaming && 'streaming',
        p.capabilities.toolUse && 'tools',
        p.capabilities.vision && 'vision',
      ].filter(Boolean).join(', ') || dim('none'),
    }))
  );
  console.log();

  if (!defaultProviderId) {
    console.log(warning('No default provider set. Run:'));
    console.log(dim(`  daemux providers set-default <provider-id>\n`));
  }
}

async function setDefaultProvider(providerId: string): Promise<void> {
  const spinner = createSpinner(`Setting default provider to ${providerId}`);
  spinner.start();

  try {
    await initProvidersFromPlugins();
  } catch (err) {
    spinner.fail('Failed to load providers');
    printError(err);
    process.exit(1);
  }

  const providerManager = getProviderManager();
  const provider = providerManager.getProvider(providerId);

  if (!provider) {
    spinner.fail(`Provider "${providerId}" not found`);
    console.log('\nAvailable providers:');
    for (const p of providerManager.listProviders()) {
      console.log(dim(`  - ${p.id}`));
    }
    process.exit(1);
  }

  const settings = loadSettings();
  settings.defaultProvider = providerId;
  saveSettings(settings);

  spinner.succeed(`Default provider set to "${providerId}"`);
  printInfo(`Settings saved to ${SETTINGS_FILE_PATH}`);
}

async function showProviderInfo(providerId: string): Promise<void> {
  const spinner = createSpinner('Loading provider');
  spinner.start();

  try {
    await initProvidersFromPlugins();
  } catch (err) {
    spinner.fail('Failed to load providers');
    printError(err);
    process.exit(1);
  }

  const providerManager = getProviderManager();
  const provider = providerManager.getProvider(providerId);

  if (!provider) {
    spinner.fail(`Provider "${providerId}" not found`);
    process.exit(1);
  }

  spinner.succeed('Loaded provider');

  const settings = loadSettings();
  const isDefault = settings.defaultProvider === providerId;

  console.log(bold(`\n${provider.name}\n`));
  console.log(`ID:            ${provider.id}`);
  console.log(`Default:       ${isDefault ? success('yes') : dim('no')}`);
  console.log(`Context:       ${provider.capabilities.maxContextWindow.toLocaleString()} tokens\n`);

  console.log(bold('Capabilities:'));
  console.log(`  ${provider.capabilities.streaming ? success('✓') : dim('-')} Streaming`);
  console.log(`  ${provider.capabilities.toolUse ? success('✓') : dim('-')} Tool Use`);
  console.log(`  ${provider.capabilities.vision ? success('✓') : dim('-')} Vision\n`);

  const models = provider.listModels();
  if (models.length > 0) {
    console.log(bold('Models:'));
    printTable(
      [
        { header: 'ID', key: 'id', width: 35 },
        { header: 'Name', key: 'name', width: 20 },
        { header: 'Context', key: 'context', width: 15 },
        { header: 'Max Output', key: 'maxOutput', width: 12 },
      ],
      models.map(m => ({
        id: m.id,
        name: m.name,
        context: m.contextWindow.toLocaleString(),
        maxOutput: m.maxOutputTokens.toLocaleString(),
      }))
    );
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerPluginCommands(program: Command): void {
  // Plugin commands
  const plugins = program.command('plugins').description('Manage plugins');

  plugins.command('list').description('List installed plugins')
    .option('--json', 'Output as JSON').action(listPlugins);

  plugins.command('install <name>').description('Install a plugin from npm or local path')
    .option('-g, --global', 'Install to user plugins directory').action(installPlugin);

  plugins.command('uninstall <name>').description('Remove an installed plugin')
    .option('-g, --global', 'Uninstall from user plugins directory').action(uninstallPlugin);

  plugins.command('info <name>').description('Show detailed plugin information').action(showPluginInfo);

  // Provider commands
  const providers = program.command('providers').description('Manage LLM providers');

  providers.command('list').description('List available LLM providers')
    .option('--json', 'Output as JSON').action(listProviders);

  providers.command('set-default <id>').description('Set the default LLM provider').action(setDefaultProvider);

  providers.command('info <id>').description('Show detailed provider information').action(showProviderInfo);
}
