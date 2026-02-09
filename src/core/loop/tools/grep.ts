import { spawn } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import type { ToolDefinition, ToolResult } from '../../types';
import { result, resolvePath } from './helpers';

const MAX_OUTPUT_CHARS = 30000;

type OutputMode = 'content' | 'files_with_matches' | 'count';

export const grepTool: ToolDefinition = {
  name: 'Grep',
  description: 'Search file contents using regex patterns. Uses ripgrep when available, falls back to native regex.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The regular expression pattern to search for',
      },
      path: {
        type: 'string',
        description: 'File or directory to search in (defaults to current working directory)',
      },
      glob: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g. "*.js", "**/*.tsx")',
      },
      type: {
        type: 'string',
        description: 'File type to search (e.g. "js", "py", "ts")',
      },
      output_mode: {
        type: 'string',
        description: 'Output mode: "content" (matching lines), "files_with_matches" (file paths), "count" (match counts)',
      },
      context: {
        type: 'number',
        description: 'Number of context lines before and after each match',
      },
      multiline: {
        type: 'boolean',
        description: 'Enable multiline matching where . matches newlines',
      },
    },
    required: ['pattern'],
  },
  isConcurrencySafe: true,
};

export async function executeGrep(
  toolUseId: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const pattern = input.pattern as string;
  const path = input.path as string | undefined;
  const globFilter = input.glob as string | undefined;
  const fileType = input.type as string | undefined;
  const outputMode = (input.output_mode as OutputMode) ?? 'files_with_matches';
  const context = input.context as number | undefined;
  const multiline = (input.multiline as boolean) ?? false;

  if (!pattern) {
    return result(toolUseId, 'Error: pattern is required', true);
  }

  const searchPath = path ? resolvePath(path) : process.cwd();

  try {
    const rgResult = await tryRipgrep(pattern, searchPath, {
      glob: globFilter,
      type: fileType,
      outputMode,
      context,
      multiline,
    });
    return result(toolUseId, truncateOutput(rgResult));
  } catch (err) {
    if (isRipgrepNotFound(err)) {
      return nativeFallback(toolUseId, pattern, searchPath, {
        glob: globFilter,
        outputMode,
        context,
        multiline,
      });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return result(toolUseId, `Error running grep: ${msg}`, true);
  }
}

interface GrepOptions {
  glob?: string;
  type?: string;
  outputMode: OutputMode;
  context?: number;
  multiline: boolean;
}

function buildRgArgs(
  pattern: string,
  searchPath: string,
  options: GrepOptions,
): string[] {
  const args: string[] = ['--no-heading', '--color', 'never'];

  if (options.outputMode === 'files_with_matches') {
    args.push('-l');
  } else if (options.outputMode === 'count') {
    args.push('-c');
  } else {
    args.push('-n');
  }

  if (options.context !== undefined && options.outputMode === 'content') {
    args.push('-C', String(options.context));
  }

  if (options.multiline) {
    args.push('-U', '--multiline-dotall');
  }

  if (options.glob) {
    args.push('--glob', options.glob);
  }

  if (options.type) {
    args.push('--type', options.type);
  }

  args.push(pattern, searchPath);
  return args;
}

const RG_TIMEOUT_MS = 60000;

function tryRipgrep(
  pattern: string,
  searchPath: string,
  options: GrepOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = buildRgArgs(pattern, searchPath, options);
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn('rg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    const timeout = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
    }, RG_TIMEOUT_MS);

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > MAX_OUTPUT_CHARS * 2) {
        killed = true;
        proc.kill('SIGTERM');
      }
    });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    proc.on('error', (err) => { clearTimeout(timeout); reject(err); });

    proc.on('close', (code: number | null) => {
      clearTimeout(timeout);
      if (killed || code === 0) {
        resolve(stdout.trim() || 'No matches found');
      } else if (code === 1) {
        resolve('No matches found'); // rg exit code 1 = no matches
      } else {
        reject(new Error(`rg exited with code ${code}: ${stderr}`));
      }
    });
  });
}

function isRipgrepNotFound(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

export function nativeFallback(
  toolUseId: string,
  pattern: string,
  searchPath: string,
  options: Omit<GrepOptions, 'type'>,
): ToolResult {
  try {
    const flags = options.multiline ? 'gms' : 'gm';
    const regex = new RegExp(pattern, flags);
    const files = walkDirectory(searchPath, options.glob);
    const results: string[] = [];

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const relPath = relative(searchPath, filePath) || filePath;

        if (options.outputMode === 'files_with_matches') {
          if (regex.test(content)) results.push(relPath);
        } else if (options.outputMode === 'count') {
          const matches = content.match(regex);
          if (matches?.length) results.push(`${relPath}:${matches.length}`);
        } else {
          results.push(...findMatchingLines(content.split('\n'), regex, relPath, options.context));
        }
        regex.lastIndex = 0;
      } catch {
        // Skip unreadable files
      }
    }

    if (results.length === 0) {
      return result(toolUseId, 'No matches found');
    }

    return result(toolUseId, truncateOutput(results.join('\n')));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return result(toolUseId, `Error running native grep: ${msg}`, true);
  }
}

function findMatchingLines(
  lines: string[],
  regex: RegExp,
  filePath: string,
  contextLines?: number,
): string[] {
  const results: string[] = [];
  const matchedLineNums = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    regex.lastIndex = 0;
    if (regex.test(line)) {
      matchedLineNums.add(i);
      if (contextLines !== undefined) {
        for (let j = Math.max(0, i - contextLines); j <= Math.min(lines.length - 1, i + contextLines); j++) {
          matchedLineNums.add(j);
        }
      }
    }
  }

  const sortedNums = Array.from(matchedLineNums).sort((a, b) => a - b);
  for (const lineNum of sortedNums) {
    results.push(`${filePath}:${lineNum + 1}:${lines[lineNum] ?? ''}`);
  }

  return results;
}

function walkDirectory(dir: string, globFilter?: string): string[] {
  const files: string[] = [];
  const globMatcher = globFilter ? new Bun.Glob(globFilter) : null;

  function walk(currentDir: string): void {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          if (isBinaryExtension(entry.name)) continue;
          if (!globMatcher || globMatcher.match(relative(dir, fullPath))) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip directories that cannot be read
    }
  }

  try {
    const stat = statSync(dir);
    if (stat.isFile()) {
      files.push(dir);
    } else {
      walk(dir);
    }
  } catch {
    // Directory not accessible
  }

  return files;
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.mp3', '.mp4', '.avi', '.mov', '.wav',
  '.o', '.obj', '.class', '.pyc', '.wasm',
]);

function isBinaryExtension(filename: string): boolean {
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx === -1) return false;
  return BINARY_EXTENSIONS.has(filename.slice(dotIdx).toLowerCase());
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return output.slice(0, MAX_OUTPUT_CHARS) + '\n... (output truncated at 30000 characters)';
}
