"""Exercise routine hosted iOS setup without launching Xcode or a simulator."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def ios_steps():
    """The ios-tests job's steps, parsed the way GitHub reads the workflow."""
    return json.loads(subprocess.check_output([
        'node', '--input-type=module', '-e', '''
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
console.log(JSON.stringify(workflow.jobs['ios-tests'].steps));
'''], cwd=ROOT, text=True))


def ios_step(name):
    steps = [step for step in ios_steps() if step.get('name') == name]
    assert len(steps) == 1, name
    return steps[0]


class IOSSetupTests(unittest.TestCase):
    def test_xcodegen_download_authentication_and_failed_install_cleanup(self):
        step = json.loads(subprocess.check_output([
            'node', '--input-type=module', '-e', '''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const steps = workflow.jobs['ios-tests'].steps.filter(step => step.name === 'Install pinned XcodeGen');
assert.equal(steps.length, 1);
console.log(JSON.stringify(steps[0]));
'''], cwd=ROOT, text=True))
        self.assertEqual(step['env']['GITHUB_TOKEN'], '${{ github.token }}')
        script = step['run']
        for failure in ['missing-token', 'http-error', 'wrong-checksum']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                stub = root / 'curl'
                stub.write_text('''#!/bin/bash
printf '%s\\0' "$@" > "$CURL_ARGS"
if [ "$CURL_FAILURE" = http-error ]; then exit 22; fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then printf 'not the pinned archive' > "$2"; exit 0; fi
  shift
done
exit 2
''')
                stub.chmod(0o755)
                args_file = root / 'curl-args'
                path_file = root / 'github-path'
                env = {'PATH': f'{root}:/usr/bin:/bin', 'RUNNER_TEMP': str(root),
                       'GITHUB_PATH': str(path_file), 'CURL_ARGS': str(args_file),
                       'CURL_FAILURE': failure}
                if failure != 'missing-token':
                    env['GITHUB_TOKEN'] = 'synthetic-job-token'
                result = subprocess.run(['bash', '-euo', 'pipefail', '-c', script],
                                        capture_output=True, text=True, env=env)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('synthetic-job-token', result.stdout + result.stderr)
                self.assertFalse(path_file.exists())
                self.assertFalse((root / 'tres-fort-tools').exists())
                self.assertFalse(list(root.glob('xcodegen.*')))
                if failure == 'missing-token':
                    self.assertFalse(args_file.exists())
                    continue
                args = args_file.read_bytes().decode().split('\0')[:-1]
                self.assertIn('Authorization: Bearer synthetic-job-token', args)
                self.assertIn('https://api.github.com/repos/yonaskolb/XcodeGen/releases/assets/370842625', args)
                self.assertEqual(args[0], '--disable')
                self.assertIn('--location', args)
                self.assertNotIn('--location-trusted', args)
                self.assertEqual(args[args.index('--proto') + 1], '=https')
                self.assertEqual(args[args.index('--proto-redir') + 1], '=https')
                if failure == 'wrong-checksum':
                    self.assertIn('FAILED', result.stdout + result.stderr)


    def test_only_main_saves_the_cached_ios_build_and_nightly_starts_clean(self):
        steps = ios_steps()
        names = [step.get('name') for step in steps]
        select = ios_step('Select the cached iOS build')
        restore = ios_step('Restore the iOS build')
        self.assertRegex(restore['uses'], r'^actions/cache@[0-9a-f]{40}$')
        self.assertEqual(restore['with'], {
            'path': '${{ steps.ios-build.outputs.path }}',
            'key': '${{ steps.ios-build.outputs.key }}',
            'restore-keys': '${{ steps.ios-build.outputs.restore-keys }}'})
        self.assertEqual(select['id'], 'ios-build')
        # Only the event, ref, shard and run decide the key. A pull request's
        # branch name must never let it save a build main would restore.
        self.assertEqual(select['env'], {
            'EVENT': '${{ github.event_name }}',
            'REF': '${{ github.ref }}',
            'SHARD': '${{ matrix.shard }}',
            'RUN': '${{ github.run_id }}-${{ github.run_attempt }}'})
        self.assertNotIn('head_ref', select['run'])
        self.assertNotIn('MEASURE', select['run'])
        # The build is selected after Xcode, restored before verification and
        # trimmed after every verification step.
        self.assertLess(names.index('Select Xcode'), names.index('Select the cached iOS build'))
        self.assertLess(names.index('Restore the iOS build'), names.index('Unsigned simulator build and tests'))
        for name in ['Unsigned simulator build and tests', 'iPhone App Store build and tests',
                     'iPad App Store build and tests', 'iPad Station build and tests']:
            self.assertLess(names.index(name), names.index('Trim the iOS build before caching'))
        sources = subprocess.run(
            'git ls-files -s -- ios scripts/verify-ios.sh scripts/ios_sources.py | shasum -a 256 | cut -c1-64',
            shell=True, cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
        main = 'refs/heads/main'
        cases = [
            # event, ref, shard, key, restore prefix spec, save
            ('pull_request', 'refs/pull/7/merge', '1', 'ios-build-unsaved-9-1-1', 'project', 'no'),
            ('pull_request', 'refs/pull/7/merge', 'app-store-iphone',
             'ios-build-unsaved-9-1-app-store-iphone', 'project-app-store', 'no'),
            ('push', main, '1', f'ios-build-v1-project-26.3-17C1-{sources}', 'project', 'yes'),
            ('push', main, '2', 'ios-build-unsaved-9-1-2', 'project', 'no'),
            ('workflow_dispatch', main, 'app-store-iphone',
             f'ios-build-v1-project-app-store-26.3-17C1-{sources}', 'project-app-store', 'yes'),
            ('workflow_dispatch', main, 'app-store-ipad',
             'ios-build-unsaved-9-1-app-store-ipad', 'project-app-store', 'no'),
            ('workflow_dispatch', 'refs/heads/topic', '1', 'ios-build-unsaved-9-1-1', 'project', 'no'),
            ('schedule', main, '1', f'ios-build-v1-project-26.3-17C1-{sources}-clean-9-1', None, 'yes'),
            ('schedule', main, 'station', 'ios-build-unsaved-9-1-station', None, 'no'),
        ]
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            tools = folder / 'bin'
            tools.mkdir()
            (tools / 'xcodebuild').write_text('#!/bin/sh\nprintf "Xcode 26.3\\nBuild version 17C1\\n"\n')
            (tools / 'defaults').write_text('#!/bin/sh\necho "$*" >> "$DEFAULTS_LOG"\n')
            for tool in tools.iterdir():
                tool.chmod(0o755)
            for event, ref, shard, key, prefix, save in cases:
                with self.subTest(event=event, ref=ref, shard=shard):
                    output, env_file, defaults = (folder / 'output', folder / 'env', folder / 'defaults')
                    for path in (output, env_file, defaults):
                        path.write_text('')
                    subprocess.run(['bash', '-euo', 'pipefail', '-c', select['run']], check=True, cwd=ROOT,
                                   capture_output=True, env={
                                       'EVENT': event, 'REF': ref, 'SHARD': shard, 'RUN': '9-1',
                                       'RUNNER_TEMP': '/runner/temp', 'GITHUB_OUTPUT': str(output),
                                       'GITHUB_ENV': str(env_file), 'DEFAULTS_LOG': str(defaults),
                                       'PATH': f'{tools}:/usr/bin:/bin'})
                    spec = 'project-app-store' if shard.startswith('app-store') else 'project'
                    restore_keys = f'ios-build-v1-{prefix}-26.3-17C1-' if prefix else ''
                    self.assertEqual(output.read_text(), f'path=/runner/temp/tres-fort-ios-build/{spec}\n'
                                     f'key={key}\nrestore-keys={restore_keys}\nsave={save}\n')
                    self.assertEqual(env_file.read_text(),
                                     'TRESFORT_IOS_BUILD_ROOT=/runner/temp/tres-fort-ios-build\n')
                    self.assertEqual(defaults.read_text(),
                                     'write com.apple.dt.XCBuild IgnoreFileSystemDeviceInodeChanges -bool YES\n')
                    # A key that must not be saved can never match a restore prefix.
                    if save == 'no':
                        self.assertFalse(key.startswith('ios-build-v1-'))
        # One spec's restore prefix never matches the other spec's builds.
        self.assertFalse('ios-build-v1-project-app-store-26.3-17C1-x'.startswith(
            'ios-build-v1-project-26.3-17C1-'))
        trim = ios_step('Trim the iOS build before caching')
        self.assertNotIn('if', trim)
        for save, kept in [('yes', ['DerivedData/Build/Products/app', 'ios/App.swift']), ('no', [])]:
            with self.subTest(save=save), tempfile.TemporaryDirectory() as folder:
                build = Path(folder) / 'project'
                for name in ['DerivedData/Logs/Build/log', 'DerivedData/Build/Products/app', 'ios/App.swift']:
                    (build / name).parent.mkdir(parents=True, exist_ok=True)
                    (build / name).write_text('x')
                subprocess.run(['bash', '-euo', 'pipefail', '-c', trim['run']], check=True,
                               capture_output=True, env={'BUILD': str(build), 'SAVE': save,
                                                         'PATH': '/usr/bin:/bin'})
                remaining = sorted(str(path.relative_to(build)) for path in build.rglob('*') if path.is_file())
                self.assertEqual(remaining, kept)


if __name__ == '__main__':
    unittest.main()
