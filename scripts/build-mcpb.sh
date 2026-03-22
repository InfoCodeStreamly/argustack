#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_ROOT/.mcpb-build"
OUTPUT="$PROJECT_ROOT/argustack.mcpb"

echo "Building Argustack MCPB..."

# Clean previous build
rm -rf "$BUILD_DIR" "$OUTPUT"
mkdir -p "$BUILD_DIR"

# Copy required files
cp "$PROJECT_ROOT/manifest.json" "$BUILD_DIR/"
cp -r "$PROJECT_ROOT/dist" "$BUILD_DIR/"
cp -r "$PROJECT_ROOT/assets" "$BUILD_DIR/"
cp "$PROJECT_ROOT/package.json" "$BUILD_DIR/"

# Install production dependencies only (no devDeps, no native scripts)
cd "$BUILD_DIR"
npm install --omit=dev --ignore-scripts 2>&1 | tail -1
cd "$PROJECT_ROOT"

# Create .mcpb (ZIP archive)
cd "$BUILD_DIR"
zip -rq "$OUTPUT" . -x "*.DS_Store" -x "__MACOSX/*" -x "*.map"
cd "$PROJECT_ROOT"

# Cleanup
rm -rf "$BUILD_DIR"

SIZE=$(du -h "$OUTPUT" | cut -f1)
echo "Built: argustack.mcpb ($SIZE)"
