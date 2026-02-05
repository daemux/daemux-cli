/**
 * Welcome Screen Component
 * Claude Code style welcome display with two-column layout
 */

import { userInfo, homedir } from 'os';
import { bold, dim, color, BOX_CHARS, getTerminalWidth, centerText, padRight } from './utils';
import { getConfig } from '../core/config';
import { version as packageVersion } from '../../package.json';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_TERMINAL_WIDTH = 60;

const LOGO_LINES = [
  '      \u2590\u259B\u2588\u2588\u2588\u259C\u258C',
  '     \u259D\u259C\u2588\u2588\u2588\u2588\u2588\u259B\u2598',
  '       \u2598\u2598 \u259D\u259D',
];

// ---------------------------------------------------------------------------
// Model Name Formatter
// ---------------------------------------------------------------------------

function formatModelName(model: string): string {
  const lower = model.toLowerCase();

  if (lower.includes('opus-4') || lower.includes('opus4')) return 'Opus 4';
  if (lower.includes('sonnet-4') || lower.includes('sonnet4')) return 'Sonnet 4';
  if (lower.includes('3-5-sonnet') || lower.includes('3.5-sonnet')) return 'Sonnet 3.5';
  if (lower.includes('haiku')) return 'Haiku';
  if (lower.includes('sonnet')) return 'Sonnet';
  if (lower.includes('opus')) return 'Opus';

  return model.split('-').slice(0, 2).join(' ');
}

// ---------------------------------------------------------------------------
// Path Shortener
// ---------------------------------------------------------------------------

function shortenPath(fullPath: string): string {
  const home = homedir();
  return fullPath.startsWith(home) ? `~${fullPath.slice(home.length)}` : fullPath;
}

// ---------------------------------------------------------------------------
// Version Getter
// ---------------------------------------------------------------------------

function getVersion(): string {
  return packageVersion ?? '0.1.0';
}

// ---------------------------------------------------------------------------
// User Name Getter
// ---------------------------------------------------------------------------

function getUserName(): string {
  try {
    const name = userInfo().username;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return 'User';
  }
}

// ---------------------------------------------------------------------------
// Welcome Screen Renderer
// ---------------------------------------------------------------------------

interface WelcomeOptions {
  width?: number;
}

export function renderWelcome(options: WelcomeOptions = {}): string {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return renderSimpleWelcome();

  const termWidth = options.width ?? getTerminalWidth();
  if (termWidth < MIN_TERMINAL_WIDTH) return renderSimpleWelcome();

  const width = Math.min(termWidth - 2, 180);
  const config = getConfig();
  const username = getUserName();
  const modelName = formatModelName(config.model);
  const cwd = shortenPath(process.cwd());
  const version = getVersion();

  const leftWidth = Math.floor(width * 0.4);
  const rightWidth = width - leftWidth - 1;

  const lines: string[] = [];

  // Top border with title
  const title = ` Daemux v${version} `;
  const titleLeftPad = 3;
  const titleRightPad = width - titleLeftPad - title.length - 1;
  lines.push(BOX_CHARS.topLeft + BOX_CHARS.horizontal.repeat(titleLeftPad) + title + BOX_CHARS.horizontal.repeat(titleRightPad) + BOX_CHARS.topRight);

  // Content rows
  const leftContent = buildLeftColumn(username, modelName, cwd, leftWidth);
  const rightContent = buildRightColumn(rightWidth);

  const maxRows = Math.max(leftContent.length, rightContent.length);

  for (let i = 0; i < maxRows; i++) {
    const leftLine = leftContent[i] ?? '';
    const rightLine = rightContent[i] ?? '';
    lines.push(
      BOX_CHARS.vertical +
        padRight(leftLine, leftWidth) +
        BOX_CHARS.vertical +
        padRight(rightLine, rightWidth) +
        BOX_CHARS.vertical
    );
  }

  // Bottom border
  lines.push(BOX_CHARS.bottomLeft + BOX_CHARS.horizontal.repeat(width) + BOX_CHARS.bottomRight);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Simple Welcome (non-TTY or narrow terminals)
// ---------------------------------------------------------------------------

function renderSimpleWelcome(): string {
  const version = getVersion();
  const username = getUserName();
  const config = getConfig();
  const modelName = formatModelName(config.model);
  const cwd = shortenPath(process.cwd());

  return [
    `Daemux v${version}`,
    `Welcome back ${username}!`,
    `Model: ${modelName}`,
    `Directory: ${cwd}`,
    '',
    'Run "daemux" to start an agent session',
    'Run "daemux --help" for available commands',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Column Builders
// ---------------------------------------------------------------------------

function buildLeftColumn(username: string, modelName: string, cwd: string, width: number): string[] {
  const lines = ['', centerText(`Welcome back ${username}!`, width), ''];

  for (const logoLine of LOGO_LINES) {
    lines.push(centerText(logoLine, width));
  }

  lines.push(centerText(dim(`${modelName} \u00B7 Claude Max`), width));
  lines.push(centerText(dim(cwd), width));

  return lines;
}

function buildRightColumn(width: number): string[] {
  const lines: string[] = [];

  lines.push(' ' + bold('Tips for getting started'));
  lines.push(' Run ' + color('daemux', 'cyan') + ' to start an agent session');
  lines.push(' ' + dim(BOX_CHARS.horizontal.repeat(Math.min(width - 2, 40))));
  lines.push(' ' + bold('Recent activity'));
  lines.push(' ' + dim('No recent activity'));
  lines.push('');
  lines.push('');
  lines.push('');

  return lines;
}

// ---------------------------------------------------------------------------
// Display Function
// ---------------------------------------------------------------------------

export function showWelcome(): void {
  console.log(renderWelcome());
}
