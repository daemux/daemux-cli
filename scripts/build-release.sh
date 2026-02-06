#!/usr/bin/env bash
#
# Daemux Build & Release Script
# Builds the project, creates platform tarballs, and generates manifest.json
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=./common.sh
source "$SCRIPT_DIR/common.sh"

RELEASE_DIR="$PROJECT_ROOT/release"
GITHUB_REPO="daemux/daemux-cli"
PLATFORMS=(
    "darwin-arm64"
    "darwin-x64"
    "linux-arm64"
    "linux-x64"
    "linux-arm64-musl"
    "linux-x64-musl"
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

read_package_field() {
    local field="$1"
    local pkg="$PROJECT_ROOT/package.json"
    [ -f "$pkg" ] || { log error "package.json not found at $pkg"; return 1; }
    bun -e "const p=JSON.parse(require('fs').readFileSync('$pkg','utf8')); \
const keys='$field'.replace(/^\./,'').split('.'); \
let v=p; for(const k of keys) v=v?.[k]; console.log(v??'')"
}

compute_sha256() {
    local file_path="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file_path" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file_path" | awk '{print $1}'
    else
        log error "Neither sha256sum nor shasum found"
        return 1
    fi
}

get_file_size() {
    local file_path="$1"
    if command -v stat >/dev/null 2>&1; then
        # macOS stat vs GNU stat
        stat -f%z "$file_path" 2>/dev/null || stat -c%s "$file_path" 2>/dev/null
    elif command -v wc >/dev/null 2>&1; then
        wc -c < "$file_path" | tr -d ' '
    else
        log error "Cannot determine file size"
        return 1
    fi
}

format_human_size() {
    local bytes="$1"
    if [ "$bytes" -ge 1048576 ]; then
        echo "$(echo "scale=2; $bytes / 1048576" | bc)MB"
    elif [ "$bytes" -ge 1024 ]; then
        echo "$(echo "scale=1; $bytes / 1024" | bc)KB"
    else
        echo "${bytes}B"
    fi
}

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

run_build() {
    log header "Building Daemux"

    cd "$PROJECT_ROOT"

    if ! command -v bun >/dev/null 2>&1; then
        log error "bun is not installed. Install it from https://bun.sh"
        exit 1
    fi

    log info "Running bun build..."
    bun build ./src/index.ts --outdir ./dist --target bun
    bun build ./src/cli/index.ts --outdir ./dist/cli --target bun

    if [ ! -d "$PROJECT_ROOT/dist" ]; then
        log error "Build failed: dist/ directory not created"
        exit 1
    fi

    log success "Build complete"
}

# ---------------------------------------------------------------------------
# Compile single binary
# ---------------------------------------------------------------------------

compile_binary() {
    log header "Compiling Single Binary"

    cd "$PROJECT_ROOT"

    local platform
    platform="$(get_platform)" || { log error "Could not detect platform"; exit 1; }

    log info "Compiling for current platform: $platform"
    bun build --compile --outfile="dist/daemux" ./src/cli/index.ts

    if [ ! -f "$PROJECT_ROOT/dist/daemux" ]; then
        log error "Compile failed: dist/daemux binary not created"
        exit 1
    fi

    local binary_size
    binary_size="$(get_file_size "$PROJECT_ROOT/dist/daemux")"

    log success "Compiled binary: dist/daemux ($(format_human_size "$binary_size"))"

    # Cross-compile for other platforms if --cross flag is set
    if [ "${CROSS_COMPILE:-}" = "1" ]; then
        compile_cross_platform
    fi
}

compile_cross_platform() {
    log info "Cross-compiling for all platforms..."

    mkdir -p "$PROJECT_ROOT/dist/bin"

    for platform in "${PLATFORMS[@]}"; do
        local target=""
        case "$platform" in
            darwin-arm64)      target="bun-darwin-arm64" ;;
            darwin-x64)        target="bun-darwin-x64" ;;
            linux-arm64)       target="bun-linux-arm64" ;;
            linux-x64)         target="bun-linux-x64" ;;
            linux-arm64-musl)  target="bun-linux-arm64" ;;
            linux-x64-musl)    target="bun-linux-x64" ;;
        esac

        if [ -z "$target" ]; then
            log warning "No compile target for platform: $platform, skipping"
            continue
        fi

        local outfile="$PROJECT_ROOT/dist/bin/daemux-${platform}"
        log info "  Compiling for $platform (target: $target)..."
        bun build --compile --target="$target" --outfile="$outfile" ./src/cli/index.ts || {
            log warning "  Cross-compile failed for $platform, skipping"
            continue
        }
        log success "  Compiled: daemux-${platform}"
    done
}

# ---------------------------------------------------------------------------
# Create platform tarballs
# ---------------------------------------------------------------------------

create_tarballs() {
    local version="$1"

    log header "Creating Platform Tarballs"

    local staging_dir="$RELEASE_DIR/.staging"
    mkdir -p "$staging_dir/daemux"

    # Copy build artifacts into staging area
    cp -r "$PROJECT_ROOT/dist" "$staging_dir/daemux/"
    cp "$PROJECT_ROOT/package.json" "$staging_dir/daemux/"
    if [ -f "$PROJECT_ROOT/scripts/setup.sh" ]; then
        mkdir -p "$staging_dir/daemux/scripts"
        cp "$PROJECT_ROOT/scripts/setup.sh" "$staging_dir/daemux/scripts/"
    fi

    for platform in "${PLATFORMS[@]}"; do
        local tarball_name="daemux-${version}-${platform}.tar.gz"
        local tarball_path="$RELEASE_DIR/$tarball_name"

        # Replace generic binary with platform-specific cross-compiled binary
        local platform_binary="$PROJECT_ROOT/dist/bin/daemux-${platform}"
        if [ -f "$platform_binary" ]; then
            cp "$platform_binary" "$staging_dir/daemux/daemux"
        fi

        log info "Creating $tarball_name..."
        tar -czf "$tarball_path" -C "$staging_dir" daemux
        log success "Created $tarball_name"
    done

    # Clean up staging
    rm -rf "$staging_dir"

    log success "All tarballs created"
}

# ---------------------------------------------------------------------------
# Generate manifest.json
# ---------------------------------------------------------------------------

build_platform_entry() {
    local version="$1"
    local platform="$2"
    local tarball_path="$RELEASE_DIR/daemux-${version}-${platform}.tar.gz"

    if [ ! -f "$tarball_path" ]; then
        log error "Tarball not found: $tarball_path"
        return 1
    fi

    local sha256 size url
    sha256="$(compute_sha256 "$tarball_path")"
    size="$(get_file_size "$tarball_path")"
    url="https://github.com/${GITHUB_REPO}/releases/download/v${version}/daemux-${version}-${platform}.tar.gz"

    printf '    "%s": {\n      "url": "%s",\n      "sha256": "%s",\n      "size": %s\n    }' \
        "$platform" "$url" "$sha256" "$size"
}

generate_manifest() {
    local version="$1"
    local min_bun_version="$2"

    log header "Generating manifest.json"

    local released
    released="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    local manifest_path="$RELEASE_DIR/manifest.json"

    local platforms_json=""
    local first=true

    for platform in "${PLATFORMS[@]}"; do
        if [ "$first" = true ]; then
            first=false
        else
            platforms_json="${platforms_json},"
        fi
        local entry
        entry="$(build_platform_entry "$version" "$platform")" || return 1
        platforms_json="${platforms_json}
${entry}"
    done

    cat > "$manifest_path" << MANIFEST_EOF
{
  "version": "${version}",
  "released": "${released}",
  "minBunVersion": "${min_bun_version}",
  "platforms": {${platforms_json}
  }
}
MANIFEST_EOF

    log success "Generated manifest.json"
}

# ---------------------------------------------------------------------------
# Print summary
# ---------------------------------------------------------------------------

print_summary() {
    local version="$1"

    log header "Release Summary (v${version})"

    log info "Files in $RELEASE_DIR:"
    echo ""

    local total_size=0
    for file in "$RELEASE_DIR"/*; do
        if [ -f "$file" ]; then
            local name size
            name="$(basename "$file")"
            size="$(get_file_size "$file")"
            total_size=$((total_size + size))

            echo "  $name  ($(format_human_size "$size"))"
        fi
    done

    echo ""
    local total_count
    total_count="$(find "$RELEASE_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')"
    log info "Total files: $total_count"

    log info "Total size:  $(format_human_size "$total_size")"

    echo ""
    log success "Release artifacts are ready in $RELEASE_DIR"
    log info "To publish: gh release create v${version} ${RELEASE_DIR}/*"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    log header "Daemux Build & Release"

    local version min_bun_version

    # Read version from package.json
    version="$(read_package_field '.version')"
    if [ -z "$version" ] || [ "$version" = "undefined" ]; then
        log error "Could not read version from package.json"
        exit 1
    fi
    log info "Version: $version"

    # Read minimum bun version from engines.bun
    min_bun_version="$(read_package_field ".engines.bun" 2>/dev/null || echo "")"
    # Strip leading comparison operators (>=, ^, ~)
    min_bun_version="$(echo "$min_bun_version" | sed 's/^[>=^~]*//')"
    if [ -z "$min_bun_version" ] || [ "$min_bun_version" = "undefined" ]; then
        min_bun_version="1.3.0"
        log warning "engines.bun not found in package.json, defaulting to $min_bun_version"
    fi
    log info "Min Bun version: $min_bun_version"

    run_build
    compile_binary
    # Prepare release directory
    rm -rf "$RELEASE_DIR"
    mkdir -p "$RELEASE_DIR"
    log success "Release directory ready: $RELEASE_DIR"
    create_tarballs "$version"
    generate_manifest "$version" "$min_bun_version"

    # Mirror manifest.json to repo root for version-controlled history
    cp "$RELEASE_DIR/manifest.json" "$PROJECT_ROOT/manifest.json"
    log success "Mirrored manifest.json to repo root"

    print_summary "$version"
}

main "$@"
