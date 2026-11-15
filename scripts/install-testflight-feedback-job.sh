#!/usr/bin/env bash
# Install (or remove) the hourly TestFlight feedback sync on the release Mac.
#
#   scripts/install-testflight-feedback-job.sh             # install and run once now
#   scripts/install-testflight-feedback-job.sh --print     # show the job, change nothing
#   scripts/install-testflight-feedback-job.sh --uninstall # stop and remove the job
#
# The job runs as the signed-in user from a dedicated detached worktree at
# ~/worktrees/testflight-feedback, moved to origin/main before every run, so it
# never touches your own checkouts. It needs the ASC API key in
# ~/.appstoreconnect/private_keys/ and a signed-in `gh`. See
# docs/TESTFLIGHT.md.
set -euo pipefail

readonly LABEL="app.tresfort.testflight-feedback"
readonly PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
readonly WORKTREE="${TESTFLIGHT_FEEDBACK_WORKTREE:-${HOME}/worktrees/testflight-feedback}"
readonly LOG="${HOME}/Library/Logs/tres-fort-testflight-feedback.log"
readonly KEY="${HOME}/.appstoreconnect/private_keys/AuthKey_VP9G3R7Q85.p8"
readonly INTERVAL="${TESTFLIGHT_FEEDBACK_INTERVAL:-3600}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
readonly REPO_DIR

fail() { echo "error: $*" >&2; exit 1; }

xml_escape() {
  local s="$1"
  s="${s//&/&amp;}"; s="${s//</&lt;}"; s="${s//>/&gt;}"
  printf '%s' "$s"
}

plist() {
  local path_dirs node_dir gh_dir run
  node_dir="$(dirname "$(command -v node || echo /opt/homebrew/bin/node)")"
  gh_dir="$(dirname "$(command -v gh || echo /opt/homebrew/bin/gh)")"
  path_dirs="${node_dir}:${gh_dir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
  run="cd '${WORKTREE}' && { git fetch -q origin main && git checkout -q --detach origin/main || echo 'warning: could not update worktree; using current checkout'; } && exec bash scripts/testflight-feedback-sync.sh"
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>$(xml_escape "${run}")</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${path_dirs}</string>
  </dict>
  <key>StartInterval</key><integer>${INTERVAL}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
PLIST
}

case "${1:-}" in
  --print)
    plist
    exit 0
    ;;
  --uninstall)
    launchctl bootout "gui/$(id -u)" "${PLIST}" 2>/dev/null || true
    rm -f "${PLIST}"
    echo "Removed ${LABEL}. The worktree at ${WORKTREE} and saved feedback are left in place."
    exit 0
    ;;
  "") ;;
  *) fail "unknown option $1" ;;
esac

[ "$(uname -s)" = "Darwin" ] || fail "this installs a macOS launchd job; run it on the release Mac"
command -v node >/dev/null || fail "node is not on PATH"
command -v gh >/dev/null || fail "gh is not on PATH"
test -f "${KEY}" || fail "missing App Store Connect API key at ${KEY}"
gh auth status >/dev/null 2>&1 || fail "gh is not signed in; run gh auth login first"

if [ ! -d "${WORKTREE}" ]; then
  git -C "${REPO_DIR}" fetch -q origin main
  mkdir -p "$(dirname "${WORKTREE}")"
  git -C "${REPO_DIR}" worktree add -q --detach "${WORKTREE}" origin/main
  echo "Created worktree ${WORKTREE} at origin/main."
fi
test -f "${WORKTREE}/scripts/testflight-feedback-sync.sh" \
  || fail "${WORKTREE} has no scripts/testflight-feedback-sync.sh; is this change merged to main yet?"

mkdir -p "$(dirname "${PLIST}")" "$(dirname "${LOG}")"
plist > "${PLIST}"
launchctl bootout "gui/$(id -u)" "${PLIST}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${PLIST}"
echo "Installed ${LABEL}: runs now and every ${INTERVAL}s. Log: ${LOG}"
