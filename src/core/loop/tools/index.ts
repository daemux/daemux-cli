import type { ToolResult } from '../../types';
import { readFileTool, executeReadFile } from './read';
import { writeFileTool, executeWriteFile } from './write';
import { bashTool, executeBash } from './bash';
import { editTool, executeEdit } from './edit';
import { globTool, executeGlob } from './glob';
import { grepTool, executeGrep } from './grep';

export { readFileTool, executeReadFile } from './read';
export { writeFileTool, executeWriteFile } from './write';
export { bashTool, executeBash } from './bash';
export { editTool, executeEdit } from './edit';
export { globTool, executeGlob } from './glob';
export { grepTool, executeGrep } from './grep';
export { result, resolvePath } from './helpers';

// SpawnAgent is registered dynamically at runtime via createSpawnAgentTool()
// It is NOT added to BUILTIN_TOOLS to avoid circular dependencies.
export { spawnAgentTool, createSpawnAgentTool } from './spawn-agent';
export type { SpawnAgentDeps, SpawnAgentInput } from './spawn-agent';

export const BUILTIN_TOOLS = [readFileTool, writeFileTool, bashTool, editTool, globTool, grepTool];

type ToolExecutor = (
  toolUseId: string,
  input: Record<string, unknown>,
) => Promise<ToolResult>;

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  Read: executeReadFile,
  Write: executeWriteFile,
  Bash: executeBash,
  Edit: executeEdit,
  Glob: executeGlob,
  Grep: executeGrep,
};

export function getToolExecutor(name: string): ToolExecutor | undefined {
  return TOOL_EXECUTORS[name];
}

export function registerToolExecutor(name: string, executor: ToolExecutor): void {
  TOOL_EXECUTORS[name] = executor;
}
