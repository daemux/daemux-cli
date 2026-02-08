/**
 * Service Types
 */

export type Platform = 'linux' | 'darwin' | 'win32';

export type ServiceStatus = 'running' | 'stopped' | 'failed' | 'unknown' | 'not-installed';

export interface ServiceConfig {
  name: string;
  displayName?: string;
  description?: string;
  execPath: string;
  args?: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
  user?: string;
  logPath?: string;
  errorLogPath?: string;
  restartOnFailure?: boolean;
  restartDelaySeconds?: number;
}

export interface ServiceInfo {
  name: string;
  status: ServiceStatus;
  pid?: number;
  uptime?: number;
  memory?: number;
  cpu?: number;
  lastError?: string;
}

export interface PlatformServiceManager {
  install(config: ServiceConfig): Promise<void>;
  uninstall(name: string): Promise<void>;
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  status(name: string): Promise<ServiceInfo>;
  isInstalled(name: string): Promise<boolean>;
}
