#!/usr/bin/env bash
set -euo pipefail

# Purpose: Generate stable colorful terminal output for screenshots and keyword-highlighting demos.
# Run: bash scripts/demo-terminal-output.sh
# Docs: README.md, docs-site/docs/guide/terminal.md, docs-site/docs/intro.md
# Settings: Best viewed after enabling keyword highlighting; action links are optional.

if [[ "${NO_COLOR:-}" != "" ]]; then
  RESET=""
  BOLD=""
  DIM=""
  RED=""
  GREEN=""
  YELLOW=""
  BLUE=""
  MAGENTA=""
  CYAN=""
else
  RESET=$'\033[0m'
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  BLUE=$'\033[34m'
  MAGENTA=$'\033[35m'
  CYAN=$'\033[36m'
fi

section() {
  printf '\n%s%s== %s ==%s\n' "$BOLD" "$CYAN" "$1" "$RESET"
}

log_line() {
  local color=$1
  shift
  printf '%s%s%s\n' "$color" "$*" "$RESET"
}

section "NyaTerm terminal output demo"
log_line "$DIM" "2026-04-13T09:15:30Z [demo] session=alpha host=203.0.113.10 task=deploy-preview"
log_line "$BLUE" "INFO    Loading release bundle version=v0.7.0 size=128MiB duration=2.4s"
log_line "$GREEN" "SUCCESS SSH authentication completed for operator@203.0.113.10"
log_line "$YELLOW" "WARN    High latency detected: 182ms over 3 samples"
log_line "$RED" "ERROR   retryable failure while opening artifact cache; retry in 5s"
log_line "$MAGENTA" "DEBUG   env=staging feature_flag=terminal-gutter trace_id=550e8400-e29b-41d4-a716-446655440000"

section "Structured log samples"
log_line "$DIM" "2026-04-13 09:16:01 app[web.1]: request_id=req-001 method=GET path=/health status=200 duration=12ms"
log_line "$DIM" "2026-04-13 09:16:02 app[worker.2]: queue=sync-jobs processed=24 failed=0"
log_line "$DIM" "2026-04-13 09:16:03 app[worker.2]: queue=alerts processed=24 failed=1 retry_in=30s"
log_line "$RED" "panic: connection pool exhausted after 32 attempts"
log_line "$GREEN" "backup completed successfully at 2026-04-13 09:16:30"

section "Match-friendly tokens"
log_line "$BOLD" "datetime=2026-04-13T09:17:00Z number=4096 size=512MB duration=45s version=1.18.2"
log_line "$BOLD" "uuid=123e4567-e89b-12d3-a456-426614174000 address=2001:db8::10 constant=MAX_RETRY_COUNT"
log_line "$BOLD" "status=SUCCESS next_window=2026-04-13T09:20:00Z"

section "Final summary"
log_line "$GREEN" "3 services healthy"
log_line "$YELLOW" "1 warning requires review"
log_line "$RED" "1 transient error captured for screenshot contrast"
