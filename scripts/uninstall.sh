#!/usr/bin/env bash
#
# Daemux Uninstall Script
# Cleanly removes Daemux from the system with interactive confirmation.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common.sh if available (repo context), otherwise define minimal logging
if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
else
    # Minimal standalone fallback for when uninstall.sh is run outside the repo
    if [ -t 1 ] && [ -n "${TERM:-}" ] && [ "${TERM}" != "dumb" ]; then
        RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
        BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
    else
        RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
    fi
    log() {
        local level="$1"; shift
        case "$level" in
            info)    echo -e "${BLUE}[INFO]${RESET} $*" >&2 ;;
            success) echo -e "${GREEN}[OK]${RESET} $*" >&2 ;;
            warning) echo -e "${YELLOW}[WARN]${RESET} $*" >&2 ;;
            error)   echo -e "${RED}[ERROR]${RESET} $*" >&2 ;;
            header)
                echo "" >&2
                echo -e "${BLUE}${BOLD}======================================== ${RESET}" >&2
                echo -e "${BLUE}${BOLD} $*${RESET}" >&2
                echo -e "${BLUE}${BOLD}======================================== ${RESET}" >&2
                echo "" >&2 ;;
        esac
    }
fi

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DAEMUX_BIN="$HOME/.local/bin/daemux"
DAEMUX_SHARE="$HOME/.local/share/daemux"
DAEMUX_USER="$HOME/.daemux"

# ---------------------------------------------------------------------------
# State tracking
# ---------------------------------------------------------------------------

REMOVED_ITEMS=()
SKIPPED_ITEMS=()
KEPT_ITEMS=()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# confirm PROMPT
# Asks the user a yes/no question. Returns 0 for yes, 1 for no.
confirm() {
    local prompt="$1"
    local reply=""

    if [ ! -t 0 ]; then
        log warning "Non-interactive shell detected, skipping: $prompt"
        return 1
    fi

    echo -en "${YELLOW}${prompt}${RESET} [y/N] "
    read -r reply
    case "$reply" in
        [yY]|[yY][eE][sS]) return 0 ;;
        *) return 1 ;;
    esac
}

# ---------------------------------------------------------------------------
# Root warning
# ---------------------------------------------------------------------------

warn_if_root() {
    if [ "$(id -u)" -eq 0 ]; then
        log warning "Running as root. Daemux is typically installed per-user."
        log warning "Paths will resolve to root's HOME ($HOME), not the regular user."
        echo ""
        if ! confirm "Continue as root?"; then
            log info "Aborted."
            exit 0
        fi
    fi
}

# ---------------------------------------------------------------------------
# Remove the symlink at ~/.local/bin/daemux
# ---------------------------------------------------------------------------

remove_bin_symlink() {
    log header "Step 1: Binary Symlink"

    if [ ! -e "$DAEMUX_BIN" ] && [ ! -L "$DAEMUX_BIN" ]; then
        log info "Not found: $DAEMUX_BIN"
        SKIPPED_ITEMS+=("$DAEMUX_BIN (does not exist)")
        return 0
    fi

    if [ -L "$DAEMUX_BIN" ]; then
        local target
        target="$(readlink "$DAEMUX_BIN" 2>/dev/null || echo "unknown")"
        log info "Found symlink: $DAEMUX_BIN -> $target"

        if confirm "Remove symlink $DAEMUX_BIN?"; then
            rm "$DAEMUX_BIN"
            log success "Removed symlink: $DAEMUX_BIN"
            REMOVED_ITEMS+=("$DAEMUX_BIN")
        else
            log info "Kept: $DAEMUX_BIN"
            KEPT_ITEMS+=("$DAEMUX_BIN")
        fi
        return 0
    fi

    # Not a symlink -- could be a regular file or directory
    log warning "$DAEMUX_BIN exists but is NOT a symlink (it is a regular file or directory)."
    log warning "This is unexpected. Inspect it before removing."
    echo ""
    ls -la "$DAEMUX_BIN" 2>/dev/null || true
    echo ""

    if confirm "Remove $DAEMUX_BIN anyway?"; then
        rm -rf "$DAEMUX_BIN"
        log success "Removed: $DAEMUX_BIN"
        REMOVED_ITEMS+=("$DAEMUX_BIN")
    else
        log info "Kept: $DAEMUX_BIN"
        KEPT_ITEMS+=("$DAEMUX_BIN")
    fi
}

# ---------------------------------------------------------------------------
# Remove ~/.local/share/daemux/ (versions, state, downloads)
# ---------------------------------------------------------------------------

remove_share_dir() {
    log header "Step 2: Application Data"

    if [ ! -d "$DAEMUX_SHARE" ]; then
        log info "Not found: $DAEMUX_SHARE"
        SKIPPED_ITEMS+=("$DAEMUX_SHARE (does not exist)")
        return 0
    fi

    log info "Found: $DAEMUX_SHARE"
    log info "Contains versions, state files, and downloads."
    echo ""
    ls -la "$DAEMUX_SHARE" 2>/dev/null || true
    echo ""

    if confirm "Remove $DAEMUX_SHARE and all its contents?"; then
        rm -rf "$DAEMUX_SHARE"
        log success "Removed: $DAEMUX_SHARE"
        REMOVED_ITEMS+=("$DAEMUX_SHARE")
    else
        log info "Kept: $DAEMUX_SHARE"
        KEPT_ITEMS+=("$DAEMUX_SHARE")
    fi
}

# ---------------------------------------------------------------------------
# Optionally remove ~/.daemux/ (user data)
# ---------------------------------------------------------------------------

remove_user_dir() {
    log header "Step 3: User Data"

    if [ ! -d "$DAEMUX_USER" ]; then
        log info "Not found: $DAEMUX_USER"
        SKIPPED_ITEMS+=("$DAEMUX_USER (does not exist)")
        return 0
    fi

    log info "Found: $DAEMUX_USER"
    log warning "This directory contains your personal Daemux data:"
    echo "  - Settings and configuration"
    echo "  - Credentials and API keys"
    echo "  - Plugins"
    echo "  - Cache and debug logs"
    echo ""
    ls -la "$DAEMUX_USER" 2>/dev/null || true
    echo ""
    log warning "Removing this directory will delete your settings and credentials."
    echo ""

    if confirm "Remove $DAEMUX_USER and all user data? (THIS CANNOT BE UNDONE)"; then
        rm -rf "$DAEMUX_USER"
        log success "Removed: $DAEMUX_USER"
        REMOVED_ITEMS+=("$DAEMUX_USER")
    else
        log info "Kept: $DAEMUX_USER"
        KEPT_ITEMS+=("$DAEMUX_USER")
    fi
}

# ---------------------------------------------------------------------------
# Print summary
# ---------------------------------------------------------------------------

print_summary() {
    log header "Uninstall Summary"

    if [ ${#REMOVED_ITEMS[@]} -gt 0 ]; then
        log success "Removed:"
        for item in "${REMOVED_ITEMS[@]}"; do
            echo "  - $item"
        done
        echo ""
    fi

    if [ ${#SKIPPED_ITEMS[@]} -gt 0 ]; then
        log info "Skipped (not found):"
        for item in "${SKIPPED_ITEMS[@]}"; do
            echo "  - $item"
        done
        echo ""
    fi

    if [ ${#KEPT_ITEMS[@]} -gt 0 ]; then
        log info "Kept (user chose to retain):"
        for item in "${KEPT_ITEMS[@]}"; do
            echo "  - $item"
        done
        echo ""
    fi

    if [ ${#REMOVED_ITEMS[@]} -eq 0 ]; then
        log info "Nothing was removed."
    else
        log success "Daemux has been uninstalled."
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    log header "Daemux Uninstaller"

    warn_if_root

    log info "This script will remove Daemux from your system."
    log info "You will be asked to confirm each step."
    echo ""
    log info "Paths that will be checked:"
    echo "  1. $DAEMUX_BIN      (binary symlink)"
    echo "  2. $DAEMUX_SHARE    (application data)"
    echo "  3. $DAEMUX_USER     (user data - separate confirmation)"
    echo ""

    if ! confirm "Proceed with uninstall?"; then
        log info "Aborted."
        exit 0
    fi

    remove_bin_symlink
    remove_share_dir
    remove_user_dir
    print_summary
}

main "$@"
