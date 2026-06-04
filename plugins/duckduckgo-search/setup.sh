#!/usr/bin/env bash
# Install Python dependencies for duckduckgo-search plugin
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

echo "Creating Python virtual environment..."
python3 -m venv "$VENV_DIR"

echo "Installing duckduckgo-search Python dependencies..."
"$VENV_DIR/bin/pip" install -r "$SCRIPT_DIR/requirements.txt"

echo "Done. Virtual environment created at $VENV_DIR"
