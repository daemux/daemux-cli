# Daemux

Universal Autonomous Agent Platform - A TypeScript + Bun-based system for running autonomous AI agents powered by Claude.

## Features

- **Autonomous Agent Loop** - "Loop until stop_reason !== tool_use"
- **Plugin System** - Extensible with 18-method unified API
- **SQLite Per Agent** - No external database dependencies
- **Multi-Agent Coordination** - Task tracking and subagent spawning
- **Approval Queue** - Non-blocking human-in-the-loop
- **Cron Scheduling** - Scheduled autonomous tasks
- **Cross-Platform** - Linux, macOS, Windows service support
- **Token Management** - Auto-compaction at 80% threshold

## Installation

### Prerequisites

- [Bun](https://bun.sh) 1.3.0 or higher
- Anthropic API key

### Install

```bash
# Clone the repository
git clone <repository-url>
cd daemux

# Install dependencies
bun install

# Build
bun run build

# Install globally (optional)
bun link
```

## Getting Started

### 1. Set Up Authentication

**IMPORTANT: Claude Code Keychain Credentials Cannot Be Used**

If you have Claude Code installed, daemux may auto-detect credentials from the macOS keychain, but you will get an error:

```
HTTP 400: This credential is only authorized for use with Claude Code and cannot be used for other API requests.
```

**Solution:** Get a direct API key from [console.anthropic.com](https://console.anthropic.com):

1. Go to https://console.anthropic.com
2. Create an API key
3. Set it up with daemux:

```bash
# Option 1: Environment variable (recommended)
export ANTHROPIC_API_KEY=sk-ant-api...

# Option 2: Use the auth command
daemux auth api-key --provider anthropic
# (paste your API key when prompted)

# Verify authentication
daemux auth status
```

### 2. Run Your First Agent

```bash
# Start interactive session
daemux run

# Ask the agent anything
> What files are in the current directory?
```

### 3. Use Built-in Agents

Daemux includes 3 pre-built agents in the `core-agents` plugin:

```bash
# List available plugins
daemux plugins list

# View agents in core-agents plugin
daemux plugins info core-agents
```

**Available agents:**
- **explorer** - Fast codebase exploration and analysis
- **researcher** - Deep research on complex topics
- **planner** - Task planning and breakdown

## CLI Commands

### Authentication
```bash
daemux auth api-key --provider anthropic    # Set up API key
daemux auth status                          # Check auth status
daemux auth clear --provider anthropic      # Remove credentials
```

### Running Agents
```bash
daemux run                  # Interactive session
daemux run --debug          # With debug logging
daemux run --mcp-debug      # With MCP protocol logging
```

### Plugin Management
```bash
daemux plugins list                 # List installed plugins
daemux plugins info <name>          # Show plugin details
daemux plugins install <path>       # Install plugin
daemux plugins uninstall <name>     # Remove plugin
```

### MCP Servers

Daemux supports the same MCP (Model Context Protocol) format as Claude Code.

#### Configure via CLI
```bash
daemux mcp add <name> --command <cmd> --args <args>   # Add stdio MCP server
daemux mcp add <name> --url <url> --type http          # Add HTTP MCP server
daemux mcp remove <name>                               # Remove MCP server
daemux mcp list                                        # List configured servers
daemux mcp get <name>                                  # Show server details
```

#### Configure via `.mcp.json`

Create `.mcp.json` in your project root (Claude Code-compatible format):

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["server.js"],
      "env": { "API_KEY": "${API_KEY}" }
    }
  }
}
```

Supports `${VAR}` and `${VAR:-default}` environment variable expansion.

#### Install MCP as a Plugin

MCP servers can be packaged as daemux plugins:

```bash
# From local path
daemux plugins install ./path/to/mcp-plugin

# From npm
daemux plugins install @daemux/my-mcp-server

# Global install
daemux plugins install @daemux/my-mcp-server --global
```

Plugin MCP servers are auto-discovered from the plugin's `.mcp.json` on activation.

#### Configuration Locations

| Scope | Location |
|-------|----------|
| User | `~/.daemux/settings.json` → `mcpServers` key |
| Project | `./.mcp.json` in project root |
| Plugin | `.mcp.json` inside plugin directory |

Project configs override user settings. Plugin MCPs are registered during plugin activation.

### Service Management
```bash
daemux service install      # Install as system service
daemux service start        # Start service
daemux service stop         # Stop service
daemux service status       # Check status
daemux service logs -f      # View logs
daemux service uninstall    # Remove service
```

## Configuration

Configuration priority (highest to lowest):
1. Environment variables (`AGENT_*` prefix)
2. CLI flags (`--debug`, `--mcp-debug`)
3. Project settings (`./.daemux/settings.json`)
4. User settings (`~/.daemux/settings.json`)
5. Defaults

### Example settings.json

```json
{
  "model": "claude-sonnet-4-20250514",
  "compactionThreshold": 0.8,
  "effectiveContextWindow": 180000,
  "queueMode": "steer",
  "debug": false,
  "heartbeatEnabled": true,
  "heartbeatIntervalMs": 1800000
}
```

## Architecture

- **Core** (~3,000 LOC): Agentic loop, plugin system, task manager
- **Infrastructure** (~2,500 LOC): Database, logging, service management
- **CLI** (~2,500 LOC): Command interface

Total: ~8,366 LOC

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Run tests
bun run test

# Lint code
bun run lint

# Type check
bun run typecheck

# Build
bun run build
```

## Troubleshooting

### "This credential is only authorized for use with Claude Code"

This means you're using a Claude Code subscription token. See the [Authentication](#1-set-up-authentication) section above for how to use a direct API key instead.

### Service won't start (macOS)

Check the generated plist file:
```bash
cat ~/Library/LaunchAgents/com.daemux.plist
```

View service logs:
```bash
daemux service logs
```

### Plugin not loading

Verify plugin structure:
```
my-plugin/
├── .claude-plugin/
│   └── plugin.json
└── agents/
    └── my-agent.md
```

## License

MIT

## Contributing

Contributions welcome! Please open an issue or pull request.
