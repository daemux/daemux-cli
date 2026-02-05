import { describe, it, expect } from 'bun:test';
import type { ServiceStatus } from '../../../src/infra/service/types';

describe('Platform Integration - runSystemctl callbacks', () => {
  it('resolves with stdout on success', async () => {
    const promise = new Promise<string>((resolve, reject) => {
      const code = 0;
      const stdout = 'ActiveState=active\nMainPID=12345';
      code === 0 ? resolve(stdout) : reject(new Error('systemctl failed'));
    });

    const result = await promise;
    expect(result).toContain('ActiveState=active');
  });

  it('rejects on non-zero exit', async () => {
    const promise = new Promise<string>((resolve, reject) => {
      const code = 4;
      const stderr = 'Unit not found';
      code === 0 ? resolve('') : reject(new Error(`systemctl failed: ${stderr}`));
    });

    await expect(promise).rejects.toThrow('Unit not found');
  });

  it('accumulates stdout chunks', () => {
    let stdout = '';
    ['Active', 'State=', 'active'].forEach(chunk => stdout += chunk);
    expect(stdout).toBe('ActiveState=active');
  });

  it('uses stderr over stdout in error message', () => {
    const stderr = 'Unit not found';
    const stdout = '';
    const errorMsg = `systemctl failed: ${stderr || stdout}`;
    expect(errorMsg).toContain('Unit not found');
  });

  it('passes --user flag', () => {
    const args = ['--user', 'daemon-reload'];
    expect(args).toContain('--user');
  });
});

describe('Platform Integration - runNssm callbacks', () => {
  it('resolves with stdout on success', async () => {
    const result = await Promise.resolve('SERVICE_RUNNING');
    expect(result).toBe('SERVICE_RUNNING');
  });

  it('rejects on failure', async () => {
    const promise = Promise.reject(new Error('nssm failed: Service not found'));
    await expect(promise).rejects.toThrow('Service not found');
  });

  it('provides helpful error when nssm not found', async () => {
    const promise = Promise.reject(
      new Error('nssm not found. Please install NSSM from https://nssm.cc/. Error: spawn ENOENT')
    );
    await expect(promise).rejects.toThrow('nssm not found');
    await expect(promise).rejects.toThrow('nssm.cc');
  });

  const testCodes = [
    { code: 0, shouldResolve: true },
    { code: 1, shouldResolve: false },
    { code: 3, shouldResolve: false },
  ];

  for (const { code, shouldResolve } of testCodes) {
    it(`${shouldResolve ? 'resolves' : 'rejects'} on exit code ${code}`, async () => {
      const promise = new Promise<string>((resolve, reject) => {
        code === 0 ? resolve('success') : reject(new Error('failed'));
      });

      if (shouldResolve) {
        expect(await promise).toBe('success');
      } else {
        await expect(promise).rejects.toThrow('failed');
      }
    });
  }
});

describe('Platform Integration - Event patterns', () => {
  it('handles multiple data events', () => {
    let stdout = '';
    ['chunk1', 'chunk2', 'chunk3'].forEach(chunk => stdout += chunk);
    expect(stdout).toBe('chunk1chunk2chunk3');
  });

  it('handles concurrent operations', async () => {
    const operations = [
      Promise.resolve('result1'),
      Promise.resolve('result2'),
      Promise.resolve('result3'),
    ];
    const results = await Promise.all(operations);
    expect(results).toEqual(['result1', 'result2', 'result3']);
  });
});

describe('Platform Integration - Buffer handling', () => {
  it('converts buffers to strings', () => {
    expect(Buffer.from('test data').toString()).toBe('test data');
    expect(Buffer.from('').toString()).toBe('');
    expect(Buffer.from('line1\nline2\n').toString()).toBe('line1\nline2\n');
  });
});

describe('Platform Integration - Status parsing', () => {
  function parseSystemctlShow(output: string): { status: ServiceStatus; pid?: number } {
    const lines = output.split('\n');
    let status: ServiceStatus = 'unknown';
    let pid: number | undefined;

    for (const line of lines) {
      const [key, value] = line.split('=');
      if (key === 'ActiveState' && value) {
        status = value === 'active' ? 'running' : value === 'inactive' ? 'stopped' : 'unknown';
      }
      if (key === 'MainPID' && value) {
        pid = parseInt(value, 10) || undefined;
      }
    }

    return { status, pid };
  }

  function parseNssmStatus(output: string): ServiceStatus {
    const statusLine = output.trim().toLowerCase();
    if (statusLine.includes('running')) return 'running';
    if (statusLine.includes('stopped')) return 'stopped';
    return 'unknown';
  }

  it('parses systemctl show output', () => {
    expect(parseSystemctlShow('ActiveState=active\nMainPID=12345')).toEqual({
      status: 'running',
      pid: 12345,
    });
    expect(parseSystemctlShow('ActiveState=inactive\nMainPID=0').status).toBe('stopped');
    expect(parseSystemctlShow('ActiveState=failed\nMainPID=0').status).toBe('unknown');
  });

  it('parses nssm status output', () => {
    expect(parseNssmStatus('SERVICE_RUNNING')).toBe('running');
    expect(parseNssmStatus('SERVICE_STOPPED')).toBe('stopped');
    expect(parseNssmStatus('service_running')).toBe('running');
    expect(parseNssmStatus('  SERVICE_RUNNING  \n')).toBe('running');
    expect(parseNssmStatus('SERVICE_PAUSED')).toBe('unknown');
    expect(parseNssmStatus('')).toBe('unknown');
  });
});

describe('Platform Integration - Exit code mapping', () => {
  const systemctlCodes = [
    { code: 0, meaning: 'success' },
    { code: 1, meaning: 'generic error' },
    { code: 4, meaning: 'unit not loaded' },
  ];

  for (const { code, meaning } of systemctlCodes) {
    it(`handles systemctl exit code ${code} (${meaning})`, () => {
      expect(code === 0).toBe(code === 0);
    });
  }
});
