#!/bin/bash

# Script to fetch and set up llama.cpp for the llama-cli project

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPS_DIR="$SCRIPT_DIR/deps"

echo "Setting up llama.cpp for llama-cli..."

# Create deps directory if it doesn't exist
mkdir -p "$DEPS_DIR"

# Read commit from versions.env to avoid duplication
SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$SCRIPT_ROOT/.github/workflows/versions.env" ]; then
    source "$SCRIPT_ROOT/.github/workflows/versions.env"
else
    echo "Error: versions.env not found"
    exit 1
fi

# Clone or update llama.cpp
if [ -d "$DEPS_DIR/llama.cpp" ]; then
    echo "Checking llama.cpp at commit $LLAMA_CPP_COMMIT..."
    cd "$DEPS_DIR/llama.cpp"
    git fetch
    git checkout "$LLAMA_CPP_COMMIT"
else
    echo "Cloning llama.cpp..."
    cd "$DEPS_DIR"
    git clone https://github.com/ggerganov/llama.cpp.git
    cd llama.cpp
    git checkout "$LLAMA_CPP_COMMIT"
fi

echo "llama.cpp setup complete!"
echo ""
echo "To build the llama-cli binary, run:"
echo "  cd $SCRIPT_DIR"
echo "  ../vendors/zig/zig build"
echo ""
echo "Usage example:"
echo "  ./zig-out/bin/llama-cli --model /path/to/model.gguf --prompt 'Hello' --temperature 0.1"