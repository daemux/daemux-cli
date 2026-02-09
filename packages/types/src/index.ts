/**
 * Core Type Definitions for Universal Autonomous Agent Platform
 * All types use Zod schemas for runtime validation with TypeScript inference
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const ConfigSchema = z.object({
  agentId: z.string().min(1),
  agentName: z.string().optional(),
  dataDir: z.string(),
  /**
   * Model to use for completions.
   * - 'default': Use the provider's default model
   * - Any string: Use the specified model ID (provider-specific)
   *
   * Note: The model string is passed directly to the LLM provider.
   * Common Anthropic models: claude-sonnet-4-20250514, claude-opus-4-20250514, claude-haiku-3-5-20250514
   */
  model: z.string().default('default'),
  compactionThreshold: z.number().min(0.5).max(0.95).default(0.8),
  effectiveContextWindow: z.number().positive().default(180000),
  queueMode: z.enum(['steer', 'interrupt', 'queue', 'collect']).default('steer'),
  collectWindowMs: z.number().positive().default(5000),
  hookTimeoutMs: z.number().positive().default(600000),
  turnTimeoutMs: z.number().positive().default(1800000),
  debug: z.boolean().default(false),
  mcpDebug: z.boolean().default(false),
  heartbeatIntervalMs: z.number().positive().default(1800000),
  heartbeatEnabled: z.boolean().default(false),
  maxConcurrentTasks: z.number().min(1).max(20).default(3),
  workPollingIntervalMs: z.number().positive().default(5000),
  workBudgetMaxTasksPerHour: z.number().positive().default(50),
});

export type Config = z.infer<typeof ConfigSchema>;

// ---------------------------------------------------------------------------
// Messages & Conversation
// ---------------------------------------------------------------------------

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const ContentBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('tool_result'),
    tool_use_id: z.string(),
    content: z.string(),
    is_error: z.boolean().optional(),
  }),
]);

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const MessageSchema = z.object({
  uuid: z.string().uuid(),
  parentUuid: z.string().uuid().nullable(),
  role: MessageRoleSchema,
  content: z.union([z.string(), z.array(ContentBlockSchema)]),
  createdAt: z.number(),
  tokenCount: z.number().optional(),
});

export type Message = z.infer<typeof MessageSchema>;

export const SessionSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.number(),
  lastActivity: z.number(),
  compactionCount: z.number().default(0),
  totalTokensUsed: z.number().default(0),
  queueMode: z.enum(['steer', 'interrupt', 'queue', 'collect']),
  activeChannelId: z.string().optional(),
  currentTaskId: z.string().optional(),
  thinkingLevel: z.enum(['low', 'medium', 'high']).optional(),
  flags: z.record(z.unknown()).default({}),
});

export type Session = z.infer<typeof SessionSchema>;

// ---------------------------------------------------------------------------
// Tools & MCP
// ---------------------------------------------------------------------------

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.unknown()),
    required: z.array(z.string()).optional(),
  }),
  isConcurrencySafe: z.boolean().optional(),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const ToolResultSchema = z.object({
  toolUseId: z.string(),
  content: z.string(),
  isError: z.boolean().optional(),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const TaskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed', 'deleted']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().min(1).max(200),
  description: z.string(),
  activeForm: z.string().optional(),
  status: TaskStatusSchema,
  owner: z.string().optional(),
  blockedBy: z.array(z.string().uuid()).default([]),
  blocks: z.array(z.string().uuid()).default([]),
  metadata: z.record(z.unknown()).default({}),
  timeBudgetMs: z.number().positive().optional(),
  verifyCommand: z.string().optional(),
  failureContext: z.string().optional(),
  retryCount: z.number().default(0),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Task = z.infer<typeof TaskSchema>;

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const AgentDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{2,49}$/),
  description: z.string(),
  model: z.enum(['inherit', 'sonnet', 'opus', 'haiku']).default('inherit'),
  tools: z.array(z.string()).optional(),
  color: z.enum(['blue', 'cyan', 'green', 'yellow', 'red']),
  systemPrompt: z.string(),
  pluginId: z.string(),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export const SubagentStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'timeout',
  'orphaned',
]);

export const SubagentRecordSchema = z.object({
  id: z.string().uuid(),
  agentName: z.string(),
  parentId: z.string().uuid().nullable(),
  taskDescription: z.string(),
  pid: z.number().optional(),
  status: SubagentStatusSchema,
  spawnedAt: z.number(),
  completedAt: z.number().optional(),
  timeoutMs: z.number(),
  result: z.string().optional(),
  tokensUsed: z.number().optional(),
  toolUses: z.number().optional(),
});

export type SubagentRecord = z.infer<typeof SubagentRecordSchema>;

export interface AgentResult {
  agentId: string;
  output: string;
  tokensUsed: number;
  toolUses: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export const ApprovalDecisionSchema = z.enum([
  'allow-once',
  'allow-always',
  'deny',
  'timeout',
]);

export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApprovalRequestSchema = z.object({
  id: z.string().uuid(),
  command: z.string(),
  context: z.record(z.unknown()).optional(),
  createdAtMs: z.number(),
  expiresAtMs: z.number(),
  decision: ApprovalDecisionSchema.nullable(),
  decidedAtMs: z.number().optional(),
  decidedBy: z.string().optional(),
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export const ScheduleTypeSchema = z.enum(['at', 'every', 'cron']);
export type ScheduleType = z.infer<typeof ScheduleTypeSchema>;

export const ScheduleSchema = z.object({
  id: z.string().uuid(),
  type: ScheduleTypeSchema,
  expression: z.string(),
  timezone: z.string().default('UTC'),
  taskTemplate: z.object({
    subject: z.string(),
    description: z.string(),
  }),
  nextRunMs: z.number(),
  lastRunMs: z.number().optional(),
  enabled: z.boolean().default(true),
});

export type Schedule = z.infer<typeof ScheduleSchema>;

// ---------------------------------------------------------------------------
// Memory Entry
// ---------------------------------------------------------------------------

export const MemoryEntrySchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.number(),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

// ---------------------------------------------------------------------------
// Audit Entry
// ---------------------------------------------------------------------------

export const AuditResultSchema = z.enum(['success', 'failure']);

export const AuditEntrySchema = z.object({
  id: z.number().optional(),
  timestamp: z.number(),
  action: z.string(),
  target: z.string().optional(),
  userId: z.string().optional(),
  agentId: z.string().optional(),
  result: AuditResultSchema,
  details: z.record(z.unknown()).optional(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// ---------------------------------------------------------------------------
// Queue Message
// ---------------------------------------------------------------------------

export const QueueModeSchema = z.enum(['steer', 'interrupt', 'queue', 'collect']);
export type QueueMode = z.infer<typeof QueueModeSchema>;

export const QueuedMessageSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  channelId: z.string().optional(),
  senderId: z.string().optional(),
  priority: z.number().default(0),
  queuedAt: z.number(),
  processedAt: z.number().optional(),
  cancelled: z.boolean().default(false),
});

export type QueuedMessage = z.infer<typeof QueuedMessageSchema>;

// ---------------------------------------------------------------------------
// Log Levels
// ---------------------------------------------------------------------------

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;
