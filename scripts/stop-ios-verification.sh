#!/usr/bin/env bash
# Stop what a cancelled CI job left running on a persistent runner (the Mac
# mini). Cancelling a job stops only the step's shell, so its verify-ios.sh
# keeps running the tests and their simulator for up to half an hour, holding
# memory and the build lock. A job whose runner died never reaches its
# cleanup at all. CI runs this at the start and end of every job on the Mac;
# after a verification that finished, there is nothing to stop.
set -euo pipefail
workspace="$(cd "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is not set}" && pwd -P)"
runner="${RUNNER_NAME:?RUNNER_NAME is not set}"
wait_seconds="${TRESFORT_IOS_STOP_WAIT:-60}"

descendants() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    echo "$child"
    descendants "$child"
  done
}

# Each runner has its own checkout and takes one job at a time, so a
# verification still running there belongs to a job that has ended, whether
# it holds the build lock or is waiting for it.
leftovers=()
for pid in $(pgrep -u "$(id -u)" -f 'verify-ios\.sh' 2>/dev/null); do
  # A verification that exits after pgrep found it makes lsof fail; it has
  # nothing left to stop, so move on to the next one.
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" || continue
  [[ "$cwd" == "$workspace" ]] && leftovers+=("$pid")
done
if (( ${#leftovers[@]} )); then
  echo "Stopping the verification left running by a cancelled job: ${leftovers[*]}"
  # Stop xcodebuild and the other children too: the shell runs its TERM trap
  # only once its foreground command exits. The trap then deletes the
  # simulator and releases the build lock.
  for pid in "${leftovers[@]}"; do
    kill -TERM "$pid" $(descendants "$pid") 2>/dev/null || true
  done
  waited=0
  for pid in "${leftovers[@]}"; do
    while kill -0 "$pid" 2>/dev/null && (( waited < wait_seconds )); do
      sleep 1
      waited=$((waited + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "Verification $pid did not stop within ${wait_seconds}s; killing it" >&2
      kill -KILL "$pid" $(descendants "$pid") 2>/dev/null || true
    fi
  done
fi

# A verification killed before its cleanup leaves its simulator booted.
# verify-ios.sh names each one after its runner, so these are this runner's.
xcrun simctl list devices -j | python3 -c '
import json, sys
prefix = "TresFort verification " + sys.argv[1] + " "
for devices in json.load(sys.stdin)["devices"].values():
    for device in devices:
        if device["name"].startswith(prefix):
            print(device["udid"])
' "$runner" | while read -r simulator; do
  echo "Deleting leftover simulator $simulator"
  xcrun simctl shutdown "$simulator" >/dev/null 2>&1 || true
  xcrun simctl delete "$simulator"
done
