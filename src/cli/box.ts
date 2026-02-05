/**
 * Box Drawing Utilities
 * Terminal box rendering and dimension helpers
 */

// ---------------------------------------------------------------------------
// Box Drawing Characters
// ---------------------------------------------------------------------------

export const BOX_CHARS = {
  topLeft: '\u256D',
  topRight: '\u256E',
  bottomLeft: '\u2570',
  bottomRight: '\u256F',
  horizontal: '\u2500',
  vertical: '\u2502',
  teeRight: '\u251C',
  teeLeft: '\u2524',
  teeDown: '\u252C',
  teeUp: '\u2534',
  cross: '\u253C',
} as const;

// ---------------------------------------------------------------------------
// Terminal Dimensions
// ---------------------------------------------------------------------------

export function getTerminalWidth(): number {
  return process.stdout.columns ?? 80;
}

export function getTerminalHeight(): number {
  return process.stdout.rows ?? 24;
}

// ---------------------------------------------------------------------------
// Box Drawing Utilities
// ---------------------------------------------------------------------------

export interface BoxOptions {
  width?: number;
  title?: string;
  padding?: number;
}

export function drawBox(content: string[], options: BoxOptions = {}): string {
  const width = options.width ?? getTerminalWidth() - 2;
  const padding = options.padding ?? 1;
  const paddingStr = ' '.repeat(padding);

  const lines: string[] = [];

  // Top border with optional title
  if (options.title) {
    const titlePart = ` ${options.title} `;
    const remainingWidth = width - titlePart.length - 2;
    const leftDashes = Math.floor(remainingWidth / 2);
    const rightDashes = remainingWidth - leftDashes;
    lines.push(BOX_CHARS.topLeft + BOX_CHARS.horizontal.repeat(leftDashes) + titlePart + BOX_CHARS.horizontal.repeat(rightDashes) + BOX_CHARS.topRight);
  } else {
    lines.push(BOX_CHARS.topLeft + BOX_CHARS.horizontal.repeat(width) + BOX_CHARS.topRight);
  }

  // Content lines
  const contentWidth = width - padding * 2;
  for (const line of content) {
    const truncated = line.length > contentWidth ? line.slice(0, contentWidth - 1) + '\u2026' : line;
    const padAmount = contentWidth - truncated.length;
    lines.push(
      `${BOX_CHARS.vertical}${paddingStr}${truncated}${' '.repeat(padAmount)}${paddingStr}${BOX_CHARS.vertical}`
    );
  }

  // Bottom border
  lines.push(BOX_CHARS.bottomLeft + BOX_CHARS.horizontal.repeat(width) + BOX_CHARS.bottomRight);

  return lines.join('\n');
}
