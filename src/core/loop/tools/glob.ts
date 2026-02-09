import { statSync } from 'fs';
import type { ToolDefinition, ToolResult } from '../../types';
import { result, resolvePath } from './helpers';

export const globTool: ToolDefinition = {
  name: 'Glob',
  description: 'Find files matching a glob pattern, sorted by modification time (most recent first)',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to match files against (e.g. "**/*.ts", "src/**/*.js")',
      },
      path: {
        type: 'string',
        description: 'The directory to search in (defaults to current working directory)',
      },
    },
    required: ['pattern'],
  },
  isConcurrencySafe: true,
};

export async function executeGlob(
  toolUseId: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const pattern = input.pattern as string;
  const path = input.path as string | undefined;

  if (!pattern) {
    return result(toolUseId, 'Error: pattern is required', true);
  }

  const searchDir = path ? resolvePath(path) : process.cwd();

  try {
    const glob = new Bun.Glob(pattern);
    const entries: { path: string; mtimeMs: number }[] = [];

    for await (const match of glob.scan({ cwd: searchDir, absolute: true })) {
      try {
        entries.push({ path: match, mtimeMs: statSync(match).mtimeMs });
      } catch {
        entries.push({ path: match, mtimeMs: 0 });
      }
    }

    if (entries.length === 0) {
      return result(toolUseId, `No files matched pattern: ${pattern}`);
    }

    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return result(toolUseId, entries.map(e => e.path).join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return result(toolUseId, `Error running glob: ${msg}`, true);
  }
}
