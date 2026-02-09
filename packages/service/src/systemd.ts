/**
 * Linux (systemd) Service Manager Implementation
 */

import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import type { Logger } from './logger';
import { getNoopLogger } from './logger';
import type { PlatformServiceManager, ServiceConfig, ServiceInfo, ServiceStatus } from './types';

export class SystemdServiceManager implements PlatformServiceManager {
  private logger: Logger;
  private userDir = join(homedir(), '.config', 'systemd', 'user');

  constructor(logger?: Logger) {
    this.logger = (logger ?? getNoopLogger()).child('systemd');
  }

  private getUnitPath(name: string): string {
    return join(this.userDir, `${name}.service`);
  }

  async install(config: ServiceConfig): Promise<void> {
    await mkdir(this.userDir, { recursive: true });

    const hardenedEnv = this.buildHardenedEnv(config.env);
    const envLines = Object.entries(hardenedEnv)
      .map(([k, v]) => `Environment="${k}=${v}"`)
      .join('\n');

    const logLines = this.buildLogDirectives(config);

    const unitContent = `[Unit]
Description=${config.description ?? config.displayName ?? config.name}
After=network.target

[Service]
Type=simple
ExecStart=${config.execPath}${config.args?.length ? ' ' + config.args.join(' ') : ''}
WorkingDirectory=${config.workingDirectory ?? homedir()}
Restart=on-failure
RestartSec=5
${envLines}
${logLines}
[Install]
WantedBy=default.target
`;

    const unitPath = this.getUnitPath(config.name);
    await writeFile(unitPath, unitContent);

    await this.runSystemctl(['daemon-reload']);
    await this.runSystemctl(['enable', config.name]);

    const lingerResult = await this.enableLinger();
    if (lingerResult) {
      this.logger.info('User lingering enabled for service persistence');
    } else {
      this.logger.warn('Could not enable user lingering. Service may stop when SSH session disconnects.');
    }

    this.logger.info('Service installed', { name: config.name, path: unitPath });
  }

  async uninstall(name: string): Promise<void> {
    try {
      await this.runSystemctl(['stop', name]);
    } catch {
      // Service might not be running
    }

    try {
      await this.runSystemctl(['disable', name]);
    } catch {
      // Service might not be enabled
    }

    const unitPath = this.getUnitPath(name);
    try {
      await unlink(unitPath);
    } catch {
      // File might not exist
    }

    await this.runSystemctl(['daemon-reload']);
    this.logger.info('Service uninstalled', { name });
  }

  async start(name: string): Promise<void> {
    await this.runSystemctl(['start', name]);
    this.logger.info('Service started', { name });
  }

  async stop(name: string): Promise<void> {
    await this.runSystemctl(['stop', name]);
    this.logger.info('Service stopped', { name });
  }

  async status(name: string): Promise<ServiceInfo> {
    try {
      const output = await this.runSystemctl([
        'show', name, '--property=ActiveState,MainPID,LoadState',
      ]);
      const lines = output.split('\n');

      let status: ServiceStatus = 'unknown';
      let pid: number | undefined;
      let loadState = '';

      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key === 'ActiveState' && value) {
          status = value === 'active' ? 'running' : value === 'inactive' ? 'stopped' : 'unknown';
        }
        if (key === 'MainPID' && value) {
          pid = parseInt(value, 10) || undefined;
        }
        if (key === 'LoadState' && value) {
          loadState = value;
        }
      }

      // systemctl show returns ActiveState=inactive for non-existent services;
      // LoadState=not-found means the unit does not exist on disk
      if (loadState === 'not-found') {
        return { name, status: 'not-installed' };
      }

      const lingerEnabled = await this.isLingerEnabled();

      return { name, status, pid, lingerEnabled };
    } catch {
      return { name, status: 'not-installed' };
    }
  }

  async isInstalled(name: string): Promise<boolean> {
    const unitPath = this.getUnitPath(name);
    try {
      await readFile(unitPath);
      return true;
    } catch {
      return false;
    }
  }

  private buildHardenedEnv(env?: Record<string, string>): Record<string, string> {
    const result = { ...env };
    const home = homedir();
    const requiredPaths = [`${home}/.local/bin`, `${home}/.bun/bin`];
    const existingPath = result.PATH ?? '';
    const pathParts = existingPath.split(':').filter(Boolean);

    for (const rp of requiredPaths) {
      if (!pathParts.includes(rp)) {
        pathParts.unshift(rp);
      }
    }

    result.PATH = pathParts.join(':');
    return result;
  }

  private buildLogDirectives(config: ServiceConfig): string {
    const lines: string[] = [];
    if (config.logPath) {
      lines.push(`StandardOutput=append:${config.logPath}`);
    }
    if (config.errorLogPath) {
      lines.push(`StandardError=append:${config.errorLogPath}`);
    }
    return lines.length > 0 ? lines.join('\n') + '\n' : '';
  }

  private async enableLinger(): Promise<boolean> {
    try {
      await this.runCommand('loginctl', ['enable-linger']);
      return true;
    } catch {
      this.logger.warn('loginctl enable-linger failed; service may not persist after logout');
      return false;
    }
  }

  async isLingerEnabled(): Promise<boolean> {
    try {
      const user = process.env.USER ?? process.env.LOGNAME ?? '';
      if (!user) return false;
      const output = await this.runCommand('loginctl', ['show-user', user, '--property=Linger']);
      return output.trim() === 'Linger=yes';
    } catch {
      return false;
    }
  }

  private runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', data => { stdout += data.toString(); });
      proc.stderr.on('data', data => { stderr += data.toString(); });

      proc.on('close', code => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`${command} failed: ${stderr || stdout}`));
        }
      });

      proc.on('error', err => {
        reject(err);
      });
    });
  }

  private runSystemctl(args: string[]): Promise<string> {
    return this.runCommand('systemctl', ['--user', ...args]);
  }
}
