.PHONY: help build test bench lint fmt clippy audit deny doc ci clean docker-smoke

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: ## cargo build --workspace --all-targets
	cargo build --workspace --all-targets

test: ## cargo test --workspace
	cargo test --workspace --all-features

bench: ## cargo bench --workspace
	cargo bench --workspace -- --output-format bencher

lint: ## cargo clippy --workspace --all-targets -- -D warnings
	cargo clippy --workspace --all-targets -- -D warnings

fmt: ## cargo fmt --all
	cargo fmt --all -- --check

clippy: lint ## alias

audit: ## cargo audit
	cargo audit --deny warnings

deny: ## cargo deny check
	cargo deny check

doc: ## cargo doc --workspace --no-deps
	cargo doc --workspace --no-deps --all-features

ci: fmt lint deny audit test ## Run the full local CI matrix

clean: ## cargo clean
	cargo clean

docker-smoke: ## Local multi-stage Docker build + CLI --help (no registry push)
	docker build -t benchora:local .
	docker run --rm benchora:local --help
