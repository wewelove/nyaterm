#!/usr/bin/env bash
set -euo pipefail

# Purpose: Print realistic terminal-style scenarios that exercise the built-in rules
# in src/lib/keywordHighlightPresets.ts.
# Run: bash scripts/demo-keyword-highlight-presets.sh
# Docs: docs-site/docs/guide/terminal.md
# Settings: Enable keyword highlighting before running.

if [[ "${NO_COLOR:-}" != "" ]]; then
  RESET=""
  BOLD=""
  CYAN=""
else
  RESET=$'\033[0m'
  BOLD=$'\033[1m'
  CYAN=$'\033[36m'
fi

section() {
  printf '\n%s%s== %s ==%s\n' "$BOLD" "$CYAN" "$1" "$RESET"
}

section "Deploy health check"
cat <<'EOF'
2026-04-13T09:17:00Z INFO  deploy target=prod-bj-1 version=v0.7.0 operator="release-bot"
2026-04-13T09:17:01Z DEBUG command="./deploy.sh --env prod --tag v0.7.0 --dry-run"
2026-04-13T09:17:02Z NOTICE release channel=stable revision=1.18.2 elapsed=245ms
2026-04-13T09:17:03Z SUCCESS completed successfully host=192.168.1.10 duration=2.4s size=128MB
EOF

section "Service startup log"
cat <<'EOF'
[web] 2026/04/13 09:18:10 info starting api-server on 0.0.0.0:8080 build=1.18.2
[web] 2026/04/13 09:18:11 debug loaded config from "/etc/nyaterm/app.json"
[web] 2026/04/13 09:18:12 warn deprecated option --legacy-auth=true will be removed in beta
[web] 2026/04/13 09:18:13 notice public endpoint https://nyaterm.example.test/docs?tab=terminal
[web] 2026/04/13 09:18:14 success health check passed in 5ms
EOF

section "Failure and retry"
cat <<'EOF'
2026-04-13T09:19:20Z ERROR failed to connect upstream=db.internal.test:5432 attempt=3 retry_in=30 sec
2026-04-13T09:19:21Z FATAL exception=timeout panic trace_id=123e4567-e89b-12d3-a456-426614174000
2026-04-13T09:19:22Z DEBUG opts="--host db.internal.test --port 5432 -v"
2026-04-13T09:19:23Z INFO  fallback address=2001:db8::10 state=null mode=verbose
EOF

section "Security and auth"
cat <<'EOF'
auth[otp] issuer="NyaTerm" user='ops@example.test' code=042631 period=30s
ssh[client] host=203.0.113.42 fingerprint="SHA256:AbCdEf123456" status=ok
config[policy] strict=true allow_none=false allow_debug=true
EOF

section "File and artifact operations"
cat <<'EOF'
download release-v0.7.0.zip -> /tmp/releases/release-v0.7.0.zip size=64 MiB elapsed=1.25s
extract backup-2026-04-13.tar.gz to "/srv/backups/current" result=done
upload artifacts-2026-04-13.tar.xz bytes=512MB speed=10kbps remaining=4h
EOF

section "Structured values"
cat <<'EOF'
metrics: cpu=87.5% mem=1.5GB rss=512 bytes uptime=7days
flags: enabled=true readonly=false pointer=nullptr sentinel=EOF
network: mac=AA:BB:CC:DD:EE:FF ws=wss://stream.example.test/socket ftp=ftp://mirror.example.test/releases/v0.7.0.tar.gz
ops: expr=[] {} () == && ++ -- += value=0xff ratio=-0.75 note="quoted string value"
EOF

section "Mixed summary line"
cat <<'EOF'
2026-04-13T09:20:00Z INFO release=v0.7.0 host=192.168.1.10 url=https://nyaterm.example.test elapsed=45s size=128MB state=success
EOF
