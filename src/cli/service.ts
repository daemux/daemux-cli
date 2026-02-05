/**
 * Daemon Management Commands
 * Install, start, stop, and manage the agent as a system service
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { spawnSync, spawn } from 'child_process';
import {
  createSpinner,
  printError,
  printWarning,
  printInfo,
  bold,
  dim,
  success,
  error,
  warning,
} from './utils';
import { getServiceManager } from '../infra/service';
import type { ServiceConfig, ServiceStatus, ServiceInfo } from '../infra/service';

// ---------------------------------------------------------------------------
// Constants and Helpers
// ---------------------------------------------------------------------------

const SERVICE_NAME = 'daemux';
const SERVICE_DESCRIPTION = 'Universal Autonomous Agent Platform';

const getLogDir = () => join(homedir(), '.daemux', 'logs');

function getExecutablePath(): string {
  // Find installed binary path (not process.execPath which may be bun in dev mode)
  const whichResult = spawnSync('which', ['daemux'], { encoding: 'utf8' });
  if (whichResult.status === 0 && whichResult.stdout.trim()) {
    return whichResult.stdout.trim();
  }

  // Fallback: check common global bin location
  const globalBin = join(process.execPath, '..', 'daemux');
  if (existsSync(globalBin)) {
    return globalBin;
  }

  // Last resort: current executable
  return process.execPath;
}

function getServiceArgs(): string[] {
  return ['run'];
}

function formatStatus(status: ServiceStatus): string {
  const map: Record<ServiceStatus, string> = {
    running: success('running'),
    stopped: dim('stopped'),
    failed: error('failed'),
    unknown: warning('unknown'),
    'not-installed': dim('not-installed'),
  };
  return map[status] ?? warning('unknown');
}

function formatUptime(seconds?: number): string {
  if (seconds === undefined) return dim('N/A');
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

// ---------------------------------------------------------------------------
// Install Command
// ---------------------------------------------------------------------------

async function installService(options: { force?: boolean }): Promise<void> {
  const manager = getServiceManager();
  const isInstalled = await manager.isInstalled(SERVICE_NAME);

  if (isInstalled && !options.force) {
    printWarning('Service is already installed. Use --force to reinstall.');
    return;
  }

  const spinner = createSpinner('Installing service');
  spinner.start();

  try {
    const logDir = getLogDir();
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

    const config: ServiceConfig = {
      name: SERVICE_NAME,
      description: SERVICE_DESCRIPTION,
      execPath: getExecutablePath(),
      args: getServiceArgs(),
      workingDirectory: homedir(),
      env: { HOME: homedir(), PATH: process.env.PATH ?? '' },
      logPath: join(logDir, 'service.log'),
      errorLogPath: join(logDir, 'service.error.log'),
      restartOnFailure: true,
      restartDelaySeconds: 5,
    };

    if (isInstalled) await manager.uninstall(SERVICE_NAME);
    await manager.install(config);

    spinner.succeed('Service installed successfully');
    printInfo(`Platform: ${manager.getPlatform()}`);
    printInfo(`Log directory: ${logDir}`);
    console.log(dim('\nTo start the service, run: daemux service start'));
  } catch (err) {
    spinner.fail('Failed to install service');
    printError(err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Uninstall Command
// ---------------------------------------------------------------------------

async function uninstallService(): Promise<void> {
  const manager = getServiceManager();
  const isInstalled = await manager.isInstalled(SERVICE_NAME);

  if (!isInstalled) {
    printWarning('Service is not installed');
    return;
  }

  const spinner = createSpinner('Uninstalling service');
  spinner.start();

  try {
    const info = await manager.status(SERVICE_NAME);
    if (info.status === 'running') {
      spinner.update('Stopping service');
      await manager.stop(SERVICE_NAME);
    }
    await manager.uninstall(SERVICE_NAME);
    spinner.succeed('Service uninstalled successfully');
  } catch (err) {
    spinner.fail('Failed to uninstall service');
    printError(err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Start/Stop/Restart Commands
// ---------------------------------------------------------------------------

async function startService(): Promise<void> {
  const manager = getServiceManager();

  if (!(await manager.isInstalled(SERVICE_NAME))) {
    printError('Service is not installed. Run "daemux service install" first.');
    process.exit(1);
  }

  const info = await manager.status(SERVICE_NAME);
  if (info.status === 'running') {
    printWarning('Service is already running');
    return;
  }

  const spinner = createSpinner('Starting service');
  spinner.start();

  try {
    await manager.start(SERVICE_NAME);
    await new Promise((r) => setTimeout(r, 1000));
    const newInfo = await manager.status(SERVICE_NAME);

    if (newInfo.status === 'running') {
      spinner.succeed('Service started successfully');
      if (newInfo.pid) printInfo(`PID: ${newInfo.pid}`);
    } else {
      spinner.warn('Service may have started but status is unclear');
    }
  } catch (err) {
    spinner.fail('Failed to start service');
    printError(err);
    process.exit(1);
  }
}

async function stopService(): Promise<void> {
  const manager = getServiceManager();

  if (!(await manager.isInstalled(SERVICE_NAME))) {
    printWarning('Service is not installed');
    return;
  }

  const info = await manager.status(SERVICE_NAME);
  if (info.status === 'stopped') {
    printWarning('Service is not running');
    return;
  }

  const spinner = createSpinner('Stopping service');
  spinner.start();

  try {
    await manager.stop(SERVICE_NAME);
    await new Promise((r) => setTimeout(r, 1000));
    const newInfo = await manager.status(SERVICE_NAME);

    if (newInfo.status === 'stopped') {
      spinner.succeed('Service stopped successfully');
    } else {
      spinner.warn('Service may still be running');
    }
  } catch (err) {
    spinner.fail('Failed to stop service');
    printError(err);
    process.exit(1);
  }
}

async function restartService(): Promise<void> {
  const manager = getServiceManager();

  if (!(await manager.isInstalled(SERVICE_NAME))) {
    printError('Service is not installed. Run "daemux service install" first.');
    process.exit(1);
  }

  const spinner = createSpinner('Restarting service');
  spinner.start();

  try {
    await manager.restart(SERVICE_NAME);
    await new Promise((r) => setTimeout(r, 1500));
    const newInfo = await manager.status(SERVICE_NAME);

    if (newInfo.status === 'running') {
      spinner.succeed('Service restarted successfully');
      if (newInfo.pid) printInfo(`PID: ${newInfo.pid}`);
    } else {
      spinner.warn('Service may not have restarted properly');
    }
  } catch (err) {
    spinner.fail('Failed to restart service');
    printError(err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Status Command
// ---------------------------------------------------------------------------

function displayServiceInfo(info: ServiceInfo, platform: string): void {
  console.log(bold('\nService Status\n'));
  console.log(`Name:      ${SERVICE_NAME}`);
  console.log(`Status:    ${formatStatus(info.status)}`);
  console.log(`Platform:  ${platform}`);

  if (info.pid !== undefined) console.log(`PID:       ${info.pid}`);
  if (info.uptime !== undefined) console.log(`Uptime:    ${formatUptime(info.uptime)}`);
  if (info.memory !== undefined) console.log(`Memory:    ${(info.memory / 1024 / 1024).toFixed(1)} MB`);
  if (info.cpu !== undefined) console.log(`CPU:       ${info.cpu.toFixed(1)}%`);
  if (info.lastError) console.log(`Last Error: ${error(info.lastError)}`);

  const logDir = getLogDir();
  console.log();
  console.log(bold('Logs:'));
  console.log(`  Output: ${dim(join(logDir, 'service.log'))}`);
  console.log(`  Errors: ${dim(join(logDir, 'service.error.log'))}\n`);
}

async function showStatus(options: { json?: boolean }): Promise<void> {
  const manager = getServiceManager();
  const isInstalled = await manager.isInstalled(SERVICE_NAME);

  if (!isInstalled) {
    if (options.json) {
      console.log(JSON.stringify({ installed: false }));
    } else {
      console.log(bold('\nService Status\n'));
      console.log(`Installed: ${dim('no')}`);
      console.log(dim('\nRun "daemux service install" to install the service.'));
    }
    return;
  }

  try {
    const info = await manager.status(SERVICE_NAME);

    if (options.json) {
      console.log(JSON.stringify({ installed: true, ...info }));
    } else {
      displayServiceInfo(info, manager.getPlatform());
    }
  } catch (err) {
    if (options.json) {
      console.log(JSON.stringify({ installed: true, error: String(err) }));
    } else {
      printError(err);
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Logs Command
// ---------------------------------------------------------------------------

async function showLogs(options: { lines?: number; follow?: boolean; errors?: boolean }): Promise<void> {
  const logFile = join(getLogDir(), options.errors ? 'service.error.log' : 'service.log');

  if (!existsSync(logFile)) {
    printWarning(`Log file not found: ${logFile}`);
    return;
  }

  const lines = String(options.lines ?? 50);

  if (options.follow) {
    const child = spawn('tail', ['-f', '-n', lines, logFile], { stdio: 'inherit' });
    process.on('SIGINT', () => {
      child.kill();
      process.exit(0);
    });
  } else {
    const result = spawnSync('tail', ['-n', lines, logFile], { stdio: 'inherit' });
    if (result.status !== 0) {
      printError('Failed to read logs');
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerServiceCommands(program: Command): void {
  const service = program.command('service').description('Manage daemux as a system service');

  service.command('install').description('Install daemux as a system service')
    .option('-f, --force', 'Force reinstall if already installed').action(installService);

  service.command('uninstall').description('Remove the daemux system service').action(uninstallService);
  service.command('start').description('Start the daemux service').action(startService);
  service.command('stop').description('Stop the daemux service').action(stopService);
  service.command('restart').description('Restart the daemux service').action(restartService);

  service.command('status').description('Show service status')
    .option('--json', 'Output as JSON').action(showStatus);

  service.command('logs').description('View service logs')
    .option('-n, --lines <number>', 'Number of lines to show', '50')
    .option('-f, --follow', 'Follow log output')
    .option('-e, --errors', 'Show error log instead of main log').action(showLogs);
}
