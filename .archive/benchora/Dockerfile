# syntax=docker/dockerfile:1
# Minimal multi-stage image for the `benchora` CLI (BENCH-004 / L27).
# Local build + smoke only — no registry login, push, or org secrets.

FROM rust:1-bookworm AS builder
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY src ./src
COPY benches ./benches
COPY examples ./examples
RUN cargo build --release --locked --bin benchora \
 && strip target/release/benchora

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/target/release/benchora /usr/local/bin/benchora
USER nobody
ENTRYPOINT ["benchora"]
CMD ["--help"]
