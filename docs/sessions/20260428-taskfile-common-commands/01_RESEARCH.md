# Research

## Repo signals

- `pyproject.toml` defines the Python package, test config, and ruff config.
- `README.md` describes the benchmark harness as a Python CLI with docs support.
- No root `package.json`, `Cargo.toml`, or `go.mod` is present.

## Conclusion

The repo is Python-first, so the common task aliases should use `uv`/`pytest`/`ruff`
for the main flow.
