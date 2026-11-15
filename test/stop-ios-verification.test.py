"""A cancelled job's verification must not keep running on the Mac mini."""
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'stop-ios-verification.sh'

# Stands in for verify-ios.sh: a shell waiting on a foreground command, the
# way the real one waits on xcodebuild, with the same TERM trap.
VERIFY = '''trap 'echo stopped >"$MARK"; exit 143' TERM
sleep 300
'''
STUBBORN = '''trap '' TERM
sleep 300
'''
XCRUN = '''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['MOCK_CALLS'], 'a') as f: f.write(json.dumps(args) + '\\n')
if args[:3] == ['simctl', 'list', 'devices']:
    print(json.dumps({'devices': {'iOS-26-2': [
        {'name': 'TresFort verification mac-mini tres-fort-ios.AAAAAA', 'udid': 'this-runner'},
        {'name': 'TresFort verification mac-mini-2 tres-fort-ios.BBBBBB', 'udid': 'other-runner'},
        {'name': 'TresFort verification tres-fort-ios.CCCCCC', 'udid': 'local-run'},
        {'name': 'iPhone 17', 'udid': 'personal'},
    ]}}))
'''


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


class StopVerificationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='stop-ios-verification-test-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        (self.bin / 'xcrun').write_text(XCRUN)
        (self.bin / 'xcrun').chmod(0o755)
        self.calls = self.root / 'calls.jsonl'
        self.calls.touch()

    def workspace(self, name, verify):
        workspace = self.root / name
        (workspace / 'scripts').mkdir(parents=True)
        (workspace / 'scripts' / 'verify-ios.sh').write_text(verify)
        return workspace

    def start(self, workspace):
        """Start a verification orphaned from the test, as a cancelled job's is."""
        mark = self.root / f'{workspace.name}.stopped'
        started = subprocess.run(
            ['bash', '-c', '(cd "$1" && exec bash scripts/verify-ios.sh </dev/null >/dev/null 2>&1) & echo $!',
             '_', str(workspace)],
            env={**os.environ, 'MARK': str(mark)}, capture_output=True, text=True, check=True)
        pid = int(started.stdout)
        self.addCleanup(self.kill_tree, pid)
        deadline = time.time() + 10
        while not subprocess.run(['pgrep', '-P', str(pid)], capture_output=True).stdout:
            self.assertLess(time.time(), deadline, 'verification never started its command')
            time.sleep(0.05)
        return pid, mark

    def kill_tree(self, pid):
        children = subprocess.run(['pgrep', '-P', str(pid)], capture_output=True, text=True).stdout.split()
        for each in [pid, *map(int, children)]:
            try:
                os.kill(each, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def stop(self, workspace, wait='60'):
        env = {**os.environ, 'PATH': f'{self.bin}:{os.environ["PATH"]}', 'MOCK_CALLS': str(self.calls),
               'GITHUB_WORKSPACE': str(workspace), 'RUNNER_NAME': 'mac-mini', 'TRESFORT_IOS_STOP_WAIT': wait}
        return subprocess.run(['bash', str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60)

    def simctl_calls(self, action):
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        return [args[2] for args in calls if args[:2] == ['simctl', action]]

    def test_stops_this_runners_verification_through_its_trap_and_leaves_the_other_runners(self):
        mine = self.workspace('mac-mini', VERIFY)
        other = self.workspace('mac-mini-2', VERIFY)
        pid, mark = self.start(mine)
        other_pid, other_mark = self.start(other)
        result = self.stop(mine)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Stopping the verification left running', result.stdout)
        self.assertFalse(alive(pid))
        self.assertEqual(mark.read_text(), 'stopped\n')
        self.assertTrue(alive(other_pid))
        self.assertFalse(other_mark.exists())

    def test_kills_a_verification_that_ignores_term(self):
        mine = self.workspace('mac-mini', STUBBORN)
        pid, _ = self.start(mine)
        result = self.stop(mine, wait='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('did not stop within 1s; killing it', result.stderr)
        deadline = time.time() + 5
        while alive(pid) and time.time() < deadline:
            time.sleep(0.05)
        self.assertFalse(alive(pid))

    def test_deletes_only_this_runners_leftover_simulators(self):
        result = self.stop(self.workspace('mac-mini', VERIFY))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('Stopping', result.stdout)
        self.assertEqual(self.simctl_calls('shutdown'), ['this-runner'])
        self.assertEqual(self.simctl_calls('delete'), ['this-runner'])

    def test_a_verification_that_exits_during_the_scan_does_not_stop_the_cleanup(self):
        # lsof fails for a process that is gone by the time it looks.
        (self.bin / 'lsof').write_text('#!/bin/sh\nexit 1\n')
        (self.bin / 'lsof').chmod(0o755)
        self.start(self.workspace('mac-mini-2', VERIFY))
        result = self.stop(self.workspace('mac-mini', VERIFY))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.simctl_calls('delete'), ['this-runner'])

    def test_a_failed_simulator_delete_fails_the_step(self):
        (self.bin / 'xcrun').write_text(XCRUN + "if args[:2] == ['simctl', 'delete']: sys.exit(1)\n")
        result = self.stop(self.workspace('mac-mini', VERIFY))
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__': unittest.main()
