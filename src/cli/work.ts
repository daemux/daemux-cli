/**
 * Work Command - Autonomous Work Loop CLI
 * Starts a persistent process that continuously polls for and executes tasks.
 */

import { Command } from 'commander';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { resolveCredentials, hasValidCredentials } from './auth';
import { printError, printInfo, printWarning, onShutdown, dim, bold, success } from './utils';
import { loadConfig } from '../core/config';
import { Database } from '../infra/database';
import { createEventBus } from '../core/event-bus';
import { TaskManager } from '../core/task-manager';
import { WorkLoop } from '../core/work-loop';
import { initLogger } from '../infra/logger';
import { loadAnthropicProvider } from './provider-loader';

// ---------------------------------------------------------------------------
// Data Directory Setup
// ---------------------------------------------------------------------------

function setupDataDir(dataDir: string): string {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  return join(dataDir, 'state.db');
}

// ---------------------------------------------------------------------------
// Work Command Options
// ---------------------------------------------------------------------------

interface WorkCommandOptions {
  pollInterval?: string;
  maxConcurrent?: string;
  budgetLimit?: string;
  once?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyPositiveInt(raw: string | undefined, setter: (value: number) => void): void {
  if (!raw) return;
  const parsed = parseInt(raw, 10);
  if (!Number.isNaN(parsed) && parsed > 0) setter(parsed);
}

// ---------------------------------------------------------------------------
// Work Command Implementation
// ---------------------------------------------------------------------------

async function workCommand(options: WorkCommandOptions): Promise<void> {
  if (!hasValidCredentials()) {
    printError('No API credentials configured.');
    console.log('\nTo configure authentication, run:');
    console.log(dim('  daemux auth setup-token --provider anthropic'));
    console.log(dim('  daemux auth api-key --provider anthropic'));
    process.exit(1);
  }

  const config = loadConfig();

  // Apply CLI flag overrides
  applyPositiveInt(options.pollInterval, v => { config.workPollingIntervalMs = v; });
  applyPositiveInt(options.maxConcurrent, v => { config.maxConcurrentTasks = v; });
  applyPositiveInt(options.budgetLimit, v => { config.workBudgetMaxTasksPerHour = v; });

  await initLogger({ level: config.debug ? 'debug' : 'info', dataDir: config.dataDir });
  const dbPath = setupDataDir(config.dataDir);

  const db = new Database({ path: dbPath, enableVec: true });
  await db.initialize();

  const credentials = resolveCredentials();
  if (!credentials) {
    printError('Failed to resolve API credentials');
    process.exit(1);
  }

  const provider = await loadAnthropicProvider();
  await provider.initialize({ type: credentials.type, value: credentials.value });

  const eventBus = createEventBus();
  const taskManager = new TaskManager({ db, eventBus });

  const workLoop = new WorkLoop({ db, eventBus, config, provider, taskManager });

  // Wire events to console output
  wireEventHandlers(eventBus);

  // Start the work loop
  workLoop.start();

  if (options.once) {
    await waitForOneTask(eventBus, workLoop, db);
    return;
  }

  // Setup graceful shutdown
  let cleanedUp = false;
  onShutdown(async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    const forceTimer = setTimeout(() => process.exit(1), 5000);
    try {
      await workLoop.stop('shutdown signal');
      db.close();
    } finally {
      clearTimeout(forceTimer);
    }
  });
}

// ---------------------------------------------------------------------------
// Event Wiring
// ---------------------------------------------------------------------------

function wireEventHandlers(eventBus: ReturnType<typeof createEventBus>): void {
  eventBus.on('work:started', ({ pollingIntervalMs, maxConcurrent }) => {
    console.log(bold('\nAutonomous Work Loop'));
    console.log(dim(`  Polling every ${pollingIntervalMs}ms | Max concurrent: ${maxConcurrent}`));
    console.log(dim('  Press Ctrl+C to stop.\n'));
  });

  eventBus.on('work:task-dispatched', ({ taskId, subject }) => {
    printInfo(`Dispatching task: ${subject} (${taskId.slice(0, 8)})`);
  });

  eventBus.on('work:task-completed', ({ subject, success: ok, durationMs }) => {
    const status = ok ? success('completed') : '\x1b[31mfailed\x1b[0m';
    console.log(`  Task ${status}: ${subject} (${(durationMs / 1000).toFixed(1)}s)`);
  });

  eventBus.on('work:budget-exhausted', ({ tasksThisHour, limit }) => {
    printWarning(`Budget limit reached: ${tasksThisHour}/${limit} tasks this hour`);
  });

  eventBus.on('work:stopped', ({ reason }) => {
    console.log(dim(`\nWork loop stopped${reason ? `: ${reason}` : ''}`));
  });
}

// ---------------------------------------------------------------------------
// --once Mode: Wait for one task, then exit
// ---------------------------------------------------------------------------

async function waitForOneTask(
  eventBus: ReturnType<typeof createEventBus>,
  workLoop: WorkLoop,
  db: Database,
): Promise<void> {
  return new Promise<void>(resolve => {
    eventBus.once('work:task-completed', () => {
      workLoop.stop('--once mode: task completed')
        .then(() => { db.close(); resolve(); })
        .catch(() => { db.close(); resolve(); });
    });

    // Also handle case where no tasks are ever found (timeout after 60s)
    setTimeout(() => {
      if (workLoop.getIsRunning()) {
        workLoop.stop('--once mode: timeout waiting for task')
          .then(() => { db.close(); resolve(); })
          .catch(() => { db.close(); resolve(); });
      }
    }, 60_000);
  });
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerWorkCommands(program: Command): void {
  program
    .command('work')
    .description('Start autonomous work loop that continuously processes tasks')
    .option('--poll-interval <ms>', 'Polling interval in milliseconds')
    .option('--max-concurrent <n>', 'Maximum concurrent tasks')
    .option('--budget-limit <n>', 'Maximum tasks per hour')
    .option('--once', 'Process one task and exit')
    .action(workCommand);
}
