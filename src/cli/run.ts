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
  color,
} from './utils';
import { loadConfig } from '../core/config';
import { Database } from '../infra/database';
import { createEventBus } from '../core/event-bus';
import { AgenticLoop, createAgenticLoop } from '../core/loop';
import { initLogger } from '../infra/logger';
import { createStreamHandler, printStats } from './run-output';
import { initializeChannels } from './run-channels';
import { loadAnthropicProvider } from './provider-loader';

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
// Interactive Mode
// ---------------------------------------------------------------------------

function createReadlineInterface(): ReturnType<typeof createInterface> {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${color('>', 'cyan')} `,
  });
}

async function processInteractiveInput(
  input: string,
  loop: AgenticLoop,
  ctx: { sessionId?: string; running: boolean; streamHandler: ReturnType<typeof createStreamHandler> },
  rl: ReturnType<typeof createInterface>,
): Promise<void> {
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

  ctx.running = true;
  console.log();

  try {
    const result = await loop.run(trimmed, { sessionId: ctx.sessionId, onStream: ctx.streamHandler });
    ctx.sessionId = result.sessionId;
    printStats(result.tokensUsed.input, result.tokensUsed.output, result.toolCalls.length, result.durationMs);
  } catch (err) {
    printError(err);
  }

  ctx.running = false;
  console.log();
  rl.prompt();
}

async function runInteractive(loop: AgenticLoop, sessionId?: string): Promise<void> {
  console.log(bold('\nAgent Interactive Session'));
  console.log(dim('Type your message and press Enter. Type "exit" or press Ctrl+C to quit.\n'));

  const rl = createReadlineInterface();
  const ctx = { sessionId, running: false, streamHandler: createStreamHandler() };

  rl.on('SIGINT', () => {
    if (ctx.running) {
      loop.interrupt();
      console.log(dim('\nInterrupted. Waiting for current turn to finish...'));
    } else {
      console.log(dim('\nGoodbye!'));
      rl.close();
      process.exit(0);
    }
  });

  rl.on('line', (input: string) => processInteractiveInput(input, loop, ctx, rl));
  rl.prompt();
}

async function handleCommand(cmd: string, loop: AgenticLoop): Promise<void> {
  const [command] = cmd.slice(1).split(' ');

  switch (command) {
    case 'help':
      console.log(bold('\nAvailable Commands:'));
      console.log('  /help     - Show this help message');
      console.log('  /session  - Show current session ID');
      console.log('  /clear    - Clear screen');
      console.log('  /exit     - Exit the session');
      console.log();
      return;

    case 'session': {
      const session = loop.getSession();
      printInfo(session ? `Current session: ${session}` : 'No active session');
      return;
    }

    case 'clear':
      console.clear();
      return;

    case 'exit':
    case 'quit':
      console.log(dim('Goodbye!'));
      process.exit(0);

    default:
      printWarning(`Unknown command: ${command}. Type /help for available commands.`);
  }
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

  const logger = await initLogger({ level: config.debug ? 'debug' : 'info', dataDir: config.dataDir });
  const { dbPath } = setupDataDir(config.dataDir);

  const db = new Database({ path: dbPath, enableVec: true });
  await db.initialize();

  const credentials = resolveCredentials();
  if (!credentials) {
    printError('Failed to resolve API credentials');
    process.exit(1);
  }

  if (credentials.source === 'claude-keychain') {
    const isServiceMode = !process.stdin.isTTY && !options.message;
    if (isServiceMode) {
      printWarning(
        'Using Claude Code keychain token. These tokens are restricted to Claude Code ' +
        'and will NOT work for API calls. Add "anthropicApiKey" to ~/.daemux/settings.json ' +
        'or run: daemux auth api-key --provider anthropic',
      );
    }
  }

  const provider = await loadAnthropicProvider();
  await provider.initialize({ type: credentials.type, value: credentials.value });

  const eventBus = createEventBus();
  const loop = createAgenticLoop({ db, eventBus, config, provider });

  // Initialize channels (Telegram, etc.) with dialog mode dependencies
  const { router, channelIds } = await initializeChannels(eventBus, loop, logger, { db, provider, config });

  let cleanedUp = false;
  async function cleanup(): Promise<void> {
    if (cleanedUp) return;
    cleanedUp = true;
    if (router) await router.stop();
    db.close();
  }

  onShutdown(async () => {
    const forceTimer = setTimeout(() => process.exit(1), 5000);
    try {
      if (loop.isRunning()) loop.interrupt();
      await cleanup();
    } finally {
      clearTimeout(forceTimer);
    }
  });

  if (options.message) {
    // Single message mode
    await runSingleMessage(loop, options.message, options.session, !options.quiet);
    await cleanup();
  } else if (process.stdin.isTTY) {
    // Interactive terminal mode (channels also active in background)
    await runInteractive(loop, options.session);
  } else if (router && channelIds.length > 0) {
    // Service mode: no terminal, channels are the only input
    logger.info('Running in service mode with channels', { channels: channelIds.join(', ') });
    // Process stays alive via TelegramPoller's setInterval.
    // Shutdown handled by SIGTERM/SIGINT via onShutdown().
  } else {
    // No terminal and no channels - nothing to do
    printError('No input source available. Configure channels or run interactively.');
    db.close();
    process.exit(1);
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
