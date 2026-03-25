#!/usr/bin/env bash
set -euo pipefail

REDPANDA_CONTAINER="$(
  docker ps --format '{{.Names}} {{.Image}}' \
    | awk '$1 ~ /redpanda/ && $1 !~ /console/ && $2 ~ /redpanda/ { print $1; exit }'
)"

if [ -z "$REDPANDA_CONTAINER" ]; then
  echo "No running Redpanda container found. Skipping Kafka reset."
  exit 0
fi

BROKERS="platform-redpanda:9092"
TOPIC_PREFIX="trading-bot."
GROUP_PREFIX="trading-bot-"

echo "Resetting Kafka topics in $REDPANDA_CONTAINER"

topics="$(
  docker exec "$REDPANDA_CONTAINER" \
    rpk topic list --brokers "$BROKERS" 2>/dev/null \
    | awk 'NR > 1 { print $1 }' \
    | grep "^${TOPIC_PREFIX}" || true
)"

if [ -n "$topics" ]; then
  while IFS= read -r topic; do
    [ -n "$topic" ] || continue
    echo "Deleting Kafka topic: $topic"
    docker exec "$REDPANDA_CONTAINER" \
      rpk topic delete "$topic" --brokers "$BROKERS" >/dev/null
  done <<< "$topics"
fi

groups="$(
  docker exec "$REDPANDA_CONTAINER" \
    rpk group list --brokers "$BROKERS" 2>/dev/null \
    | awk 'NR > 1 { print $1 }' \
    | grep "^${GROUP_PREFIX}" || true
)"

if [ -n "$groups" ]; then
  while IFS= read -r group; do
    [ -n "$group" ] || continue
    echo "Deleting Kafka consumer group: $group"
    docker exec "$REDPANDA_CONTAINER" \
      rpk group delete "$group" --brokers "$BROKERS" >/dev/null || true
  done <<< "$groups"
fi

echo "Kafka reset completed."
