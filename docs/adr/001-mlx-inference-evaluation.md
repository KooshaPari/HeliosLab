# ADR 001: MLX as Primary Inference Engine

## Status

Proposed

## Date

2026-02-28

## Context

Co(lab) vendors llama.cpp for local LLM inference, requiring a C++ toolchain (cmake + zig) for builds. Apple's MLX framework offers native Apple Silicon support with unified memory architecture and significantly faster inference.

The current llama.cpp integration requires:

- CMake build system
- Zig compiler for native binaries
- ~5-8MB binary size with Metal backend
- ~150 tok/s generation speed on Apple Silicon

## Decision

Adopt MLX as the primary inference engine on macOS Apple Silicon. Retain llama.cpp as fallback for non-Apple platforms and older Macs without unified memory.

## Performance Comparison

| Metric              | MLX               | llama.cpp (Metal)      |
| ------------------- | ----------------- | ---------------------- |
| Token generation    | ~230 tok/s        | ~150 tok/s             |
| Time to first token | 50-100ms          | 100-150ms              |
| Model loading       | 5-10s             | 30s+                   |
| Memory overhead     | Minimal (unified) | Higher (copy overhead) |
| Binary size         | ~12-18MB          | ~5-8MB                 |
| GPU utilization     | >90%              | ~70%                   |

## Integration Surface

Files that interact with the llama.cpp inference backend:

- `setup-deps.ts` — Vendors llama.cpp source and runs cmake + zig build
- `postBuild.ts` — Builds llama CLI binary via zig
- Inference API call sites (to be identified during implementation)

## Migration Path

1. Add MLX.zig bindings (github.com/jaco-bro/MLX.zig)
2. Create unified inference interface (strategy pattern)
3. Implement MLX backend behind interface
4. Runtime detection: Apple Silicon → MLX, else → llama.cpp
5. Deprecate direct llama.cpp calls, route through interface
6. Update setup-deps.ts to conditionally vendor MLX or llama.cpp

## Fallback Strategy

- **Primary**: MLX on Apple Silicon (M1+)
- **Fallback 1**: llama.cpp with Metal backend on older Macs
- **Fallback 2**: llama.cpp with CPU backend on non-Apple platforms
- **Detection**: Check `process.arch === 'arm64'` and `process.platform === 'darwin'` at startup

## Risks

- **MLX.zig maturity**: Bindings are newer (March 2025); may have gaps for advanced features
- **Model format**: MLX uses safetensors natively; GGUF models need conversion
- **Binary size increase**: MLX adds ~12-18MB vs llama.cpp's ~5-8MB
- **Apple-only**: MLX only works on Apple Silicon — cannot be sole engine

## Consequences

### Positive

- ~53% faster inference on primary platform (Apple Silicon)
- Eliminates C++ toolchain requirement for macOS builds
- Better memory efficiency via unified memory (zero-copy ops)
- Aligned with Apple's ML direction (WWDC 2025)

### Negative

- Must maintain two inference backends
- MLX model library is smaller than GGUF ecosystem
- Slightly larger binary size on macOS
- Additional testing matrix (MLX + llama.cpp paths)

## References

- MLX Documentation: ml-explore.github.io/mlx
- llama.cpp.zig bindings: github.com/Deins/llama.cpp.zig
- MLX.zig bindings: github.com/jaco-bro/MLX.zig
- Benchmarking study: "Production-Grade Local LLM Inference on Apple Silicon" (2025)
