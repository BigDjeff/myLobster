#!/usr/bin/env bash
set -euo pipefail

# Runs a one-shot Claude Code prompt in ~/.openclaw and prints raw output.
# Usage: scripts/claudecode-run.sh "your full prompt"

PROMPT="${1:-}"
WORKDIR="${HOME}/.openclaw"

if [ -z "$PROMPT" ]; then
  echo "ERROR: missing prompt"
  exit 1
fi

cd "$WORKDIR"
claude -p "$PROMPT"
