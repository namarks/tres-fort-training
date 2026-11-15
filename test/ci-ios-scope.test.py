"""The fast CI policy must not skip iOS changes or hide missing Git evidence."""
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'ci_ios_scope', Path(__file__).resolve().parents[1] / 'scripts/ci-ios-scope.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
ROOT = Path(__file__).resolve().parents[1]


def device_lists():
    """Selectors per device job, parsed as scripts/verify-ios.sh reads them."""
    lists = {}
    for path in sorted((ROOT / '.github/ios-tests').glob('*.txt')):
        lines = (line.split('#', 1)[0].strip() for line in path.read_text().splitlines())
        lists[path.stem] = [line for line in lines if line]
    return lists


class IOSScopeTests(unittest.TestCase):
    def test_periodic_and_manual_runs_always_include_full_suite(self):
        for event in ['schedule', 'workflow_dispatch']:
            with patch.object(policy.subprocess, 'check_output') as diff:
                self.assertEqual(policy.suite_for_checkout(event), 'full')
                diff.assert_not_called()

    def test_backend_and_documentation_only_changes_skip_ios(self):
        for event in ['pull_request', 'push']:
            self.assertEqual(policy.select_suite(event, [
                'src/db.ts', 'test/api.test.ts', 'docs/DESIGN.md',
                'migrations/0045_example.sql', 'README.md', 'vitest.config.ts',
            ]), 'skip')

    def test_web_site_and_plugin_only_changes_skip_ios(self):
        # The iOS build copies only ios/; none of these reach it.
        for event in ['pull_request', 'push']:
            self.assertEqual(policy.select_suite(event, [
                'web/app.js', 'website/index.html', 'plugins/tres-fort/README.md',
                'GEMINI.md', 'test/web_plan_editing.test.ts',
            ]), 'skip')
            self.assertEqual(policy.select_suite(event, [
                'web/app.js', 'ios/TresFort/App.swift']), 'smoke')

    def test_ios_shared_fixtures_and_unknown_paths_run_smoke(self):
        for path in ['ios/TresFort/App.swift', 'ios/project.yml',
                     'ios/TresFortTests/Fixtures/CalendarProjection.json',
                     'package.json', 'new-tool.conf']:
            self.assertEqual(policy.select_suite('pull_request', ['docs/note.md', path]), 'smoke')

    def test_verification_changes_require_full_coverage_before_merge(self):
        for event in ['pull_request', 'push']:
            for path in ['.github/workflows/ci.yml', 'scripts/verify-ios.sh',
                         'scripts/ci-ios-scope.py', 'test/verify-ios.test.py',
                         'test/ci-ios-scope.test.py']:
                self.assertEqual(policy.select_suite(event, ['docs/note.md', path]), 'full')

    def test_device_test_lists_run_full_because_smoke_has_no_device_jobs(self):
        for name in ['station', 'app-store-iphone', 'app-store-ipad']:
            self.assertEqual(policy.select_suite(
                'pull_request', [f'.github/ios-tests/{name}.txt']), 'full')

    def test_smoke_is_one_iphone_job_and_full_adds_every_device_job(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        matrix = re.search(r"matrix: \$\{\{ fromJSON\(needs\.plans\.outputs\.ios-suite == 'full'"
                           r" && '([^']+)' \|\| '([^']+)'\) \}\}", workflow)
        self.assertIsNotNone(matrix)
        full, smoke = (json.loads(group) for group in matrix.groups())
        # The suite rides in the matrix so each check is named for its shard.
        self.assertEqual(smoke, {'suite': ['smoke'], 'shard': [1]})
        self.assertEqual(full, {'suite': ['full'], 'shard': [
            1, 2, 3, 4, 5, 6, 'station', 'app-store-iphone', 'app-store-ipad']})
        self.assertNotIn('include:', workflow)
        self.assertRegex(workflow, r"schedule:\n(?:\s+#[^\n]*\n)*\s+- cron: '\S+ \S+ \* \* \*'")

    def test_only_public_visibility_selects_a_hosted_mac(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        script = re.search(r'      - name: Select iOS runner\n.*?        run: \|\n((?:          [^\n]*\n)+)',
                           workflow, re.S).group(1)
        script = '\n'.join(line[10:] for line in script.splitlines())
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'runner-selection-output'
            for private, expected in [('false', '\"macos-15\"'), ('true', 'none'),
                                      ('', 'none'), ('unknown', 'none')]:
                with self.subTest(private=private):
                    output.write_text('')
                    subprocess.run(['bash', '-euo', 'pipefail', '-c', script], check=True,
                                   capture_output=True, env={'PRIVATE': private,
                                   'GITHUB_OUTPUT': str(output), 'PATH': '/usr/bin:/bin',
                                   'PREFERENCE': 'self-hosted', 'ACTOR': 'namarks'})
                    self.assertEqual(output.read_text(), f'runner={expected}\n')
        job = re.search(r'  ios-tests:\n(.*?)\n  ios:\n', workflow, re.S).group(1)
        self.assertIn("runs-on: ${{ fromJSON(needs.plans.outputs.ios-runner) }}", job)
        self.assertIn("needs.plans.outputs.ios-runner != 'none'", job)
        aggregate = re.search(r'  ios:\n(.*?)\n  backend-tests:\n', workflow, re.S).group(1)
        self.assertNotIn("needs.plans.outputs.ios-runner != 'none'", aggregate)
        self.assertNotIn('TRESFORT_IOS_BUILD_ROOT=', job)
        self.assertNotIn('stop-ios-verification.sh', job)
        self.assertNotIn('RUNNER_NAME', job)
        self.assertIn('max-parallel: 9', job)
        self.assertIn('DEVELOPER_DIR=/Applications/Xcode_26.3.app/Contents/Developer', job)

    def test_ios_aggregate_fails_when_required_coverage_has_no_runner(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        aggregate = re.search(r'  ios:\n(.*?)\n  backend-tests:\n', workflow, re.S).group(1)
        script = re.search(r'        run: \|\n((?:          [^\n]*\n)+)', aggregate).group(1)
        script = '\n'.join(line[10:] for line in script.splitlines())
        cases = [
            ('success', 'skip', 'skipped', 'none', True),
            ('success', 'smoke', 'skipped', 'none', False),
            ('success', 'full', 'success', 'none', False),
            ('success', 'smoke', 'success', '"macos-15"', True),
            ('success', 'full', 'failure', '"macos-15"', False),
            ('failure', 'skip', 'skipped', 'none', False),
        ]
        for scope, suite, result, runner, passes in cases:
            with self.subTest(scope=scope, suite=suite, result=result, runner=runner):
                completed = subprocess.run(['bash', '-euo', 'pipefail', '-c', script],
                    capture_output=True, text=True, env={'SCOPE_RESULT': scope, 'SUITE': suite,
                    'RESULT': result, 'RUNNER': runner, 'PATH': '/usr/bin:/bin'})
                self.assertEqual(completed.returncode == 0, passes)

    def test_actions_are_immutable_and_checkouts_do_not_keep_credentials(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        for action in re.findall(r'uses: ([^\s]+)', workflow):
            self.assertRegex(action, r'^actions/[a-z-]+@[0-9a-f]{40}$')
        checkouts = re.findall(r'- uses: actions/checkout@[^\n]+\n(.*?)(?=      - |\n  [a-z]|\Z)',
                               workflow, re.S)
        self.assertEqual(len(checkouts), 3)
        for checkout in checkouts:
            self.assertIn('persist-credentials: false', checkout)

    def test_xcodegen_download_authentication_and_failed_install_cleanup(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        step = re.search(r'      - name: Install pinned XcodeGen\n(.*?)(?=\n      - name:)',
                         workflow, re.S).group(1)
        self.assertIn('GITHUB_TOKEN: ${{ github.token }}', step)
        script = re.search(r'        run: \|\n((?:          [^\n]*\n)+)', step).group(1)
        script = '\n'.join(line[10:] for line in script.splitlines())
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

    def test_device_test_lists_name_real_suites(self):
        ios = ROOT / 'ios'
        for name, selectors in device_lists().items():
            self.assertTrue(selectors, name)
            self.assertEqual(len(selectors), len(set(selectors)), name)
            for selector in selectors:
                with self.subTest(list=name, selector=selector):
                    target, *rest = selector.split('/')
                    self.assertIn(target, ['TresFortTests', 'TresFortUITests'])
                    if rest:
                        source = (ios / target / (rest[0] + '.swift')).read_text()
                        self.assertRegex(source, rf'class\s+{re.escape(rest[0])}\b')
                    if len(rest) == 2:
                        self.assertRegex(source, rf'func\s+{re.escape(rest[1])}\s*\(')

    def test_public_device_shards_require_camera_gate_and_native_ui_coverage(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        steps = dict(re.findall(r'      - name: ([^\n]+)\n(.*?)(?=\n      - |\n  [a-z]|\Z)',
                                workflow, re.S))
        job_name = re.search(r'  ios-tests:\n(?:    #[^\n]*\n)*    name: ([^\n]+)', workflow).group(1)
        # GitHub appends matrix values (suite, shard) only to a literal name;
        # an expression here makes every shard's check look the same.
        self.assertEqual(job_name, 'iOS')
        lists = device_lists()
        for family, device in [('iPhone', 'iPhone-17-Pro'), ('iPad', 'iPad-Pro-13-inch-M4-8GB')]:
            step = steps[f'{family} App Store build and tests']
            self.assertIn("APP_STORE_BUILD: '1'", step)
            self.assertIn(f'--device com.apple.CoreSimulator.SimDeviceType.{device}', step)
            self.assertIn(f'--only-testing-file .github/ios-tests/app-store-{family.lower()}.txt', step)
            self.assertIn('TresFortUITests/AppStoreScreenshotTests', lists[f'app-store-{family.lower()}'])
        for suite in ['TresFortTests/StationMediaPipeDetectorTests', 'TresFortTests/PublicStationTests']:
            self.assertIn(suite, lists['app-store-iphone'])
        # Require the entire public unit target, not a similarly prefixed class.
        for suite in ['TresFortTests', 'TresFortUITests/PublicStationJourneyTests',
                      'TresFortUITests/IpadWorkoutDisplayJourneyTests',
                      'TresFortUITests/MemberActivationJourneyTests/testFreshDeviceSignInRestoresExistingTrainingAndStation']:
            self.assertIn(suite, lists['app-store-ipad'])
        self.assertNotIn('--skip-testing', steps['iPad App Store build and tests'])
        self.assertNotIn('APP_STORE_BUILD', steps['iPad Station build and tests'])
        self.assertIn('--only-testing-file .github/ios-tests/station.txt',
                      steps['iPad Station build and tests'])
        for suite in ['StationJourneyTests', 'IpadWorkoutDisplayJourneyTests']:
            self.assertIn('TresFortUITests/' + suite, lists['station'])

    def test_documentation_only_changes_skip_backend_tests(self):
        for event in ['pull_request', 'push']:
            self.assertEqual(policy.select_backend(event, [
                'docs/plans/web-app/plan.md', 'docs/plans/README.md', 'README.md',
                'AGENTS.md', '.agents/skills/codex-gate/SKILL.md',
            ]), 'skip')
            for path in ['src/db.ts', 'test/api.test.ts', 'migrations/0059_x.sql',
                         'package.json', 'ios/TresFort/App.swift', '.github/workflows/ci.yml',
                         'scripts/ci-ios-scope.py', 'new-tool.conf']:
                self.assertEqual(policy.select_backend(event, ['docs/note.md', path]), 'run')
        for event in ['schedule', 'workflow_dispatch']:
            self.assertEqual(policy.suite_for_checkout(event, select=policy.select_backend), 'run')
        self.assertEqual(policy.suite_for_checkout('push', '0' * 40, policy.select_backend), 'run')
        with patch.object(policy.subprocess, 'check_output', return_value=b'docs/a.md\0') as diff:
            self.assertEqual(policy.suite_for_checkout(
                'pull_request', select=policy.select_backend), 'skip')
            diff.assert_called_once()

    def test_workflow_gates_backend_shards_on_scope_and_requires_the_aggregate(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        self.assertIn('--target backend', workflow)
        shards = re.search(r'  backend-tests:\n(.*?)\n  backend:\n', workflow, re.S).group(1)
        self.assertIn('needs: plans', shards)
        self.assertIn("needs.plans.outputs.backend == 'run'", shards)
        aggregate = re.search(r'  backend:\n(.*)', workflow, re.S).group(1)
        self.assertIn('name: typecheck + tests', aggregate)
        self.assertIn('skip) test "$RESULT" = skipped', aggregate)
        self.assertIn('run) test "$RESULT" = success', aggregate)

    def test_pull_request_compares_tested_merge_with_base_and_preserves_paths(self):
        with patch.object(policy.subprocess, 'check_output', return_value=
                          b'docs/name with\na newline.md\0ios/deleted.swift\0docs/renamed.swift\0') as diff:
            self.assertEqual(policy.suite_for_checkout('pull_request'), 'smoke')
            diff.assert_called_once_with(
                ['git', 'diff', '--no-renames', '--name-only', '-z', 'HEAD^1', 'HEAD'])

    def test_push_compares_entire_push_including_earlier_ios_change(self):
        before = 'a' * 40
        with patch.object(policy.subprocess, 'check_output', return_value=
                          b'ios/earlier.swift\0docs/latest.md\0') as diff:
            self.assertEqual(policy.suite_for_checkout('push', before), 'smoke')
            diff.assert_called_once_with(
                ['git', 'diff', '--no-renames', '--name-only', '-z', before, 'HEAD'])

    def test_missing_git_evidence_cannot_report_skip(self):
        for event, before in [('pull_request', None), ('push', 'a' * 40)]:
            with patch.object(policy.subprocess, 'check_output', side_effect=
                              subprocess.CalledProcessError(128, 'git')):
                with self.assertRaises(subprocess.CalledProcessError):
                    policy.suite_for_checkout(event, before)
        for before in [None, '', '--bad-ref']:
            with self.assertRaises(ValueError):
                policy.suite_for_checkout('push', before)
        self.assertEqual(policy.suite_for_checkout('push', '0' * 40), 'smoke')


if __name__ == '__main__':
    unittest.main()
