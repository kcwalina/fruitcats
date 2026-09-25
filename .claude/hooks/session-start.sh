#!/bin/bash
# Installs the repo's packages when any is missing: a fresh clone in the cloud, a new worktree, or a checkout
# installed before a package was added (the Via Mochi health watch failed on @azure/identity that way).
set -euo pipefail
cd "$CLAUDE_PROJECT_DIR"
if npm ls --depth=0 >/dev/null 2>&1; then
  exit 0
fi
npm install --no-audit --no-fund
