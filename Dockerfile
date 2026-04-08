# ── Stage 1: builder ──────────────────────────────────────────────────────
# Use the official Rust image. For cross-compiling to aarch64 (e.g. RPi 4 /
# EliteDesk ARM) add --platform linux/arm64 or use cross.
FROM rust:1.80-slim-bookworm AS builder

ARG FEATURES=""

# System deps for linking
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Cache dependencies by copying manifests first
COPY Cargo.toml Cargo.lock ./
COPY crates/patchbox-core/Cargo.toml  crates/patchbox-core/
COPY crates/patchbox-dante/Cargo.toml crates/patchbox-dante/
COPY crates/patchbox/Cargo.toml       crates/patchbox/

# Create stub src files so `cargo build` can cache deps without the real source
RUN mkdir -p crates/patchbox-core/src crates/patchbox-dante/src crates/patchbox/src \
    && echo 'fn main() {}' > crates/patchbox/src/main.rs \
    && touch crates/patchbox-core/src/lib.rs crates/patchbox-dante/src/lib.rs \
    && touch crates/patchbox/src/lib.rs

RUN cargo build --release --package patchbox 2>&1 | tail -3 || true

# Now copy the real source and web-ui, and do the real build
COPY crates/       crates/
COPY web-ui/       web-ui/

# Touch to invalidate the cached stub artefacts
RUN touch crates/patchbox/src/main.rs crates/patchbox/src/lib.rs \
          crates/patchbox-core/src/lib.rs crates/patchbox-dante/src/lib.rs

RUN if [ -n "$FEATURES" ]; then \
        cargo build --release --package patchbox --features "$FEATURES"; \
    else \
        cargo build --release --package patchbox; \
    fi

# ── Stage 2: runtime ──────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

# O-05: OCI image labels (source, description, version, license, authors)
ARG VERSION="0.1.0"
LABEL org.opencontainers.image.title="dante-patchbox" \
      org.opencontainers.image.description="Dante AoIP matrix mixer and DSP patchbay for pub/venue sound systems" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/legopc/dante-patchbox" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.authors="legopc" \
      org.opencontainers.image.documentation="https://github.com/legopc/dante-patchbox/blob/main/README.md"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create an unprivileged user
RUN groupadd -r patchbox && useradd -r -g patchbox patchbox

# Copy the binary from builder
COPY --from=builder /build/target/release/patchbox /usr/local/bin/patchbox

# Default config location (override via -v or PATCHBOX_CONFIG env var)
RUN mkdir -p /etc/patchbox /var/lib/patchbox/scenes \
    && chown -R patchbox:patchbox /etc/patchbox /var/lib/patchbox

USER patchbox

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
    CMD wget -qO- http://localhost:8080/api/v1/health || exit 1

# NOTE: The 'inferno' feature (real Dante) is NOT enabled by default.
# For real Dante I/O, rebuild with:
#   docker build --build-arg FEATURES=inferno -t dante-patchbox:inferno .
# and the container needs --network host + CAP_NET_RAW + a running statime daemon.
# For TLS support: --build-arg FEATURES=tls
ENTRYPOINT ["/usr/local/bin/patchbox"]
CMD ["--port", "8080"]
