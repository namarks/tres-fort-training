#!/usr/bin/env bash
# Scheduled TestFlight feedback sync for the release Mac.
#
# 1. Saves recent feedback (comment, screenshots, crash log) under
#    ~/Downloads/testflight-feedback/ before Apple's screenshot links expire.
# 2. Raw feedback stays private by default. Optional GitHub mirroring requires
#    FEEDBACK_FILE_ISSUES=1 and REPO=owner/private-repo; the mirror checks privacy.
#
# Run by the launchd job that scripts/install-testflight-feedback-job.sh
# installs; safe to run by hand. Both steps are idempotent.
set -euo pipefail

cd "$(dirname "$0")/.."
echo "== $(date -u +%Y-%m-%dT%H:%M:%SZ) TestFlight feedback sync at $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

# The private reader prints raw reports on stdout; do not copy them to launchd logs.
node scripts/testflight-feedback.mjs --days "${FEEDBACK_DAYS:-30}" --save > /dev/null

if [ "${FEEDBACK_FILE_ISSUES:-0}" = "1" ]; then
  node scripts/beta-feedback-to-issues.mjs
fi
