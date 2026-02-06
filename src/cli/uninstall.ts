/**
 * Uninstall Command
 * Remove daemux from the system via the interactive uninstall script.
 */

import { join } from 'path';
import { homedir } from 'os';
import { Command } from 'commander';
import { printError, printInfo } from './utils';

const SCRIPT_CANDIDATES = [
  join(import.meta.dir, '..', '..', 'scripts', 'uninstall.sh'),
  join(homedir(), '.local', 'share', 'daemux', 'scripts', 'uninstall.sh'),
];

async function resolveUninstallScript(): Promise<string | null> {
  for (const path of SCRIPT_CANDIDATES) {
    if (await Bun.file(path).exists()) return path;
  }
  return null;
}

export function registerUninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .description('Remove daemux from your system')
    .action(handleUninstall);
}

async function handleUninstall(): Promise<void> {
  const scriptPath = await resolveUninstallScript();

  if (!scriptPath) {
    printError('Uninstall script not found.');
    printInfo('To uninstall manually, remove the following:');
    console.log(`  1. ~/.local/bin/daemux          (binary symlink)`);
    console.log(`  2. ~/.local/share/daemux/       (application data)`);
    console.log(`  3. ~/.daemux/                   (user data)`);
    process.exit(1);
  }

  const proc = Bun.spawn(['bash', scriptPath], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}
