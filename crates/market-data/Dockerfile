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

RUN cargo build --release -p trading-bot-market-data

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

COPY --from=build /app/target/release/trading-bot-market-data /usr/local/bin/trading-bot-market-data

EXPOSE 8090

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["trading-bot-market-data"]
