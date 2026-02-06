#!/usr/bin/env bash
#
# Daemux Shared Shell Utilities
# Sourced by install.sh, setup.sh, uninstall.sh, and other project scripts.
# Provides: colored output, OS/arch detection, download helpers, cleanup traps.
#

# ---------------------------------------------------------------------------
# TTY-aware color detection
# ---------------------------------------------------------------------------

HAS_COLOR=0
if [ -t 1 ]; then
    HAS_COLOR=1
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    RESET='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    BOLD=''
    RESET=''
fi

# ---------------------------------------------------------------------------
# Unified log function
# ---------------------------------------------------------------------------

# log LEVEL MESSAGE...
# Levels: info, success, warning, error, header
log() {
    local level="$1"; shift
    local color=""
    case "$level" in
        info)    color="$BLUE" ;;
        success) color="$GREEN" ;;
        warning) color="$YELLOW" ;;
        error)   color="$RED" ;;
        header)
            echo ""
            if [ "$HAS_COLOR" = "1" ]; then
                printf '%b========================================%b\n' "$BLUE$BOLD" "$RESET" >&2
                printf '%b %s%b\n' "$BLUE$BOLD" "$*" "$RESET" >&2
                printf '%b========================================%b\n' "$BLUE$BOLD" "$RESET" >&2
            else
                printf '========================================\n' >&2
                printf ' %s\n' "$*" >&2
                printf '========================================\n' >&2
            fi
            echo "" >&2
            return
            ;;
    esac
    if [ "$HAS_COLOR" = "1" ]; then
        printf '%b%s%b\n' "$color" "$*" "$RESET" >&2
    else
        printf '%s\n' "$*" >&2
    fi
}

# ---------------------------------------------------------------------------
# Downloader detection and download_file()
# ---------------------------------------------------------------------------

DOWNLOADER=""

if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
fi

# download_file URL DEST
# Downloads a file from URL to DEST with progress output.
# Returns 0 on success, 1 on failure.
download_file() {
    local url="$1"
    local dest="$2"

    if [ -z "$url" ] || [ -z "$dest" ]; then
        log error "download_file: url and dest arguments are required"
        return 1
    fi

    if [ -z "$DOWNLOADER" ]; then
        log error "Neither curl nor wget found. Please install one of them."
        return 1
    fi

    local dest_dir
    dest_dir="$(dirname "$dest")"
    if [ ! -d "$dest_dir" ]; then
        mkdir -p "$dest_dir"
    fi

    if [ "$DOWNLOADER" = "curl" ]; then
        curl --fail --location --progress-bar "$url" -o "$dest"
    else
        wget -q --show-progress -O "$dest" "$url"
    fi
}

# ---------------------------------------------------------------------------
# Checksum verification
# ---------------------------------------------------------------------------

# verify_checksum FILE_PATH EXPECTED_SHA256
# Returns 0 if checksum matches, 1 otherwise.
verify_checksum() {
    local file_path="$1"
    local expected_hash="$2"

    if [ -z "$file_path" ] || [ -z "$expected_hash" ]; then
        log error "verify_checksum: file_path and expected_hash arguments are required"
        return 1
    fi

    if [ ! -f "$file_path" ]; then
        log error "verify_checksum: file not found: $file_path"
        return 1
    fi

    local actual_hash=""
    if command -v sha256sum >/dev/null 2>&1; then
        actual_hash="$(sha256sum "$file_path" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
        actual_hash="$(shasum -a 256 "$file_path" | awk '{print $1}')"
    else
        log error "verify_checksum: neither sha256sum nor shasum found"
        return 1
    fi

    if [ "$actual_hash" != "$expected_hash" ]; then
        log error "Checksum mismatch for $file_path"
        log error "  expected: $expected_hash"
        log error "  actual:   $actual_hash"
        return 1
    fi

    return 0
}

# ---------------------------------------------------------------------------
# OS, architecture, and platform detection
# ---------------------------------------------------------------------------

# detect_os: prints darwin or linux, returns 1 on unsupported.
detect_os() {
    local kernel
    kernel="$(uname -s)"
    case "$kernel" in
        Darwin*) echo "darwin" ;;
        Linux*)  echo "linux" ;;
        *)
            log error "Unsupported operating system: $kernel"
            return 1
            ;;
    esac
}

# detect_arch: prints x64 or arm64, returns 1 on unsupported.
detect_arch() {
    local machine
    machine="$(uname -m)"
    case "$machine" in
        x86_64|amd64)   echo "x64" ;;
        aarch64|arm64)   echo "arm64" ;;
        *)
            log error "Unsupported architecture: $machine"
            return 1
            ;;
    esac
}

# detect_libc: prints glibc or musl on Linux, empty string on macOS.
detect_libc() {
    local os
    os="$(detect_os)" || return 1

    if [ "$os" != "linux" ]; then
        echo ""
        return 0
    fi

    # Check for musl via the dynamic linker path
    if ls /lib/ld-musl* >/dev/null 2>&1; then
        echo "musl"
        return 0
    fi

    # Fall back to ldd version string
    if command -v ldd >/dev/null 2>&1; then
        local ldd_out
        ldd_out="$(ldd --version 2>&1 || true)"
        if echo "$ldd_out" | grep -qi musl; then
            echo "musl"
            return 0
        fi
    fi

    echo "glibc"
}

# get_platform: prints combined string like "darwin-arm64" or "linux-x64-musl".
get_platform() {
    local os arch libc platform
    os="$(detect_os)" || return 1
    arch="$(detect_arch)" || return 1
    libc="$(detect_libc)" || return 1

    platform="${os}-${arch}"
    if [ -n "$libc" ]; then
        platform="${platform}-${libc}"
    fi
    echo "$platform"
}

# ---------------------------------------------------------------------------
# Cleanup trap setup
# ---------------------------------------------------------------------------

# setup_cleanup [FUNC_NAME]
# Registers EXIT/INT/TERM traps that call the given function (default: cleanup).
# Define your cleanup function before calling this.
# Usage:
#   my_cleanup() { rm -rf "$TMP_DIR"; }
#   setup_cleanup my_cleanup
setup_cleanup() {
    local fn="${1:-cleanup}"
    if ! type "$fn" >/dev/null 2>&1; then
        log warning "Cleanup function '$fn' not defined, using no-op"
        trap ':' EXIT INT TERM
        return
    fi
    trap "$fn" EXIT INT TERM
}
