import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { ToolDefinition, ToolResult } from '../../types';
import { result, resolvePath } from './helpers';

export const editTool: ToolDefinition = {
  name: 'Edit',
  description: 'Perform a surgical string replacement in a file. Replaces old_string with new_string.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to modify',
      },
      old_string: {
        type: 'string',
        description: 'The exact text to find and replace',
      },
      new_string: {
        type: 'string',
        description: 'The text to replace old_string with',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences (default: false)',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  isConcurrencySafe: false,
};

export async function executeEdit(
  toolUseId: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const filePath = input.file_path as string;
  const oldString = input.old_string as string;
  const newString = input.new_string as string;
  const replaceAll = (input.replace_all as boolean) ?? false;

  if (!filePath) {
    return result(toolUseId, 'Error: file_path is required', true);
  }
  if (oldString === undefined || oldString === null) {
    return result(toolUseId, 'Error: old_string is required', true);
  }
  if (newString === undefined || newString === null) {
    return result(toolUseId, 'Error: new_string is required', true);
  }
  if (oldString === newString) {
    return result(toolUseId, 'Error: old_string and new_string are identical, no changes needed', true);
  }

  const resolvedPath = resolvePath(filePath);

  if (!existsSync(resolvedPath)) {
    return result(toolUseId, `Error: File not found: ${resolvedPath}`, true);
  }

  try {
    const content = readFileSync(resolvedPath, 'utf-8');
    const occurrences = countOccurrences(content, oldString);

    if (occurrences === 0) {
      return result(toolUseId, 'Error: old_string not found in file', true);
    }

    if (occurrences > 1 && !replaceAll) {
      return result(
        toolUseId,
        `Error: old_string is not unique, found ${occurrences} occurrences. Use replace_all to replace all.`,
        true,
      );
    }

    const newContent = replaceAll
      ? replaceAllOccurrences(content, oldString, newString)
      : content.replace(oldString, newString);

    writeFileSync(resolvedPath, newContent, 'utf-8');

    const replacedCount = replaceAll ? occurrences : 1;
    return result(
      toolUseId,
      `Successfully replaced ${replacedCount} occurrence${replacedCount > 1 ? 's' : ''} in ${resolvedPath}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return result(toolUseId, `Error editing file: ${msg}`, true);
  }
}

function countOccurrences(content: string, search: string): number {
  return content.split(search).length - 1;
}

function replaceAllOccurrences(content: string, search: string, replacement: string): string {
  return content.split(search).join(replacement);
}
