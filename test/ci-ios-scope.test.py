"""The fast CI policy must not skip iOS changes or hide missing Git evidence."""
import importlib.util
from pathlib import Path
import re
import subprocess
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
    def test_workflow_coverage_contract_runs_independently(self):
        # Keep a second entry point: removing the workflow's direct Node call
        # must still execute the contract that detects the missing invocation.
        # Intentional changes to these checks also require independent review.
        subprocess.run(['node', '--test', 'test/ci-ios-workflow.test.mjs'],
                       cwd=ROOT, check=True, capture_output=True, text=True)

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
        for path in ['ios/TresFort/App.swift',
                     'ios/TresFortTests/Fixtures/CalendarProjection.json',
                     'package.json', 'new-tool.conf']:
            self.assertEqual(policy.select_suite('pull_request', ['docs/note.md', path]), 'smoke')

    def test_native_verification_changes_require_full_coverage_before_merge(self):
        for event in ['pull_request', 'push']:
            for path in ['scripts/verify-ios.sh', 'test/verify-ios.test.py']:
                self.assertEqual(policy.select_suite(event, ['docs/note.md', path]), 'full')

    def test_selection_policy_and_contracts_use_smoke_and_keep_fast_checks(self):
        for event in ['pull_request', 'push']:
            for path in ['scripts/ci-ios-scope.py', 'test/ci-ios-scope.test.py',
                         'test/ci-ios-workflow.test.mjs']:
                with self.subTest(event=event, path=path):
                    paths = ['docs/note.md', path]
                    self.assertEqual(policy.select_suite(event, paths), 'smoke')
                    # Fast workflow/selector/verifier checks run in this job.
                    self.assertEqual(policy.select_backend(event, paths), 'run')

    def test_routine_workflow_and_setup_tests_use_smoke_unless_coverage_changes(self):
        setup = ['.github/workflows/ci.yml', 'test/ci-ios-setup.test.py']
        for event in ['pull_request', 'push']:
            self.assertEqual(policy.select_suite(event, setup + ['docs/note.md']), 'smoke')
            self.assertEqual(policy.select_backend(event, setup), 'run')
            for coverage in ['scripts/verify-ios.sh', 'test/verify-ios.test.py',
                             '.github/ios-tests/station.txt', 'ios/project-app-store.yml']:
                targeted = setup + ['scripts/ci-ios-scope.py', 'test/ci-ios-workflow.test.mjs']
                for paths in [targeted + [coverage], [coverage] + targeted]:
                    with self.subTest(event=event, paths=paths):
                        self.assertEqual(policy.select_suite(event, paths), 'full')

    def test_packaging_inputs_require_all_device_variants(self):
        paths = [
            'ios/project.yml', 'ios/project-app-store.yml', 'scripts/ios_sources.py',
            'ios/Dependencies/verify_app_store_project.py',
            'ios/Dependencies/prepare_simulator_plist.py', 'test/app-store-packaging.test.py',
            'ios/TresFort/Info.plist', 'ios/TresFort/TresFort.entitlements',
            'ios/TresFortWidgets/Info.plist', 'ios/TresFortWidgets/TresFortWidgets.entitlements',
        ]
        for path in paths:
            self.assertTrue((ROOT / path).is_file(), path)
            for event in ['pull_request', 'push']:
                with self.subTest(event=event, path=path):
                    self.assertEqual(policy.select_suite(event, [path, 'docs/note.md']), 'full')

    def test_device_test_lists_run_full_because_smoke_has_no_device_jobs(self):
        for name in ['station', 'app-store-iphone', 'app-store-ipad']:
            self.assertEqual(policy.select_suite(
                'pull_request', [f'.github/ios-tests/{name}.txt']), 'full')

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

    def test_device_lists_keep_required_native_coverage(self):
        lists = device_lists()
        for family in ['iphone', 'ipad']:
            self.assertIn('TresFortUITests/AppStoreScreenshotTests', lists[f'app-store-{family}'])
        for suite in ['TresFortTests/StationMediaPipeDetectorTests', 'TresFortTests/PublicStationTests']:
            self.assertIn(suite, lists['app-store-iphone'])
        # Require the entire public unit target, not a similarly prefixed class.
        for suite in ['TresFortTests', 'TresFortUITests/PublicStationJourneyTests',
                      'TresFortUITests/IpadWorkoutDisplayJourneyTests',
                      'TresFortUITests/MemberActivationJourneyTests/testFreshDeviceSignInRestoresExistingTrainingAndStation']:
            self.assertIn(suite, lists['app-store-ipad'])
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
