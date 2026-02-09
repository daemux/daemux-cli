import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { ToolDefinition, ToolResult } from '../../types';
import { result, resolvePath } from './helpers';

export const writeFileTool: ToolDefinition = {
  name: 'Write',
  description: 'Write content to a file at the specified path',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
      encoding: {
        type: 'string',
        description: 'The encoding to use (default: utf-8)',
      },
    },
    required: ['path', 'content'],
  },
  isConcurrencySafe: false,
};

export async function executeWriteFile(
  toolUseId: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const path = input.path as string;
  const content = input.content as string;
  const encoding = (input.encoding as BufferEncoding) ?? 'utf-8';

  if (!path) {
    return result(toolUseId, 'Error: path is required', true);
  }
  if (content === undefined) {
    return result(toolUseId, 'Error: content is required', true);
  }

  const resolvedPath = resolvePath(path);

  try {
    mkdirSync(dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, content, encoding);
    return result(toolUseId, `File written successfully: ${resolvedPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return result(toolUseId, `Error writing file: ${msg}`, true);
  }
}
