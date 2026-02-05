# Core Agents Plugin

Core agents shipped with the Universal Autonomous Agent Platform. These agents provide essential capabilities for codebase exploration, research, and planning.

## Included Agents

### Explorer (`explorer`)

Fast agent for quickly navigating and understanding codebases.

**Color:** Cyan

**Tools:** `read_file`, `bash`

**Use When:**
- "What does this project do?"
- "Find files related to authentication"
- "Show me the structure of this codebase"
- "Where is the database logic?"
- "How is X implemented?"

**Example:**
```
> explore: find all API endpoints in this project
```

### Researcher (`researcher`)

Deep research agent for thorough investigation requiring comprehensive analysis.

**Color:** Green

**Tools:** `read_file`, `bash`, `write_file`

**Use When:**
- Need comprehensive analysis of a feature
- "How does the payment system work in detail?"
- Need documentation written about existing code
- "Compare REST vs GraphQL approaches in this codebase"
- Understanding complex component interactions

**Example:**
```
> research: document how the authentication flow works from login to session management
```

### Planner (`planner`)

Software architect for designing implementation plans before coding.

**Color:** Blue

**Tools:** `read_file`

**Use When:**
- "How should I implement user notifications?"
- Need a plan before making changes
- "What's the best approach for caching?"
- Want to understand trade-offs between approaches
- Feature requires changes to multiple files

**Example:**
```
> plan: add real-time notifications to the dashboard
```

## Agent Selection Guide

| Need | Agent | Why |
|------|-------|-----|
| Quick file lookup | explorer | Fast, minimal tool use |
| Code location | explorer | Pattern-based search |
| Deep understanding | researcher | Thorough analysis |
| Documentation | researcher | Can write output files |
| Before coding | planner | Design before implement |
| Architecture decisions | planner | Trade-off analysis |

## Output Formats

Each agent produces structured output:

- **Explorer:** Concise answers with key file references
- **Researcher:** Comprehensive reports with code citations
- **Planner:** Step-by-step implementation plans with trade-offs

## Extending

To add custom agents, create a new `.md` file in the `agents/` directory with YAML frontmatter:

```markdown
---
name: my-agent
description: |
  When to use this agent...
model: inherit
tools:
  - read_file
  - bash
color: yellow
---

System prompt content...
```

Then add the file path to `plugin.json`:

```json
{
  "agents": [
    "agents/explorer.md",
    "agents/researcher.md",
    "agents/planner.md",
    "agents/my-agent.md"
  ]
}
```
