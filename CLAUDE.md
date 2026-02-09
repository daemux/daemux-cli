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

## Plugin System

### Installing Plugins

```bash
daemux plugins install @daemux/<name> --global   # from npm
daemux plugins install ./path/to/plugin --global  # from local
```

Plugins install to `~/.daemux/plugins/<flat-name>/` (scoped prefix stripped: `@daemux/anthropic-provider` → `anthropic-provider/`).

### Plugin Loading

Plugin loading searches `~/.daemux/plugins/` (user scope) and `./.daemux/plugins/` (project scope). No hardcoded sibling-repo paths — plugins must be installed via `daemux plugins install` or the setup script.

### Cross-Repo Plugin Development

1. Build in `daemux-plugins`: `npm run build`
2. Install from local path: `daemux plugins install ../daemux-plugins/llm-providers/anthropic-provider --global`

### Available Plugins (from daemux-plugins repo)

| Package | Purpose |
|---------|---------|
| `@daemux/plugin-sdk` | Shared types and helpers for plugin authors |
| `@daemux/anthropic-provider` | Anthropic Claude LLM provider |
| `@daemux/telegram-adapter` | Telegram Bot API channel adapter |
| `@daemux/human-behavior` | Human-like response behavior simulation |
| `@daemux/transcription` | OpenAI audio transcription for voice messages |

### Important

New plugins and MCP servers belong in the `daemux-plugins` repo, not here. This repo only consumes them via `daemux plugins install`.

## Runtime Behavior

### Channel Conflict Prevention

When running `daemux` interactively while the daemux service is already running (`daemux service start`), channel connections (Telegram, etc.) are automatically skipped to prevent conflicts (e.g., Telegram 409 errors from duplicate polling). The interactive session runs in agent-only mode. Channels remain managed by the running service.
