#!/usr/bin/env bash
set -euo pipefail

SUBJECT_SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/upload-testflight.sh"
readonly SUBJECT_SCRIPT
test_root=$(mktemp -d "${TMPDIR:-/tmp}/tres-fort-upload-test.XXXXXX")
cleanup() {
  rm -rf "${test_root}"
}
trap cleanup EXIT

case_number=0
last_output=""
last_status=0
public_project_contents=$'APP_STORE_BUILD\nRemove run recorder location keys\nTARGETED_DEVICE_FAMILY = "1,2";\nTARGETED_DEVICE_FAMILY = "1,2";\nTARGETED_DEVICE_FAMILY = "1,2";\nTARGETED_DEVICE_FAMILY = "1,2";'

fail() {
  echo "not ok ${case_number} - $1" >&2
  printf '%s\n' "${last_output}" >&2
  exit 1
}

assert_status() {
  local expected="$1"
  [ "${last_status}" -eq "${expected}" ] || fail "expected status ${expected}, got ${last_status}"
}

assert_contains() {
  local expected="$1"
  [[ "${last_output}" == *"${expected}"* ]] || fail "missing output: ${expected}"
}

assert_not_contains() {
  local unexpected="$1"
  [[ "${last_output}" != *"${unexpected}"* ]] || fail "unexpected output: ${unexpected}"
}

assert_no_build_activity() {
  [ ! -s "${xcodegen_log}" ] || fail "generated a project despite failed release prerequisites"
  [ ! -s "${xcodebuild_log}" ] || fail "built despite failed release prerequisites"
  [ ! -s "${plutil_log}" ] || fail "inspected an archive despite failed release prerequisites"
  [ ! -s "${xcrun_log}" ] || fail "uploaded despite failed release prerequisites"
  [ ! -s "${node_log}" ] || fail "distributed despite failed release prerequisites"
  grep -qx '  CURRENT_PROJECT_VERSION: "29"' "${case_project}" || fail "changed the build number despite failed release prerequisites"
}

assert_no_export() {
  grep -q -- '-exportArchive' "${xcodebuild_log}" && fail "exported a rejected archive"
  [ ! -s "${xcrun_log}" ] || fail "uploaded a rejected archive"
  [ ! -s "${node_log}" ] || fail "distributed a rejected archive"
}

run_case() {
  local name="$1"
  local xcrun_status="$2"
  local xcrun_output="$3"
  local case_root="${test_root}/case-${case_number}"

  mkdir -p \
    "${case_root}/repo/scripts" \
    "${case_root}/repo/ios/Dependencies" \
    "${case_root}/bin" \
    "${case_root}/home/.appstoreconnect/private_keys"
  cp "${SUBJECT_SCRIPT}" "${case_root}/repo/scripts/upload-testflight.sh"
  cp "$(dirname "${SUBJECT_SCRIPT}")/check-release-assets.py" \
    "${case_root}/repo/scripts/check-release-assets.py"
  cp "$(dirname "${SUBJECT_SCRIPT}")/../ios/Dependencies/verify_app_store_project.py" \
    "${case_root}/repo/ios/Dependencies/verify_app_store_project.py"
  printf '%s\n' \
    'settings:' \
    '  MARKETING_VERSION: "0.1.0"' \
    '  CURRENT_PROJECT_VERSION: "29"' \
    > "${case_root}/repo/ios/project.yml"
  : > "${case_root}/home/.appstoreconnect/private_keys/AuthKey_VP9G3R7Q85.p8"

  if [ "${CASE_MISSING_ARTWORK:-0}" != 1 ]; then
    # Complete solid-color PNGs, generated locally. No provider artwork is
    # copied into test fixtures or needed to exercise the upload control flow.
    python3 - "${case_root}/repo" <<'PY'
import json
import struct
import sys
import zlib
from pathlib import Path

def chunk(kind, payload=b''):
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))

for brand in ('logo_apple_health', 'logo_garmin_connect'):
    directory = Path(sys.argv[1]) / 'ios/TresFort/Assets.xcassets/Connections' / (brand + '.imageset')
    directory.mkdir(parents=True)
    images = []
    for scale in (1, 2, 3):
        size = 30 * scale
        name = f'synthetic-{scale}x.png'
        data = (b'\x89PNG\r\n\x1a\n'
                + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress((b'\0' + bytes([40, 80, 120, 255]) * size) * size))
                + chunk(b'IEND'))
        (directory / name).write_bytes(data)
        images.append({'filename': name, 'idiom': 'universal', 'scale': f'{scale}x'})
    (directory / 'Contents.json').write_text(json.dumps({'images': images, 'info': {'author': 'synthetic-test', 'version': 1}}))
PY
  fi

  # shellcheck disable=SC2016
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'printf "%s\n" "$*" >> "${STUB_XCODEGEN_LOG}"' \
    'mkdir -p TresFort.xcodeproj' \
    'printf "%s\n" "${STUB_PROJECT_CONTENTS}" > TresFort.xcodeproj/project.pbxproj' \
    > "${case_root}/bin/xcodegen"
  # shellcheck disable=SC2016
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'printf "%s\n" "$@" >> "${STUB_XCODEBUILD_LOG}"' \
    'if [ "${STUB_ARCHIVE_SDK}" = 1 ]; then mkdir -p build/TresFort.xcarchive/Products/Applications/TresFort.app; touch build/TresFort.xcarchive/Products/Applications/TresFort.app/pose_landmarker_full.task; fi' \
    > "${case_root}/bin/xcodebuild"
  # shellcheck disable=SC2016
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'printf "%s\n" "$*" >> "${STUB_PLUTIL_LOG}"' \
    'case "$*" in' \
    '  *TresFortWidgets.appex/Info.plist) printf "%s\n" "${STUB_WIDGET_DEVICE_FAMILY}" ;;' \
    '  *) printf "%s\n" "${STUB_APP_DEVICE_FAMILY}" ;;' \
    'esac' \
    > "${case_root}/bin/plutil"
  # These expressions must remain literal so the generated stub expands them.
  # shellcheck disable=SC2016
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'printf "%s\n" "$*" >> "${STUB_XCRUN_LOG}"' \
    'printf "%s\n" "${STUB_XCRUN_OUTPUT}" >&2' \
    'exit "${STUB_XCRUN_STATUS}"' \
    > "${case_root}/bin/xcrun"
  # shellcheck disable=SC2016
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'printf "%s\n" "$*" >> "${STUB_NODE_LOG}"' \
    'exit "${STUB_NODE_STATUS}"' \
    > "${case_root}/bin/node"
  chmod +x "${case_root}/bin/xcodegen" "${case_root}/bin/xcodebuild" "${case_root}/bin/xcrun" "${case_root}/bin/plutil" "${case_root}/bin/node"
  xcodebuild_log="${case_root}/xcodebuild.log"
  xcodegen_log="${case_root}/xcodegen.log"
  plutil_log="${case_root}/plutil.log"
  xcrun_log="${case_root}/xcrun.log"
  node_log="${case_root}/node.log"
  case_project="${case_root}/repo/ios/project.yml"
  : > "${xcodebuild_log}"
  : > "${xcodegen_log}"
  : > "${plutil_log}"
  : > "${xcrun_log}"
  : > "${node_log}"

  # Unset inherited switches so a caller's build environment cannot silently
  # select public packaging or make every default case use the legacy switch.
  local flag_env=(env -u APP_STORE_BUILD -u APP_STORE_IPHONE_ONLY -u BUILD_NUMBER -u TESTFLIGHT_EXTERNAL -u TESTFLIGHT_NOTES)
  if [ "${CASE_LOCAL_BUILD:-0}" != 1 ]; then
    flag_env+=(BUILD_NUMBER=30)
  fi
  if [ "${CASE_APP_STORE_BUILD+x}" = x ]; then
    flag_env+=("APP_STORE_BUILD=${CASE_APP_STORE_BUILD}")
  fi
  if [ "${CASE_EXTERNAL+x}" = x ]; then
    flag_env+=("TESTFLIGHT_EXTERNAL=${CASE_EXTERNAL}")
  fi
  if [ "${CASE_NOTES+x}" = x ]; then
    flag_env+=("TESTFLIGHT_NOTES=${CASE_NOTES}")
  fi
  if [ "${CASE_LEGACY_FLAG+x}" = x ]; then
    flag_env+=("APP_STORE_IPHONE_ONLY=${CASE_LEGACY_FLAG}")
  fi

  if last_output=$(cd "${case_root}/repo" && \
    "${flag_env[@]}" \
    HOME="${case_root}/home" \
    PATH="${case_root}/bin:${PATH}" \
    STUB_APP_DEVICE_FAMILY="${CASE_APP_DEVICE_FAMILY-[1,2]}" \
    STUB_WIDGET_DEVICE_FAMILY="${CASE_WIDGET_DEVICE_FAMILY-[1,2]}" \
    STUB_XCODEBUILD_LOG="${xcodebuild_log}" \
    STUB_XCODEGEN_LOG="${xcodegen_log}" \
    STUB_PROJECT_CONTENTS="${CASE_PROJECT_CONTENTS-${public_project_contents}}" \
    STUB_ARCHIVE_SDK="${CASE_ARCHIVE_SDK:-0}" \
    STUB_PLUTIL_LOG="${plutil_log}" \
    STUB_XCRUN_LOG="${xcrun_log}" \
    STUB_XCRUN_STATUS="${xcrun_status}" \
    STUB_XCRUN_OUTPUT="${xcrun_output}" \
    STUB_NODE_LOG="${node_log}" \
    STUB_NODE_STATUS="${CASE_NODE_STATUS:-0}" \
    bash scripts/upload-testflight.sh 2>&1); then
    last_status=0
  else
    last_status=$?
  fi

  echo "ok ${case_number} - ${name}"
}

case_number=$((case_number + 1))
CASE_MISSING_ARTWORK=1 CASE_LOCAL_BUILD=1 run_case \
  "missing private artwork stops before version mutation, archive, upload or distribution" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 2
assert_contains "Release artwork preflight failed"
assert_contains "docs/RELEASE-ASSETS.md"
assert_not_contains "Bumping"
assert_no_build_activity

case_number=$((case_number + 1))
run_case \
  "textual rejection fails closed when altool exits zero" \
  0 \
  $'ERROR: Failed to upload package.\nRequestUUID = rejected-delivery'
assert_status 1
assert_contains "ERROR: Failed to upload package."
assert_contains "reported an upload failure despite exiting successfully"
assert_not_contains "Uploaded 0.1.0 (30)."

case_number=$((case_number + 1))
run_case \
  "affirmative success passes and preserves delivery UUID" \
  0 \
  $'UPLOAD SUCCEEDED with no errors\nRequestUUID = accepted-delivery'
assert_status 0
assert_contains "UPLOAD SUCCEEDED with no errors"
assert_contains "RequestUUID = accepted-delivery"
assert_contains "Uploaded 0.1.0 (30)."

case_number=$((case_number + 1))
run_case \
  "harmless resume-file log line does not fail a successful upload" \
  0 \
  $'ERROR: [ContentDelivery.Uploader] Failed to create URL for \'CDUploaderStateInfoResumeFilePath\'\nUPLOAD SUCCEEDED with no errors\nRequestUUID = accepted-delivery'
assert_status 0
assert_contains "UPLOAD SUCCEEDED with no errors"
assert_contains "Uploaded 0.1.0 (30)."

case_number=$((case_number + 1))
run_case \
  "other errors still fail beside the harmless resume-file line" \
  0 \
  $'ERROR: [ContentDelivery.Uploader] Failed to create URL for \'CDUploaderStateInfoResumeFilePath\'\nERROR: Failed to upload package.\nUPLOAD SUCCEEDED with no errors'
assert_status 1
assert_contains "reported an upload failure despite exiting successfully"
assert_not_contains "Uploaded 0.1.0 (30)."

case_number=$((case_number + 1))
run_case \
  "nonzero altool status propagates" \
  7 \
  "Transport unavailable"
assert_status 7
assert_contains "altool exited with status 7"
assert_not_contains "Uploaded 0.1.0 (30)."

case_number=$((case_number + 1))
run_case \
  "ambiguous zero exit fails closed" \
  0 \
  "RequestUUID = ambiguous-delivery"
assert_status 1
assert_contains "did not report affirmative upload success"
assert_not_contains "Uploaded 0.1.0 (30)."

case_number=$((case_number + 1))
run_case \
  "negated success wording fails closed" \
  0 \
  "The package was not successfully uploaded."
assert_status 1
assert_contains "did not report affirmative upload success"
assert_not_contains "Uploaded 0.1.0 (30)."

case_number=$((case_number + 1))
run_case \
  "default build keeps both device families" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 0
grep -q 'TARGETED_DEVICE_FAMILY' "${xcodebuild_log}" && fail "default archive overrode the device family"
grep -qx 'generate --spec project.yml' "${xcodegen_log}" || fail "default archive selected the wrong spec"
[ -s "${plutil_log}" ] && fail "default archive ran the public packaging check"

case_number=$((case_number + 1))
CASE_APP_STORE_BUILD=0 run_case \
  "explicit beta build keeps the default project and archive checks" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 0
grep -qx 'generate --spec project.yml' "${xcodegen_log}" || fail "beta archive selected the wrong spec"
[ -s "${plutil_log}" ] && fail "beta archive ran the public packaging check"

case_number=$((case_number + 1))
CASE_APP_STORE_BUILD=1 run_case \
  "App Store candidate archives iPhone and iPad and verifies both bundles" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 0
assert_contains "Uploaded 0.1.0 (30)."
grep -qx 'generate --spec project-app-store.yml' "${xcodegen_log}" || fail "missing App Store spec selection"
grep -q 'TresFort.app/Info.plist' "${plutil_log}" || fail "app bundle not verified"
grep -q 'TresFortWidgets.appex/Info.plist' "${plutil_log}" || fail "widget bundle not verified"

case_number=$((case_number + 1))
CASE_APP_STORE_BUILD=1 CASE_APP_DEVICE_FAMILY='[1]' run_case \
  "App Store candidate missing iPad in the app fails before export" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 1
assert_contains "UIDeviceFamily [1,2]"
assert_contains "TresFort.app"
assert_not_contains "Uploaded 0.1.0 (30)."
assert_no_export

case_number=$((case_number + 1))
CASE_APP_STORE_BUILD=1 CASE_WIDGET_DEVICE_FAMILY='[2]' run_case \
  "App Store candidate missing iPhone in the widget fails before export" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 1
assert_contains "UIDeviceFamily [1,2]"
assert_contains "TresFortWidgets.appex"
assert_no_export

case_number=$((case_number + 1))
CASE_APP_STORE_BUILD=1 CASE_APP_DEVICE_FAMILY='' run_case \
  "App Store candidate missing the app device family fails before export" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 1
assert_contains "UIDeviceFamily [1,2]"
assert_no_export

case_number=$((case_number + 1))
CASE_APP_STORE_BUILD=1 CASE_WIDGET_DEVICE_FAMILY='' run_case \
  "App Store candidate missing the widget device family fails before export" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 1
assert_contains "UIDeviceFamily [1,2]"
assert_contains "TresFortWidgets.appex"
assert_no_export

case_number=$((case_number + 1))
CASE_APP_STORE_BUILD=yes CASE_LOCAL_BUILD=1 run_case \
  "unrecognized App Store flag is rejected before building" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 2
assert_contains "APP_STORE_BUILD must be 0 or 1"
assert_no_build_activity

case_number=$((case_number + 1))
CASE_APP_STORE_BUILD='' CASE_LOCAL_BUILD=1 run_case \
  "explicitly empty App Store flag is rejected before version mutation" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 2
assert_contains "APP_STORE_BUILD must be 0 or 1"
assert_no_build_activity

for legacy_value in 0 1 ''; do
  case_number=$((case_number + 1))
  CASE_LEGACY_FLAG="${legacy_value}" CASE_LOCAL_BUILD=1 run_case \
    "legacy App Store flag '${legacy_value}' is rejected before version mutation" \
    0 \
    "UPLOAD SUCCEEDED with no errors"
  assert_status 2
  assert_contains "APP_STORE_IPHONE_ONLY"
  assert_no_build_activity

  case_number=$((case_number + 1))
  CASE_APP_STORE_BUILD=1 CASE_LEGACY_FLAG="${legacy_value}" CASE_LOCAL_BUILD=1 run_case \
    "legacy App Store flag '${legacy_value}' is rejected alongside the new public flag" \
    0 \
    "UPLOAD SUCCEEDED with no errors"
  assert_status 2
  assert_contains "APP_STORE_IPHONE_ONLY"
  assert_no_build_activity
done

case_number=$((case_number + 1))
CASE_APP_STORE_BUILD=1 CASE_PROJECT_CONTENTS="${public_project_contents} .dependencies/mediapipe" run_case \
  "App Store project with Station SDK inputs fails before archiving" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 1
assert_contains "App Store project retains Station SDK input"
[ -s "${xcodebuild_log}" ] && fail "built despite retaining Station SDK inputs"

case_number=$((case_number + 1))
CASE_APP_STORE_BUILD=1 CASE_PROJECT_CONTENTS='wrong project' run_case \
  "App Store project missing its Swift condition fails before archiving" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 1
assert_contains "App Store project is missing APP_STORE_BUILD"
[ -s "${xcodebuild_log}" ] && fail "built despite using the wrong project"

case_number=$((case_number + 1))
CASE_APP_STORE_BUILD=1 CASE_PROJECT_CONTENTS="${public_project_contents} APP_STORE_IPHONE_ONLY" run_case \
  "App Store project with the legacy Swift condition fails before archiving" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 1
assert_contains "APP_STORE_IPHONE_ONLY"
[ -s "${xcodebuild_log}" ] && fail "built despite retaining the legacy Swift condition"

case_number=$((case_number + 1))
CASE_APP_STORE_BUILD=1 CASE_PROJECT_CONTENTS="${public_project_contents//1,2/1}" run_case \
  "App Store project missing a device family fails before archiving" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 1
[ -s "${xcodebuild_log}" ] && fail "built despite a project missing iPad support"

case_number=$((case_number + 1))
CASE_APP_STORE_BUILD=1 CASE_ARCHIVE_SDK=1 run_case \
  "App Store archive with a stale Station model fails before exporting" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 1
assert_contains "App Store archive retains Station SDK asset"
assert_no_export

case_number=$((case_number + 1))
run_case \
  "successful upload gives the build to external testers" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 0
grep -qx '../scripts/testflight-distribute.mjs --build 30 --wait 45' "${node_log}" \
  || fail "did not distribute build 30: $(cat "${node_log}")"

case_number=$((case_number + 1))
CASE_NOTES='Try the new run summary' run_case \
  "What to Test notes are passed through" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 0
grep -q -- '--notes Try the new run summary' "${node_log}" || fail "notes not passed: $(cat "${node_log}")"

case_number=$((case_number + 1))
CASE_EXTERNAL=0 run_case \
  "internal-only upload skips external testers" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 0
assert_contains "stays with internal testers only"
[ -s "${node_log}" ] && fail "distributed an internal-only build"

case_number=$((case_number + 1))
CASE_NODE_STATUS=1 run_case \
  "distribution failure after upload exits 3 with the re-run command" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 3
assert_contains "Uploaded 0.1.0 (30)."
assert_contains "Re-run: node scripts/testflight-distribute.mjs --build 30"

case_number=$((case_number + 1))
run_case \
  "failed upload never distributes" \
  7 \
  "Transport unavailable"
assert_status 7
[ -s "${node_log}" ] && fail "distributed after a failed upload"

case_number=$((case_number + 1))
CASE_EXTERNAL=yes CASE_LOCAL_BUILD=1 run_case \
  "unrecognized external flag is rejected before building" \
  0 \
  "UPLOAD SUCCEEDED with no errors"
assert_status 2
assert_contains "TESTFLIGHT_EXTERNAL must be 0 or 1"
assert_no_build_activity

echo "1..${case_number}"
