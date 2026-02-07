/**
 * Channel Text Formatting Utilities
 * Abstract formatting interface and default plain-text implementation.
 * Channel adapters (Telegram, Discord, etc.) provide their own formatters.
 */

// ---------------------------------------------------------------------------
// Abstract Formatting Interface
// ---------------------------------------------------------------------------

export interface ChannelFormatter {
  /** Format bold text */
  bold(text: string): string;
  /** Format italic text */
  italic(text: string): string;
  /** Format strikethrough text */
  strikethrough(text: string): string;
  /** Format inline code */
  code(text: string): string;
  /** Format code block with optional language */
  codeBlock(text: string, language?: string): string;
  /** Format a hyperlink */
  link(text: string, url: string): string;
  /** Escape special characters for this format */
  escape(text: string): string;
  /** Convert markdown to this channel's native format */
  fromMarkdown(markdown: string): string;
  /** Split text into chunks respecting format boundaries */
  chunk(text: string, maxLength: number): string[];
}

// ---------------------------------------------------------------------------
// Plain Text Formatter (default/fallback)
// ---------------------------------------------------------------------------

function chunkPlainText(text: string, maxLength: number): string[] {
  if (maxLength <= 0) {
    throw new Error('maxLength must be positive');
  }

  if (text.length <= maxLength) {
    return text.length > 0 ? [text] : [''];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let breakPoint = remaining.lastIndexOf('\n', maxLength);
    if (breakPoint <= 0) {
      breakPoint = remaining.lastIndexOf(' ', maxLength);
    }
    if (breakPoint <= 0) {
      breakPoint = maxLength;
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return chunks;
}

export const plainTextFormatter: ChannelFormatter = {
  bold: (text) => text,
  italic: (text) => text,
  strikethrough: (text) => text,
  code: (text) => text,
  codeBlock: (text) => text,
  link: (text, url) => `${text} (${url})`,
  escape: (text) => text,
  fromMarkdown: (text) => text,
  chunk: chunkPlainText,
};
