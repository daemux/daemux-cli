/**
 * Mock Process Spawn
 * Simulates child process execution for testing
 */

import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MockProcessOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: Error;
  delay?: number;
}

export interface MockSpawnCall {
  command: string;
  args: string[];
  options: Record<string, unknown>;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Mock Process
// ---------------------------------------------------------------------------

export class MockChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = { write: () => {}, end: () => {} };

  pid = Math.floor(Math.random() * 100000);
  killed = false;
  exitCode: number | null = null;
  signalCode: string | null = null;

  constructor(private output: MockProcessOutput) {
    super();
  }

  async execute(): Promise<void> {
    // Add delay if specified
    if (this.output.delay) {
      await new Promise(resolve => setTimeout(resolve, this.output.delay));
    }

    // Emit error if specified
    if (this.output.error) {
      setImmediate(() => this.emit('error', this.output.error));
      return;
    }

    // Emit stdout
    if (this.output.stdout) {
      setImmediate(() => this.stdout.emit('data', Buffer.from(this.output.stdout)));
    }

    // Emit stderr
    if (this.output.stderr) {
      setImmediate(() => this.stderr.emit('data', Buffer.from(this.output.stderr)));
    }

    // Emit close
    setImmediate(() => {
      this.exitCode = this.output.exitCode;
      this.emit('close', this.output.exitCode);
    });
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.signalCode = signal ?? 'SIGTERM';
    setImmediate(() => {
      this.exitCode = 128 + (signal === 'SIGKILL' ? 9 : 15);
      this.emit('close', this.exitCode);
    });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Mock Spawn Factory
// ---------------------------------------------------------------------------

export class MockSpawnFactory {
  private responses: Map<string, MockProcessOutput> = new Map();
  private defaultResponse: MockProcessOutput = {
    stdout: '',
    stderr: '',
    exitCode: 0,
  };
  private callHistory: MockSpawnCall[] = [];
  private patternResponses: Array<{ pattern: RegExp; output: MockProcessOutput }> = [];

  setResponse(command: string, output: MockProcessOutput): this {
    this.responses.set(command, output);
    return this;
  }

  setPatternResponse(pattern: RegExp, output: MockProcessOutput): this {
    this.patternResponses.push({ pattern, output });
    return this;
  }

  setDefaultResponse(output: MockProcessOutput): this {
    this.defaultResponse = output;
    return this;
  }

  setSuccessResponse(command: string, stdout: string): this {
    return this.setResponse(command, { stdout, stderr: '', exitCode: 0 });
  }

  setFailureResponse(command: string, stderr: string, exitCode = 1): this {
    return this.setResponse(command, { stdout: '', stderr, exitCode });
  }

  setTimeoutResponse(command: string, delay: number): this {
    return this.setResponse(command, {
      stdout: '',
      stderr: '',
      exitCode: 0,
      delay,
    });
  }

  setErrorResponse(command: string, errorMessage: string): this {
    return this.setResponse(command, {
      stdout: '',
      stderr: '',
      exitCode: 1,
      error: new Error(errorMessage),
    });
  }

  getCallHistory(): MockSpawnCall[] {
    return [...this.callHistory];
  }

  getLastCall(): MockSpawnCall | undefined {
    return this.callHistory[this.callHistory.length - 1];
  }

  getCallsFor(command: string): MockSpawnCall[] {
    return this.callHistory.filter(c => c.command === command);
  }

  reset(): this {
    this.responses.clear();
    this.patternResponses = [];
    this.callHistory = [];
    return this;
  }

  createSpawn(): (
    command: string,
    args?: string[],
    options?: Record<string, unknown>
  ) => MockChildProcess {
    return (command: string, args: string[] = [], options: Record<string, unknown> = {}) => {
      // Record the call
      this.callHistory.push({
        command,
        args,
        options,
        timestamp: Date.now(),
      });

      // Build full command for matching
      const fullCommand = [command, ...args].join(' ');

      // Find matching response
      let output = this.responses.get(fullCommand);

      // Try pattern matching
      if (!output) {
        for (const { pattern, output: patternOutput } of this.patternResponses) {
          if (pattern.test(fullCommand)) {
            output = patternOutput;
            break;
          }
        }
      }

      // Try just command name
      if (!output) {
        output = this.responses.get(command);
      }

      // Use default
      if (!output) {
        output = this.defaultResponse;
      }

      const process = new MockChildProcess(output);
      process.execute();
      return process;
    };
  }
}

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

export function createMockSpawnFactory(): MockSpawnFactory {
  return new MockSpawnFactory();
}

// ---------------------------------------------------------------------------
// Common Command Mocks
// ---------------------------------------------------------------------------

export const commonMocks = {
  ls: {
    success: { stdout: 'file1.txt\nfile2.txt\nfolder1/', stderr: '', exitCode: 0 },
    empty: { stdout: '', stderr: '', exitCode: 0 },
    notFound: { stdout: '', stderr: 'ls: cannot access: No such file or directory', exitCode: 2 },
  },
  cat: {
    success: (content: string) => ({ stdout: content, stderr: '', exitCode: 0 }),
    notFound: { stdout: '', stderr: 'cat: file: No such file or directory', exitCode: 1 },
  },
  bash: {
    success: (output: string) => ({ stdout: output, stderr: '', exitCode: 0 }),
    failure: (error: string) => ({ stdout: '', stderr: error, exitCode: 1 }),
  },
  launchctl: {
    list: (services: Array<{ pid: number | string; name: string }>) => ({
      stdout: services.map(s => `${s.pid}\t0\t${s.name}`).join('\n'),
      stderr: '',
      exitCode: 0,
    }),
    success: { stdout: '', stderr: '', exitCode: 0 },
    failure: { stdout: '', stderr: 'Service not found', exitCode: 1 },
  },
  systemctl: {
    show: (active: boolean, pid = 12345) => ({
      stdout: `ActiveState=${active ? 'active' : 'inactive'}\nMainPID=${pid}`,
      stderr: '',
      exitCode: 0,
    }),
    success: { stdout: '', stderr: '', exitCode: 0 },
    failure: { stdout: '', stderr: 'Unit not found', exitCode: 4 },
  },
  nssm: {
    statusRunning: { stdout: 'SERVICE_RUNNING', stderr: '', exitCode: 0 },
    statusStopped: { stdout: 'SERVICE_STOPPED', stderr: '', exitCode: 0 },
    success: { stdout: '', stderr: '', exitCode: 0 },
    notFound: { stdout: '', stderr: '', exitCode: 3, error: new Error('nssm not found') },
  },
};
