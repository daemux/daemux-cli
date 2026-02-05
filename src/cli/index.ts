#!/usr/bin/env bun
/**
 * Daemux CLI - Main Entry Point
 * Universal Autonomous Agent Platform
 */

import { Command } from 'commander';
import { registerAuthCommands } from './auth';
import { registerRunCommands, runCommand } from './run';
import { registerPluginCommands } from './plugins';
import { registerServiceCommands } from './service';
import { setConfig, getConfig } from '../core/config';
import { initLogger } from '../infra/logger';
import { version as packageVersion } from '../../package.json';

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

  return program;
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

function handleError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);

  // Check for common errors and provide helpful messages
  if (message.includes('ENOENT')) {
    console.error('Error: File or directory not found');
  } else if (message.includes('EACCES')) {
    console.error('Error: Permission denied');
  } else if (message.includes('ECONNREFUSED')) {
    console.error('Error: Connection refused');
  } else if (message.includes('authentication') || message.includes('401')) {
    console.error('Error: Authentication failed. Check your credentials.');
  } else if (message.includes('rate limit') || message.includes('429')) {
    console.error('Error: Rate limit exceeded. Please wait and try again.');
  } else {
    console.error(`Error: ${message}`);
  }

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
// Entry Point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const program = createProgram();

  // Start agent session if no command specified (make "daemux" equivalent to "daemux run")
  const args = process.argv.slice(2);
  const hasCommand = args.length > 0 && args[0] && !args[0].startsWith('-');
  const isHelpOrVersion = args.includes('--help') || args.includes('-h') ||
                          args.includes('--version') || args.includes('-V');

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
