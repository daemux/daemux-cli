# Universal Autonomous Agent Platform - Architecture Suggestion

## Executive Summary

A **minimal but scalable** architecture for a universal agent platform.

**Key insight:** 80% of functionality comes from 20% of the code if you design the core correctly.

**Your Platform Philosophy:**
- Tiny Core + Everything as Plugins
- Core contains: Agentic Loop + Plugin Loader + Event Bus + Agent Registry + Task Manager
- Plugins provide: MCPs, Channels, Memory, Knowledge

---

## Tech Stack

### TypeScript + Bun

**Why Bun:** All-in-one runtime with bundler, test runner, SQLite built-in. No separate tooling needed. Fast startup (~25ms), native TypeScript support, npm compatible.

### Final Tech Stack

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FINAL TECH STACK (2026)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  LANGUAGE                                                                    │
│  └── TypeScript 5.9 (strict mode, ESM-only)                                 │
│                                                                              │
│  RUNTIME                                                                     │
│  └── Bun 1.3+ (primary)                                                     │
│      └── Node.js 24 LTS (fallback for compatibility)                        │
│                                                                              │
│  BUILD & TOOLING (built into Bun)                                           │
│  ├── bun build       Bundler (replaces tsdown/esbuild)                      │
│  ├── bun test        Test runner (replaces Vitest)                          │
│  ├── bun install     Package manager (replaces npm/pnpm)                    │
│  └── oxlint          Linting (Rust-based, fast)                             │
│                                                                              │
│  CORE DEPENDENCIES                                                           │
│  ├── @anthropic-ai/sdk     Claude API                                       │
│  ├── zod                   Validation + types                               │
│  ├── commander             CLI parsing                                      │
│  └── sqlite-vec            Vector search extension                          │
│      └── bun:sqlite        Built-in SQLite (no better-sqlite3)              │
│                                                                              │
│  DISTRIBUTION                                                                │
│  ├── npm package           Primary distribution                             │
│  └── bun compile           Single executable (optional)                     │
│                                                                              │
│  CROSS-PLATFORM DAEMON                                                       │
│  ├── Linux: systemd user service                                            │
│  ├── macOS: launchd LaunchAgent                                             │
│  └── Windows: Windows Service / NSSM                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Version Summary

| Component | Version | Notes |
|-----------|---------|-------|
| TypeScript | 5.9 | Stable (7.0 native preview available) |
| Bun | 1.3+ | Current: 1.3.7 |
| Node.js | 24 LTS | Fallback only |
| @anthropic-ai/sdk | latest | Claude API |
| zod | 3.x | Schema validation |
| commander | 12.x | CLI |
| sqlite-vec | latest | Vector search |
| oxlint | latest | Linting |

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        UNIVERSAL AGENT PLATFORM                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                         PLUGIN LAYER                                    ││
│  │                                                                         ││
│  │  ┌─────────────────────────────────────────────────────────────────┐   ││
│  │  │                    PLUGIN STRUCTURE                              │   ││
│  │  │  Each plugin can contain: agents/, commands/, hooks/, .mcp.json │   ││
│  │  └─────────────────────────────────────────────────────────────────┘   ││
│  │                                                                         ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   ││
│  │  │  Channels   │  │    MCPs     │  │   Memory    │  │   Agents    │   ││
│  │  │  (plugins)  │  │  (plugins)  │  │  (plugin)   │  │  (plugins)  │   ││
│  │  │             │  │             │  │             │  │             │   ││
│  │  │ - Telegram  │  │ - GitHub    │  │ - Vector DB │  │ - Reviewer  │   ││
│  │  │ - Slack     │  │ - Jira      │  │ - Sessions  │  │ - Architect │   ││
│  │  │ - Discord   │  │ - Calendar  │  │ - Compactor │  │ - Tester    │   ││
│  │  │ - Email     │  │ - Database  │  │ - Search    │  │ - Explorer  │   ││
│  │  │ - Voice     │  │ - Custom    │  │             │  │ - Custom    │   ││
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   ││
│  │         │                │                │                │          ││
│  │  ┌──────┴────────────────┴────────────────┴────────────────┴───────┐  ││
│  │  │                    KNOWLEDGE (auto-loaded)                       │  ││
│  │  │  AGENT.md (project) | ~/.agent/rules/ (global) | plugin rules   │  ││
│  │  └─────────────────────────────────────────────────────────────────┘  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                     │                                       │
│  ┌──────────────────────────────────┼──────────────────────────────────────┐│
│  │                         TINY CORE                                      ││
│  │                                  │                                      ││
│  │    ┌─────────────────────────────┴─────────────────────────────┐       ││
│  │    │              UNIFIED PLUGIN API (~25 methods)             │       ││
│  │    │  registerChannel | registerMCP | registerAgent            │       ││
│  │    │  registerMemory  | spawnSubagent | on(event)              │       ││
│  │    │  createTask | updateTask | searchMemory | log             │       ││
│  │    └─────────────────────────────┬─────────────────────────────┘       ││
│  │                                  │                                      ││
│  │    ┌─────────────┐    ┌──────────┴──────────┐    ┌─────────────┐       ││
│  │    │ Event Bus   │◄───┤   AGENTIC LOOP      ├───►│ Task Manager│       ││
│  │    │ (pub/sub)   │    │  (main orchestrator)│    │ (workflow)  │       ││
│  │    └─────────────┘    │                     │    └─────────────┘       ││
│  │                       │ 1. Receive message  │                          ││
│  │    ┌─────────────┐    │ 2. Check/compact    │    ┌─────────────┐       ││
│  │    │ Agent       │◄───┤ 3. Build context    ├───►│ Debug       │       ││
│  │    │ Registry    │    │ 4. Call LLM         │    │ Logger      │       ││
│  │    └─────────────┘    │ 5. Execute/spawn    │    └─────────────┘       ││
│  │                       │ 6. Loop until done  │                          ││
│  │    ┌─────────────┐    └─────────────────────┘    ┌─────────────┐       ││
│  │    │ Message     │                               │ Plugin      │       ││
│  │    │ Queue       │                               │ Loader      │       ││
│  │    └─────────────┘                               └─────────────┘       ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    PER-AGENT STORAGE (SQLite)                          │ │
│  │  state.db: sessions | tasks | entities | audit | sqlite-vec: vectors  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Architecture Insight:** ALL agents are defined INSIDE plugins (like Claude Code), not in core. Each plugin can contain `agents/` directory with agent definitions that are auto-discovered. Core only provides the Agent Registry for loading/spawning - all agent definitions live in plugins.

---

## Core Design Principles

### 1. Tiny Core, Fat Plugins

Core should be minimal with ONLY:
- Agentic loop (message → LLM → tools/spawn → loop)
- Agent registry and spawning
- Task manager for workflow tracking
- Plugin loader and API
- Event bus for communication
- Config and state management

**Everything else is a plugin:**
- Channels (Telegram, Slack, Email) → Channel plugins
- MCPs (GitHub, Jira, Calendar, databases) → MCP plugins (unified tools)
- Memory (vector search, sessions, compaction) → Memory plugins
- Knowledge (AGENT.md, rules, patterns) → Markdown files
- Even the LLM provider → Provider plugin

### 2. Simple Plugin Interface

Plugin API should have ~25 methods:
- Registration: registerChannel, registerMCP, registerAgent, registerMemory, registerProvider
- Agent operations: spawnSubagent, listAgents, getAgent
- Task operations: createTask, updateTask, listTasks, getTask
- Lifecycle hooks: 7 events (message, agent:start, agent:end, subagent:spawn, startup, shutdown, preCompact)
- Utilities: sendMessage, searchMemory, getState, setState

### 3. Minimal Channel Interface

Just 4 methods per channel:
- connect(config) - Start the channel connection
- disconnect() - Stop the channel
- send(target, message) - Send outbound message
- onMessage(handler) - Receive inbound messages

### 4. MCPs = Unified External Tools

All external tool integrations use Model Context Protocol:
- Standard protocol: connect, listTools, callTool, listResources, readResource
- Supports: stdio (local), SSE (cloud), HTTP (REST), WebSocket (realtime)
- Replaces custom skill implementations - use existing MCP servers

### 5. Knowledge = Guidance Files

Domain knowledge bundled as simple markdown (not tool implementations):
- `AGENT.md` - Auto-loaded project context (like CLAUDE.md)
- `~/.agent/rules/` - Global patterns and guidelines
- `.agent/rules/` - Project-specific rules
- Loaded into agent context, separate from tools

---

## Database Architecture (1 Agent = 1 Instance)

Since each agent runs as a **separate isolated instance** (own machine/Docker), the architecture is simple:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     1000 AGENTS = 1000 ISOLATED INSTANCES                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐       ┌─────────────────┐        │
│  │   Machine/VM 1  │  │   Machine/VM 2  │  ...  │  Machine/VM N   │        │
│  │                 │  │                 │       │                 │        │
│  │  ┌───────────┐  │  │  ┌───────────┐  │       │  ┌───────────┐  │        │
│  │  │  Agent 1  │  │  │  │  Agent 2  │  │       │  │  Agent N  │  │        │
│  │  │           │  │  │  │           │  │       │  │           │  │        │
│  │  │ - SQLite  │  │  │  │ - SQLite  │  │       │  │ - SQLite  │  │        │
│  │  │ - Plugins │  │  │  │ - Plugins │  │       │  │ - Plugins │  │        │
│  │  │ - Config  │  │  │  │ - Config  │  │       │  │ - Config  │  │        │
│  │  └───────────┘  │  │  └───────────┘  │       │  └───────────┘  │        │
│  └─────────────────┘  └─────────────────┘       └─────────────────┘        │
│                                                                              │
│                          OPTIONAL: Central Registry                          │
│                    (for monitoring, config distribution)                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### SQLite Per Agent

Each agent has its own directory with:
- config file (agent configuration)
- state.db (SQLite database for sessions, messages, tasks, memory, state, audit)
- plugins/ directory (installed channel, skill, MCP plugins)
- data/ directory (working files, downloads)

### Why SQLite is Enough

| Concern | Solution |
|---------|----------|
| **Concurrency** | Single agent = single writer, no contention |
| **Performance** | SQLite handles 100K+ messages easily |
| **Vectors** | sqlite-vec extension for embeddings |
| **Backup** | Just copy the .db file |
| **Portability** | Move agent = copy directory |
| **No dependencies** | No PostgreSQL/Redis to manage |

---

## Agentic Loop - THE MOST IMPORTANT PART

The key insight:

**Loop until `stop_reason !== "tool_use"`**

```
┌─────────────────────────────────────────────────────────────────┐
│                     AGENTIC LOOP FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   User Message                                                  │
│        │                                                        │
│        ▼                                                        │
│   ┌─────────────────────┐                                       │
│   │ Call Claude API     │◄──────────────────────┐              │
│   │ with tools          │                       │              │
│   └──────────┬──────────┘                       │              │
│              │                                   │              │
│              ▼                                   │              │
│   ┌─────────────────────┐                       │              │
│   │ Check stop_reason   │                       │              │
│   └──────────┬──────────┘                       │              │
│              │                                   │              │
│       ┌──────┴──────┐                           │              │
│       │             │                           │              │
│       ▼             ▼                           │              │
│   "tool_use"    "end_turn"                      │              │
│       │             │                           │              │
│       ▼             ▼                           │              │
│   ┌─────────┐   ┌─────────┐                    │              │
│   │ Execute │   │  DONE   │                    │              │
│   │ Tools   │   │ Return  │                    │              │
│   └────┬────┘   └─────────┘                    │              │
│        │                                        │              │
│        ▼                                        │              │
│   ┌─────────────────────┐                      │              │
│   │ Add tool results    │                      │              │
│   │ to messages         │──────────────────────┘              │
│   └─────────────────────┘                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Loop until done** - Keep calling API until `stop_reason !== "tool_use"`
2. **Execute ALL tools** - Claude may call multiple tools at once, execute them all
3. **Preserve message structure** - Tool results use `tool_use_id` to match calls
4. **Handle errors gracefully** - Return error message as tool result, let Claude decide
5. **Stream for UX** - Use streaming API for real-time feedback
6. **No limits on iterations** - Let Claude work until it's done (add timeout for safety)

### Error Recovery & Resilience

**Philosophy: Fail-Open with Logging**
Operations never fail completely. Errors are logged, users informed, system proceeds.

#### Transcript Corruption Detection
- Every message stores `parent_uuid` pointing to previous message
- Before each LLM call, validate chain integrity
- If cycle detected (UUID appears twice) → truncate at last valid message
- Log corruption event, continue with truncated context

#### Token Limit Safeguards
- Reserve space for max output tokens: `effective_context = max_tokens - reserved_output`
- Pre-check before LLM call: if usage > 98% effective → block new messages
- Auto-compact triggers at 80% (leaves buffer for compaction itself)

#### Orphaned Process Cleanup
- Track OS process ID (PID) in subagent registry
- Background check every 60 seconds for:
  - Running subagents past timeout → SIGTERM, then SIGKILL after 10s
  - Zombie processes (registered but PID gone) → mark orphaned, cleanup
- Log all termination events with reason

#### Hook Failure Handling
- Hooks run in subprocess with 10-minute timeout
- Exit codes: 0 = success, 1 = warning to user, 2 = error to Claude
- Timeout (124) treated as exit 1
- **Never-block principle**: hook failure never stops agent work

#### Rate Limit Handling
- Show warning at 70% usage (not error)
- Implement exponential backoff: 2s → 4s → 8s → 16s → 30s max
- Auto-refresh OAuth tokens 5 minutes before expiry

#### Failure Modes Matrix

| Failure | Detection | Recovery | Outcome |
|---------|-----------|----------|---------|
| Transcript cycle | UUID chain validation | Truncate + resume | Continue with truncated history |
| Token overflow | Effective window tracking | Auto-compact at 80% | Free up context space |
| Subagent timeout | Registry scan every 60s | SIGKILL after SIGTERM | Mark failed, cleanup |
| Hook crash | Subprocess timeout/exit | Log, continue always | Never blocks loop |
| Rate limited | HTTP 429 | Exponential backoff | Retry with delay |
| DB corruption | Integrity check on startup | Restore from backup | Emit alert, resume |

### Critical Implementation Details (Often Missed)

**Context Window Management:**
- Use **effective context window** = full window - reserved space for max output tokens
- Auto-compact conversation at ~80% usage (gives room to complete compaction)
- Block at ~98% usage (prevent "too long" errors)
- Large outputs (PDFs, tool results) saved to disk with file reference instead of inline
- Remove phantom "(no content)" blocks that waste tokens

**Parallel Tool Calls:**
- Claude may request multiple tools in one response
- Execute ALL tools, collect ALL results
- **Critical:** Match each `tool_result` to its `tool_use_id` exactly
- Orphaned tool_result blocks cause API 400 errors in long sessions

**Error Handling:**
- Tool errors → return error string as tool result, let Claude retry/adapt
- Hook errors → always exit 0, never block (log error as systemMessage)
- Rate limits → show warning at 70% usage, implement exponential backoff
- Token refresh → auto-refresh OAuth tokens on expiration

**Timeouts:**
- Hook execution: 10 minutes (not 60 seconds)
- Bash commands: configurable, show elapsed time
- Overall turn: add safety timeout (e.g., 30 minutes)

**State Persistence:**
- Save conversation to JSONL after each turn
- Session can be resumed from transcript
- Detect corrupted transcripts (parentUuid cycles)

### Hook System (Polyglot - Python/Shell/Any)

Claude Code's hooks can be written in **any language** (Python, Shell, Node, etc.):

**Hook Execution Model:**
- Hook receives JSON via stdin
- Hook returns JSON via stdout
- Exit codes control behavior:
  - Exit 0: Allow operation
  - Exit 1: Show stderr to user (not to Claude)
  - Exit 2: Block operation, show stderr to Claude

**Hook Events:**
| Event | When | Can Return |
|-------|------|------------|
| PreToolUse | Before tool executes | allow/deny/ask, additionalContext |
| PostToolUse | After tool completes | logging, feedback |
| PreCompact | Before memory compaction | inject critical context to preserve |
| SubagentSpawn | Before subagent spawns | modify input, deny spawn |
| UserPromptSubmit | User sends message | validate, inject context |
| Stop | Agent tries to exit | verify completion |
| SessionStart | Session begins | load config |
| SessionEnd | Session ends | cleanup |

**Why Polyglot Hooks Matter:**
- Python hooks for complex validation logic
- Shell hooks for simple checks (fast, no runtime)
- Any executable works (Go, Rust binaries, etc.)
- Plugins can include Python/Shell without TypeScript

### Logging & Debugging System

Comprehensive logging for debugging and monitoring:

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEBUG LOGGING SYSTEM                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Log Directory: ~/.agent/debug-logs/                           │
│   Latest Log:    ~/.agent/debug-logs/latest (symlink)           │
│                                                                  │
│   Enable via:                                                    │
│   - CLI flag:     agent --debug                                 │
│   - MCP-specific: agent --mcp-debug                             │
│   - API logging:  ANTHROPIC_LOG=debug agent                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**What Gets Logged:**

| Category | Details |
|----------|---------|
| **API Calls** | Requests, responses, timing (when ANTHROPIC_LOG=debug) |
| **Tool Execution** | Tool calls, results, failures, denials |
| **Hook Events** | PreToolUse/PostToolUse invocations, decisions |
| **MCP Activity** | Server startup, tool discovery, protocol messages |
| **Subagent Spawns** | Agent launches, input, output, metrics |
| **Sessions** | Start, end, compaction events |
| **Errors** | Stack traces, context, recovery attempts |

**Log Management:**
- `cleanupPeriodDays` setting controls retention (default: 7 days)
- Sensitive data (tokens, passwords, API keys) automatically sanitized
- Session-specific log files with `latest` symlink for monitoring
- Real-time monitoring: `tail -f ~/.agent/debug-logs/latest`

**Audit Logging (separate from debug):**
- Stored in SQLite `audit` table for compliance
- Records: timestamp, user, tool, action, result
- Queryable history of all agent actions
- Can be extended via PostToolUse hooks for custom destinations

---

## Autonomous Agent Features

For **fully autonomous** operation without human-in-the-loop, these features are essential:

### Approval Queue (Hybrid: Promise + DB Checkpoint)

**Architecture**: Promise-based waiting with database checkpoint for restart recovery.

#### Flow
1. Agent requests approval → creates DB record + Promise
2. Returns `status: "approval-pending"` immediately to LLM
3. Waits async in background (120s timeout)
4. Human approves via any interface → resolves Promise
5. DB updated with decision for audit

#### Storage Schema
```sql
CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  context TEXT,                    -- JSON: why, agent_id, task_id
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  decision TEXT,                   -- 'allow-once' | 'allow-always' | 'deny' | NULL
  decided_at_ms INTEGER,
  decided_by TEXT
);
```

#### Implementation Pattern
```typescript
class ApprovalManager {
  private pending = new Map<string, { resolve, timeout }>();

  async requestApproval(cmd: string): Promise<Decision | null> {
    const id = uuid();

    // DB checkpoint (survives restart)
    await db.approvals.insert({ id, cmd, createdAt: now(), expiresAt: now() + 120_000 });

    // Promise-based wait
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);  // Timeout → null
      }, 120_000);
      this.pending.set(id, { resolve, timeout: timer });
    });
  }

  resolveApproval(id: string, decision: Decision) {
    const entry = this.pending.get(id);
    if (entry) {
      clearTimeout(entry.timeout);
      entry.resolve(decision);
      this.pending.delete(id);
    }
    db.approvals.update({ id }, { decision, decidedAt: now() });
  }

  // Recovery on startup
  async recoverPending() {
    const stale = await db.approvals.find({ decision: null, expiresAt: { $lt: now() } });
    for (const row of stale) {
      await db.approvals.update({ id: row.id }, { decision: 'timeout' });
    }
  }
}
```

#### Timeout Handling
- Default timeout: 120 seconds
- On timeout: decision = null → configurable fallback:
  - `deny` (default, safe)
  - `allow-once` (for low-risk operations)
  - `defer-to-allowlist` (check patterns)

#### Interfaces (all write to same DB)
- **CLI**: `agent approve <id> --allow|--deny`
- **Web UI**: Buttons (Allow once / Always allow / Deny)
- **API**: POST /approvals/{id}/decision
- **Channel DM**: Action buttons in notification

#### Queue Display
- Show countdown timer (time remaining)
- Show queue count if multiple pending
- FIFO processing order

### Heartbeat System (Autonomous Self-Check)

Agent periodically checks its own state and plans next actions:

```
┌─────────────────────────────────────────────────────────────────┐
│                    HEARTBEAT PATTERN                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Every N minutes (configurable, default 30m):                  │
│        │                                                         │
│        ▼                                                         │
│   ┌─────────────────────┐                                       │
│   │ Read HEARTBEAT.md   │  (agent's persistent todo/goals)      │
│   │ from agent root     │                                       │
│   └──────────┬──────────┘                                       │
│              │                                                   │
│              ▼                                                   │
│   ┌─────────────────────┐                                       │
│   │ Check pending tasks │  (scheduled, waiting, stalled)        │
│   │ in task queue       │                                       │
│   └──────────┬──────────┘                                       │
│              │                                                   │
│              ▼                                                   │
│   ┌─────────────────────┐                                       │
│   │ Call LLM to decide  │  "What should I do next?"             │
│   │ next autonomous     │  Considers: goals, tasks, time        │
│   │ action              │                                       │
│   └──────────┬──────────┘                                       │
│              │                                                   │
│              ▼                                                   │
│   Agent executes decided action (or sleeps until next event)    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**HEARTBEAT.md Contents:**
- Long-term goals (agent's purpose)
- Active projects and their status
- Recurring tasks (daily standup, weekly report)
- Self-notes from previous sessions

### Cron Service (Scheduled Tasks)

For agents that need to act on schedules:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SCHEDULE TYPES                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  at:    "at 2024-12-25 09:00"     (one-time, specific datetime) │
│  every: "every 30m"               (recurring interval)          │
│  cron:  "cron 0 9 * * MON"        (standard cron expression)    │
│                                                                  │
│  All times support timezone: "at 09:00 America/New_York"        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation:**
- Store schedules in SQLite with next_run timestamp
- On startup, calculate next_run for all schedules
- Background loop checks for due schedules every minute
- Execute scheduled task via normal agentic loop

### Memory Compaction (Token-Aware)

When conversation approaches context limit, auto-summarize:

```
┌─────────────────────────────────────────────────────────────────┐
│                    MEMORY COMPACTION                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Before each LLM call, check token usage:                      │
│        │                                                         │
│        ▼                                                         │
│   ┌─────────────────────┐                                       │
│   │ current_tokens >    │  (threshold ~80% of effective window) │
│   │ compaction_threshold│                                       │
│   └──────────┬──────────┘                                       │
│              │ Yes                                               │
│              ▼                                                   │
│   ┌─────────────────────┐                                       │
│   │ Call LLM to         │  "Summarize this conversation while   │
│   │ summarize history   │   preserving key facts and context"   │
│   └──────────┬──────────┘                                       │
│              │                                                   │
│              ▼                                                   │
│   ┌─────────────────────┐                                       │
│   │ Replace messages    │  Keep: system prompt, summary, recent │
│   │ with summary        │  Store: full history to JSONL backup  │
│   └──────────┬──────────┘                                       │
│              │                                                   │
│              ▼                                                   │
│   Session continues with fresh context space                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Details:**
- Track compaction_count in session metadata
- Store compaction summaries in semantic memory (searchable)
- Preserve critical context: user identity, project context, active tasks
- Full transcript always saved to JSONL (can reconstruct if needed)

### Task Manager (Workflow Tracking)

For multi-step workflows, track progress with structured tasks:

```
┌─────────────────────────────────────────────────────────────────┐
│                    TASK MANAGEMENT                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Task Lifecycle:                                               │
│                                                                  │
│   pending ──────► in_progress ──────► completed                 │
│      │                                    │                     │
│      └──────────────────────────────────► deleted               │
│                                                                  │
│   Dependencies:                                                  │
│                                                                  │
│   Task A ──blocks──► Task B                                     │
│   Task B ──blockedBy──► Task A                                  │
│                                                                  │
│   Task B cannot start until Task A completes                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Task Fields:**
- id, subject, description, active_form (UI spinner text)
- status: pending | in_progress | completed
- owner: agent name working on it
- blocked_by, blocks: arrays of task IDs for dependencies
- metadata: custom JSON data
- timestamps: created_at, updated_at

**When to Use Tasks:**
- Multi-step workflows (3+ steps)
- Agent handoffs (architect → developer → reviewer)
- Parallel work coordination
- Progress visibility for users
- Resumability after crashes

### Subagent Registry (Multi-Agent Coordination)

Track spawned subagents globally to prevent orphans:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SUBAGENT REGISTRY                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Main Agent                                                     │
│        │                                                         │
│        ├──► Spawn Subagent A (task: research)                   │
│        │         │                                               │
│        │         └──► Register in SQLite:                       │
│        │               - agent_id, parent_id                    │
│        │               - task description                       │
│        │               - spawn_time, status                     │
│        │               - timeout (auto-cleanup)                 │
│        │                                                         │
│        ├──► Spawn Subagent B (task: code review)                │
│        │         └──► Register...                               │
│        │                                                         │
│        └──► Periodically check registry:                        │
│              - Collect completed results                         │
│              - Kill timed-out subagents                         │
│              - Clean up orphaned processes                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Lifecycle:**
1. Parent spawns subagent → registers in DB
2. Subagent runs → updates status periodically
3. Subagent completes → marks done, stores result
4. Parent collects result → marks collected
5. Cleanup job removes old entries

### Agent Definition Format

Subagents are defined as markdown files with YAML frontmatter, **located inside plugins**:

```
~/.agent/plugins/my-plugin/agents/    # User plugin agents
./.agent/plugins/my-plugin/agents/    # Project plugin agents
plugins/feature-dev/agents/            # Bundled plugin agents
```

**All agents live in plugins**, including default ones like Explorer. The `core-agents` plugin ships with the platform and provides common agents. This follows Claude Code's pattern where `plugins/*/agents/*.md` are auto-discovered.

**Agent Definition Structure (YAML frontmatter + markdown body):**

| Field | Required | Values | Description |
|-------|----------|--------|-------------|
| name | Yes | lowercase-hyphens | Agent identifier (3-50 chars) |
| description | Yes | string | Triggering conditions with examples |
| model | No | inherit/sonnet/opus/haiku | LLM model to use |
| tools | No | array | Allowed tools (empty = all) |
| color | Yes | blue/cyan/green/yellow/red | Visual identifier |

**Body Content:** System prompt defining agent's role, responsibilities, process steps, and output format.

**Agent Result:** Returns agentId, output, tokensUsed, toolUses, durationMs for metrics.

### Queue Modes (Concurrent Message Handling)

How agent handles multiple incoming messages:

```
┌─────────────────────────────────────────────────────────────────┐
│                    QUEUE MODES                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  STEER (default):                                               │
│    New message adds context to current session                  │
│    Agent sees it as additional user input mid-turn              │
│    Use for: collaborative work, course correction               │
│                                                                  │
│  INTERRUPT:                                                      │
│    New message stops current task, starts new one               │
│    Previous task is suspended (can resume later)                │
│    Use for: urgent requests, priority shifts                    │
│                                                                  │
│  QUEUE:                                                          │
│    New messages wait in queue until current task done           │
│    Process FIFO after completion                                │
│    Use for: batch processing, support tickets                   │
│                                                                  │
│  COLLECT:                                                        │
│    Collect messages for N seconds, then process as batch        │
│    Useful for: aggregating related messages, reducing API calls │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Human-Like Behavior Patterns

For agents interacting via messaging channels:

**Typing Indicators:**
- Show "typing..." before responding
- Duration proportional to response length
- Adds perceived thoughtfulness

**Response Timing:**
- Don't respond instantly (feels robotic)
- Add small random delay (1-3 seconds)
- Longer delay for complex responses

**Message Chunking:**
- Break long responses into multiple messages
- Pause between chunks (feels like natural typing)
- Respect channel message length limits

**Presence Management:**
- Show online/away status appropriately
- "Away" during long background tasks
- "Online" when actively monitoring

### Session State Store (Rich Metadata)

Track session state beyond just messages:

```
Session State Fields:
├── session_id           (unique identifier)
├── created_at           (start time)
├── last_activity        (for timeout detection)
├── compaction_count     (how many times summarized)
├── total_tokens_used    (lifetime API usage)
├── queue_mode           (steer/interrupt/queue)
├── thinking_level       (low/medium/high for extended thinking)
├── active_channel       (which channel initiated)
├── user_context         (cached user preferences)
├── current_task_id      (what's being worked on)
└── flags                (JSON blob for custom state)
```

### Channel Adapter Pattern (Multi-Channel Outbound)

Unified interface for sending to any channel:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHANNEL ADAPTER                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Agent wants to send message                                   │
│        │                                                         │
│        ▼                                                         │
│   ┌─────────────────────┐                                       │
│   │ Delivery Pipeline   │                                       │
│   │                     │                                       │
│   │ 1. Format message   │  (markdown → channel-specific)        │
│   │ 2. Split if needed  │  (respect length limits)              │
│   │ 3. Route to channel │  (based on target config)             │
│   └──────────┬──────────┘                                       │
│              │                                                   │
│       ┌──────┴──────┬──────────┬──────────┐                    │
│       ▼             ▼          ▼          ▼                    │
│   ┌───────┐    ┌───────┐  ┌───────┐  ┌───────┐               │
│   │Telegram│   │ Slack │  │Discord│  │ Email │               │
│   └───────┘    └───────┘  └───────┘  └───────┘               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Features:**
- Message formatting per channel (markdown variants)
- Attachment handling (inline vs file upload)
- Reply threading (if channel supports)

---

## Directory Structure

Separation of **installed package** (stateless) from **user data** (persistent):

### Installed Package (Read-Only, Shared)
```
/usr/local/bin/agent           # Binary/executable (or npm global)
/usr/local/lib/agent/          # Core package files
├── dist/                      # Compiled TypeScript
├── node_modules/              # Dependencies
└── package.json               # Package manifest
```

### User Home Directory (~/.agent/)
```
~/.agent/                       # Global user configuration
├── settings.json              # Global settings (permissions, defaults)
├── credentials/               # API tokens, OAuth, secrets (chmod 600)
│   ├── anthropic.json
│   ├── providers/
│   └── channels/
├── sessions/                  # Conversation history (JSONL files)
│   ├── session-abc123.jsonl
│   └── index.json            # Lightweight session index
├── debug-logs/                # Debug logging output
│   ├── session-abc123.log
│   └── latest                # Symlink to current session log
├── rules/                     # Global knowledge/patterns
│   └── my-patterns.md
├── commands/                  # User custom commands
│   └── my-command.md
├── hooks/                     # User hooks (Python/Shell/any)
│   ├── hooks.json
│   └── my-hook.py
├── plugins/                   # Installed plugins (with agents inside)
│   └── my-plugin/
│       ├── .claude-plugin/plugin.json
│       ├── agents/           # Agent definitions for this plugin
│       │   └── reviewer.md
│       ├── commands/
│       └── .mcp.json
└── shell-snapshots/           # Bash environment state
```

### Project Directory (./.agent/)
```
./.agent/                       # Project-specific (in project root)
├── AGENT.md                   # Auto-loaded project context (like CLAUDE.md)
├── settings.json              # Project settings (git-tracked)
├── settings.local.json        # User local overrides (git-ignored)
├── rules/                     # Context rules and knowledge
│   └── coding-standards.md
├── commands/                  # Project commands
├── hooks/                     # Project hooks
│   ├── hooks.json
│   └── validate-bash.sh      # Can be Shell/Python/any
├── plugins/                   # Project-specific plugins (with agents inside)
│   └── project-tools/
│       ├── .claude-plugin/plugin.json
│       ├── agents/           # Project-specific agents
│       │   └── project-reviewer.md
│       └── commands/
└── plugin-name.local.md       # Per-plugin config (git-ignored)
```

### Source Code Structure
```
agent-platform/                 # Development repository
├── src/
│   ├── core/                  # TINY CORE
│   │   ├── loop.ts            # Agentic loop (orchestrator)
│   │   ├── agent-registry.ts  # Agent loading + spawning
│   │   ├── task-manager.ts    # Workflow task tracking
│   │   ├── plugin-api.ts      # Plugin interface
│   │   ├── plugin-loader.ts   # Dynamic loading
│   │   ├── event-bus.ts       # Pub/sub
│   │   ├── config.ts          # Configuration
│   │   └── state.ts           # State management
│   │
│   ├── infra/                 # Infrastructure
│   │   ├── database.ts        # SQLite abstraction
│   │   ├── message-queue.ts   # Message queuing (steer/interrupt/queue)
│   │   ├── logger.ts          # Debug logging system
│   │   └── service.ts         # Daemon management
│   │
│   └── cli/                   # CLI commands
│
├── plugins/                   # Bundled plugins
│   └── core-agents/           # Default agents (shipped as plugin)
│       ├── .claude-plugin/plugin.json
│       └── agents/
│           └── explorer.md    # Default exploration agent
└── package.json
```

### Settings Priority (Highest to Lowest)
1. Enterprise settings (managed, organization-level)
2. User global settings (`~/.agent/settings.json`)
3. Project settings (`./.agent/settings.json`)
4. Command-level restrictions (frontmatter)
5. Hook validation (runtime)

### Git Ignore Pattern for Projects
```gitignore
.agent/*.local.json
.agent/*.local.md
.agent/credentials/
```

---

## Cross-Platform Daemon

### Service Management Abstraction

Create a unified ServiceManager interface with platform implementations:
- **Linux:** systemd user service (systemctl --user)
- **macOS:** launchd LaunchAgent (plist file)
- **Windows:** Windows Service via node-windows or NSSM

### Health Monitoring

Each agent daemon should:
- Self-monitor (memory, CPU, connection status)
- Heartbeat to optional control plane
- Auto-restart on failure
- Graceful shutdown handling

---

## Implementation Roadmap

### Phase 1: Core Foundation
- Agentic loop with tool execution
- **Task Manager**: Create, update, list with dependencies
- Plugin loader (dynamic import)
- Event bus (pub/sub)
- SQLite state backend with tasks table
- Session state store with rich metadata
- CLI: start/stop/config/status

### Phase 2: Agent System
- **Agent Registry**: Load definitions from markdown files
- **Subagent Spawning**: Launch isolated agents with tool restrictions
- Agent definition parser (YAML frontmatter + markdown body)
- Model configuration per agent (inherit/sonnet/opus/haiku)
- Tool access restrictions per agent

### Phase 3: Essential Plugins
- Anthropic provider plugin
- MCP protocol support (stdio, SSE, HTTP, WebSocket)
- Telegram channel plugin (with typing indicators)
- Basic built-in tools (bash, file, http)
- Channel adapter pipeline for multi-channel delivery

### Phase 4: Memory & Autonomy
- Memory compaction with token awareness (auto at 80%)
- JSONL transcript backup and recovery
- Queue modes (steer/interrupt/queue/collect)
- Approval queue for non-blocking human decisions
- sqlite-vec for semantic memory/search

### Phase 5: Production Ready
- Cross-platform daemon (systemd/launchd/Windows)
- Heartbeat system with HEARTBEAT.md
- Cron service (at/every/cron schedules)
- Human-like behavior (typing indicators, delays)
- Audit logging and health monitoring

### Phase 6: Advanced & Distribution
- Voice channel plugin
- Central control plane API (optional)
- Docker image & deployment scripts
- npm package distribution
- Documentation & examples

---

## Key Recommendations Summary

1. **Language:** TypeScript + Bun (fast startup, built-in SQLite)
2. **Build:** Bun bundler (replaces tsdown/esbuild)
3. **Distribution:** npm package + Docker image
4. **Database:** SQLite per agent (no shared infra)
5. **Core size:** Minimal, focused
6. **Plugin API:** ~25 methods (added agent + task operations)
7. **Lifecycle hooks:** 7 events (added subagent:spawn, preCompact)
8. **Channels:** Plugin-based, 4 methods each
9. **Daemon:** Platform-specific service managers
10. **Scaling:** Horizontal (more instances, not bigger)
11. **Autonomous:** Approval queue + heartbeat + cron (no blocking on humans)
12. **Context:** Token-aware compaction (80%) + JSONL backup
13. **Multi-agent:** Agent registry + subagent spawning with lifecycle tracking
14. **Task tracking:** Structured tasks with dependencies for workflows
15. **Tools:** MCPs unified (replaced Skills with MCP protocol)
16. **Knowledge:** Markdown files (AGENT.md, rules/) for guidance

---

## Verification Checklist

| Requirement | Solution | Status |
|-------------|----------|--------|
| Cross-platform (Linux/Mac/Windows) | Bun/Node.js + platform service managers | ✓ |
| Installable on any OS | npm package + optional binary | ✓ |
| Agentic logic like Claude Code | Loop until stop_reason !== tool_use | ✓ |
| MCPs support | Standard MCP protocol (stdio/SSE/HTTP/WS) | ✓ |
| Agent definitions | Markdown files with YAML frontmatter | ✓ |
| Subagent spawning | Agent registry + spawn with tool restrictions | ✓ |
| Workflow tracking | Task manager with dependencies | ✓ |
| Knowledge/guidance | AGENT.md + rules/ (replaced Skills) | ✓ |
| Minimal core | Minimal, focused | ✓ |
| Full capabilities | Plugin-based coverage | ✓ |
| Fully autonomous | Approval queue + heartbeat + cron | ✓ |
| 1000+ instances | 1 agent = 1 VM/Docker | ✓ |
| Channels as plugins | ChannelPlugin interface | ✓ |
| Clean core | Everything external | ✓ |
| Database per agent | SQLite + sqlite-vec | ✓ |
| Non-blocking human decisions | Approval queue pattern | ✓ |
| Scheduled tasks | Cron service (at/every/cron) | ✓ |
| Self-planning | Heartbeat + HEARTBEAT.md | ✓ |
| Context management | Token-aware compaction (80%) | ✓ |
| Multi-agent coordination | Agent registry + subagent lifecycle | ✓ |
| Concurrent messages | Queue modes (steer/interrupt/queue) | ✓ |
| Human-like behavior | Typing indicators, delays | ✓ |
| Multi-channel delivery | Channel adapter pipeline | ✓ |

---

## Next Steps

1. **Validate architecture** - Review and refine
2. **Set up project** - TypeScript, tsdown, Vitest
3. **Build agentic loop** - The core 200 lines
4. **Add plugin loader** - Dynamic import system
5. **Create first plugin** - Anthropic provider
6. **Test end-to-end** - Simple CLI agent
7. **Add channels** - Telegram, then Slack
8. **Production-ize** - Daemon, health checks, logging

This architecture provides **full agentic capabilities** with **multi-channel support** in a **minimal, maintainable codebase**.
