/**
 * Cross-Platform Service Manager
 */

import { platform } from 'os';
import { SystemdServiceManager } from './systemd';
import { LaunchdServiceManager } from './launchd';
import { WindowsServiceManager } from './windows';
import type { Platform, PlatformServiceManager, ServiceConfig, ServiceInfo } from './types';

export type { Platform, ServiceConfig, ServiceInfo, ServiceStatus } from './types';

export class ServiceManager {
  private manager: PlatformServiceManager;
  private _platform: Platform;

  constructor() {
    this._platform = this.detectPlatform();
    this.manager = this.createManager();
  }

  private detectPlatform(): Platform {
    const p = platform();
    if (p === 'linux' || p === 'darwin' || p === 'win32') {
      return p;
    }
    throw new Error(`Unsupported platform: ${p}`);
  }

  private createManager(): PlatformServiceManager {
    switch (this._platform) {
      case 'linux':
        return new SystemdServiceManager();
      case 'darwin':
        return new LaunchdServiceManager();
      case 'win32':
        return new WindowsServiceManager();
    }
  }

  getPlatform(): Platform {
    return this._platform;
  }

  async install(config: ServiceConfig): Promise<void> {
    await this.manager.install(config);
  }

  async uninstall(name: string): Promise<void> {
    await this.manager.uninstall(name);
  }

  async start(name: string): Promise<void> {
    await this.manager.start(name);
  }

  async stop(name: string): Promise<void> {
    await this.manager.stop(name);
  }

  async restart(name: string): Promise<void> {
    await this.stop(name);
    await this.start(name);
  }

  async status(name: string): Promise<ServiceInfo> {
    return this.manager.status(name);
  }

  async isInstalled(name: string): Promise<boolean> {
    return this.manager.isInstalled(name);
  }
}

let serviceManager: ServiceManager | null = null;

export function getServiceManager(): ServiceManager {
  if (!serviceManager) {
    serviceManager = new ServiceManager();
  }
  return serviceManager;
}
