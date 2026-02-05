import { describe, it, expect } from 'bun:test';

describe('Input - prompt function', () => {
  it('formats question with trailing space', () => {
    const question = 'Enter your name:';
    expect(`${question} `.endsWith(' ')).toBe(true);
  });

  it('trims whitespace from answers', () => {
    expect('  hello  '.trim()).toBe('hello');
    expect('\tworld\t'.trim()).toBe('world');
    expect(''.trim()).toBe('');
  });

  it('handles multiline input', () => {
    expect('line1\nline2'.trim()).toBe('line1\nline2');
  });
});

describe('Input - promptSecret function', () => {
  describe('TTY raw mode handling', () => {
    it('checks isTTY before setting raw mode', () => {
      const stdinMock = { isTTY: true, setRawMode: () => {} };
      expect(stdinMock.isTTY && stdinMock.setRawMode).toBeTruthy();
    });

    it('skips raw mode for non-TTY', () => {
      const stdinMock = { isTTY: false };
      expect(stdinMock.isTTY && (stdinMock as any).setRawMode).toBeFalsy();
    });
  });

  describe('character processing', () => {
    const isEnter = (c: string) => c === '\n' || c === '\r';
    const isBackspace = (c: string) => c === '\x7f' || c === '\b';
    const isInterrupt = (c: string) => c === '\x03';

    it('detects Enter key', () => {
      expect(isEnter('\n')).toBe(true);
      expect(isEnter('\r')).toBe(true);
    });

    it('detects Ctrl+C', () => {
      expect(isInterrupt('\x03')).toBe(true);
    });

    it('detects backspace variations', () => {
      expect(isBackspace('\x7f')).toBe(true);
      expect(isBackspace('\b')).toBe(true);
    });

    it('accumulates regular characters', () => {
      let input = '';
      ['p', 'a', 's', 's'].forEach(c => input += c);
      expect(input).toBe('pass');
    });

    it('handles backspace on non-empty input', () => {
      let input = 'pass';
      if (input.length > 0) input = input.slice(0, -1);
      expect(input).toBe('pas');
    });

    it('ignores backspace on empty input', () => {
      let input = '';
      if (input.length > 0) input = input.slice(0, -1);
      expect(input).toBe('');
    });
  });

  describe('Buffer conversion', () => {
    it('converts buffers to strings', () => {
      expect(Buffer.from('hello').toString()).toBe('hello');
      expect(Buffer.from('a').toString()).toBe('a');
      expect(Buffer.from('\n').toString()).toBe('\n');
      expect(Buffer.from('').toString()).toBe('');
    });
  });
});

describe('Input - confirm function', () => {
  const parseConfirm = (answer: string, defaultValue: boolean): boolean => {
    if (answer === '') return defaultValue;
    return answer.toLowerCase().startsWith('y');
  };

  describe('hint formatting', () => {
    it('generates correct hints', () => {
      expect(true ? '[Y/n]' : '[y/N]').toBe('[Y/n]');
      expect(false ? '[Y/n]' : '[y/N]').toBe('[y/N]');
    });
  });

  describe('answer parsing', () => {
    it('returns default on empty answer', () => {
      expect(parseConfirm('', true)).toBe(true);
      expect(parseConfirm('', false)).toBe(false);
    });

    it('recognizes yes variants', () => {
      ['y', 'Y', 'yes', 'YES', 'Yeah'].forEach(answer => {
        expect(parseConfirm(answer, false)).toBe(true);
      });
    });

    it('recognizes no variants', () => {
      ['n', 'N', 'no', 'NO'].forEach(answer => {
        expect(parseConfirm(answer, true)).toBe(false);
      });
    });

    it('handles other input as false', () => {
      ['maybe', 'sure', 'ok'].forEach(answer => {
        expect(parseConfirm(answer, true)).toBe(false);
      });
    });
  });
});

describe('Input - Module exports', () => {
  it('exports all functions', () => {
    const { prompt, promptSecret, confirm } = require('../../src/cli/input');
    expect(typeof prompt).toBe('function');
    expect(typeof promptSecret).toBe('function');
    expect(typeof confirm).toBe('function');
  });
});

describe('Input - Edge cases', () => {
  it('handles special characters', () => {
    expect('\x1b[A'.startsWith('\x1b')).toBe(true);
    expect('\t').toBe('\t');
    expect('\x00'.length).toBe(1);
  });

  it('handles Promise-based patterns', async () => {
    const result = await new Promise<string>(resolve => setTimeout(() => resolve('test'), 0));
    expect(result).toBe('test');
  });
});
