#!/usr/bin/env bash
set -euo pipefail

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is not installed. Install it to run secret scans." >&2
  echo "macOS (brew): brew install gitleaks" >&2
  echo "Other: https://github.com/gitleaks/gitleaks#installation" >&2
  exit 1
fi

is_ci="false"
if [ "${CI+x}" = "x" ] && [ "$CI" = "true" ]; then
  is_ci="true"
fi

is_github_actions="false"
if [ "${GITHUB_ACTIONS+x}" = "x" ] && [ "$GITHUB_ACTIONS" = "true" ]; then
  is_github_actions="true"
fi

if [ "$is_ci" = "true" ] || [ "$is_github_actions" = "true" ]; then
  gitleaks detect --source . --no-git --redact --config .gitleaks.toml --no-banner
  echo "Secret scan passed (CI full-repo mode)."
  exit 0
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ -z "$(git diff --cached --name-only)" ]; then
    echo "No staged files; skipping gitleaks staged scan."
    exit 0
  fi

  staged_paths="$(
    git diff --cached --name-only \
      | grep -Ev '(^|/)docker/\.env\..*\.local(\..*)?$|(^|/)\.env\..*\.local(\..*)?$' \
      || true
  )"

  if [ -z "$staged_paths" ]; then
    echo "Only local env files are staged; skipping gitleaks staged scan."
    exit 0
  fi

  printf '%s\n' "$staged_paths" \
    | xargs -I {} sh -c 'git show ":$1" 2>/dev/null || true' _ {} \
    | gitleaks detect --pipe --redact --config .gitleaks.toml --no-banner
else
  gitleaks detect --source . --redact --config .gitleaks.toml --no-banner
fi

echo "Secret scan passed."
