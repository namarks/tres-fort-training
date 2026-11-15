"""Official release artwork must be complete and local before a build begins."""
import importlib.util
import json
from pathlib import Path
import shutil
import struct
import tempfile
import unittest
import zlib


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/check-release-assets.py'
spec = importlib.util.spec_from_file_location('check_release_assets', SCRIPT)
release_assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_assets)

BRANDS = ('logo_apple_health', 'logo_garmin_connect')
CONNECTIONS = Path('ios/TresFort/Assets.xcassets/Connections')


def chunk(kind, payload=b''):
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))


def synthetic_png(width, height=None):
    """A complete RGBA PNG of a solid color; no provider artwork is used."""
    height = width if height is None else height
    pixels = (b'\0' + bytes([40, 80, 120, 255]) * width) * height
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND'))


class ReleaseArtworkTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='tres-fort-release-assets-test-')
        self.addCleanup(temporary.cleanup)
        self.temporary = Path(temporary.name)
        self.root = self.temporary / 'repo'
        for brand in BRANDS:
            directory = self.directory(brand)
            directory.mkdir(parents=True)
            images = []
            for scale in (1, 2, 3):
                filename = f'synthetic-{scale}x.png'
                (directory / filename).write_bytes(synthetic_png(30 * scale))
                images.append({'filename': filename, 'idiom': 'universal', 'scale': f'{scale}x'})
            self.write_manifest({'images': images, 'info': {'author': 'synthetic-test', 'version': 1}}, brand)

    def directory(self, brand=BRANDS[0]):
        return self.root / CONNECTIONS / f'{brand}.imageset'

    def write_manifest(self, contents, brand=BRANDS[0]):
        (self.directory(brand) / 'Contents.json').write_text(json.dumps(contents))

    def manifest(self, brand=BRANDS[0]):
        return json.loads((self.directory(brand) / 'Contents.json').read_text())

    def verify(self):
        release_assets.verify(self.root)

    def test_complete_synthetic_assets_for_both_providers_pass(self):
        self.verify()

    def test_each_provider_manifest_is_required(self):
        for brand in BRANDS:
            with self.subTest(brand=brand):
                manifest = self.directory(brand) / 'Contents.json'
                original = manifest.read_bytes()
                manifest.unlink()
                with self.assertRaises(ValueError):
                    self.verify()
                manifest.write_bytes(original)

    def test_each_scale_requires_an_image_file(self):
        for scale in (1, 2, 3):
            with self.subTest(scale=scale):
                image = self.directory() / f'synthetic-{scale}x.png'
                original = image.read_bytes()
                image.unlink()
                with self.assertRaises(ValueError):
                    self.verify()
                image.write_bytes(original)

    def test_missing_duplicate_or_nonuniversal_scale_is_rejected(self):
        original = self.manifest()
        variants = [
            {'images': original['images'][1:]},
            {'images': original['images'] + [original['images'][0]]},
            {'images': [dict(image, idiom='iphone') for image in original['images']]},
        ]
        for variant in variants:
            with self.subTest(variant=variant):
                self.write_manifest(variant)
                with self.assertRaises(ValueError):
                    self.verify()

    def test_filenames_cannot_escape_the_imageset(self):
        original = self.manifest()
        outside = self.temporary / 'outside.png'
        outside.write_bytes(synthetic_png(30))
        for name in ('../outside.png', str(outside), 'nested/art.png', '', '.', '..'):
            with self.subTest(name=name):
                updated = json.loads(json.dumps(original))
                updated['images'][0]['filename'] = name
                self.write_manifest(updated)
                with self.assertRaises(ValueError):
                    self.verify()

    def test_symlinked_image_is_rejected(self):
        image = self.directory() / 'synthetic-1x.png'
        outside = self.temporary / 'outside.png'
        image.rename(outside)
        image.symlink_to(outside)
        with self.assertRaises(ValueError):
            self.verify()

    def test_symlinked_manifest_is_rejected(self):
        manifest = self.directory() / 'Contents.json'
        outside = self.temporary / 'outside.json'
        manifest.rename(outside)
        manifest.symlink_to(outside)
        with self.assertRaises(ValueError):
            self.verify()

    def test_symlinked_imageset_directory_is_rejected(self):
        directory = self.directory()
        outside = self.temporary / 'outside.imageset'
        shutil.move(directory, outside)
        directory.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.verify()

    def test_symlinked_parent_directory_is_rejected(self):
        directory = self.root / CONNECTIONS
        outside = self.temporary / 'outside-connections'
        shutil.move(directory, outside)
        directory.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.verify()

    def test_dimensions_match_each_scale_and_are_square(self):
        for scale in (1, 2, 3):
            image = self.directory() / f'synthetic-{scale}x.png'
            original = image.read_bytes()
            for width, height in ((30 * scale - 1, 30 * scale), (30 * scale, 30 * scale + 1)):
                with self.subTest(scale=scale, width=width, height=height):
                    image.write_bytes(synthetic_png(width, height))
                    with self.assertRaises(ValueError):
                        self.verify()
            image.write_bytes(original)

    def test_non_png_truncation_or_missing_image_data_is_rejected(self):
        image = self.directory() / 'synthetic-1x.png'
        complete = image.read_bytes()
        variants = (b'not a PNG', complete[:24], complete[:33] + chunk(b'IEND'), complete[:-12])
        for contents in variants:
            with self.subTest(length=len(contents)):
                image.write_bytes(contents)
                with self.assertRaises(ValueError):
                    self.verify()

    def test_malformed_manifest_fails_with_a_validation_error(self):
        for malformed in ({}, {'images': None}, {'images': ['invalid']}, {'images': {}}):
            with self.subTest(malformed=malformed):
                self.write_manifest(malformed)
                # These errors are translated to the preflight's explicit
                # rejection. An uncaught AttributeError would leak a traceback.
                with self.assertRaises((ValueError, KeyError, TypeError)):
                    self.verify()


if __name__ == '__main__':
    unittest.main()
