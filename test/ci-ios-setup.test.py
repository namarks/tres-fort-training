"""Exercise routine hosted iOS setup without launching Xcode or a simulator."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


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


if __name__ == '__main__':
    unittest.main()
