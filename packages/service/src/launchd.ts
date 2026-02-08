/**
 * macOS (launchd) Service Manager Implementation
 */

import { mkdir, readFile, unlink, chmod } from 'fs/promises';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import type { Logger } from './logger';
import { getNoopLogger } from './logger';
import type { PlatformServiceManager, ServiceConfig, ServiceInfo, ServiceStatus } from './types';

export class LaunchdServiceManager implements PlatformServiceManager {
  private logger: Logger;
  private agentsDir = join(homedir(), 'Library', 'LaunchAgents');

  constructor(logger?: Logger) {
    this.logger = (logger ?? getNoopLogger()).child('launchd');
  }

  private getPlistPath(name: string): string {
    return join(this.agentsDir, `${name}.plist`);
  }

  async install(config: ServiceConfig): Promise<void> {
    await mkdir(this.agentsDir, { recursive: true });

    const envDict = config.env
      ? Object.entries(config.env)
          .map(([k, v]) => `      <key>${k}</key>\n      <string>${v}</string>`)
          .join('\n')
      : '';

    const argsArray = [config.execPath, ...(config.args ?? [])];
    const programArgs = argsArray
      .map(arg => `    <string>${this.escapeXml(arg)}</string>`)
      .join('\n');

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${config.name}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${config.workingDirectory ?? homedir()}</string>
  <key>StandardOutPath</key>
  <string>${join(homedir(), '.daemux', 'logs', `${config.name}.out.log`)}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), '.daemux', 'logs', `${config.name}.err.log`)}</string>
${envDict ? `  <key>EnvironmentVariables</key>\n  <dict>\n${envDict}\n  </dict>` : ''}
</dict>
</plist>
`;

    const plistPath = this.getPlistPath(config.name);
    await writeFile(plistPath, plistContent);
    await chmod(plistPath, 0o644);

    // Create log directory
    await mkdir(join(homedir(), '.daemux', 'logs'), { recursive: true });

    this.logger.info('Service installed', { name: config.name, path: plistPath });
  }

  async uninstall(name: string): Promise<void> {
    try {
      await this.runLaunchctl(['unload', this.getPlistPath(name)]);
    } catch {
      // Service might not be loaded
    }

    const plistPath = this.getPlistPath(name);
    try {
      await unlink(plistPath);
    } catch {
      // File might not exist
    }

    this.logger.info('Service uninstalled', { name });
  }

  async start(name: string): Promise<void> {
    await this.runLaunchctl(['load', this.getPlistPath(name)]);
    this.logger.info('Service started', { name });
  }

  async stop(name: string): Promise<void> {
    await this.runLaunchctl(['unload', this.getPlistPath(name)]);
    this.logger.info('Service stopped', { name });
  }

  async status(name: string): Promise<ServiceInfo> {
    try {
      const output = await this.runLaunchctl(['list']);
      const lines = output.split('\n');

      for (const line of lines) {
        const parts = line.split('\t');
        if (parts[2] === name && parts[0]) {
          const pid = parseInt(parts[0], 10);
          return {
            name,
            status: pid > 0 ? 'running' : 'stopped',
            pid: pid > 0 ? pid : undefined,
          };
        }
      }

      const installed = await this.isInstalled(name);
      return { name, status: installed ? 'stopped' : 'not-installed' };
    } catch {
      return { name, status: 'not-installed' };
    }
  }

  async isInstalled(name: string): Promise<boolean> {
    const plistPath = this.getPlistPath(name);
    try {
      await readFile(plistPath);
      return true;
    } catch {
      return false;
    }
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private runLaunchctl(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('launchctl', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', data => { stdout += data.toString(); });
      proc.stderr.on('data', data => { stderr += data.toString(); });

      proc.on('close', code => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`launchctl failed: ${stderr || stdout}`));
        }
      });
    });
  }
}
