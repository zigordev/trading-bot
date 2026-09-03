FROM rust:1.94-bookworm AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    libssl-dev \
    perl \
    pkg-config \
    zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates/execution /app/crates/execution
COPY crates/market-data /app/crates/market-data
COPY crates/observability /app/crates/observability
COPY crates/research-backtesting /app/crates/research-backtesting
COPY crates/strategy-engine /app/crates/strategy-engine

RUN cargo build --release -p trading-bot-execution

FROM debian:bookworm-slim AS local
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    libsasl2-2 \
    libzstd1 \
    tini \
    wget \
    zlib1g \
  && rm -rf /var/lib/apt/lists/*

# A dedicated unprivileged user. A container running as root shares uid 0
# with the host, so a container escape starts with root rather than having
# to earn it. Nothing here needs privileges: the binary listens on a port
# above 1024 and writes nothing outside /tmp.
RUN useradd --system --create-home --uid 10001 --shell /usr/sbin/nologin app

COPY --from=build /app/target/release/trading-bot-execution /usr/local/bin/trading-bot-execution
RUN chown app:app /usr/local/bin/trading-bot-execution

EXPOSE 8120

USER app

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["trading-bot-execution"]
