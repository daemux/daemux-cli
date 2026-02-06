# Project Development Standards

## Mandatory Rules

### Agent Delegation (NEVER violate)
- ALWAYS delegate ALL tasks to agents - use either plugin agents or built-in agents (via Task tool)
- NEVER perform any work directly - the main agent's role is ONLY to coordinate and delegate
- This applies to ALL task types: coding, research, exploration, file operations, testing, deployment, and any other work
- If unsure which agent to use, use the Task tool with a general-purpose, explore or any other built-in agent

### Deployer Agent Required
ALL server operations MUST use the deployer agent (deploy, logs, status, health checks, migrations, remote commands).
NEVER use Bash/SSH directly for deployment operations.

### Code Quality (enforced by agents)
- No TODO/FIXME in committed code
- No Mock/placeholder code
- No hardcoded secrets
- Decimal types for money (never float)
- Timezone-aware dates
- Parameterized queries only

## Code Limits (MANDATORY)

| Limit | Value | Action if Exceeded |
|-------|-------|-------------------|
| File size | 400 lines | Split into modules |
| Functions per file | 10 | Group by domain/feature |
| Function length | 50 lines | Extract helper functions |
| Line width | 120 chars | Wrap or refactor |
| Max nesting | 5 levels | Use early returns |

## Workflow

### Task Type Detection

Detect from user request:
- **backend** - Python, FastAPI, API endpoints, database queries, server-side logic
- **frontend** - React, Vue, JS, HTML/CSS, UI components, browser
- **database** - Migrations, schema changes, SQL
- **infra** - Server setup, deployment config, optimization
- **standard** - Mixed or unclear

### Agent Flows

#### Standard Flow
```
architect → product-manager(PRE) → [docs-researcher] → developer → simplifier → reviewer → tester → product-manager(POST) → [deployer]
```

#### Backend Flow
```
architect → product-manager(PRE) → [docs-researcher] → [api-verifier(external,PRE)] → developer(backend) → simplifier → reviewer → [api-verifier(external,POST)] → tester(backend) → product-manager(POST) → [deployer]
```

#### Frontend Flow
```
architect → product-manager(PRE) → [docs-researcher] → [designer] → developer(frontend) → [designer(review)] → simplifier → api-verifier(contract) → api-verifier(integration) → reviewer → tester(frontend) → product-manager(POST) → [deployer]
```

#### Database Flow
```
infra-ops(database,migrate) → simplifier → reviewer → product-manager(POST) → [deployer]
```

#### Infra Flow
```
infra-ops (standalone)
```

### Agents Reference

| Agent | When to use |
|-------|-------------|
| architect | BEFORE developer - designs architecture |
| product-manager | PRE-DEV: validates approach. POST-DEV: after tests |
| docs-researcher | Before developer for external libraries |
| api-verifier | API verification (mode: external/contract/integration) |
| developer | Code implementation (type: backend/frontend) |
| simplifier | AFTER developer - simplifies code |
| reviewer | After ANY code changes |
| tester | After review passes (type: backend/frontend) |
| infra-ops | Infrastructure ops (target: database/server, action: migrate/optimize) |
| deployer | Deploy to production, view logs, check status |
| designer | UI/UX design specs before frontend development |
| designer(review) | After developer: design review + generate icons via nano-banana if needed |
| Explore (Task tool) | Read/understand code |
| spec-tracker | Manage spec checklist in progress.md (mode: INIT/NEXT-BATCH/UPDATE) |

### Optional Agents

| Agent | When to Skip |
|-------|--------------|
| [deployer] | DEPLOY_SERVER_IP not configured (workflow ends at product-manager(POST)) |
| [designer] | Minor fixes, bug fixes, or non-visual changes |
| [designer(review)] | Only use if [designer] was used (reviews implementation, generates images via nano-banana) |

### Autonomous Iteration Philosophy

**Self-Correction (MANDATORY):** Before each fix attempt:
1. Read previous error output carefully
2. Check git diff to see what was already tried
3. Identify WHY it failed, not just WHAT failed
4. Try a DIFFERENT approach if same fix failed twice

**Persistence Wins:** Keep iterating until success.

### Fix-and-Verify Loops

**review-loop:** reviewer → PASS? → EXIT | ISSUES? → developer → reviewer (repeat)

**manager-loop:** product-manager → COMPLETE? → EXIT | ISSUES? → developer → product-manager (repeat)

**test-loop:** tester → PASS? → EXIT | FAIL? → developer → simplifier → reviewer → tester (repeat)

### Gates & Prerequisites

**Before product-manager (POST-DEV):**
- `TESTS: PASSED` from tester
- `Review: NO ISSUES` from reviewer
- `Integration: PASSED` from api-verifier (frontend only)

**Before deployer:**
- `APPROVED` or `COMPLETE` from product-manager
- Deployment is optional when DEPLOY_SERVER_IP is not configured

Missing evidence means run that agent first. Do NOT proceed without it.

### Parallel Execution

**Launch multiple agents in ONE message when possible.**

**Parallel OK:** Independent features, backend + frontend, tester(backend) + tester(frontend)

**Sequential ONLY:** Same-file changes, simplifier → reviewer, review-fix cycles, deployer after tests

### Batched Execution (MANDATORY for spec/TASK.md projects)

Large specs exceed context limits. Break work into batches:

**Phase 0 — Bootstrap (once):** `spec-tracker(INIT)` → creates `progress.md` from spec
**Phase 1-N — Implement in batches:**
```
spec-tracker(NEXT-BATCH) → architect → [normal flow per task type] → product-manager → spec-tracker(UPDATE) → [deployer on final batch]
```
- Batch size: 3-5 related requirements per cycle
- After each batch: `/clear` context and start fresh session
- Done when: `spec-tracker(UPDATE)` reports 100% coverage

**Agents read `progress.md` (small checklist), NOT the full spec file.**

### Known Patterns

**Localization:** Each language MUST be handled by a separate agent in parallel.

### Output Format and Continuation

**CRITICAL: Copy the EXACT flow from the Agent Flows section above. Include ALL agents, including optional ones in `[brackets]`. Do NOT abbreviate or skip agents.**

Output the analysis in this format:

```
TASK TYPE: [backend/frontend/database/infra/standard]

RECOMMENDED FLOW:
<copy the EXACT flow from Agent Flows section - include ALL agents with [optional] ones>

DEPLOYMENT: [AVAILABLE - DEPLOY_SERVER_IP configured | NOT CONFIGURED - workflow ends at product-manager(POST)]

TASK TRACKING: ALWAYS use TaskCreate/TaskUpdate/TaskList tools for multi-step tasks (3+ steps)

NOTES:
- [any special considerations]

LAUNCHING: [first-agent-name]
```

**For spec/TASK.md projects:** Prepend `spec-tracker(NEXT-BATCH) →` and append `→ spec-tracker(UPDATE)` to any flow above. First session uses `spec-tracker(INIT)` instead.

**Expected RECOMMENDED FLOW outputs (copy exactly):**

- **backend**: `architect → product-manager(PRE) → [docs-researcher] → [api-verifier(external,PRE)] → developer(backend) → simplifier → reviewer → [api-verifier(external,POST)] → tester(backend) → product-manager(POST) → [deployer]`
- **frontend**: `architect → product-manager(PRE) → [docs-researcher] → [designer] → developer(frontend) → [designer(review)] → simplifier → api-verifier(contract) → api-verifier(integration) → reviewer → tester(frontend) → product-manager(POST) → [deployer]`
- **database**: `infra-ops(database,migrate) → simplifier → reviewer → product-manager(POST) → [deployer]`
- **infra**: `infra-ops (standalone)`
- **standard**: `architect → product-manager(PRE) → [docs-researcher] → developer → simplifier → reviewer → tester → product-manager(POST) → [deployer]`

**MANDATORY: After outputting the workflow analysis above, you MUST:**
1. **Create tasks** using TaskCreate for each major step in the workflow (if 3+ steps)
2. **Immediately invoke** the first agent using the Task tool in the same response

Do NOT stop. Do NOT wait for user confirmation. The workflow skill is not complete until tasks are created and the first agent is launched.

## Release & Deployment Process

### How Releases Work

Releases are fully automated via GitHub Actions. The pipeline:

1. **Push a version tag** (e.g., `git tag -a v0.2.0 -m "v0.2.0"`)
2. **Push the tag** (`git push origin main --follow-tags`)
3. **GitHub Actions `release.yml`** triggers automatically and:
   - Cross-compiles 6 platform binaries (linux-x64, linux-arm64, linux-x64-musl, linux-arm64-musl, darwin-x64, darwin-arm64)
   - Creates platform-specific tarballs in `release/`
   - Creates a GitHub Release with tarballs as download assets
   - Generates `manifest.json` with version, URLs, SHA256 checksums, and minBunVersion
   - Commits `manifest.json` back to `main` (mirrored at daemux.ai/manifest.json)
4. **CI workflow `ci.yml`** runs on every push to main and PRs (typecheck, test, lint)

### Release Steps for Agent

```bash
# 1. Ensure all changes are committed and tests pass
bun test && bun run typecheck && bun run lint

# 2. Update version in package.json
# Edit package.json "version" field to the new version

# 3. Commit version bump
git add package.json
git commit -m "chore: bump version to vX.Y.Z"

# 4. Create annotated tag
git tag -a vX.Y.Z -m "vX.Y.Z: <brief description>"

# 5. Push commit and tag (triggers release workflow)
git push origin main --follow-tags

# 6. Verify release on GitHub Actions
gh run list --workflow=release.yml --limit=1
gh run watch  # to monitor the release workflow
```

### Key Files

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | CI: typecheck, test, lint on push/PR |
| `.github/workflows/release.yml` | Release: build, publish, manifest commit |
| `scripts/build-release.sh` | Cross-compile + tarball + manifest generation |
| `manifest.json` | Auto-generated release manifest (committed by CI) |
| `install.sh` | Bootstrap installer (`curl -fsSL https://daemux.ai/install \| bash`) |
| `scripts/uninstall.sh` | Interactive uninstall script |
| `src/updater/` | Auto-update subsystem (checks manifest.json) |

### Version Scheme

Follow semver: `vMAJOR.MINOR.PATCH`
- Patch: bug fixes
- Minor: new features, backward compatible
- Major: breaking changes
