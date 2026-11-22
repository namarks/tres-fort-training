#!/usr/bin/env bash
# Build an unsigned copy of the Apple Watch app and its complication for a
# Watch simulator. The Watch targets exist only in ios/project-watch.yml
# (docs/plans/apple-watch), so the iPhone verification (verify-ios.sh, which
# builds project.yml) never compiles them. No simulator is created: the
# build targets any Watch simulator and nothing is run.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -gt 0 ]]; then
  echo 'Usage: npm run ios:verify-watch' >&2
  exit 2
fi
for tool in xcodegen xcodebuild python3; do
  command -v "$tool" >/dev/null || { echo "Required tool missing: $tool" >&2; exit 1; }
done

scratch="$(mktemp -d "${TMPDIR:-/tmp}/tres-fort-watch.XXXXXX")"
sources="$scratch/ios"
derived_data="$scratch/DerivedData"
evidence_root="${IOS_EVIDENCE_DIR:-$repo_root/.artifacts/ios}"
cleanup() {
  result=$?
  trap - EXIT
  # Keep the logs of a failed build; sources and DerivedData never become
  # artifacts.
  if [[ "$result" -ne 0 || "${IOS_KEEP_RESULTS:-0}" == 1 ]]; then
    evidence="$evidence_root/$(basename "$scratch")"
    if mkdir -p "$evidence"; then
      for path in "$scratch"/*.log; do
        if [[ -e "$path" ]] && ! cp "$path" "$evidence/"; then result=1; fi
      done
      echo "Apple Watch build evidence: $evidence"
    else
      echo "Could not retain build evidence at $evidence" >&2
      result=1
    fi
  fi
  rm -rf "$scratch"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

python3 -B - "$repo_root/ios" "$sources" <<'PY'
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(sys.argv[1]).parent / 'scripts'))
from ios_sources import copy_sources
copy_sources(sys.argv[1], sys.argv[2])
PY
{
  xcodebuild -version
  xcodegen --version
  echo 'Project spec: project-watch.yml'
  git -C "$repo_root" rev-parse HEAD
  git -C "$repo_root" status --short
} >"$scratch/environment.log"
TRESFORT_MEDIAPIPE_CACHE="${TRESFORT_MEDIAPIPE_CACHE:-$repo_root/.artifacts/mediapipe-downloads}" \
  xcodegen generate --spec "$sources/project-watch.yml" >"$scratch/xcodegen.log" 2>&1
echo 'Building the Apple Watch app and its complication...'
if ! xcodebuild build -project "$sources/TresFort.xcodeproj" -scheme TresFortWatch -configuration Debug \
    -destination 'generic/platform=watchOS Simulator' -derivedDataPath "$derived_data" \
    CODE_SIGNING_ALLOWED=NO >"$scratch/build.log" 2>&1; then
  # Compiler errors scroll far above the tail; print them first.
  awk '/error:/ && !seen[$0]++' "$scratch/build.log" | head -n 60 >&2
  tail -n 100 "$scratch/build.log" >&2
  exit 1
fi
# The complication ships inside the Watch app; a build that leaves it out
# would still succeed.
app="$derived_data/Build/Products/Debug-watchsimulator/TresFortWatch.app"
if [[ ! -d "$app/PlugIns/TresFortWatchWidgets.appex" ]]; then
  echo "The built Watch app does not contain its complication: $app/PlugIns/TresFortWatchWidgets.appex" >&2
  exit 1
fi
echo 'Apple Watch app built with its complication inside.'
