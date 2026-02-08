/**
 * Update Commands
 * Check, apply, enable/disable auto-updates for daemux
 */

import { Command } from 'commander';
import {
  createSpinner,
  printError,
  printInfo,
  bold,
  dim,
  success,
  warning,
  info,
  error as errorColor,
} from './utils';
import { Updater } from '../updater';
import type { UpdateState } from '../updater';

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ms: number): string {
  if (ms === 0) return dim('never');
  return new Date(ms).toLocaleString();
}

function formatCheckResult(result: UpdateState['lastCheckResult']): string {
  switch (result) {
    case 'up-to-date': return success('up-to-date');
    case 'update-available': return warning('update available');
    case 'error': return errorColor('error');
    default: return dim('unknown');
  }
}

function formatInterval(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Check-Only Action
// ---------------------------------------------------------------------------

async function checkForUpdates(): Promise<void> {
  const spinner = createSpinner('Checking for updates');
  spinner.start();

  const updater = new Updater();
  const result = await updater.check();

  switch (result.status) {
    case 'up-to-date':
      spinner.succeed(`Already up to date (v${result.currentVersion})`);
      break;

    case 'update-available':
      spinner.succeed('Update available');
      console.log(`  Current:   ${dim(result.currentVersion)}`);
      console.log(`  Available: ${bold(result.availableVersion ?? 'unknown')}`);
      console.log(`\nRun ${info('daemux update')} to apply.`);
      break;

    case 'error':
      spinner.fail('Update check failed');
      printError(result.error ?? 'Unknown error');
      break;
  }
}

// ---------------------------------------------------------------------------
// Status Action
// ---------------------------------------------------------------------------

function showUpdateStatus(): void {
  const updater = new Updater();
  const state = updater.getState();

  console.log(bold('\nUpdate Status\n'));
  console.log(`  Version:        ${state.currentVersion}`);
  console.log(`  Auto-update:    ${state.disabled ? warning('disabled') : success('enabled')}`);
  console.log(`  Last check:     ${formatTimestamp(state.lastCheckTime)}`);
  console.log(`  Check result:   ${formatCheckResult(state.lastCheckResult)}`);
  console.log(`  Check interval: ${formatInterval(state.checkIntervalMs)}`);

  if (state.availableVersion) {
    console.log(`  Available:      ${bold(state.availableVersion)}`);
  }

  if (state.pendingUpdate) {
    const verifiedLabel = state.pendingUpdate.verified
      ? success('verified')
      : warning('unverified');
    console.log(`  Pending:        v${state.pendingUpdate.version} (${verifiedLabel})`);
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Enable / Disable Actions
// ---------------------------------------------------------------------------

function setAutoUpdate(enabled: boolean): void {
  const updater = new Updater();
  updater.setState({ disabled: !enabled });
  const label = enabled ? 'enabled' : 'disabled';
  console.log(`${success('✓')} Auto-updates ${label}.`);
  if (!enabled) {
    printInfo('Set DISABLE_AUTOUPDATER=1 in your environment for permanent effect.');
  }
}

// ---------------------------------------------------------------------------
// Check-and-Apply Action (default)
// ---------------------------------------------------------------------------

async function checkAndApply(force = false): Promise<void> {
  const spinner = createSpinner('Checking for updates');
  spinner.start();

  const updater = new Updater();
  const result = await updater.check();

  if (result.status === 'error') {
    spinner.fail('Update check failed');
    printError(result.error ?? 'Unknown error');
    process.exit(1);
  }

  if (result.status === 'up-to-date') {
    spinner.succeed(`Already up to date (v${result.currentVersion})`);
    return;
  }

  spinner.succeed(`Update available: v${result.availableVersion}`);

  const downloadSpinner = createSpinner(
    `Downloading v${result.availableVersion}`
  );
  downloadSpinner.start();

  try {
    if (!result.availableVersion) {
      downloadSpinner.fail('No version information available');
      process.exit(1);
    }
    await updater.download(result.availableVersion);
    downloadSpinner.succeed(`Downloaded v${result.availableVersion}`);
  } catch (err) {
    downloadSpinner.fail('Download failed');
    printError(err);
    process.exit(1);
  }

  const applySpinner = createSpinner('Applying update');
  applySpinner.start();

  const applied = await updater.apply({ force });
  if (applied) {
    applySpinner.succeed(
      `Updated to v${result.availableVersion}. Please restart daemux.`
    );
  } else {
    applySpinner.fail('Failed to apply update');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerUpdateCommands(program: Command): void {
  program
    .command('update')
    .description('Check for updates and apply if available')
    .option('-c, --check', 'Check for updates without applying')
    .option('-s, --status', 'Show current update state')
    .option('-f, --force', 'Force update (delete locked versions)')
    .option('--disable', 'Disable auto-updates')
    .option('--enable', 'Enable auto-updates')
    .action(handleUpdateCommand);
}

// ---------------------------------------------------------------------------
// Command Options & Router
// ---------------------------------------------------------------------------

interface UpdateCommandOptions {
  check?: boolean;
  status?: boolean;
  force?: boolean;
  disable?: boolean;
  enable?: boolean;
}

async function handleUpdateCommand(options: UpdateCommandOptions): Promise<void> {
  if (options.status) {
    showUpdateStatus();
    return;
  }

  if (options.disable) {
    setAutoUpdate(false);
    return;
  }

  if (options.enable) {
    setAutoUpdate(true);
    return;
  }

  if (options.check) {
    await checkForUpdates();
    return;
  }

  await checkAndApply(options.force);
}
