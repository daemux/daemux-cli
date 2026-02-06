/**
 * Human-Like Behavior Module
 * Simulates natural response patterns for agent messaging channels
 */

import { getLogger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface HumanBehaviorConfig {
  typingDelayPerChar: number;
  minResponseDelay: number;
  maxResponseDelay: number;
  maxChunkLength: number;
  chunkPause: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: HumanBehaviorConfig = {
  typingDelayPerChar: 30,
  minResponseDelay: 1000,
  maxResponseDelay: 3000,
  maxChunkLength: 2000,
  chunkPause: 1500,
  enabled: false,
};

// ---------------------------------------------------------------------------
// Delay Helpers
// ---------------------------------------------------------------------------

const MIN_TYPING_DELAY = 500;
const MAX_TYPING_DELAY = 5000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// HumanBehavior Class
// ---------------------------------------------------------------------------

export class HumanBehavior {
  private config: HumanBehaviorConfig;

  constructor(config: HumanBehaviorConfig) {
    this.config = config;
  }

  /**
   * Calculate typing indicator duration proportional to text length.
   * Clamped between 500ms and 5000ms.
   */
  calculateTypingDelay(text: string): number {
    const raw = text.length * this.config.typingDelayPerChar;
    return clamp(raw, MIN_TYPING_DELAY, MAX_TYPING_DELAY);
  }

  /**
   * Random delay between configured min and max response delay.
   */
  calculateResponseDelay(): number {
    const { minResponseDelay, maxResponseDelay } = this.config;
    return minResponseDelay + Math.random() * (maxResponseDelay - minResponseDelay);
  }

  /**
   * Split text into chunks at natural break points (paragraph breaks,
   * sentence ends, line breaks). Never breaks mid-word.
   */
  chunkMessage(text: string, maxLength?: number): string[] {
    const limit = maxLength ?? this.config.maxChunkLength;
    if (text.length <= limit) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= limit) {
        chunks.push(remaining);
        break;
      }

      const cutIndex = this.findBreakPoint(remaining, limit);
      chunks.push(remaining.slice(0, cutIndex).trimEnd());
      remaining = remaining.slice(cutIndex).trimStart();
    }

    return chunks.filter((c) => c.length > 0);
  }

  /**
   * Simulate a human-like response: optional typing indicator, delay,
   * chunked message delivery with pauses between chunks.
   */
  async simulateHumanResponse(
    text: string,
    sendFn: (chunk: string) => Promise<void>,
    typingFn?: (active: boolean) => Promise<void>
  ): Promise<void> {
    if (!this.config.enabled) {
      await sendFn(text);
      return;
    }

    const chunks = this.chunkMessage(text);
    const responseDelay = this.calculateResponseDelay();

    // Initial response delay
    if (typingFn) {
      await typingFn(true);
    }
    await sleep(responseDelay);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;

      // Typing indicator for chunk
      if (typingFn && i > 0) {
        await typingFn(true);
      }

      const typingDelay = this.calculateTypingDelay(chunk);
      await sleep(typingDelay);

      if (typingFn) {
        await typingFn(false);
      }

      await sendFn(chunk);

      // Pause between chunks (skip after last)
      if (i < chunks.length - 1) {
        await sleep(this.config.chunkPause);
      }
    }

    getLogger().debug('Human-like response delivered', {
      chunks: chunks.length,
      totalLength: text.length,
    });
  }

  /**
   * Whether human-like behavior is currently enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get a copy of the current configuration.
   */
  getConfig(): HumanBehaviorConfig {
    return { ...this.config };
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private findBreakPoint(text: string, maxLength: number): number {
    const segment = text.slice(0, maxLength);

    // Prefer paragraph break (double newline)
    const paragraphBreak = segment.lastIndexOf('\n\n');
    if (paragraphBreak > maxLength * 0.3) {
      return paragraphBreak + 2;
    }

    // Then sentence end (period/exclamation/question followed by space or newline)
    const sentenceMatch = this.findLastSentenceEnd(segment);
    if (sentenceMatch > maxLength * 0.3) {
      return sentenceMatch;
    }

    // Then single line break
    const lineBreak = segment.lastIndexOf('\n');
    if (lineBreak > maxLength * 0.3) {
      return lineBreak + 1;
    }

    // Then word boundary (last space)
    const spaceBreak = segment.lastIndexOf(' ');
    if (spaceBreak > maxLength * 0.3) {
      return spaceBreak + 1;
    }

    // Fallback: hard break at limit
    return maxLength;
  }

  private findLastSentenceEnd(text: string): number {
    let lastEnd = -1;
    for (let i = text.length - 1; i >= 0; i--) {
      const char = text[i];
      if (char === '.' || char === '!' || char === '?') {
        const next = text[i + 1];
        if (next === ' ' || next === '\n' || next === undefined) {
          lastEnd = i + 1;
          break;
        }
      }
    }
    return lastEnd;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHumanBehavior(
  config?: Partial<HumanBehaviorConfig>
): HumanBehavior {
  const merged: HumanBehaviorConfig = { ...DEFAULT_CONFIG, ...config };
  return new HumanBehavior(merged);
}
