"""Headless entry point:
blender -b --factory-startup --python-exit-code 1 --python blender/run.py -- --recipe NAME --out DIR --previews DIR --textures DIR
Prints RECIPE_OK <name> on success; tools/assets/build.mjs looks for it."""
import argparse
import importlib
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from lib import scene  # noqa: E402
from lib.ctx import BuildContext  # noqa: E402


def parse(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument('--recipe', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--previews', required=True)
    parser.add_argument('--textures', required=True)
    parser.add_argument('--seed', type=int, default=1)
    parser.add_argument('--no-previews', action='store_true')
    return parser.parse_args(argv)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = parse(argv)
    scene.reset()
    scene.configure_cycles()
    ctx = BuildContext(
        root=HERE.parent, out=Path(args.out), previews=Path(args.previews), textures=Path(args.textures),
        seed=args.seed, previews_enabled=not args.no_previews, recipe=args.recipe,
    )
    ctx.ensure_dirs()
    started = time.time()
    module = importlib.import_module(f'recipes.{args.recipe}')
    records = module.build(ctx)
    for record in records:
        ctx.write_sidecar(record)
    print(f'RECIPE_OK {args.recipe} assets={len(records)} seconds={time.time() - started:.1f}')


main()
