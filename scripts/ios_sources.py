"""One source selection for disposable iOS builds and capture verification."""
import hashlib
import os
from pathlib import Path
import shutil

IGNORE = shutil.ignore_patterns(
    '*.xcodeproj', 'DerivedData', 'build', '.bundle', '.dependencies', 'vendor', 'fastlane',
    '*.xcuserstate', '.DS_Store', '.api_key.json')


def source_manifest(root):
    root = Path(root)
    result = {}

    def fail(error):
        raise error

    for directory, dirs, files in os.walk(root, onerror=fail):
        ignored = IGNORE(directory, dirs + files)
        dirs[:] = sorted(name for name in dirs if name not in ignored)
        for name in set(dirs + files) - ignored:
            if (Path(directory) / name).is_symlink():
                raise ValueError('iOS source snapshot cannot contain symbolic links')
        for name in sorted(set(files) - ignored):
            path = Path(directory) / name
            result[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def copy_sources(source, destination):
    shutil.copytree(source, destination, ignore=IGNORE, symlinks=True)
    return source_manifest(destination)


def sync_sources(source, destination):
    """Make destination hold the same source set, rewriting only changed files.

    Unchanged files keep their inode and modification time, so a persistent
    DerivedData that built this copy before recompiles only what changed.
    Ignored entries already in destination (a generated project, fetched
    dependencies) are kept.
    """
    source, destination = Path(source), Path(destination)
    wanted = source_manifest(source)
    destination.mkdir(parents=True, exist_ok=True)
    kept_dirs = []
    for directory, dirs, files in os.walk(destination):
        ignored = IGNORE(directory, dirs + files)
        dirs[:] = [name for name in dirs if name not in ignored]
        for name in set(files) - ignored:
            path = Path(directory) / name
            if path.is_symlink() or str(path.relative_to(destination)) not in wanted:
                path.unlink()
        kept_dirs.extend(Path(directory) / name for name in dirs)
    for path in sorted(kept_dirs, key=lambda item: len(item.parts), reverse=True):
        if path.is_symlink():
            path.unlink()
        elif not any(path.iterdir()):
            path.rmdir()
    for relative, digest in wanted.items():
        target = destination / relative
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise ValueError(f'cannot replace {relative} in the persistent iOS source copy')
        if target.is_file():
            here, there = (source / relative).stat(), target.stat()
            if (here.st_size, here.st_mtime_ns) == (there.st_size, there.st_mtime_ns):
                continue
            if hashlib.sha256(target.read_bytes()).hexdigest() == digest:
                continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / relative, target)
    result = source_manifest(destination)
    for relative in [name for name, digest in wanted.items() if result.get(name) != digest]:
        # Same size and time but different bytes: copy it after all.
        shutil.copy2(source / relative, destination / relative)
    result = source_manifest(destination)
    if result != wanted:
        raise ValueError('persistent iOS source copy does not match the checkout')
    return result


def require_unchanged_sources(root, captured):
    if source_manifest(root) != captured:
        raise ValueError('iOS source set or contents changed during capture')
