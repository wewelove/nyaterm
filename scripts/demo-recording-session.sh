#!/usr/bin/env bash
set -euo pipefail

# Purpose: Print a structured pseudo-session that looks good when NyaTerm recording is enabled.
# Run: bash scripts/demo-recording-session.sh
# Docs: docs-site/docs/guide/terminal.md, docs-site/docs/getting-started/quick-start.md
# Settings: Start recording in NyaTerm before running for the best capture.

DELAY_SECONDS=${DELAY_SECONDS:-0.35}
PROMPT=${PROMPT:-'operator@nyaterm-demo:~/workspace$'}

emit() {
  printf '%s\n' "$1"
  sleep "$DELAY_SECONDS"
}

emit "$PROMPT pwd"
emit "/home/operator/workspace"
emit "$PROMPT git status --short"
emit " M configs/app.yml"
emit "?? docs/screenshots-plan.md"
emit "$PROMPT ./deploy/check-health.sh"
emit "[INFO] checking api.example.test:8080"
emit "[INFO] checking db.internal.test:5432"
emit "[WARN] background job queue depth is above target"
emit "[SUCCESS] web, worker, and scheduler are reachable"
emit "$PROMPT tail -n 3 logs/app.log"
emit "2026-04-13T09:21:10Z INFO  startup complete"
emit "2026-04-13T09:21:11Z WARN  cache warmup slower than baseline"
emit "2026-04-13T09:21:12Z ERROR retryable timeout contacting 203.0.113.42"
emit "$PROMPT echo 'recording demo complete'"
emit "recording demo complete"
