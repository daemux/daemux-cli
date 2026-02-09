#!/usr/bin/env bun
/**
 * Daemux CLI - Main Entry Point
 * Universal Autonomous Agent Platform
 */

import { Command } from 'commander';
import { join } from 'path';
import { homedir } from 'os';
import { registerAuthCommands } from './auth';
import { registerRunCommands, runCommand } from './run';
import { registerPluginCommands } from './plugins';
import { registerServiceCommands } from './service';
import { registerUpdateCommands } from './update';
import { registerUninstallCommand } from './uninstall';
import { registerApprovalCommands } from './approvals';
import { registerChannelCommands } from './channels';
import { registerWorkCommands } from './work';
import { registerMCPCommands } from './mcp';
import { setConfig, getConfig } from '../core/config';
import { initLogger } from '../infra/logger';
import { version as packageVersion } from '../../package.json';
import { Updater, loadStateSync, defaultState, acquireLock, releaseLock, setLogger } from '@daemux/updater';
import { getLogger } from '../infra/logger';
import { onShutdown } from './utils';

// ---------------------------------------------------------------------------
// Version Handling
// ---------------------------------------------------------------------------

function getVersion(): string {
  return packageVersion ?? '1.0.0';
}

// ---------------------------------------------------------------------------
// Global Options Handler
// ---------------------------------------------------------------------------

interface GlobalOptions {
  debug?: boolean;
  mcpDebug?: boolean;
}

function applyGlobalOptions(options: GlobalOptions): void {
  if (!options.debug && !options.mcpDebug) return;

  const config = getConfig();
  setConfig({
    debug: options.debug || config.debug,
    mcpDebug: options.mcpDebug || config.mcpDebug,
  });

  initLogger({
    level: 'debug',
    dataDir: config.dataDir,
  });
}

// ---------------------------------------------------------------------------
// Main Program
// ---------------------------------------------------------------------------

function createProgram(): Command {
  const program = new Command();

  program
    .name('daemux')
    .description('Universal Autonomous Agent Platform')
    .version(getVersion())
    .option('--debug', 'Enable debug logging')
    .option('--mcp-debug', 'Enable MCP protocol debug logging')
    .hook('preAction', (thisCommand) => {
      const options = thisCommand.opts() as GlobalOptions;
      applyGlobalOptions(options);
    });

  // Register all command groups
  registerAuthCommands(program);
  registerRunCommands(program);
  registerPluginCommands(program);
  registerServiceCommands(program);
  registerUpdateCommands(program);
  registerUninstallCommand(program);
  registerApprovalCommands(program);
  registerChannelCommands(program);
  registerWorkCommands(program);
  registerMCPCommands(program);

  return program;
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

const FRIENDLY_ERRORS: [test: (msg: string) => boolean, label: string][] = [
  [(m) => m.includes('ENOENT'), 'File or directory not found'],
  [(m) => m.includes('EACCES'), 'Permission denied'],
  [(m) => m.includes('ECONNREFUSED'), 'Connection refused'],
  [(m) => m.includes('authentication') || m.includes('401'), 'Authentication failed. Check your credentials.'],
  [(m) => m.includes('rate limit') || m.includes('429'), 'Rate limit exceeded. Please wait and try again.'],
];

function handleError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const friendly = FRIENDLY_ERRORS.find(([test]) => test(message));
  console.error(`Error: ${friendly ? friendly[1] : message}`);

  // In debug mode, show full stack trace
  if (process.env.DEBUG || process.argv.includes('--debug')) {
    if (err instanceof Error && err.stack) {
      console.error('\nStack trace:');
      console.error(err.stack);
    }
  }

  process.exit(1);
}

// ---------------------------------------------------------------------------
// Unhandled Rejection Handler
// ---------------------------------------------------------------------------

process.on('unhandledRejection', (reason) => {
  handleError(reason);
});

process.on('uncaughtException', (err) => {
  handleError(err);
});

// ---------------------------------------------------------------------------
// Background Update Check
// ---------------------------------------------------------------------------

function checkForUpdatesInBackground(): void {
  try {
    setLogger(getLogger());
    const state = defaultState(packageVersion);
    if (state.disabled) return;

    const stateDir = join(homedir(), '.local', 'share', 'daemux');
    const statePath = join(stateDir, 'update-state.json');
    const persisted = loadStateSync(statePath, packageVersion);

    // Show notification if a pending update exists
    if (persisted.pendingUpdate?.verified && persisted.availableVersion) {
      const ver = persisted.availableVersion;
      console.error(`\x1b[33mUpdate available: v${ver}\x1b[0m  Run \x1b[36mdaemux update\x1b[0m to apply.\n`);
    }

    // Only spawn a background check if enough time has elapsed
    const elapsed = Date.now() - persisted.lastCheckTime;
    if (elapsed < persisted.checkIntervalMs) return;

    Updater.checkInBackground();
  } catch {
    // Never block CLI startup for update checks
  }
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const program = createProgram();

  // Start agent session if no command specified (make "daemux" equivalent to "daemux run")
  const args = process.argv.slice(2);
  const hasCommand = args.length > 0 && args[0] && !args[0].startsWith('-');
  const isHelpOrVersion = args.includes('--help') || args.includes('-h') ||
                          args.includes('--version') || args.includes('-V');

  // Run background update check before parsing commands
  checkForUpdatesInBackground();

  // Acquire PID lock so cleanupOldVersions() won't delete our binary
  try {
    await acquireLock(packageVersion);
    onShutdown(() => { releaseLock(); });
    process.on('exit', () => { releaseLock(); });
  } catch {
    // Never block CLI startup for lock acquisition
  }

  if (!hasCommand && !isHelpOrVersion) {
    // Manually parse and apply global options since preAction hook won't fire
    const globalOptions = {
      debug: args.includes('--debug'),
      mcpDebug: args.includes('--mcp-debug'),
    };

    applyGlobalOptions(globalOptions);
    await runCommand(globalOptions);
    return;
  }

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    handleError(err);
  }
}

main();
