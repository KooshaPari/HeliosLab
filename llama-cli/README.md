# llama-cli

A Zig-based command-line interface for running llama.cpp models with support for request cancellation and temperature control.

## Features

- ✅ Request cancellation support (SIGINT/SIGTERM)
- ✅ Temperature control for sampling
- ✅ Streaming and non-streaming output
- ✅ Stop token support
- ✅ Configurable context size and thread count
- ✅ Mock mode for testing without llama.cpp dependencies

## Building

### Mock Version (for testing)

The mock version provides a working CLI without requiring llama.cpp dependencies. It generates realistic code completions based on the input prompt.

```bash
cd llama-cli
../vendors/zig/zig build
```

This builds the mock version at `zig-out/bin/llama-cli-mock`.

### Full Version (with llama.cpp)

To build with actual llama.cpp support:

1. Set up llama.cpp dependencies:
   ```bash
   ./setup-llama.sh
   ```

2. Switch to the full build configuration:
   ```bash
   mv build.zig build-mock.zig
   mv build-full.zig build.zig
   ```

3. Build:
   ```bash
   ../vendors/zig/zig build
   ```

## Usage

### Mock Version

```bash
./zig-out/bin/llama-cli-mock --model dummy.gguf --prompt "function add(a, b) {" --temperature 0.1
```

### Full Version (when built with llama.cpp)

```bash
./zig-out/bin/llama-cli --model /path/to/model.gguf --prompt "Complete this code:" --temperature 0.1
```

### Command Line Options

- `--model PATH`: Path to the GGUF model file (required)
- `--prompt TEXT`: Input prompt (required, or read from stdin)
- `--temperature FLOAT`: Temperature for sampling (default: 0.1)
- `--max-tokens INT`: Maximum tokens to generate (default: 100)
- `--top-p FLOAT`: Top-p sampling parameter (default: 0.95)
- `--top-k INT`: Top-k sampling parameter (default: 40)
- `--repeat-penalty FLOAT`: Repeat penalty (default: 1.1)
- `--n-threads INT`: Number of threads to use (default: 4)
- `--n-ctx INT`: Context size (default: 2048)
- `--stop TOKEN`: Stop token (can be used multiple times)
- `--no-stream`: Disable streaming output
- `--help`: Show help message

### Integration with Colab

The binary is designed to be spawned from the main Bun process in Colab. Key features for integration:

1. **Request Cancellation**: The process responds to SIGINT/SIGTERM for immediate cancellation
2. **Streaming Output**: Real-time token generation with `--stream` (default)
3. **Temperature Control**: Fine-grained sampling control with `--temperature`
4. **Configurable Context**: Adjust context size with `--n-ctx` based on model capabilities

Example integration:
```javascript
import { spawn } from 'child_process';

const llamaProcess = spawn('./llama-cli/zig-out/bin/llama-cli', [
  '--model', modelPath,
  '--prompt', prompt,
  '--temperature', '0.1',
  '--max-tokens', '100',
  '--stop', '\n\n'
]);

// Handle streaming output
llamaProcess.stdout.on('data', (data) => {
  console.log(data.toString());
});

// Cancel generation if needed
setTimeout(() => {
  llamaProcess.kill('SIGINT');
}, 5000);
```

## Architecture

- `src/main.zig`: Full implementation with llama.cpp integration
- `src/main-mock.zig`: Mock implementation for testing
- `src/llama_bindings.zig`: Zig bindings for llama.cpp C API
- `build.zig`: Current build configuration (points to mock by default)
- `build-full.zig`: Full build configuration with llama.cpp
- `setup-llama.sh`: Script to fetch and set up llama.cpp dependencies

The mock version provides realistic code completions based on prompt analysis, making it perfect for development and testing of the Colab integration without requiring actual model files.