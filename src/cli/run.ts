/**
 * Agent Execution Commands
 * Start interactive session or run single message
 */

import { Command } from 'commander';
import { createInterface } from 'readline';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { resolveCredentials, hasValidCredentials } from './auth';
import {
  printError,
  printInfo,
  printWarning,
  onShutdown,
  bold,
  dim,
  error,
  color,
} from './utils';
import { loadConfig } from '../core/config';
import { Database } from '../infra/database';
import { createEventBus } from '../core/event-bus';
import { AgenticLoop, createAgenticLoop } from '../core/loop';
import type { StreamChunk } from '../core/loop/types';
import { initLogger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

interface DataDirSetup {
  dataDir: string;
  dbPath: string;
}

function setupDataDir(dataDir: string): DataDirSetup {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const sessionsDir = join(dataDir, 'sessions');
  if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });

  return {
    dataDir,
    dbPath: join(dataDir, 'state.db'),
  };
}

// ---------------------------------------------------------------------------
// Stream Output Handler
// ---------------------------------------------------------------------------

function createStreamHandler(): (chunk: StreamChunk) => void {
  let currentToolId: string | null = null;

  return (chunk: StreamChunk) => {
    switch (chunk.type) {
      case 'text':
        process.stdout.write(chunk.content);
        break;

      case 'tool_start':
        if (currentToolId) {
          process.stdout.write('\n');
        }
        process.stdout.write(dim(`\n[Calling ${chunk.name}...]\n`));
        currentToolId = chunk.toolUseId;
        break;

      case 'tool_result':
        if (chunk.isError) {
          process.stdout.write(error(`[Tool error: ${truncateResult(chunk.result)}]\n`));
        } else {
          process.stdout.write(dim(`[Result: ${truncateResult(chunk.result)}]\n`));
        }
        currentToolId = null;
        break;

      case 'thinking':
        process.stdout.write(dim(`\n[Thinking: ${chunk.content}]\n`));
        break;

      case 'done':
        process.stdout.write('\n');
        break;
    }
  };
}

function truncateResult(result: string, maxLen = 100): string {
  if (result.length <= maxLen) return result;
  return result.slice(0, maxLen) + '...';
}

// ---------------------------------------------------------------------------
// Interactive Mode
// ---------------------------------------------------------------------------

function printStats(tokensIn: number, tokensOut: number, toolCount: number, durationMs: number): void {
  const time = (durationMs / 1000).toFixed(1);
  console.log(dim(`\n[Tokens: ${tokensIn}/${tokensOut} | Tools: ${toolCount} | Time: ${time}s]`));
}

async function runInteractive(loop: AgenticLoop, sessionId?: string): Promise<void> {
  console.log(bold('\nAgent Interactive Session'));
  console.log(dim('Type your message and press Enter. Type "exit" or press Ctrl+C to quit.\n'));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${color('>', 'cyan')} `,
  });

  let running = false;
  const streamHandler = createStreamHandler();

  rl.on('SIGINT', () => {
    if (running) {
      loop.interrupt();
      console.log(dim('\nInterrupted. Waiting for current turn to finish...'));
    } else {
      console.log(dim('\nGoodbye!'));
      rl.close();
      process.exit(0);
    }
  });

  const processInput = async (input: string) => {
    const trimmed = input.trim();

    if (trimmed === 'exit' || trimmed === 'quit') {
      console.log(dim('Goodbye!'));
      rl.close();
      process.exit(0);
    }

    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('/')) {
      await handleCommand(trimmed, loop);
      rl.prompt();
      return;
    }

    running = true;
    console.log();

    try {
      const result = await loop.run(trimmed, { sessionId, onStream: streamHandler });
      sessionId = result.sessionId;
      printStats(result.tokensUsed.input, result.tokensUsed.output, result.toolCalls.length, result.durationMs);
    } catch (err) {
      printError(err);
    }

    running = false;
    console.log();
    rl.prompt();
  };

  rl.on('line', processInput);
  rl.prompt();
}

async function handleCommand(cmd: string, loop: AgenticLoop): Promise<void> {
  const [command] = cmd.slice(1).split(' ');

  if (command === 'help') {
    console.log(bold('\nAvailable Commands:'));
    console.log('  /help     - Show this help message');
    console.log('  /session  - Show current session ID');
    console.log('  /clear    - Clear screen');
    console.log('  /exit     - Exit the session');
    console.log();
    return;
  }

  if (command === 'session') {
    const session = loop.getSession();
    printInfo(session ? `Current session: ${session}` : 'No active session');
    return;
  }

  if (command === 'clear') {
    console.clear();
    return;
  }

  if (command === 'exit' || command === 'quit') {
    console.log(dim('Goodbye!'));
    process.exit(0);
  }

  printWarning(`Unknown command: ${command}. Type /help for available commands.`);
}

// ---------------------------------------------------------------------------
// Single Message Mode
// ---------------------------------------------------------------------------

async function runSingleMessage(
  loop: AgenticLoop,
  message: string,
  sessionId?: string,
  showStream = true
): Promise<void> {
  const streamHandler = showStream ? createStreamHandler() : undefined;

  try {
    const result = await loop.run(message, {
      sessionId,
      onStream: streamHandler,
    });

    if (!showStream) {
      console.log(result.response);
    }

    // Print stats to stderr so they don't interfere with piped output
    process.stderr.write(
      dim(
        `\n[Session: ${result.sessionId} | ` +
          `Tokens: ${result.tokensUsed.input}/${result.tokensUsed.output} | ` +
          `Time: ${(result.durationMs / 1000).toFixed(1)}s]\n`
      )
    );
  } catch (err) {
    printError(err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main Run Command
// ---------------------------------------------------------------------------

export interface RunOptions {
  message?: string;
  session?: string;
  debug?: boolean;
  mcpDebug?: boolean;
  quiet?: boolean;
}

export async function runCommand(options: RunOptions = {}): Promise<void> {
  if (!hasValidCredentials()) {
    printError('No API credentials configured.');
    console.log('\nTo configure authentication, run:');
    console.log(dim('  daemux auth setup-token --provider anthropic'));
    console.log(dim('  daemux auth api-key --provider anthropic'));
    process.exit(1);
  }

  const config = loadConfig();
  config.debug = options.debug || config.debug;
  config.mcpDebug = options.mcpDebug || config.mcpDebug;

  initLogger({ level: config.debug ? 'debug' : 'info', dataDir: config.dataDir });
  const { dbPath } = setupDataDir(config.dataDir);

  const db = new Database({ path: dbPath, enableVec: true });
  await db.initialize();

  const credentials = resolveCredentials();
  if (!credentials) {
    printError('Failed to resolve API credentials');
    process.exit(1);
  }

  const loop = createAgenticLoop({
    db,
    eventBus: createEventBus(),
    config,
    credentials,
  });

  onShutdown(async () => {
    if (loop.isRunning()) loop.interrupt();
    db.close();
  });

  if (options.message) {
    await runSingleMessage(loop, options.message, options.session, !options.quiet);
    db.close();
  } else {
    await runInteractive(loop, options.session);
  }
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerRunCommands(program: Command): void {
  program
    .command('run')
    .description('Start an agent session')
    .option('-m, --message <message>', 'Run a single message instead of interactive mode')
    .option('-s, --session <id>', 'Resume an existing session')
    .option('-q, --quiet', 'Suppress streaming output (print final response only)')
    .action(runCommand);
}
