#!/usr/bin/env python3
"""Prepare the Debug simulator's plist without weakening a shipping plist."""
import os
from pathlib import Path
import plistlib
import sys


def prepare(source, destination, configuration, platform):
    info = plistlib.loads(Path(source).read_bytes())
    if configuration == 'Debug' and platform == 'iphonesimulator':
        info.setdefault('NSAppTransportSecurity', {})['NSAllowsLocalNetworking'] = True
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(plistlib.dumps(info, sort_keys=False))


if __name__ == '__main__':
    prepare(sys.argv[1], sys.argv[2], os.environ.get('CONFIGURATION'),
            os.environ.get('PLATFORM_NAME'))
