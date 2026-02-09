import { existsSync, readFileSync } from 'fs';
import type { ToolDefinition, ToolResult } from '../../types';
import { result, resolvePath } from './helpers';

export const readFileTool: ToolDefinition = {
  name: 'Read',
  description: 'Read the contents of a file at the specified path',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to read',
      },
      encoding: {
        type: 'string',
        description: 'The encoding to use (default: utf-8)',
      },
    },
    required: ['path'],
  },
  isConcurrencySafe: true,
};

export async function executeReadFile(
  toolUseId: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const path = input.path as string;
  const encoding = (input.encoding as BufferEncoding) ?? 'utf-8';

  if (!path) {
    return result(toolUseId, 'Error: path is required', true);
  }

  const resolvedPath = resolvePath(path);

  if (!existsSync(resolvedPath)) {
    return result(toolUseId, `Error: File not found: ${resolvedPath}`, true);
  }

  try {
    const content = readFileSync(resolvedPath, encoding);
    return result(toolUseId, content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return result(toolUseId, `Error reading file: ${msg}`, true);
  }
}
