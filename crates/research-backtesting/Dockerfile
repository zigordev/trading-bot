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
COPY crates/research-backtesting /app/crates/research-backtesting
COPY crates/strategy-engine /app/crates/strategy-engine

RUN cargo build --release -p trading-bot-research-backtesting

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

COPY --from=build /app/target/release/trading-bot-research-backtesting /usr/local/bin/trading-bot-research-backtesting

EXPOSE 8110

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["trading-bot-research-backtesting"]
