#!/usr/bin/env bash
set -euo pipefail

# Purpose: Create mild short-lived CPU and disk activity for remote resource monitor screenshots.
# Run: bash scripts/demo-remote-stats.sh [duration_seconds]
# Docs: docs-site/docs/guide/terminal.md
# Settings: Run on a remote SSH host after enabling remote resource monitoring.

DURATION_SECONDS=${1:-20}
WORKERS=${WORKERS:-2}
PAYLOAD_MB=${PAYLOAD_MB:-8}

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/nyaterm-stats-demo.XXXXXX")
PAYLOAD_FILE="$TMP_DIR/payload.bin"
END_TIME=$((SECONDS + DURATION_SECONDS))
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

hash_once() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" >/dev/null
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" >/dev/null
  else
    cksum "$1" >/dev/null
  fi
}

printf 'Preparing %s MiB payload in %s\n' "$PAYLOAD_MB" "$TMP_DIR"
dd if=/dev/zero of="$PAYLOAD_FILE" bs=1M count="$PAYLOAD_MB" status=none

worker() {
  while (( SECONDS < END_TIME )); do
    hash_once "$PAYLOAD_FILE"
  done
}

for ((i = 1; i <= WORKERS; i++)); do
  worker &
  PIDS+=("$!")
done

while (( SECONDS < END_TIME )); do
  cp "$PAYLOAD_FILE" "$TMP_DIR/copy.bin"
  wc -c < "$TMP_DIR/copy.bin" >/dev/null
  rm -f "$TMP_DIR/copy.bin"
  printf '[stats-demo] remaining=%02ds workers=%s payload=%sMiB temp_dir=%s\n' "$((END_TIME - SECONDS))" "$WORKERS" "$PAYLOAD_MB" "$TMP_DIR"
  sleep 1
done

wait
printf 'Remote stats demo complete.\n'
