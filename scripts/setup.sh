#!/usr/bin/env bash
#
# Daemux Post-Install Setup Script
# Creates necessary directories and sets permissions
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

# Daemux home directory
DAEMUX_HOME="$HOME/.daemux"

print_info "Setting up Daemux directories..."

# Create main directory structure
create_dir() {
    local dir="$1"
    local mode="$2"

    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        print_success "Created: $dir"
    else
        print_info "Exists: $dir"
    fi

    # Set permissions if specified
    if [ -n "$mode" ]; then
        chmod "$mode" "$dir" 2>/dev/null || print_warning "Could not set permissions on $dir"
    fi
}

# Create directory structure
create_dir "$DAEMUX_HOME"
create_dir "$DAEMUX_HOME/credentials" "700"  # Secure permissions for credentials
create_dir "$DAEMUX_HOME/plugins"
create_dir "$DAEMUX_HOME/debug-logs"
create_dir "$DAEMUX_HOME/data"
create_dir "$DAEMUX_HOME/cache"

# Create default settings file if it doesn't exist
SETTINGS_FILE="$DAEMUX_HOME/settings.json"
if [ ! -f "$SETTINGS_FILE" ]; then
    cat > "$SETTINGS_FILE" << 'EOF'
{
  "model": "claude-sonnet-4-20250514",
  "maxTokens": 8192,
  "debug": false
}
EOF
    print_success "Created default settings: $SETTINGS_FILE"
else
    print_info "Settings file exists: $SETTINGS_FILE"
fi

# Set secure permissions on credentials directory
if [ -d "$DAEMUX_HOME/credentials" ]; then
    # Ensure credentials directory has secure permissions
    chmod 700 "$DAEMUX_HOME/credentials" 2>/dev/null || true

    # Secure any existing credential files
    for file in "$DAEMUX_HOME/credentials"/*.json; do
        if [ -f "$file" ]; then
            chmod 600 "$file" 2>/dev/null || true
        fi
    done
fi

# ---------------------------------------------------------------------------
# Default Plugin Installation
# ---------------------------------------------------------------------------

PLUGINS_DIR="$DAEMUX_HOME/plugins"
DEFAULT_PLUGINS=("daemux-anthropic-provider")

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLED_PLUGINS_DIR="$(dirname "$SCRIPT_DIR")/plugins"

install_default_plugins() {
    for plugin in "${DEFAULT_PLUGINS[@]}"; do
        local plugin_target="$PLUGINS_DIR/$plugin"

        # Skip if already installed
        if [ -d "$plugin_target" ] && [ -f "$plugin_target/.claude-plugin/plugin.json" ]; then
            print_info "Plugin already installed: $plugin"
            continue
        fi

        # Check for bundled plugin first
        local bundled_plugin="$BUNDLED_PLUGINS_DIR/$plugin"
        if [ -d "$bundled_plugin" ] && [ -f "$bundled_plugin/.claude-plugin/plugin.json" ]; then
            print_info "Installing bundled plugin: $plugin"
            cp -r "$bundled_plugin" "$plugin_target"
            print_success "Installed plugin: $plugin"
            continue
        fi

        # Try npm/bun install as fallback
        if command -v bun &> /dev/null; then
            print_info "Installing plugin from npm: $plugin"
            local temp_dir="$PLUGINS_DIR/.temp-install"
            mkdir -p "$temp_dir"

            # Initialize a temp package and install the plugin
            (
                cd "$temp_dir" || exit 1
                bun init -y > /dev/null 2>&1
                if bun add "$plugin" > /dev/null 2>&1; then
                    local pkg_dir="$temp_dir/node_modules/$plugin"
                    if [ -d "$pkg_dir" ] && [ -f "$pkg_dir/.claude-plugin/plugin.json" ]; then
                        cp -r "$pkg_dir" "$plugin_target"
                        print_success "Installed plugin from npm: $plugin"
                    else
                        print_warning "Package $plugin is not a valid daemux plugin"
                    fi
                else
                    print_warning "Could not install plugin: $plugin (not found in npm)"
                fi
            )

            # Cleanup temp directory
            rm -rf "$temp_dir"
        else
            print_warning "Skipping plugin $plugin: bun not available for npm install"
        fi
    done
}

# Install default plugins
install_default_plugins

print_success "Daemux setup complete!"
print_info "Configuration directory: $DAEMUX_HOME"
