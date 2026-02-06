#!/usr/bin/env bash
# Daemux Bootstrap Installer
# Usage: curl -fsSL https://daemux.ai/install | bash
#   or:  curl -fsSL https://daemux.ai/install | bash -s -- --dry-run
#
# Utility functions are inlined here for curl|bash usage.
# Canonical versions live in scripts/common.sh.
set -euo pipefail

DAEMUX_BASE_URL="https://daemux.ai"
DAEMUX_DATA_DIR="${HOME}/.local/share/daemux"
DAEMUX_BIN_DIR="${HOME}/.local/bin"
DAEMUX_LOG="${DAEMUX_DATA_DIR}/install.log"
BUN_INSTALL_URL="https://bun.sh/install"
DRY_RUN=false
VERSION_OVERRIDE=""
BUN_VERSION_OVERRIDE=""
ROLLBACK_TARGET=""
CLEANUP_PATHS=()
PLATFORM=""
VERSION=""
MIN_BUN_VERSION=""
INSTALL_TYPE="fresh"

# --- TTY-aware colors ---------------------------------------------------------
if [ -t 1 ] && [ -n "${TERM:-}" ] && [ "${TERM}" != "dumb" ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

# --- Unified message output ---------------------------------------------------
msg() {
    local level="$1"; shift
    case "$level" in
        info) echo -e "${BLUE}[INFO]${NC} $*" ;;
        ok)   echo -e "${GREEN}[OK]${NC} $*" ;;
        warn) echo -e "${YELLOW}[WARN]${NC} $*" ;;
        err)  echo -e "${RED}[ERROR]${NC} $*" >&2 ;;
        die)  echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1 ;;
    esac
}

# --- Argument parsing ---------------------------------------------------------
parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --dry-run) DRY_RUN=true; shift ;;
            --version)
                shift
                [ $# -eq 0 ] && msg die "--version requires a value (e.g. --version 0.2.0)"
                VERSION_OVERRIDE="$1"; shift ;;
            --bun-version)
                shift
                [ $# -eq 0 ] && msg die "--bun-version requires a value (e.g. --bun-version 1.4.0)"
                BUN_VERSION_OVERRIDE="$1"; shift ;;
            --help|-h)
                cat <<'USAGE'
Daemux Installer

Usage:
  curl -fsSL https://daemux.ai/install | bash
  curl -fsSL https://daemux.ai/install | bash -s -- --dry-run
  curl -fsSL https://daemux.ai/install | bash -s -- --version 0.2.0

Options:
  --dry-run              Show what would happen without making changes
  --version <ver>        Install a specific version instead of latest
  --bun-version <ver>    Override minimum Bun version from manifest
  --help                 Show this help message
USAGE
                exit 0 ;;
            *) msg die "Unknown option: $1. Use --help for usage." ;;
        esac
    done
}

# --- Platform detection (includes libc detection) -----------------------------
detect_platform() {
    local os arch
    case "$(uname -s)" in
        Darwin) os="darwin" ;;
        Linux)  os="linux" ;;
        *)      msg die "Unsupported OS: $(uname -s). Only macOS and Linux are supported." ;;
    esac
    case "$(uname -m)" in
        x86_64|amd64)  arch="x64" ;;
        arm64|aarch64) arch="arm64" ;;
        *)             msg die "Unsupported architecture: $(uname -m)" ;;
    esac
    if [ "$os" = "linux" ]; then
        local libc="glibc"
        if [ -f /etc/alpine-release ]; then
            libc="musl"
        elif command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
            libc="musl"
        fi
        [ "$libc" = "musl" ] && PLATFORM="${os}-${arch}-musl" || PLATFORM="${os}-${arch}"
    else
        PLATFORM="${os}-${arch}"
    fi
    msg ok "Detected platform: $PLATFORM"
}

# --- Download helper (with retry) ---------------------------------------------
download() {
    local url="$1" output="$2"
    if [ "$DRY_RUN" = true ]; then
        msg info "[DRY RUN] Download $url -> $output"
        return 0
    fi
    local attempt=1 max_attempts=3 delay=2 rc=0
    while [ "$attempt" -le "$max_attempts" ]; do
        rc=0
        if command -v curl >/dev/null 2>&1; then
            if [ -t 1 ]; then
                curl -fSL --progress-bar "$url" -o "$output" || rc=$?
            else
                curl -fsSL "$url" -o "$output" || rc=$?
            fi
        elif command -v wget >/dev/null 2>&1; then
            if [ -t 1 ]; then
                wget --show-progress -q "$url" -O "$output" || rc=$?
            else
                wget -q "$url" -O "$output" || rc=$?
            fi
        else
            msg die "No download tool available"
        fi
        [ "$rc" -eq 0 ] && return 0
        if [ "$attempt" -lt "$max_attempts" ]; then
            msg warn "Download failed (attempt ${attempt}/${max_attempts}). Retrying in ${delay}s..."
            sleep "$delay"
            delay=$((delay * 2))
        fi
        attempt=$((attempt + 1))
    done
    msg die "Download failed after ${max_attempts} attempts: $url"
}

# --- Checksum verification ----------------------------------------------------
verify_checksum() {
    local file="$1" expected="$2" actual=""
    if [ "$DRY_RUN" = true ]; then
        msg info "[DRY RUN] Verify SHA256 of $file"; return 0
    fi
    if command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum "$file" | cut -d' ' -f1)
    elif command -v shasum >/dev/null 2>&1; then
        actual=$(shasum -a 256 "$file" | cut -d' ' -f1)
    else
        msg die "No checksum tool available"
    fi
    if [ "$actual" != "$expected" ]; then
        msg err "Checksum verification failed!"
        msg err "Expected: $expected"
        msg err "Actual:   $actual"
        msg die "The downloaded file may be corrupted or tampered with."
    fi
    msg ok "Checksum verified"
}

# --- Detect upgrade vs fresh install ------------------------------------------
detect_install_type() {
    local symlink_path="${DAEMUX_BIN_DIR}/daemux"
    if [ -x "$symlink_path" ] || [ -L "$symlink_path" ]; then
        INSTALL_TYPE="upgrade"
        local current_ver=""
        current_ver=$("$symlink_path" --version 2>/dev/null || echo "")
        if [ -n "$current_ver" ]; then
            msg info "Existing installation detected (v${current_ver})"
        else
            msg info "Existing installation detected"
        fi
    else
        INSTALL_TYPE="fresh"
        msg info "No existing installation found"
    fi
}

# --- Fetch manifest and download tarball --------------------------------------
fetch_release_artifacts() {
    local manifest_file manifest_json platform_block TARBALL_URL="" EXPECTED_SHA=""
    manifest_file=$(mktemp); CLEANUP_PATHS+=("$manifest_file")
    msg info "Fetching release manifest..."
    download "${DAEMUX_BASE_URL}/manifest.json" "$manifest_file"
    if [ "$DRY_RUN" = true ]; then
        msg info "[DRY RUN] Would parse manifest for platform $PLATFORM"
        VERSION="0.0.0-dry-run"; TARBALL_URL="${DAEMUX_BASE_URL}/daemux-dry-run.tar.gz"
        EXPECTED_SHA="0000000000000000000000000000000000000000000000000000000000000000"
        return 0
    fi
    manifest_json=$(cat "$manifest_file")
    VERSION=$(echo "$manifest_json" \
        | sed -n "s/.*\"version\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1)
    [ -z "$VERSION" ] && msg die "Failed to parse version from manifest"
    MIN_BUN_VERSION=$(echo "$manifest_json" \
        | sed -n "s/.*\"minBunVersion\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1)
    [ -z "$MIN_BUN_VERSION" ] && MIN_BUN_VERSION="1.3.0"
    if [ -n "$VERSION_OVERRIDE" ]; then
        VERSION="$VERSION_OVERRIDE"
        msg info "Version overridden to: $VERSION"
    fi
    platform_block=$(echo "$manifest_json" | sed -n "/\"${PLATFORM}\"[[:space:]]*:/,/}/p")
    [ -z "$platform_block" ] && msg die "Platform '$PLATFORM' not found in manifest"
    TARBALL_URL=$(echo "$platform_block" \
        | sed -n "s/.*\"url\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1)
    EXPECTED_SHA=$(echo "$platform_block" \
        | sed -n "s/.*\"sha256\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1)
    [ -z "$TARBALL_URL" ] || [ -z "$EXPECTED_SHA" ] \
        && msg die "Failed to parse download URL or checksum for platform '$PLATFORM'"
    echo "$TARBALL_URL" | grep -qE '^https://' || msg die "Invalid URL in manifest: $TARBALL_URL"
    echo "$EXPECTED_SHA" | grep -qE '^[0-9a-f]{64}$' \
        || msg die "Invalid SHA256 format in manifest: $EXPECTED_SHA"
    msg ok "Manifest loaded: daemux v${VERSION} for ${PLATFORM}"
    rm -f "$manifest_file"
    local tmp_dir tarball_path
    tmp_dir=$(mktemp -d); CLEANUP_PATHS+=("$tmp_dir")
    tarball_path="${tmp_dir}/daemux.tar.gz"
    msg info "Downloading daemux v${VERSION}..."
    download "$TARBALL_URL" "$tarball_path"
    msg info "Verifying download integrity..."
    verify_checksum "$tarball_path" "$EXPECTED_SHA"
    TARBALL_PATH="$tarball_path"
}

# --- Install binary and run post-install setup --------------------------------
install_and_setup() {
    local tarball_path="$1"
    local install_dir="${DAEMUX_DATA_DIR}/versions/${VERSION}"
    local symlink_path="${DAEMUX_BIN_DIR}/daemux"

    if [ "$DRY_RUN" = true ]; then
        msg info "[DRY RUN] Extract to $install_dir"
        msg info "[DRY RUN] Symlink $symlink_path -> $install_dir/daemux"
        msg info "[DRY RUN] Run: $symlink_path setup"
        return 0
    fi

    if [ -L "$symlink_path" ]; then
        ROLLBACK_TARGET=$(readlink "$symlink_path")
    fi

    CLEANUP_PATHS+=("$install_dir")
    mkdir -p "$install_dir"
    msg info "Extracting to ${install_dir}..."
    tar -xzf "$tarball_path" -C "$install_dir"

    mkdir -p "$DAEMUX_BIN_DIR"
    [ -L "$symlink_path" ] || [ -e "$symlink_path" ] && rm -f "$symlink_path"
    ln -s "$install_dir/daemux" "$symlink_path"
    chmod +x "$symlink_path"
    msg ok "Installed daemux v${VERSION}"

    rm -rf "$(dirname "$tarball_path")"

    if [ -x "$symlink_path" ]; then
        msg info "Running post-install setup..."
        "$symlink_path" setup 2>&1 \
            || msg warn "Post-install setup had warnings (non-fatal)"
        msg ok "Post-install setup complete"
    else
        msg warn "Skipping post-install setup: daemux binary not executable"
    fi
}

# --- Bun runtime (version check + install) ------------------------------------
ensure_bun() {
    local min_bun_version="${MIN_BUN_VERSION:-1.3.0}" bun_bin=""
    if [ -n "$BUN_VERSION_OVERRIDE" ]; then
        min_bun_version="$BUN_VERSION_OVERRIDE"
        msg info "Bun version overridden to: $min_bun_version"
    fi
    if command -v bun >/dev/null 2>&1; then
        bun_bin=$(command -v bun)
    elif [ -x "${HOME}/.bun/bin/bun" ]; then
        bun_bin="${HOME}/.bun/bin/bun"
    fi
    if [ -n "$bun_bin" ]; then
        local current_ver
        current_ver=$("$bun_bin" --version 2>/dev/null || echo "0.0.0")
        if [ "$(printf '%s\n' "$min_bun_version" "$current_ver" \
            | sort -V | head -1)" = "$min_bun_version" ]; then
            msg ok "Bun v${current_ver} already installed (>= ${min_bun_version})"
            return 0
        fi
        msg warn "Bun v${current_ver} below minimum v${min_bun_version}. Upgrading..."
    fi

    local installer_path
    if [ "$DRY_RUN" = true ]; then
        msg info "[DRY RUN] Download and run Bun installer from ${BUN_INSTALL_URL}"
        return 0
    fi
    installer_path=$(mktemp)
    CLEANUP_PATHS+=("$installer_path")

    msg info "Downloading Bun installer..."
    download "$BUN_INSTALL_URL" "$installer_path"
    msg info "Installing Bun runtime..."
    bash "$installer_path"
    rm -f "$installer_path"

    export BUN_INSTALL="${HOME}/.bun"
    export PATH="${BUN_INSTALL}/bin:${PATH}"

    if command -v bun >/dev/null 2>&1; then
        msg ok "Bun v$(bun --version) installed"
    else
        msg die "Bun installation completed but binary not found in PATH"
    fi
}

# --- Completion banner with PATH advice ---------------------------------------
print_completion() {
    echo ""
    if [ "$INSTALL_TYPE" = "upgrade" ]; then
        echo -e "${GREEN}${BOLD}Daemux upgraded to v${VERSION}!${NC}"
    else
        echo -e "${GREEN}${BOLD}Daemux v${VERSION} installed successfully!${NC}"
    fi
    echo ""
    echo "  Next steps:"
    echo "    1. Set up authentication:  daemux auth api-key --provider anthropic"
    echo "    2. Start using daemux:     daemux run"
    echo "    For help:                  daemux --help"
    echo ""
    echo "  To uninstall later:          daemux uninstall"
    echo ""
    case ":${PATH}:" in *":${DAEMUX_BIN_DIR}:"*) return 0 ;; esac
    local shell_name shell_rc
    shell_name=$(basename "${SHELL:-bash}")
    case "$shell_name" in
        zsh)  shell_rc="\$HOME/.zshrc" ;;
        bash) shell_rc="\$HOME/.bashrc" ;;
        fish) shell_rc="\$HOME/.config/fish/config.fish" ;;
        *)    shell_rc="\$HOME/.profile" ;;
    esac
    echo ""
    msg warn "${DAEMUX_BIN_DIR} is not in your PATH."
    echo "  Add it by running:"
    if [ "$shell_name" = "fish" ]; then
        echo "    fish_add_path ${DAEMUX_BIN_DIR}"
    else
        echo "    echo 'export PATH=\"${DAEMUX_BIN_DIR}:\$PATH\"' >> ${shell_rc}"
    fi
    echo ""
    echo "  Then reload your shell:  exec ${shell_name}"
    echo ""
}

# --- Main ---------------------------------------------------------------------
main() {
    parse_args "$@"
    echo ""; echo -e "${BOLD}Daemux Installer${NC}"; echo ""
    [ "$DRY_RUN" = true ] && { msg warn "Dry-run mode: no changes will be made"; echo ""; }
    trap 'ec=$?; [ "$ec" -ne 0 ] && [ "$DRY_RUN" = false ] && {
        msg warn "Installation failed (exit $ec). Cleaning up..."
        for p in "${CLEANUP_PATHS[@]}"; do [ -e "$p" ] && rm -rf "$p"; done
        [ -n "$ROLLBACK_TARGET" ] && [ -e "$ROLLBACK_TARGET" ] && {
            ln -sf "$ROLLBACK_TARGET" "${DAEMUX_BIN_DIR}/daemux"
            msg ok "Rolled back to: $ROLLBACK_TARGET"
        }
    }; exit "$ec"' EXIT INT TERM
    if [ "$DRY_RUN" != true ]; then
        mkdir -p "$(dirname "$DAEMUX_LOG")"
        exec > >(tee -a "$DAEMUX_LOG") 2>&1
        msg info "Install log: $DAEMUX_LOG"
    fi
    detect_platform
    local missing=()
    command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 \
        || missing+=("curl or wget")
    command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 \
        || missing+=("sha256sum or shasum")
    command -v tar >/dev/null 2>&1 || missing+=("tar")
    if [ ${#missing[@]} -gt 0 ]; then
        msg err "Missing required dependencies:"
        for dep in "${missing[@]}"; do echo "  - $dep"; done
        msg die "Please install the missing dependencies and try again."
    fi
    msg ok "All dependencies satisfied"
    detect_install_type
    TARBALL_PATH=""
    fetch_release_artifacts
    install_and_setup "$TARBALL_PATH"
    ensure_bun
    print_completion
}

main "$@"
