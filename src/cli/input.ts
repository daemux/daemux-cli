/**
 * Interactive Input Helpers
 * Prompt, confirm, and secret input functions for CLI
 */

import { createInterface } from 'readline';
import { dim } from './utils';

// ---------------------------------------------------------------------------
// Interactive Input
// ---------------------------------------------------------------------------

export async function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${question} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const setRawMode = (enabled: boolean) => {
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        process.stdin.setRawMode(enabled);
      }
    };

    setRawMode(true);
    process.stdout.write(`${question} `);

    let input = '';
    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      setRawMode(false);
      rl.close();
    };

    const onData = (char: Buffer) => {
      const c = char.toString();

      if (c === '\n' || c === '\r') {
        cleanup();
        process.stdout.write('\n');
        return resolve(input);
      }

      if (c === '\x03') {
        cleanup();
        return process.exit(130);
      }

      if (c === '\x7f' || c === '\b') {
        if (input.length > 0) input = input.slice(0, -1);
      } else {
        input += c;
      }
    };

    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

export async function confirm(question: string, defaultValue = false): Promise<boolean> {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = await prompt(`${question} ${dim(hint)}`);

  if (answer === '') return defaultValue;
  return answer.toLowerCase().startsWith('y');
}
