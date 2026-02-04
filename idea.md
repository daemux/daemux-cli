# Universal Autonomous Agent Platform - Architecture Suggestion

## Executive Summary

A **minimal but scalable** architecture for a universal agent platform.

**Key insight:** 80% of functionality comes from 20% of the code if you design the core correctly.

**Your Platform Philosophy:**
- Tiny Core (2-3K LOC) + Everything as Plugins
- Core contains: Agentic Loop + Plugin Loader + Event Bus
- Plugins provide: Skills, MCPs, Channels, Memory, Tools

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
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   ││
│  │  │  Channels   │  │   Skills    │  │    MCPs     │  │   Memory    │   ││
│  │  │             │  │             │  │             │  │             │   ││
│  │  │ - Telegram  │  │ - GitHub    │  │ - Jira      │  │ - Vector DB │   ││
│  │  │ - Slack     │  │ - Email     │  │ - Salesforce│  │ - Knowledge │   ││
│  │  │ - Discord   │  │ - Calendar  │  │ - Notion    │  │ - Sessions  │   ││
│  │  │ - Email     │  │ - CRM       │  │ - Custom    │  │             │   ││
│  │  │ - Voice     │  │             │  │             │  │             │   ││
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   ││
│  └─────────┼────────────────┼────────────────┼────────────────┼───────────┘│
│            └────────────────┴───────┬────────┴────────────────┘            │
│                                     │                                      │
│  ┌──────────────────────────────────┼──────────────────────────────────────┐│
│  │                    TINY CORE (~2-3K LOC)                               ││
│  │                                  │                                      ││
│  │    ┌─────────────────────────────┴─────────────────────────────┐       ││
│  │    │              UNIFIED PLUGIN API (~20 methods)             │       ││
│  │    │  registerChannel | registerSkill | registerMCP            │       ││
│  │    │  registerTool    | registerMemory | on(event)             │       ││
│  │    └─────────────────────────────┬─────────────────────────────┘       ││
│  │                                  │                                      ││
│  │    ┌─────────────┐    ┌──────────┴──────────┐    ┌─────────────┐       ││
│  │    │ Event Bus   │◄───┤   AGENTIC LOOP      ├───►│ Task Queue  │       ││
│  │    │ (pub/sub)   │    │                     │    │ (priority)  │       ││
│  │    └─────────────┘    │ 1. Receive message  │    └─────────────┘       ││
│  │                       │ 2. Build context    │                          ││
│  │    ┌─────────────┐    │ 3. Call LLM         │    ┌─────────────┐       ││
│  │    │ Config      │◄───┤ 4. Execute tools    ├───►│ State       │       ││
│  │    │ Manager     │    │ 5. Loop until done  │    │ Manager     │       ││
│  │    └─────────────┘    │ 6. Deliver response │    └─────────────┘       ││
│  │                       └─────────────────────┘                          ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    PER-AGENT STORAGE (SQLite)                          │ │
│  │   SQLite (state.db) │ Files (data/) │ sqlite-vec (vectors) │ Service  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Design Principles

### 1. Tiny Core, Fat Plugins

Core should be ~2-3K LOC with ONLY:
- Agentic loop (message → LLM → tools → loop)
- Plugin loader and API
- Event bus for communication
- Config and state management

**Everything else is a plugin:**
- Channels (Telegram, Slack, Email) → Channel plugins
- Skills (GitHub, Calendar, CRM) → Skill plugins
- MCPs (Jira, Salesforce, custom) → MCP plugins
- Memory (vector search, knowledge base) → Memory plugins
- Even the LLM provider → Provider plugin

### 2. Simple Plugin Interface

Plugin API should have ~20 methods:
- Registration: registerChannel, registerSkill, registerMCP, registerTool, registerMemory, registerProvider
- Lifecycle hooks: just 5 events (message, agent:start, agent:end, startup, shutdown)
- Utilities: sendMessage, searchMemory, getState, setState

### 3. Minimal Channel Interface

Just 4 methods per channel:
- connect(config) - Start the channel connection
- disconnect() - Stop the channel
- send(target, message) - Send outbound message
- onMessage(handler) - Receive inbound messages

### 4. Skills = Tools + Documentation

Skills are simple: a description for the LLM + tool definitions. No complex framework needed.

### 5. MCPs Follow Standard Protocol

Use the Model Context Protocol standard - connect, listTools, callTool, listResources, readResource.

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

### Optional: Central Control Plane

If managing 1000 agents, add a lightweight control plane for:
- Agent registry and discovery
- Config distribution
- Health monitoring
- Log collection

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

### Critical Implementation Details (Often Missed)

**Context Window Management:**
- Use **effective context window** = full window - reserved space for max output tokens
- Auto-compact conversation when approaching limit (~98% usage)
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
| UserPromptSubmit | User sends message | validate, inject context |
| Stop | Agent tries to exit | verify completion |
| SessionStart | Session begins | load config |
| SessionEnd | Session ends | cleanup |

**Why Polyglot Hooks Matter:**
- Python hooks for complex validation logic
- Shell hooks for simple checks (fast, no runtime)
- Any executable works (Go, Rust binaries, etc.)
- Plugins can include Python/Shell without TypeScript

---

## Autonomous Agent Features

For **fully autonomous** operation without human-in-the-loop, these features are essential:

### Approval Queue (Non-Blocking Human Decisions)

When an agent needs human approval but shouldn't block, use an **approval queue**:

```
┌─────────────────────────────────────────────────────────────────┐
│                    APPROVAL QUEUE PATTERN                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Agent encounters decision requiring approval                   │
│        │                                                         │
│        ▼                                                         │
│   ┌─────────────────────┐                                       │
│   │ Create approval     │                                       │
│   │ request in queue    │                                       │
│   │ (persist to DB)     │                                       │
│   └──────────┬──────────┘                                       │
│              │                                                   │
│              ▼                                                   │
│   ┌─────────────────────┐      ┌─────────────────────┐         │
│   │ Agent continues     │      │ Human reviews via   │         │
│   │ other work OR       │◄────►│ /approve <id> allow │         │
│   │ waits with timeout  │      │ /approve <id> deny  │         │
│   └──────────┬──────────┘      └─────────────────────┘         │
│              │                                                   │
│              ▼                                                   │
│   Agent receives approval/denial via event                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Design:**
- Approval requests stored in SQLite (survives restarts)
- Each request has unique ID, context, expiry time
- Human can approve via any channel (CLI, web, Telegram command)
- Agent can: wait (blocking), continue other work (non-blocking), or timeout with default action

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
│   │ current_tokens >    │  (threshold ~95% of effective window) │
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
│   │ 4. Track delivery   │  (store in DB with status)            │
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
- Delivery confirmation tracking
- Retry on failure with backoff

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
├── skills/                    # User custom skills (hot-reloaded)
│   └── my-skill/
│       └── SKILL.md
├── commands/                  # User custom commands
│   └── my-command.md
├── hooks/                     # User hooks (Python/Shell/any)
│   ├── hooks.json
│   └── my-hook.py
├── plugins/                   # Installed plugins
│   └── plugin-name/
└── shell-snapshots/           # Bash environment state
```

### Project Directory (./.agent/)
```
./.agent/                       # Project-specific (in project root)
├── settings.json              # Project settings (git-tracked)
├── settings.local.json        # User local overrides (git-ignored)
├── skills/                    # Project skills
├── commands/                  # Project commands
├── hooks/                     # Project hooks
│   ├── hooks.json
│   └── validate-bash.sh      # Can be Shell/Python/any
├── rules/                     # Context rules and memory
│   └── project-context.md
└── plugin-name.local.md       # Per-plugin config (git-ignored)
```

### Source Code Structure
```
agent-platform/                 # Development repository
├── src/
│   ├── core/                  # TINY CORE (~2K LOC)
│   │   ├── loop.ts            # Agentic loop
│   │   ├── plugin-api.ts      # Plugin interface
│   │   ├── plugin-loader.ts   # Dynamic loading
│   │   ├── event-bus.ts       # Pub/sub
│   │   ├── config.ts          # Configuration
│   │   └── state.ts           # State management
│   │
│   ├── infra/                 # Infrastructure (~1K LOC)
│   │   ├── database.ts        # SQLite abstraction
│   │   ├── queue.ts           # Task queue
│   │   └── service.ts         # Daemon management
│   │
│   └── cli/                   # CLI commands (~500 LOC)
│
├── plugins/                   # Bundled plugins (optional)
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

### Phase 1: Core (2 weeks)
- Agentic loop with tool execution
- Plugin loader (dynamic import)
- Event bus (pub/sub)
- SQLite state backend
- Session state store with rich metadata
- CLI: start/stop/config/status

### Phase 2: Essential Plugins (2 weeks)
- Anthropic provider plugin
- Telegram channel plugin (with typing indicators)
- Slack channel plugin
- Email channel plugin (IMAP/SMTP)
- Basic tools skill (bash, file, http)
- Channel adapter pipeline for multi-channel delivery

### Phase 3: Autonomous Features (2 weeks)
- Queue modes (steer/interrupt/queue/collect)
- Approval queue for non-blocking human decisions
- Memory compaction with token awareness
- JSONL transcript backup and recovery
- Message timing delays (human-like behavior)

### Phase 4: Production Ready (2 weeks)
- Cross-platform daemon (systemd/launchd/Windows)
- Heartbeat system with HEARTBEAT.md
- Cron service (at/every/cron schedules)
- sqlite-vec for semantic memory
- Audit logging and health monitoring

### Phase 5: Multi-Agent & Advanced (2 weeks)
- Subagent spawning with registry
- Subagent lifecycle tracking and auto-cleanup
- MCP protocol support
- Voice channel plugin
- Optional: Central control plane API
- Docker image & deployment scripts

---

## Key Recommendations Summary

1. **Language:** TypeScript + Node.js 22+ (like Claude Code)
2. **Build:** tsdown or tsup for fast bundling
3. **Distribution:** npm package + Docker image
4. **Database:** SQLite per agent (no shared infra)
5. **Core size:** ~3K LOC maximum
6. **Plugin API:** ~20 methods, not 374
7. **Lifecycle hooks:** 5 events, not 14
8. **Channels:** Plugin-based, 4 methods each
9. **Daemon:** Platform-specific service managers
10. **Scaling:** Horizontal (more instances, not bigger)
11. **Autonomous:** Approval queue + heartbeat + cron (no blocking on humans)
12. **Context:** Token-aware compaction + JSONL backup
13. **Multi-agent:** Subagent registry with lifecycle tracking
14. **Human-like:** Typing indicators, response delays, queue modes

---

## Verification Checklist

| Requirement | Solution | Status |
|-------------|----------|--------|
| Cross-platform (Linux/Mac/Windows) | Node.js + platform service managers | ✓ |
| Installable on any OS | npm package + optional binary | ✓ |
| Agentic logic like Claude Code | Loop until stop_reason !== tool_use | ✓ |
| MCPs support | Standard MCP protocol plugin | ✓ |
| Subagents | Spawn subprocess with inherited config | ✓ |
| Skills as plugins | SkillPlugin interface | ✓ |
| Minimal core | 3K LOC | ✓ |
| Full capabilities | Plugin-based coverage | ✓ |
| Fully autonomous | Approval queue + heartbeat + cron | ✓ |
| 1000+ instances | 1 agent = 1 VM/Docker | ✓ |
| Channels as plugins | ChannelPlugin interface | ✓ |
| Clean core | Everything external | ✓ |
| Database per agent | SQLite + sqlite-vec | ✓ |
| Non-blocking human decisions | Approval queue pattern | ✓ |
| Scheduled tasks | Cron service (at/every/cron) | ✓ |
| Self-planning | Heartbeat + HEARTBEAT.md | ✓ |
| Context management | Token-aware compaction | ✓ |
| Multi-agent coordination | Subagent registry | ✓ |
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
