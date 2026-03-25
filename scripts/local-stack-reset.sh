#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$REPO_ROOT/scripts/local-stack-down.sh" --volumes
"$REPO_ROOT/scripts/local-kafka-reset.sh"
