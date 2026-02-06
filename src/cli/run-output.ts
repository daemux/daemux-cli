/**
 * Stream Output Helpers
 * Handles formatting and display of streaming output during agent execution.
 */

import { dim, error } from './utils';
import type { StreamChunk } from '../core/loop/types';

export function createStreamHandler(): (chunk: StreamChunk) => void {
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

export function truncateResult(result: string, maxLen = 100): string {
  if (result.length <= maxLen) return result;
  return result.slice(0, maxLen) + '...';
}

export function printStats(tokensIn: number, tokensOut: number, toolCount: number, durationMs: number): void {
  const time = (durationMs / 1000).toFixed(1);
  console.log(dim(`\n[Tokens: ${tokensIn}/${tokensOut} | Tools: ${toolCount} | Time: ${time}s]`));
}
