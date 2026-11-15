#!/usr/bin/env bash
# Build and test an unsigned copy. Never reuse a person's simulator or keychain.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
usage() {
  echo 'Usage: npm run ios:verify -- --runtime RUNTIME --device DEVICE [--ui-suite full|smoke] [--ci-shard 1|2|3|4|5|6] [--only-testing Target[/Class[/method]]] [--only-testing-file PATH] [--content-size SIZE]'
}
runtime=''
device=''
content_size=''
ci_shard=''
ui_suite='full'
test_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime|--device|--only-testing|--only-testing-file|--content-size|--ci-shard|--ui-suite)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || { usage >&2; exit 2; }
      case "$1" in
        --runtime) runtime="$2" ;;
        --device) device="$2" ;;
        --content-size) content_size="$2" ;;
        --ci-shard) ci_shard="$2" ;;
        --ui-suite) ui_suite="$2" ;;
        --only-testing) test_args+=("-only-testing:$2") ;;
        --only-testing-file)
          # One selector per line; blank lines and # comments are ignored.
          [[ -f "$2" ]] || { echo "Test selection file not found: $2" >&2; exit 2; }
          selected=0
          while IFS= read -r selector || [[ -n "$selector" ]]; do
            selector="${selector%%#*}"
            selector="${selector//[[:space:]]/}"
            [[ -n "$selector" ]] || continue
            [[ "$selector" =~ ^[A-Za-z_][A-Za-z0-9_]*(/[A-Za-z_][A-Za-z0-9_]*){0,2}$ ]] || {
              echo "Invalid test selector in $2: $selector" >&2; exit 2; }
            test_args+=("-only-testing:$selector")
            selected=$((selected + 1))
          done <"$2"
          [[ "$selected" -gt 0 ]] || { echo "Test selection file is empty: $2" >&2; exit 2; } ;;
      esac
      shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ -n "$runtime" && -n "$device" ]] || { usage >&2; exit 2; }
if [[ ${APP_STORE_IPHONE_ONLY+x} ]]; then
  echo 'APP_STORE_IPHONE_ONLY is obsolete; remove it and use APP_STORE_BUILD=1 for the public iPhone + iPad build.' >&2
  exit 2
fi
case "${APP_STORE_BUILD-0}" in
  0) project_spec=project.yml ;;
  1) project_spec=project-app-store.yml ;;
  *) echo 'APP_STORE_BUILD must be 0 or 1.' >&2; exit 2 ;;
esac
[[ "$ui_suite" == full || "$ui_suite" == smoke ]] || { usage >&2; exit 2; }
if [[ -n "$ci_shard" ]]; then
  [[ "$ci_shard" =~ ^[1-6]$ ]] || { usage >&2; exit 2; }
fi
if [[ -n "$ci_shard" || "$ui_suite" == smoke ]]; then
  [[ ${#test_args[@]} -eq 0 ]] || { echo 'CI selection cannot be combined with --only-testing' >&2; exit 2; }
fi
if [[ "$ui_suite" == smoke ]]; then
  [[ -z "$ci_shard" || "$ci_shard" == 1 ]] || { echo 'Smoke coverage is one job; use --ci-shard 1 or none' >&2; exit 2; }
  # The PR gate is one job: build the app and every UI test bundle, then run
  # every unit test. UI journeys, the iPad Station and the App Store device
  # jobs run only in the nightly/manual full run (release check).
  test_args+=("-only-testing:TresFortTests")
elif [[ -n "$ci_shard" ]]; then
  # Keep full-suite jobs near 30 minutes, including a cold build. The CI
  # limit for full runs is 40 minutes only as headroom for slow runners.
  # Shard 1 runs units and the complement, so new classes stay covered. The
  # partition test checks all selectors against real suites without overlap.
  full_second=(TrainingJourneyTests WorkoutFeedbackJourneyTests IntervalsConnectionJourneyTests)
  full_third=(TodayNavigationJourneyTests)
  full_fourth=(MemberActivationJourneyTests PlanlessAccountJourneyTests MixedWeekSetupJourneyTests FreestyleJourneyTests)
  full_fifth=(UIActionJourneyTests HistoryJourneyTests ExerciseGroupJourneyTests ExerciseInformationJourneyTests ExerciseDiscoveryJourneyTests)
  full_sixth=(WorkoutLibraryJourneyTests WeeklyScheduleJourneyTests RunnerStreamlineJourneyTests)
  if [[ "$ci_shard" == 1 ]]; then
    for suite in "${full_second[@]}" "${full_third[@]}" "${full_fourth[@]}" "${full_fifth[@]}" "${full_sixth[@]}"; do
      test_args+=("-skip-testing:TresFortUITests/$suite")
    done
  else
    case "$ci_shard" in
      2) suites=("${full_second[@]}") ;;
      3) suites=("${full_third[@]}") ;;
      4) suites=("${full_fourth[@]}") ;;
      5) suites=("${full_fifth[@]}") ;;
      6) suites=("${full_sixth[@]}") ;;
    esac
    for suite in "${suites[@]}"; do
      test_args+=("-only-testing:TresFortUITests/$suite")
    done
  fi
fi
for tool in xcodegen xcodebuild xcrun python3; do
  command -v "$tool" >/dev/null || { echo "Required tool missing: $tool" >&2; exit 1; }
done

scratch="$(mktemp -d "${TMPDIR:-/tmp}/tres-fort-ios.XXXXXX")"
simulator=''
build_lock=''
# A persistent machine (the Mac mini CI runner) sets TRESFORT_IOS_BUILD_ROOT
# to keep one source copy and DerivedData per project spec between runs, so a
# build recompiles only what changed. Unset, every run builds from scratch.
if [[ -n "${TRESFORT_IOS_BUILD_ROOT:-}" ]]; then
  build_dir="$TRESFORT_IOS_BUILD_ROOT/${project_spec%.yml}"
  sources="$build_dir/ios"
  derived_data="$build_dir/DerivedData"
else
  sources="$scratch/ios"
  derived_data="$scratch/DerivedData"
fi
evidence_root="${IOS_EVIDENCE_DIR:-$repo_root/.artifacts/ios}"
recording_root="$scratch"
cleanup() {
  result=$?
  trap - EXIT
  if [[ -n "$simulator" ]]; then
    xcrun simctl shutdown "$simulator" >>"$recording_root/cleanup.log" 2>&1 || true
    if ! xcrun simctl delete "$simulator" >>"$recording_root/cleanup.log" 2>&1; then
      echo "Could not delete verification simulator $simulator; see cleanup.log" >&2
      result=1
    fi
  fi
  # Retain logs and the result bundle (including synthetic UI screenshots).
  # DerivedData, copied sources, and simulator data never become artifacts.
  if [[ "$result" -ne 0 || "${IOS_KEEP_RESULTS:-0}" == 1 ]]; then
    evidence="$evidence_root/$(basename "$scratch")"
    if mkdir -p "$evidence"; then
      if [[ "$recording_root" != "$evidence" ]]; then
        for path in "$recording_root"/*.log "$recording_root"/*.json "$recording_root"/*.xcresult; do
          if [[ -e "$path" ]] && ! cp -R "$path" "$evidence/"; then result=1; fi
        done
      fi
      echo "iOS verification evidence: $evidence"
    else
      echo "Could not retain verification evidence at $evidence" >&2
      result=1
    fi
  fi
  rm -rf "$scratch"
  # Release the lock only while it is still this verification's.
  if [[ -n "$build_lock" && "$(cat "$build_lock" 2>/dev/null)" == "$$" ]]; then
    rm -f "$build_lock"
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "${IOS_KEEP_RESULTS:-0}" == 1 ]]; then
  # A CI timeout can kill the shell before its cleanup trap finishes. Record
  # diagnostics directly in the upload directory so cancellation retains them.
  mkdir -p "$evidence_root/$(basename "$scratch")"
  recording_root="$evidence_root/$(basename "$scratch")"
fi

xcrun simctl list runtimes -j >"$recording_root/runtimes.json"
xcrun simctl list devicetypes -j >"$recording_root/devicetypes.json"
python3 - "$recording_root" "$runtime" "$device" <<'PY'
import json, pathlib, sys
root, runtime, device = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
runtimes = json.loads((root / 'runtimes.json').read_text())['runtimes']
devices = json.loads((root / 'devicetypes.json').read_text())['devicetypes']
if not any(r['identifier'] == runtime and r.get('isAvailable') for r in runtimes):
    sys.exit('Selected runtime is not installed and available: ' + runtime)
if not any(d['identifier'] == device for d in devices):
    sys.exit('Selected device type is not installed: ' + device)
PY
if [[ -n "${TRESFORT_IOS_BUILD_ROOT:-}" ]]; then
  # One verification at a time per build directory. A cancelled CI job's
  # verification can still be winding down when the runner starts its next
  # job, so wait for it (TRESFORT_IOS_BUILD_LOCK_WAIT seconds, 15 minutes by
  # default). A lock whose process is gone, or is no longer a verification
  # (a job killed at its timeout, or a restart), is taken over.
  mkdir -p "$build_dir"
  lock="$build_dir/.lock"
  lock_held() {
    local pid
    pid="$(cat "$lock" 2>/dev/null)" || return 1
    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    ps -p "$pid" -o command= 2>/dev/null | grep -q 'verify-ios'
  }
  # A hard link appears atomically with its contents and fails if the lock
  # already exists, so only one verification takes a free lock.
  take_lock() {
    local taken=1
    echo $$ >"$lock.$$"
    if ln "$lock.$$" "$lock" 2>/dev/null; then taken=0; fi
    rm -f "$lock.$$"
    return "$taken"
  }
  # Only one process at a time may decide a lock is stale and remove it, so
  # two never both remove it and then both take it. A takeover left behind
  # by a killed process is cleared after a minute.
  clear_stale_lock() {
    find "$lock.takeover" -maxdepth 0 -mmin +1 -exec rmdir {} \; 2>/dev/null || true
    mkdir "$lock.takeover" 2>/dev/null || return 0
    if ! lock_held; then rm -f "$lock"; fi
    rmdir "$lock.takeover"
  }
  waited=0
  until take_lock; do
    if ! lock_held; then
      clear_stale_lock
      sleep 1
      continue
    fi
    if (( waited >= ${TRESFORT_IOS_BUILD_LOCK_WAIT:-900} )); then
      echo "Another verification is using $build_dir" >&2
      exit 1
    fi
    if (( waited == 0 )); then
      echo "Waiting for the verification already using $build_dir to finish"
    fi
    sleep 5
    waited=$((waited + 5))
  done
  build_lock="$lock"
  echo "Reusing the build in $build_dir; delete it to start clean"
fi
python3 -B - "$repo_root/ios" "$sources" "$recording_root" "${TRESFORT_IOS_BUILD_ROOT:+sync}" <<'PY'
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(sys.argv[1]).parent / 'scripts'))
from ios_sources import copy_sources, sync_sources
root = pathlib.Path(sys.argv[2])
manifest = (sync_sources if sys.argv[4:] == ['sync'] else copy_sources)(sys.argv[1], root)
(pathlib.Path(sys.argv[3]) / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
PY
{
  xcodebuild -version
  xcodegen --version
  echo "Runtime: $runtime"
  echo "Device type: $device"
  echo "CI shard: ${ci_shard:-full or focused}"
  echo "UI suite: $ui_suite"
  echo "Project spec: $project_spec"
  printf 'Test selection: %s\n' ${test_args[@]+"${test_args[@]}"}
  git -C "$repo_root" rev-parse HEAD
  git -C "$repo_root" status --short
} >"$recording_root/environment.log"
TRESFORT_MEDIAPIPE_CACHE="${TRESFORT_MEDIAPIPE_CACHE:-$repo_root/.artifacts/mediapipe-downloads}" \
  xcodegen generate --spec "$sources/$project_spec" >"$recording_root/xcodegen.log" 2>&1
if [[ "$project_spec" == project-app-store.yml ]]; then
  python3 -B "$sources/Dependencies/verify_app_store_project.py" \
    "$sources/TresFort.xcodeproj/project.pbxproj"
fi
# On CI the name carries the runner's, so stop-ios-verification.sh can find
# this runner's simulator if the run is killed before its cleanup.
simulator="$(xcrun simctl create "TresFort verification ${RUNNER_NAME:+$RUNNER_NAME }$(basename "$scratch")" "$device" "$runtime")"
echo "Verifying TresFort on $runtime / $device ($simulator)"
xcrun simctl boot "$simulator" >"$recording_root/boot.log" 2>&1
# Let the fresh simulator finish its first boot while Xcode compiles. The
# build and test actions share this invocation's sources and DerivedData.
build_args=(-project "$sources/TresFort.xcodeproj" -scheme TresFort -configuration Debug
  -destination "platform=iOS Simulator,id=$simulator" -derivedDataPath "$derived_data"
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO)
build_marker=''
if [[ -n "${TRESFORT_IOS_BUILD_ROOT:-}" ]]; then
  # A cancelled job's xcodebuild can outlive its shell and keep writing to
  # this DerivedData. This run holds the lock, so anything still building
  # here is left over: stop it before reusing the build.
  if pkill -f "derivedDataPath $derived_data" 2>/dev/null; then
    echo "Stopping a leftover build in $build_dir"
    sleep 5
    pkill -9 -f "derivedDataPath $derived_data" 2>/dev/null || true
  fi
  # An interrupted build can leave DerivedData claiming outputs it never
  # wrote, which fails at link time. Start a build that did not finish clean.
  # Builds kept before this marker existed carry no record of whether they
  # finished, so the build layout version also starts them clean once.
  build_marker="$build_dir/.building"
  if [[ -e "$build_marker" || "$(cat "$build_dir/.layout" 2>/dev/null)" != 2 ]]; then
    echo "The last build in $build_dir did not finish; starting it clean"
    rm -rf "$derived_data"
    echo 2 >"$build_dir/.layout"
  fi
  touch "$build_marker"
fi
echo 'Building app and test bundles while the simulator starts...'
build_status=0
xcodebuild build-for-testing "${build_args[@]}" \
  -resultBundlePath "$recording_root/Build.xcresult" >"$recording_root/build.log" 2>&1 || build_status=$?
# The build finished, passing or failing; only an interrupted one keeps the marker.
if [[ -n "$build_marker" ]]; then rm -f "$build_marker"; fi
if (( build_status != 0 )); then
  # Compiler errors scroll far above the tail; print them first.
  awk '/error:/ && !seen[$0]++' "$recording_root/build.log" | head -n 60 >&2
  tail -n 100 "$recording_root/build.log" >&2
  exit 1
fi
echo 'Build complete; waiting for simulator boot readiness...'
if ! xcrun simctl bootstatus "$simulator" -b >>"$recording_root/boot.log" 2>&1; then
  tail -n 100 "$recording_root/boot.log" >&2
  exit 1
fi
if [[ -n "$content_size" ]]; then
  # Set the actual simulator preference: a root SwiftUI environment override
  # alone may not reach system controls or separately presented sheets.
  xcrun simctl ui "$simulator" content_size "$content_size" >"$recording_root/ui-settings.log" 2>&1
  xcrun simctl ui "$simulator" content_size >>"$recording_root/ui-settings.log" 2>&1
fi
# Each failed test's own activity steps and errors (its last 80), so a
# failure that is not the shard's last test still shows what it waited
# on. Element-tree dumps are left out; they would crowd out the steps.
# An optional exact "Class method" limits output to a test that later passed.
report_failed_test_traces() {
  awk -v selected_test="${2:-}" '
       /^Test Case .* started/ { n = 0 }
       /^ +t = |error:/ { line[n++ % 80] = $0 }
       /^Test Case .* failed/ {
         if (selected_test != "" && !index($0, "-[" selected_test "]")) next
         print "---- trace: " $0
         for (i = (n > 80 ? n - 80 : 0); i < n; i++) print line[i % 80]
       }' "$1"
}
# Tests that failed and then passed when Xcode ran them again: "Class method".
retried_tests() {
  sed -nE "s/^Test Case '-\[([^]]+)\]' (passed|failed) .*/\2 \1/p" "$1" |
    awk '{ test = $2 " " $3; seen[test] = seen[test] " " $1 }
         END { for (test in seen) if (seen[test] ~ /failed/ && seen[test] ~ /passed/) print test }' | sort
}
# Name each test that passed only on its retry, in the log and (on GitHub) as a
# warning on the run, so a flaky test gets fixed instead of quietly re-run.
report_retried_tests() {
  local retried
  retried="$(retried_tests "$1")"
  [[ -n "$retried" ]] || return 0
  echo 'Passed only when run again (flaky; fix these):'
  while IFS= read -r test; do
    echo "  $test"
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
      echo "::warning title=Flaky iOS test::$test failed, then passed when run again"
    fi
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
      echo "- Flaky iOS test (passed when run again): \`$test\`" >>"$GITHUB_STEP_SUMMARY" || true
    fi
    if [[ "${2:-}" == "--include-traces" ]]; then
      report_failed_test_traces "$1" "$test"
    fi
  done <<<"$retried"
}
# Disable test cloning so every simulator this command creates has one owner.
# A failed test runs once more in place: a real regression fails both times,
# while a test that passes only on its retry is reported as flaky above. This
# replaces re-running a whole 30-minute job by hand for one slow simulator.
echo "Running $ui_suite tests (shard ${ci_shard:-all})..."
if ! xcodebuild test-without-building "${build_args[@]}" \
    -retry-tests-on-failure -test-iterations 2 \
    -resultBundlePath "$recording_root/Tests.xcresult" \
    ${test_args[@]+"${test_args[@]}"} >"$recording_root/xcodebuild.log" 2>&1; then
  report_retried_tests "$recording_root/xcodebuild.log" >&2
  awk '/error:|Test Case .*failed|Test Suite .*failed/{print}' "$recording_root/xcodebuild.log" >&2
  report_failed_test_traces "$recording_root/xcodebuild.log" >&2
  tail -n 100 "$recording_root/xcodebuild.log" >&2
  exit 1
fi
awk '/Executed [0-9]+ tests|\*\* TEST/{print}' "$recording_root/xcodebuild.log"
report_retried_tests "$recording_root/xcodebuild.log" --include-traces
