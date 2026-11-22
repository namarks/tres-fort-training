"""The Apple Watch build check fails when the build does, and leaves nothing behind."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'verify-watch.sh'

MOCK = '''#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['MOCK_CALLS'], 'a') as f: f.write(json.dumps([name, args]) + '\\n')
if name == 'xcodegen' and args[0] == 'generate':
    sys.exit(int(os.environ.get('MOCK_GENERATE_EXIT', '0')))
elif name == 'xcodebuild' and args[0] == 'build':
    print('Watch.swift:7: error: synthetic compiler error' if os.environ.get('MOCK_BUILD_EXIT') else 'built')
    products = pathlib.Path(args[args.index('-derivedDataPath') + 1]) / 'Build/Products/Debug-watchsimulator'
    app = products / 'TresFortWatch.app'
    app.mkdir(parents=True)
    if not os.environ.get('MOCK_NO_COMPLICATION'):
        (app / 'PlugIns' / 'TresFortWatchWidgets.appex').mkdir(parents=True)
    sys.exit(int(os.environ.get('MOCK_BUILD_EXIT', '0')))
else: print('synthetic-tool-version')
'''


class VerifyWatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='verify-watch-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for folder in ('scripts', 'ios', 'scratch', 'bin'):
            (self.root / folder).mkdir()
        (self.root / 'bin' / 'python3').symlink_to(Path(sys.executable).resolve())
        (self.root / 'ios' / 'project-watch.yml').write_text('include: project.yml\n')
        shutil.copy(SCRIPT, self.root / 'scripts' / SCRIPT.name)
        shutil.copy(SCRIPT.parent / 'ios_sources.py', self.root / 'scripts' / 'ios_sources.py')
        for name in ['xcodegen', 'xcodebuild', 'git']:
            path = self.root / 'bin' / name
            path.write_text(MOCK)
            path.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.root / 'bin') + os.pathsep + os.environ['PATH'],
                        TMPDIR=str(self.root / 'scratch'), MOCK_CALLS=str(self.root / 'calls.jsonl'))
        self.env.pop('IOS_KEEP_RESULTS', None)
        self.env.pop('IOS_EVIDENCE_DIR', None)

    def run_script(self, args=()):
        result = subprocess.run(['bash', str(self.root / 'scripts' / SCRIPT.name), *args],
                                env=self.env, capture_output=True, text=True)
        self.assertEqual(list((self.root / 'scratch').glob('tres-fort-watch.*')), [], result.stderr)
        return result

    def calls(self):
        path = self.root / 'calls.jsonl'
        return [json.loads(row) for row in path.read_text().splitlines()] if path.exists() else []

    def evidence(self):
        return sorted(path.name for path in (self.root / '.artifacts' / 'ios').glob('*/*'))

    def test_builds_the_watch_scheme_unsigned_from_the_watch_spec(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        generation = next(args for name, args in self.calls() if name == 'xcodegen' and args[0] == 'generate')
        self.assertEqual(Path(generation[generation.index('--spec') + 1]).name, 'project-watch.yml')
        build = next(args for name, args in self.calls() if name == 'xcodebuild' and args[0] == 'build')
        self.assertEqual(build[build.index('-scheme') + 1], 'TresFortWatch')
        self.assertEqual(build[build.index('-destination') + 1], 'generic/platform=watchOS Simulator')
        self.assertIn('CODE_SIGNING_ALLOWED=NO', build)
        self.assertFalse((self.root / '.artifacts').exists(), 'a passing build keeps nothing')

    def test_takes_no_arguments(self):
        self.assertEqual(self.run_script(['--runtime', 'anything']).returncode, 2)
        self.assertEqual(self.calls(), [])

    def test_a_failed_build_fails_and_shows_the_compiler_error(self):
        self.env['MOCK_BUILD_EXIT'] = '65'
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn('synthetic compiler error', result.stderr)
        self.assertEqual(self.evidence(), ['build.log', 'environment.log', 'xcodegen.log'])

    def test_a_failed_project_generation_fails_before_building(self):
        self.env['MOCK_GENERATE_EXIT'] = '1'
        self.assertNotEqual(self.run_script().returncode, 0)
        self.assertFalse(any(name == 'xcodebuild' and args[0] == 'build' for name, args in self.calls()))

    def test_a_watch_app_without_its_complication_fails(self):
        self.env['MOCK_NO_COMPLICATION'] = '1'
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn('does not contain its complication', result.stderr)

    def test_logs_are_kept_on_request(self):
        self.env['IOS_KEEP_RESULTS'] = '1'
        self.assertEqual(self.run_script().returncode, 0)
        self.assertEqual(self.evidence(), ['build.log', 'environment.log', 'xcodegen.log'])


if __name__ == '__main__':
    unittest.main()
