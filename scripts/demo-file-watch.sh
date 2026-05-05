#!/usr/bin/env bash
set -euo pipefail

# Purpose: Append visible changes to a file so NyaTerm's auto-upload prompt can be triggered.
# Run: bash scripts/demo-file-watch.sh /path/to/file [iterations] [delay_seconds]
# Docs: docs-site/docs/guide/file-transfer.md
# Settings: First open a remote file from NyaTerm so the local temp copy is being watched.

TARGET_FILE=${1:-./demo-file-watch-target.txt}
ITERATIONS=${2:-5}
DELAY_SECONDS=${3:-1}

mkdir -p "$(dirname "$TARGET_FILE")"

if [[ ! -f "$TARGET_FILE" ]]; then
  printf '# NyaTerm file watch demo\n' > "$TARGET_FILE"
fi

printf 'Updating %s for %s iterations with %ss delay.\n' "$TARGET_FILE" "$ITERATIONS" "$DELAY_SECONDS"

for ((i = 1; i <= ITERATIONS; i++)); do
  printf '\n[%s] auto-upload demo change %02d\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$i" >> "$TARGET_FILE"
  printf 'status=modified source=demo-file-watch iteration=%02d\n' "$i" >> "$TARGET_FILE"
  printf 'Wrote iteration %02d to %s\n' "$i" "$TARGET_FILE"
  sleep "$DELAY_SECONDS"
done

printf 'File watch demo finished. If NyaTerm opened this file, you should have seen upload prompts.\n'
