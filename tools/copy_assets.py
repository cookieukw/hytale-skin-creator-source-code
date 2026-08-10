"""Copies into the project only the assets actually referenced by the site.

The app references files via "Assets/..." paths. During local development,
this was a symbolic link to the game installation; running this script makes
the fitting room self-contained so it can be hosted for users without Hytale.

Usage:  python3 tools/copy_assets.py [--dest Assets] [--dry-run]
"""
import argparse
import os
import re
import shutil
import sys

SOURCE = '/mnt/devhd/Assets/'

# Loaded directly by fitting_room.js (not listed in the catalog)
EXTRA = [
    'Assets/Common/Characters/Player_With_Face.blockymodel',
    'Assets/Common/Characters/Player_Textures/Player_Greyscale.png',
]


def referenced_paths(catalog_js='catalog.js'):
    """Every "Assets/..." path referenced in the catalog, deduplicated."""
    src = open(catalog_js, encoding='utf-8').read()
    found = re.findall(r'"(Assets/[^"]+)"', src)
    return sorted(set(found) | set(EXTRA))


def human(n):
    for unit in ('B', 'KB', 'MB', 'GB'):
        if n < 1024 or unit == 'GB':
            return f'{n:.1f} {unit}' if unit != 'B' else f'{n} B'
        n /= 1024


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dest', default='Assets',
                    help='destination directory in the project (default: Assets)')
    ap.add_argument('--dry-run', action='store_true',
                    help='measure size only, do not copy')
    args = ap.parse_args()

    paths = referenced_paths()

    missing, total = [], 0
    for rel in paths:
        src = SOURCE + rel[len('Assets/'):]
        if not os.path.isfile(src):
            missing.append(rel)
            continue
        total += os.path.getsize(src)

    print(f'referenced   : {len(paths)} files')
    print(f'total size   : {human(total)}')
    if missing:
        print(f'MISSING      : {len(missing)}')
        for m in missing[:10]:
            print('   ', m)
        return 1

    if args.dry_run:
        print('\n(dry-run, nothing copied)')
        return 0

    # Build staging directory alongside dest, then atomic swap to avoid broken state
    staging = args.dest + '.new'
    if os.path.exists(staging):
        shutil.rmtree(staging)

    for rel in paths:
        src = SOURCE + rel[len('Assets/'):]
        dst = os.path.join(staging, rel[len('Assets/'):])
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)

    if os.path.islink(args.dest):
        os.unlink(args.dest)          # remove link only, not target
    elif os.path.isdir(args.dest):
        shutil.rmtree(args.dest)
    os.rename(staging, args.dest)

    print(f'\ncopied to    : {args.dest}/')
    return 0


if __name__ == '__main__':
    sys.exit(main())
