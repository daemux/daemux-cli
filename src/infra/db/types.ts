/**
 * Database Row Types (Internal)
 */

export interface SessionRow {
  id: string;
  created_at: number;
  last_activity: number;
  compaction_count: number;
  total_tokens_used: number;
  queue_mode: string;
  active_channel_id: string | null;
  current_task_id: string | null;
  thinking_level: string | null;
  flags: string;
}

export interface MessageRow {
  uuid: string;
  session_id: string;
  parent_uuid: string | null;
  role: string;
  content: string;
  created_at: number;
  token_count: number | null;
}

export interface TaskRow {
  id: string;
  subject: string;
  description: string;
  active_form: string | null;
  status: string;
  owner: string | null;
  blocked_by: string;
  blocks: string;
  metadata: string;
  created_at: number;
  updated_at: number;
}

export interface SubagentRow {
  id: string;
  agent_name: string;
  parent_id: string | null;
  task_description: string;
  pid: number | null;
  status: string;
  spawned_at: number;
  completed_at: number | null;
  timeout_ms: number;
  result: string | null;
  tokens_used: number | null;
  tool_uses: number | null;
}

export interface ApprovalRow {
  id: string;
  command: string;
  context: string | null;
  created_at_ms: number;
  expires_at_ms: number;
  decision: string | null;
  decided_at_ms: number | null;
  decided_by: string | null;
}

export interface ScheduleRow {
  id: string;
  type: string;
  expression: string;
  timezone: string;
  task_template: string;
  next_run_ms: number;
  last_run_ms: number | null;
  enabled: number;
}

export interface MemoryRow {
  id: string;
  content: string;
  metadata: string;
  created_at: number;
}

export interface AuditRow {
  id: number;
  timestamp: number;
  action: string;
  target: string | null;
  user_id: string | null;
  agent_id: string | null;
  result: string;
  details: string | null;
}
