/**
 * Linux (systemd) Service Manager Implementation
 */

import { mkdir, readFile, unlink } from 'fs/promises';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { getLogger } from '../logger';
import type { PlatformServiceManager, ServiceConfig, ServiceInfo, ServiceStatus } from './types';

export class SystemdServiceManager implements PlatformServiceManager {
  private logger = getLogger().child('systemd');
  private userDir = join(homedir(), '.config', 'systemd', 'user');

  private getUnitPath(name: string): string {
    return join(this.userDir, `${name}.service`);
  }

  async install(config: ServiceConfig): Promise<void> {
    await mkdir(this.userDir, { recursive: true });

    const envLines = config.env
      ? Object.entries(config.env)
          .map(([k, v]) => `Environment="${k}=${v}"`)
          .join('\n')
      : '';

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

[Install]
WantedBy=default.target
`;

    const unitPath = this.getUnitPath(config.name);
    await writeFile(unitPath, unitContent);

    await this.runSystemctl(['daemon-reload']);
    await this.runSystemctl(['enable', config.name]);

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

      return { name, status, pid };
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

  private runSystemctl(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('systemctl', ['--user', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', data => { stdout += data.toString(); });
      proc.stderr.on('data', data => { stderr += data.toString(); });

      proc.on('close', code => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`systemctl failed: ${stderr || stdout}`));
        }
      });
    });
  }
}
