#!/bin/bash
# Cloud sessions start from a fresh clone with no node_modules; install so tools like tools/ops.mjs can run.
set -euo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
cd "$CLAUDE_PROJECT_DIR"
npm ci --no-audit --no-fund
