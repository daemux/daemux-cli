#!/usr/bin/env bash
#
# Daemux Installation Script
# Installs bun, npm dependencies, and optional sqlite-vec extension
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print functions
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE} $1${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*)    echo "macos" ;;
        Linux*)     echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)          echo "unknown" ;;
    esac
}

OS=$(detect_os)
print_info "Detected OS: $OS"

# Check and install Bun
print_header "Checking Bun Installation"

if command -v bun &> /dev/null; then
    BUN_VERSION=$(bun --version)
    print_success "Bun is already installed (v$BUN_VERSION)"
else
    print_info "Bun is not installed. Installing..."

    if [ "$OS" = "windows" ]; then
        print_info "On Windows, installing via npm..."
        if command -v npm &> /dev/null; then
            npm install -g bun
        else
            print_error "npm is not available. Please install Node.js first or install Bun manually."
            print_info "Visit: https://bun.sh/docs/installation"
            exit 1
        fi
    else
        # macOS and Linux
        curl -fsSL https://bun.sh/install | bash

        # Source the updated profile
        if [ -f "$HOME/.bashrc" ]; then
            source "$HOME/.bashrc" 2>/dev/null || true
        fi
        if [ -f "$HOME/.zshrc" ]; then
            source "$HOME/.zshrc" 2>/dev/null || true
        fi

        # Add bun to PATH for this session
        export BUN_INSTALL="$HOME/.bun"
        export PATH="$BUN_INSTALL/bin:$PATH"
    fi

    if command -v bun &> /dev/null; then
        print_success "Bun installed successfully (v$(bun --version))"
    else
        print_error "Bun installation failed. Please install manually: https://bun.sh"
        exit 1
    fi
fi

# Install npm dependencies
print_header "Installing Dependencies"

print_info "Running bun install..."
bun install

print_success "Dependencies installed successfully"

# Install sqlite-vec extension (optional)
print_header "Installing sqlite-vec Extension (Optional)"

install_sqlite_vec_macos() {
    if command -v brew &> /dev/null; then
        print_info "Homebrew detected. Attempting to install sqlite-vec..."
        if brew install sqlite-vec 2>/dev/null; then
            print_success "sqlite-vec installed via Homebrew"
            return 0
        else
            print_warning "sqlite-vec not available in Homebrew or installation failed"
            return 1
        fi
    else
        print_warning "Homebrew not found. Skipping sqlite-vec installation."
        print_info "To install Homebrew: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        return 1
    fi
}

install_sqlite_vec_linux() {
    # Try to download from GitHub releases
    SQLITE_VEC_VERSION="v0.1.6"
    ARCH=$(uname -m)

    case "$ARCH" in
        x86_64)  ARCH_SUFFIX="x86_64" ;;
        aarch64) ARCH_SUFFIX="aarch64" ;;
        arm64)   ARCH_SUFFIX="aarch64" ;;
        *)
            print_warning "Unsupported architecture: $ARCH"
            return 1
            ;;
    esac

    DOWNLOAD_URL="https://github.com/asg017/sqlite-vec/releases/download/${SQLITE_VEC_VERSION}/sqlite-vec-${SQLITE_VEC_VERSION}-loadable-linux-${ARCH_SUFFIX}.tar.gz"

    print_info "Attempting to download sqlite-vec from GitHub releases..."
    print_info "URL: $DOWNLOAD_URL"

    TMP_DIR=$(mktemp -d)
    if curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DIR/sqlite-vec.tar.gz" 2>/dev/null; then
        tar -xzf "$TMP_DIR/sqlite-vec.tar.gz" -C "$TMP_DIR"

        # Try to install to /usr/local/lib or ~/.local/lib
        if [ -w "/usr/local/lib" ]; then
            cp "$TMP_DIR"/*.so /usr/local/lib/ 2>/dev/null || true
            print_success "sqlite-vec installed to /usr/local/lib"
        else
            mkdir -p "$HOME/.local/lib"
            cp "$TMP_DIR"/*.so "$HOME/.local/lib/" 2>/dev/null || true
            print_success "sqlite-vec installed to $HOME/.local/lib"
            print_info "You may need to set LD_LIBRARY_PATH: export LD_LIBRARY_PATH=\$HOME/.local/lib:\$LD_LIBRARY_PATH"
        fi

        rm -rf "$TMP_DIR"
        return 0
    else
        print_warning "Failed to download sqlite-vec"
        rm -rf "$TMP_DIR"
        return 1
    fi
}

case "$OS" in
    macos)
        install_sqlite_vec_macos || print_warning "sqlite-vec is optional. Vector search features may be limited."
        ;;
    linux)
        install_sqlite_vec_linux || print_warning "sqlite-vec is optional. Vector search features may be limited."
        ;;
    windows)
        print_warning "sqlite-vec installation on Windows requires manual setup."
        print_info "Visit: https://github.com/asg017/sqlite-vec for instructions."
        ;;
    *)
        print_warning "Unknown OS. Skipping sqlite-vec installation."
        ;;
esac

# Run setup script
print_header "Running Post-Install Setup"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/setup.sh" ]; then
    chmod +x "$SCRIPT_DIR/setup.sh"
    "$SCRIPT_DIR/setup.sh"
else
    print_warning "setup.sh not found. Skipping post-install setup."
fi

# Final summary
print_header "Installation Complete"

print_success "Daemux has been installed successfully!"
echo ""
print_info "Next steps:"
echo "  1. Configure authentication:"
echo "     daemux auth api-key --provider anthropic"
echo ""
echo "  2. Run daemux:"
echo "     daemux run"
echo ""
print_info "For help: daemux --help"
