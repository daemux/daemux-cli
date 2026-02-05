/**
 * Cross-Platform Daemon Service Management
 * Re-exports from split modules
 */

export {
  ServiceManager,
  getServiceManager,
} from './service/index';

export type {
  Platform,
  ServiceConfig,
  ServiceInfo,
  ServiceStatus,
} from './service/types';
