#!/usr/bin/env python3
"""Verify privately supplied artwork before an official release mutates anything."""
import json
import struct
import sys
import zlib
from pathlib import Path

BRANDS = ("logo_apple_health", "logo_garmin_connect")


def verify(root):
    root = root.resolve()
    for brand in BRANDS:
        directory = root / "ios/TresFort/Assets.xcassets/Connections" / (brand + ".imageset")
        if any(p.is_symlink() for p in (directory, *directory.parents) if p != root and root in p.parents):
            raise ValueError(f"Artwork directories must not be symlinks: {brand}")
        manifest = directory / "Contents.json"
        if not manifest.is_file() or manifest.is_symlink():
            raise ValueError(f"Missing licensed artwork for {brand}; see docs/RELEASE-ASSETS.md")
        images = json.loads(manifest.read_text())["images"]
        if not isinstance(images, list) or any(not isinstance(i, dict) for i in images):
            raise ValueError(f"Invalid artwork manifest for {brand}")
        for scale in (1, 2, 3):
            candidates = [i for i in images if i.get("scale") == f"{scale}x" and i.get("idiom") == "universal"]
            if len(candidates) != 1:
                raise ValueError(f"{brand} needs one universal image at {scale}x")
            name = candidates[0].get("filename", "")
            if not name or Path(name).name != name or name in (".", ".."):
                raise ValueError(f"Invalid artwork filename for {brand}")
            image = directory / name
            if not image.is_file() or image.is_symlink():
                raise ValueError(f"Missing {scale}x artwork for {brand}")
            with image.open("rb") as source:
                data = source.read(5 * 1024 * 1024 + 1)
            header = data[:24]
            if len(data) > 5 * 1024 * 1024:
                raise ValueError(f"Artwork exceeds the release size limit for {brand}")
            if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
                raise ValueError(f"Expected PNG artwork for {brand}")
            if struct.unpack(">II", header[16:24]) != (30 * scale, 30 * scale):
                raise ValueError(f"Expected square 30-point artwork for {brand} at {scale}x")
            offset, saw_data, saw_end = 8, False, False
            while offset + 12 <= len(data):
                length = struct.unpack(">I", data[offset:offset + 4])[0]
                end = offset + 12 + length
                if end > len(data):
                    raise ValueError(f"Truncated PNG artwork for {brand}")
                kind = data[offset + 4:offset + 8]
                contents = data[offset + 8:end - 4]
                expected_crc = struct.unpack(">I", data[end - 4:end])[0]
                if zlib.crc32(kind + contents) & 0xffffffff != expected_crc:
                    raise ValueError(f"Invalid PNG checksum for {brand}")
                saw_data |= kind == b"IDAT" and bool(contents)
                offset = end
                if kind == b"IEND":
                    saw_end = length == 0 and offset == len(data)
                    break
            if not saw_data or not saw_end:
                raise ValueError(f"Incomplete PNG artwork for {brand}")


if __name__ == "__main__":
    try:
        verify(Path(__file__).resolve().parents[1])
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"Release artwork preflight failed: {error}", file=sys.stderr)
        sys.exit(2)
