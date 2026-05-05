#!/usr/bin/env bash
set -euo pipefail

# Purpose: Print text patterns that NyaTerm action links can recognize.
# Run: bash scripts/demo-action-links.sh
# Docs: docs-site/docs/guide/terminal.md
# Settings: Enable action links before running; open a link with Ctrl/Cmd + click.

cat <<'EOF'
Action link matcher demo
========================

IPv4 samples:
- primary gateway: 192.0.2.1
- cache node: 198.51.100.24
- api endpoint: 203.0.113.42

host:port samples:
- app.example.test:8080
- db.internal.test:5432
- ssh-gateway.test:2222
- metrics.service.test:9100

archive filename samples:
- backup-2026-04-13.tar.gz
- release-v0.7.0.zip
- logs-rolling-01.tgz
- artifacts-2026-04-13.tar.xz

Mixed line:
- connect to 203.0.113.42 then inspect backup-2026-04-13.tar.gz on db.internal.test:5432
EOF
