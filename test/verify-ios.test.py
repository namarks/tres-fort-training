"""Verify process failures cannot produce green CI or leak disposable devices."""
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'verify-ios.sh'

class VerifyIOSTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='verify-ios-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        (self.root / 'ios').mkdir()
        (self.root / 'ios' / 'Dependencies').mkdir()
        (self.root / 'scratch').mkdir()
        (self.root / 'bin').mkdir()
        (self.root / 'bin' / 'python3').symlink_to(Path(sys.executable).resolve())
        (self.root / 'ios' / 'project.yml').write_text('name: Test\n')
        (self.root / 'ios' / 'project-app-store.yml').write_text('name: TestAppStore\n')
        shutil.copy(SCRIPT, self.root / 'scripts' / SCRIPT.name)
        shutil.copy(SCRIPT.parent / 'ios_sources.py', self.root / 'scripts' / 'ios_sources.py')
        shutil.copy(SCRIPT.parent.parent / 'ios/Dependencies/verify_app_store_project.py',
                    self.root / 'ios/Dependencies/verify_app_store_project.py')
        mock = '''#!/usr/bin/env python3
import json, os, pathlib, signal, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['MOCK_CALLS'], 'a') as f: f.write(json.dumps([name, args]) + '\\n')
if name == 'xcrun':
    if args[:3] == ['simctl', 'list', 'runtimes']:
        print(json.dumps({'runtimes': [{'identifier': 'runtime', 'isAvailable': True}]}))
    elif args[:3] == ['simctl', 'list', 'devicetypes']:
        print(json.dumps({'devicetypes': [{'identifier': 'device'}]}))
    elif args[:2] == ['simctl', 'create']: print('disposable-simulator')
    elif args[:2] == ['simctl', 'boot']: sys.exit(int(os.environ.get('MOCK_BOOT_EXIT', '0')))
    elif args[:2] == ['simctl', 'bootstatus']: sys.exit(int(os.environ.get('MOCK_BOOTSTATUS_EXIT', '0')))
    elif args[:2] == ['simctl', 'ui']: sys.exit(int(os.environ.get('MOCK_UI_EXIT', '0')))
    elif args[:2] == ['simctl', 'delete']: sys.exit(int(os.environ.get('MOCK_DELETE_EXIT', '0')))
elif name == 'xcodegen' and args[0] == 'generate':
    project = pathlib.Path(args[args.index('--spec') + 1]).parent / 'TresFort.xcodeproj'
    project.mkdir(exist_ok=True)
    contents = 'APP_STORE_BUILD\\nRemove run recorder location keys\\n' + 'TARGETED_DEVICE_FAMILY = "1,2";\\n' * 4
    (project / 'project.pbxproj').write_text(os.environ.get('MOCK_PROJECT_CONTENTS', contents))
elif name == 'xcodebuild' and args[0] in ['build-for-testing', 'test-without-building']:
    if args[0] == 'build-for-testing' and os.environ.get('MOCK_BUILD_LOG'):
        import time
        with open(os.environ['MOCK_BUILD_LOG'], 'a') as f: f.write('start\\n')
        time.sleep(0.5)
        with open(os.environ['MOCK_BUILD_LOG'], 'a') as f: f.write('end\\n')
    result = pathlib.Path(args[args.index('-resultBundlePath') + 1])
    result.mkdir()
    (result / 'result.txt').write_text('synthetic evidence')
    print('build/test diagnostic')
    if args[0] == 'test-without-building' and os.environ.get('MOCK_TEST_EXIT'):
        print("Test Case '-[Suite testExample]' started.")
        print('    t =     1.00s Tap "LOG SET 1" Button')
        print('Example.swift:42: error: XCTest assertion failed')
        print("Test Case '-[Suite testExample]' failed (2.000 seconds).")
        print('accessibility dump\\n' * 120)
    if args[0] == 'test-without-building' and os.environ.get('MOCK_RETRIED_TESTS'):
        # Xcode's retry: one test fails, then passes when run again.
        print("Test Case '-[TresFortUITests.Steady testAlwaysPasses]' started.")
        print('    t =     0.50s unrelated steady activity')
        print("Test Case '-[TresFortUITests.Steady testAlwaysPasses]' passed (1.000 seconds).")
        print("Test Case '-[TresFortUITests.Slow testNeedsRetry]' started.")
        for step in range(85): print(f'    t =     1.00s retry-step-{step:03d}')
        print('Retry.swift:17: error: Failed to find expected button')
        print('unbounded element-tree dump')
        print("Test Case '-[TresFortUITests.Slow testNeedsRetry]' failed (9.000 seconds).")
        print("Test Case '-[TresFortUITests.Slow testNeedsRetry]' started.")
        print('    t =     1.00s successful retry activity')
        print("Test Case '-[TresFortUITests.Slow testNeedsRetry]' passed (4.000 seconds).")
        for attempt in range(2):
            print("Test Case '-[TresFortUITests.Broken testFailsTwice]' started.")
            print('    t =     1.00s unrelated terminal failure activity')
            print("Test Case '-[TresFortUITests.Broken testFailsTwice]' failed (2.000 seconds).")
    if args[0] == 'test-without-building' and os.environ.get('MOCK_CANCEL_DURING_TEST'):
        # Kill only the disposable verifier shell, emulating a runner that
        # cannot wait for cleanup. The test owns and removes its whole temp tree.
        os.kill(os.getppid(), signal.SIGKILL)
    failure = 'MOCK_BUILD_EXIT' if args[0] == 'build-for-testing' else 'MOCK_TEST_EXIT'
    sys.exit(int(os.environ.get(failure, '0')))
else: print('synthetic-tool-version')
'''
        for name in ['xcrun', 'xcodegen', 'xcodebuild', 'git']:
            path = self.root / 'bin' / name
            path.write_text(mock)
            path.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.root/'bin')+os.pathsep+os.environ['PATH'],
                        TMPDIR=str(self.root/'scratch'), MOCK_CALLS=str(self.root/'calls.jsonl'))
        self.env.pop('IOS_KEEP_RESULTS', None)
        self.env.pop('IOS_EVIDENCE_DIR', None)
        self.env.pop('APP_STORE_IPHONE_ONLY', None)
        self.env.pop('APP_STORE_BUILD', None)

    def run_script(self, args=None):
        args = args if args is not None else ['--runtime','runtime','--device','device']
        result = subprocess.run(['bash',str(self.root/'scripts'/SCRIPT.name),*args],
                                env=self.env, capture_output=True, text=True)
        self.assertEqual(list((self.root/'scratch').glob('tres-fort-ios.*')), [], result.stderr)
        return result

    def calls(self):
        path=self.root/'calls.jsonl'
        return [json.loads(row) for row in path.read_text().splitlines()] if path.exists() else []

    def test_requires_explicit_selection_before_creating_device(self):
        self.assertEqual(self.run_script([]).returncode, 2)
        self.assertEqual(self.calls(), [])

    def test_selects_app_store_project_only_when_requested(self):
        self.env['APP_STORE_BUILD'] = '1'
        self.assertEqual(self.run_script().returncode, 0)
        generation = next(args for name, args in self.calls()
                          if name == 'xcodegen' and args[0] == 'generate')
        self.assertEqual(Path(generation[generation.index('--spec') + 1]).name,
                         'project-app-store.yml')

    def test_invalid_app_store_mode_stops_before_creating_device(self):
        for mode in ('yes', ''):
            with self.subTest(mode=mode):
                self.env['APP_STORE_BUILD'] = mode
                self.assertEqual(self.run_script().returncode, 2)
                self.assertEqual(self.calls(), [])

    def test_deprecated_flag_is_rejected_even_when_empty_zero_or_new_mode_is_set(self):
        for legacy in ('', '0', '1'):
            for mode in ('0', '1'):
                with self.subTest(legacy=legacy, mode=mode):
                    self.env['APP_STORE_IPHONE_ONLY'] = legacy
                    self.env['APP_STORE_BUILD'] = mode
                    result = self.run_script()
                    self.assertEqual(result.returncode, 2)
                    self.assertIn('APP_STORE_IPHONE_ONLY is obsolete', result.stderr)
                    self.assertEqual(self.calls(), [])

    def test_public_project_guard_rejects_wrong_generation_before_creating_device(self):
        self.env['APP_STORE_BUILD'] = '1'
        self.env['MOCK_PROJECT_CONTENTS'] = 'APP_STORE_IPHONE_ONLY'
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('deprecated APP_STORE_IPHONE_ONLY', result.stderr)
        self.assertFalse(any(args[:2] == ['simctl', 'create'] for _, args in self.calls()))
        self.assertFalse(any(name == 'xcodebuild' and args[0] == 'build-for-testing'
                             for name, args in self.calls()))

    def test_invalid_runtime_cleans_scratch_and_never_creates_simulator(self):
        result=self.run_script(['--runtime','missing','--device','device'])
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(any(args[:2]==['simctl','create'] for _,args in self.calls()))

    def test_success_removes_owned_device_and_outputs(self):
        self.assertEqual(self.run_script().returncode,0)
        self.assertIn(['xcrun',['simctl','delete','disposable-simulator']],self.calls())
        self.assertFalse((self.root/'.artifacts').exists())

    def test_test_failure_remains_failure_with_retained_evidence_and_cleanup(self):
        self.env['MOCK_TEST_EXIT']='65'
        result=self.run_script(['--runtime','runtime','--device','device','--only-testing','TresFortTests'])
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Example.swift:42: error: XCTest assertion failed', result.stderr)
        # The failed test's trace survives even when later output fills the tail.
        self.assertIn("---- trace: Test Case '-[Suite testExample]' failed", result.stderr)
        self.assertIn('Tap "LOG SET 1" Button', result.stderr)
        self.assertIn(['xcrun',['simctl','delete','disposable-simulator']],self.calls())
        self.assertEqual(len(list((self.root/'.artifacts').rglob('result.txt'))),2)
        self.assertIn('-only-testing:TresFortTests',next(args for name,args in self.calls() if name=='xcodebuild' and args[0]=='test-without-building'))

    def test_selection_file_adds_each_selector_and_rejects_bad_files(self):
        selection=self.root/'selection.txt'
        selection.write_text('# comment\nTresFortTests/StationLiveTests\n\n  TresFortUITests/A/testB  # why\nTresFortTests')
        result=self.run_script(['--runtime','runtime','--device','device','--only-testing-file',str(selection)])
        self.assertEqual(result.returncode,0,result.stderr)
        args=next(args for name,args in self.calls() if name=='xcodebuild' and args[0]=='test-without-building')
        self.assertEqual([arg for arg in args if arg.startswith('-only-testing:')],
                         ['-only-testing:TresFortTests/StationLiveTests','-only-testing:TresFortUITests/A/testB',
                          '-only-testing:TresFortTests'])
        for contents in ['# nothing selected\n\n','TresFortTests/-flag\n','A/B/C/D\n']:
            with self.subTest(contents=contents):
                selection.write_text(contents)
                calls_before=self.calls()
                self.assertEqual(self.run_script(['--runtime','runtime','--device','device',
                                                  '--only-testing-file',str(selection)]).returncode,2)
                self.assertEqual(self.calls(),calls_before)
        for extra in [['--only-testing-file',str(self.root/'missing.txt')],
                      ['--only-testing-file',str(selection),'--ci-shard','1']]:
            selection.write_text('TresFortTests\n')
            calls_before=self.calls()
            self.assertEqual(self.run_script(['--runtime','runtime','--device','device',*extra]).returncode,2)
            self.assertEqual(self.calls(),calls_before)

    def test_build_failure_retains_diagnostics_and_never_runs_tests(self):
        self.env['MOCK_BUILD_EXIT']='65'
        self.assertNotEqual(self.run_script().returncode,0)
        self.assertIn(['xcrun',['simctl','delete','disposable-simulator']],self.calls())
        self.assertFalse(any(name=='xcodebuild' and args[0]=='test-without-building' for name,args in self.calls()))
        self.assertEqual(len(list((self.root/'.artifacts').rglob('build.log'))),1)

    def test_forced_cancellation_retains_in_progress_evidence_without_cleanup(self):
        self.env['IOS_KEEP_RESULTS']='1'
        self.env['MOCK_CANCEL_DURING_TEST']='1'
        result=subprocess.run(['bash',str(self.root/'scripts'/SCRIPT.name),
                               '--runtime','runtime','--device','device'],
                              env=self.env,capture_output=True,text=True)
        self.assertEqual(result.returncode,-signal.SIGKILL)
        # Evidence must already exist before an EXIT trap or simulator cleanup.
        evidence=self.root/'.artifacts'/'ios'
        self.assertEqual(len(list(evidence.rglob('build.log'))),1)
        self.assertEqual(len(list(evidence.rglob('xcodebuild.log'))),1)
        self.assertEqual(len(list(evidence.rglob('sources.json'))),1)
        self.assertEqual(len(list(evidence.rglob('result.txt'))),2)
        self.assertFalse(any(p.name in ['DerivedData','ios'] for p in evidence.glob('*/*')))

    def test_boot_failures_remain_failures_and_clean_owned_device(self):
        for failure in ['MOCK_BOOT_EXIT', 'MOCK_BOOTSTATUS_EXIT']:
            with self.subTest(failure=failure):
                self.env[failure]='1'
                self.assertNotEqual(self.run_script().returncode,0)
                self.assertIn(['xcrun',['simctl','delete','disposable-simulator']],self.calls())
                self.assertFalse(any(name=='xcodebuild' and args[0]=='test-without-building' for name,args in self.calls()))
                self.env.pop(failure)

    def test_boot_overlaps_build_and_tests_reuse_same_build_and_device(self):
        self.assertEqual(self.run_script().returncode,0)
        calls=self.calls()
        build=next(args for name,args in calls if name=='xcodebuild' and args[0]=='build-for-testing')
        test=next(args for name,args in calls if name=='xcodebuild' and args[0]=='test-without-building')
        self.assertLess(calls.index(['xcrun',['simctl','boot','disposable-simulator']]),calls.index(['xcodebuild',build]))
        self.assertLess(calls.index(['xcodebuild',build]),calls.index(['xcrun',['simctl','bootstatus','disposable-simulator','-b']]))
        self.assertLess(calls.index(['xcrun',['simctl','bootstatus','disposable-simulator','-b']]),calls.index(['xcodebuild',test]))
        for option in ['-project','-scheme','-destination','-derivedDataPath']:
            self.assertEqual(build[build.index(option)+1],test[test.index(option)+1])
        self.assertEqual(test[test.index('-parallel-testing-enabled')+1],'NO')
        # A failed test runs once more in place, never more than once.
        self.assertIn('-retry-tests-on-failure',test)
        self.assertEqual(test[test.index('-test-iterations')+1],'2')
        self.assertNotIn('-retry-tests-on-failure',build)

    def test_persistent_build_root_reuses_sources_and_derived_data(self):
        build_root = self.root / 'persistent'
        self.env['TRESFORT_IOS_BUILD_ROOT'] = str(build_root)
        ios = self.root / 'ios'
        (ios / 'Kept.swift').write_text('let kept = 1\n')
        (ios / 'Changed.swift').write_text('let changed = 1\n')
        (ios / 'Removed.swift').write_text('let removed = 1\n')
        self.assertEqual(self.run_script().returncode, 0)
        copy = build_root / 'project' / 'ios'
        build = next(args for name, args in self.calls()
                     if name == 'xcodebuild' and args[0] == 'build-for-testing')
        self.assertEqual(build[build.index('-derivedDataPath') + 1],
                         str(build_root / 'project' / 'DerivedData'))
        self.assertEqual(build[build.index('-project') + 1], str(copy / 'TresFort.xcodeproj'))
        kept = (copy / 'Kept.swift').stat()
        (ios / 'Changed.swift').write_text('let changed = 2\n')
        (ios / 'Removed.swift').unlink()
        self.assertEqual(self.run_script().returncode, 0)
        # Unchanged files are left alone, so Xcode's incremental build keeps them.
        self.assertEqual(((copy / 'Kept.swift').stat().st_ino, (copy / 'Kept.swift').stat().st_mtime_ns),
                         (kept.st_ino, kept.st_mtime_ns))
        self.assertEqual((copy / 'Changed.swift').read_text(), 'let changed = 2\n')
        self.assertFalse((copy / 'Removed.swift').exists())
        self.assertTrue((copy / 'TresFort.xcodeproj').is_dir())
        self.assertFalse((build_root / 'project' / '.lock').exists())
        self.env['APP_STORE_BUILD'] = '1'
        self.assertEqual(self.run_script().returncode, 0)
        self.assertTrue((build_root / 'project-app-store' / 'ios' / 'Kept.swift').exists())

    def test_persistent_build_root_refuses_a_build_in_use(self):
        build_root = self.root / 'persistent'
        self.env['TRESFORT_IOS_BUILD_ROOT'] = str(build_root)
        self.env['TRESFORT_IOS_BUILD_LOCK_WAIT'] = '0'
        (build_root / 'project').mkdir(parents=True)
        lock = build_root / 'project' / '.lock'
        holder = subprocess.Popen(['bash', '-c', 'sleep 30; true', 'verify-ios.sh'])
        self.addCleanup(holder.kill)
        lock.write_text(f'{holder.pid}\n')
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Another verification is using', result.stderr)
        self.assertFalse(any(args[:2] == ['simctl', 'create'] for _, args in self.calls()))
        self.assertEqual(lock.read_text(), f'{holder.pid}\n')
        holder.kill()
        holder.wait()
        # A lock left by a killed job is taken over.
        self.assertEqual(self.run_script().returncode, 0)
        # So is one whose process id now belongs to something else.
        other = subprocess.Popen(['sleep', '30'])
        self.addCleanup(other.kill)
        lock.write_text(f'{other.pid}\n')
        self.assertEqual(self.run_script().returncode, 0)

    def test_concurrent_verifications_take_the_build_one_at_a_time(self):
        build_root = self.root / 'persistent'
        log = self.root / 'builds.log'
        self.env.update(TRESFORT_IOS_BUILD_ROOT=str(build_root), MOCK_BUILD_LOG=str(log))
        script = ['bash', str(self.root / 'scripts' / SCRIPT.name), '--runtime', 'runtime', '--device', 'device']
        runs = [subprocess.Popen(script, env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
                for _ in range(4)]
        for run in runs:
            _, stderr = run.communicate(timeout=120)
            self.assertEqual(run.returncode, 0, stderr)
        # Every build finished before the next one started.
        self.assertEqual(log.read_text(), 'start\nend\n' * 4)
        self.assertEqual(sorted(p.name for p in (build_root / 'project').glob('.lock*')), [])

    def test_persistent_build_root_waits_for_a_cancelled_verification(self):
        build_root = self.root / 'persistent'
        self.env['TRESFORT_IOS_BUILD_ROOT'] = str(build_root)
        (build_root / 'project').mkdir(parents=True)
        holder = subprocess.Popen(['bash', '-c', 'sleep 3; true', 'verify-ios.sh'])
        self.addCleanup(holder.kill)
        (build_root / 'project' / '.lock').write_text(f'{holder.pid}\n')
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Waiting for the verification already using', result.stdout)
        self.assertIsNotNone(holder.poll())

    def test_persistent_build_root_restarts_an_unfinished_build_clean(self):
        build_root = self.root / 'persistent'
        self.env['TRESFORT_IOS_BUILD_ROOT'] = str(build_root)
        project = build_root / 'project'
        self.assertEqual(self.run_script().returncode, 0)
        self.assertFalse((project / '.building').exists())
        # A build kept before the marker existed starts clean once.
        (project / '.layout').unlink()
        (project / 'DerivedData').mkdir(exist_ok=True)
        (project / 'DerivedData' / 'old.o').write_text('old\n')
        self.assertEqual(self.run_script().returncode, 0)
        self.assertFalse((project / 'DerivedData' / 'old.o').exists())
        (project / 'DerivedData').mkdir(exist_ok=True)
        (project / 'DerivedData' / 'kept.o').write_text('warm\n')
        self.assertEqual(self.run_script().returncode, 0)
        self.assertTrue((project / 'DerivedData' / 'kept.o').exists())
        # A build that was interrupted leaves its marker behind.
        (project / '.building').touch()
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('did not finish; starting it clean', result.stdout)
        self.assertFalse((project / 'DerivedData' / 'kept.o').exists())
        self.assertFalse((project / '.building').exists())
        # A build that ran to a failure is not interrupted.
        self.env['MOCK_BUILD_EXIT'] = '65'
        self.assertNotEqual(self.run_script().returncode, 0)
        self.assertFalse((project / '.building').exists())

    def test_persistent_build_root_stops_a_leftover_build(self):
        build_root = self.root / 'persistent'
        self.env['TRESFORT_IOS_BUILD_ROOT'] = str(build_root)
        derived_data = build_root / 'project' / 'DerivedData'
        leftover = subprocess.Popen(['bash', '-c', 'sleep 30; true', 'xcodebuild',
                                     '-derivedDataPath', str(derived_data)])
        self.addCleanup(leftover.kill)
        other = subprocess.Popen(['bash', '-c', 'sleep 30; true', 'xcodebuild',
                                  '-derivedDataPath', str(self.root / 'elsewhere')])
        self.addCleanup(other.kill)
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Stopping a leftover build', result.stdout)
        self.assertIsNotNone(leftover.wait(timeout=10))
        self.assertIsNone(other.poll())

    def test_sync_repairs_a_file_with_the_same_size_and_time(self):
        sys.path.insert(0, str(SCRIPT.parent))
        from ios_sources import sync_sources
        source, copy = self.root / 'ios', self.root / 'copy'
        (source / 'Same.swift').write_text('let a = 1\n')
        sync_sources(source, copy)
        (copy / 'Same.swift').write_text('let a = 2\n')
        stat = (source / 'Same.swift').stat()
        os.utime(copy / 'Same.swift', ns=(stat.st_atime_ns, stat.st_mtime_ns))
        sync_sources(source, copy)
        self.assertEqual((copy / 'Same.swift').read_text(), 'let a = 1\n')

    def test_tests_that_pass_only_on_retry_are_reported_as_flaky(self):
        summary=self.root/'summary.md'
        self.env.update(MOCK_RETRIED_TESTS='1',GITHUB_ACTIONS='true',GITHUB_STEP_SUMMARY=str(summary))
        result=self.run_script()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('Passed only when run again',result.stdout)
        self.assertIn('::warning title=Flaky iOS test::TresFortUITests.Slow testNeedsRetry failed',result.stdout)
        self.assertIn('TresFortUITests.Slow testNeedsRetry',summary.read_text())
        # Keep the failed attempt's last 80 activity/error lines on a green run,
        # without earlier steps, other tests, the passing attempt, or tree dumps.
        self.assertIn("---- trace: Test Case '-[TresFortUITests.Slow testNeedsRetry]' failed",result.stdout)
        self.assertIn('Retry.swift:17: error: Failed to find expected button',result.stdout)
        trace_lines = [line for line in result.stdout.splitlines()
                       if line.startswith('    t = ') or 'Retry.swift:17: error:' in line]
        self.assertEqual(len(trace_lines),80)
        self.assertIn('retry-step-006',trace_lines[0])
        self.assertIn('retry-step-084',trace_lines[-2])
        for omitted in ['retry-step-005','unrelated steady activity',
                        'successful retry activity','unrelated terminal failure activity',
                        'unbounded element-tree dump']:
            self.assertNotIn(omitted,result.stdout)
        self.assertIn(['xcrun',['simctl','delete','disposable-simulator']],self.calls())
        self.assertFalse((self.root/'.artifacts').exists())
        # Neither a steady pass nor a test that failed every time is "flaky".
        for name in ['testAlwaysPasses','testFailsTwice']:
            self.assertNotIn(name,result.stdout)
            self.assertNotIn(name,summary.read_text())
        self.env['MOCK_TEST_EXIT']='1'
        summary.unlink()
        result=self.run_script()
        self.assertNotEqual(result.returncode,0)
        self.assertIn('TresFortUITests.Slow testNeedsRetry',result.stderr)
        self.assertIn('Example.swift:42: error',result.stderr)

    def test_quiet_run_reports_no_flaky_tests(self):
        summary=self.root/'summary.md'
        self.env.update(GITHUB_ACTIONS='true',GITHUB_STEP_SUMMARY=str(summary))
        result=self.run_script()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn('Passed only when run again',result.stdout)
        self.assertFalse(summary.exists())

    def test_ci_shards_are_complementary_and_reject_extra_filters(self):
        universe={'TresFortTests'} | {
            'TresFortUITests/'+path.stem
            for path in (SCRIPT.parents[1]/'ios'/'TresFortUITests').glob('*Tests.swift')
        }
        covered=set()
        for shard in ['1','2','3','4','5','6']:
            with self.subTest(shard=shard):
                result=self.run_script(['--runtime','runtime','--device','device','--ci-shard',shard])
                self.assertEqual(result.returncode,0,result.stderr)
                args=[args for name,args in self.calls() if name=='xcodebuild' and args[0]=='test-without-building'][-1]
                selection=[arg for arg in args if arg.startswith(('-only-testing:', '-skip-testing:'))]
                if shard=='1':
                    self.assertTrue(all(arg.startswith('-skip-testing:') for arg in selection))
                    selected=universe-{arg.removeprefix('-skip-testing:') for arg in selection}
                else:
                    self.assertTrue(all(arg.startswith('-only-testing:') for arg in selection))
                    selected={arg.removeprefix('-only-testing:') for arg in selection}
                self.assertTrue(selected)
                self.assertTrue(selected <= universe, selected - universe)
                self.assertFalse(covered & selected)
                covered |= selected
        self.assertEqual(covered,universe)
        for extra in [['--ci-shard','0'],['--ci-shard','7'],['--ci-shard','1','--only-testing','TresFortTests']]:
            calls_before=self.calls()
            self.assertEqual(self.run_script(['--runtime','runtime','--device','device',*extra]).returncode,2)
            self.assertEqual(self.calls(),calls_before)

    def test_smoke_is_one_job_of_every_unit_test_and_no_ui_journeys(self):
        result=self.run_script(['--runtime','runtime','--device','device',
                                '--ui-suite','smoke','--ci-shard','1'])
        self.assertEqual(result.returncode,0,result.stderr)
        args=[args for name,args in self.calls() if name=='xcodebuild' and args[0]=='test-without-building'][-1]
        selections=[arg.removeprefix('-only-testing:') for arg in args if arg.startswith('-only-testing:')]
        self.assertFalse(any(arg.startswith('-skip-testing:') for arg in args))
        # The whole unit target and nothing else: UI journeys run in the
        # nightly/manual full run, so a PR waits only for build and units.
        self.assertEqual(selections,['TresFortTests'])
        # build-for-testing still compiles the UI test bundle, so a PR that
        # breaks UI test code fails here rather than in the nightly run.
        build=[args for name,args in self.calls() if name=='xcodebuild' and args[0]=='build-for-testing'][-1]
        self.assertFalse(any(arg.startswith(('-only-testing:','-skip-testing:')) for arg in build))
        result=self.run_script(['--runtime','runtime','--device','device','--ui-suite','smoke'])
        self.assertEqual(result.returncode,0,result.stderr)
        args=[args for name,args in self.calls() if name=='xcodebuild' and args[0]=='test-without-building'][-1]
        self.assertEqual([arg.removeprefix('-only-testing:') for arg in args if arg.startswith('-only-testing:')],selections)
        for extra in [['--ui-suite','invalid'],
                      ['--ui-suite','smoke','--ci-shard','2'],
                      ['--ui-suite','smoke','--ci-shard','3'],
                      ['--ui-suite','smoke','--ci-shard','6'],
                      ['--ui-suite','smoke','--only-testing','TresFortTests']]:
            calls_before=self.calls()
            self.assertEqual(self.run_script(['--runtime','runtime','--device','device',*extra]).returncode,2)
            self.assertEqual(self.calls(),calls_before)

    def test_system_text_setting_failure_cleans_device_without_running_tests(self):
        self.env['MOCK_UI_EXIT']='1'
        result=self.run_script(['--runtime','runtime','--device','device',
                                '--content-size','accessibility-extra-extra-extra-large'])
        self.assertNotEqual(result.returncode,0)
        self.assertIn(['xcrun',['simctl','delete','disposable-simulator']],self.calls())
        self.assertFalse(any(name=='xcodebuild' and args[0]=='test-without-building' for name,args in self.calls()))
        self.assertEqual(len(list((self.root/'.artifacts').rglob('ui-settings.log'))),1)

    def test_cleanup_failure_is_not_a_green_run(self):
        self.env['MOCK_DELETE_EXIT']='1'
        self.assertNotEqual(self.run_script().returncode,0)
        self.assertEqual(len(list((self.root/'.artifacts').rglob('cleanup.log'))),1)

if __name__ == '__main__': unittest.main()
