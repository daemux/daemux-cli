import { resolve, isAbsolute } from 'path';
import type { ToolResult } from '../../types';

export function result(toolUseId: string, content: string, isError = false): ToolResult {
  return { toolUseId, content, isError };
}

export function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}
