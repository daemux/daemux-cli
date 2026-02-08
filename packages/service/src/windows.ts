/**
 * Windows (nssm) Service Manager Implementation
 */

import { spawn } from 'child_process';
import type { Logger } from './logger';
import { getNoopLogger } from './logger';
import type { PlatformServiceManager, ServiceConfig, ServiceInfo, ServiceStatus } from './types';

export class WindowsServiceManager implements PlatformServiceManager {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = (logger ?? getNoopLogger()).child('windows-service');
  }

  async install(config: ServiceConfig): Promise<void> {
    await this.runNssm(['install', config.name, config.execPath]);

    if (config.args?.length) {
      await this.runNssm(['set', config.name, 'AppParameters', config.args.join(' ')]);
    }

    if (config.workingDirectory) {
      await this.runNssm(['set', config.name, 'AppDirectory', config.workingDirectory]);
    }

    if (config.description) {
      await this.runNssm(['set', config.name, 'Description', config.description]);
    }

    if (config.displayName) {
      await this.runNssm(['set', config.name, 'DisplayName', config.displayName]);
    }

    // Configure auto-restart
    await this.runNssm(['set', config.name, 'AppExit', 'Default', 'Restart']);
    await this.runNssm(['set', config.name, 'AppRestartDelay', '5000']);

    // Set environment variables
    if (config.env) {
      const envStr = Object.entries(config.env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
      await this.runNssm(['set', config.name, 'AppEnvironmentExtra', envStr]);
    }

    this.logger.info('Service installed', { name: config.name });
  }

  async uninstall(name: string): Promise<void> {
    try {
      await this.stop(name);
    } catch {
      // Service might not be running
    }

    await this.runNssm(['remove', name, 'confirm']);
    this.logger.info('Service uninstalled', { name });
  }

  async start(name: string): Promise<void> {
    await this.runNssm(['start', name]);
    this.logger.info('Service started', { name });
  }

  async stop(name: string): Promise<void> {
    await this.runNssm(['stop', name]);
    this.logger.info('Service stopped', { name });
  }

  async status(name: string): Promise<ServiceInfo> {
    try {
      const output = await this.runNssm(['status', name]);
      const statusLine = output.trim().toLowerCase();

      let status: ServiceStatus = 'unknown';
      if (statusLine.includes('running')) {
        status = 'running';
      } else if (statusLine.includes('stopped')) {
        status = 'stopped';
      }

      return { name, status };
    } catch {
      return { name, status: 'not-installed' };
    }
  }

  async isInstalled(name: string): Promise<boolean> {
    try {
      await this.runNssm(['status', name]);
      return true;
    } catch {
      return false;
    }
  }

  private runNssm(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('nssm.exe', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', data => { stdout += data.toString(); });
      proc.stderr.on('data', data => { stderr += data.toString(); });

      proc.on('close', code => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`nssm failed: ${stderr || stdout}`));
        }
      });

      proc.on('error', err => {
        reject(new Error(`nssm not found. Please install NSSM from https://nssm.cc/. Error: ${err.message}`));
      });
    });
  }
}
