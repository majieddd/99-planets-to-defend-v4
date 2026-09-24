# Working on 99 Planets To Defend (v4)

Read `docs/blueprint.md` before your first edit. It is the approved design and the running record:
restate its pillars and name the first end-to-end playable (Build order, item 1) before any task.

## Run it

    npm run dev          # Vite dev server on http://127.0.0.1:5173
    npm run check        # both TypeScript projects, ESLint, em dash scan, blueprint gate
    npm test             # Vitest unit tests
    npm run e2e          # Playwright smoke tests (builds, then serves on 4173)

Live site: https://majieddd.github.io/99-planets-to-defend-v4/ (deployed from main).

If port 4173 is busy (another checkout or project), run `P99_PREVIEW_PORT=4174 npm run e2e`. The
suite never reuses a server it did not start, so a busy port fails loudly instead of testing someone
else's files.

`npm run check` runs the owner's private blueprint gate. On a machine without it, set
`BLUEPRINT_CHECKER` to the checker's path, or prefix that one command with `CI=1`; do not export
`CI`, because it also switches Playwright into CI mode.

In Git Bash, MSYS rewrites POSIX-looking values into Windows paths, so a local Pages build needs
`MSYS2_ENV_CONV_EXCL=P99_BASE P99_BASE=/99-planets-to-defend-v4/ npm run build`.

## Invariants

These break silently. Each one exists because the reference game lost time to it.

1. **`src/sim` is pure.** No three, DOM, `process`, clock or `Math.random`. Time and randomness come
   in by injection (`src/sim/rng.ts` streams, the fixed tick). ESLint and `tsconfig.sim.json` both
   enforce it. Anything that needs storage or rendering belongs outside `src/sim`.
2. **three is pinned to 0.186.0.** The painted material includes r186 shader chunks. Upgrading three is
   its own task with a Style Lab visual comparison.
3. **TypeScript is pinned to 6.0.3.** typescript-eslint does not support TypeScript 7.
4. **No em dash anywhere**, in any of the four spellings `npm run check` scans for. Use " - ".
5. **Exported assets are committed.** `public/assets` is produced by `npm run assets` (Blender 5.2.1 via
   `BLENDER_PATH`); CI and Pages never run Blender.
6. **Done means evidence.** A result line or a frame that shows the behaviour, pasted into the review,
   never "the code reads right".

## House style

Comments explain why, not what, in full sentences. When you fix something subtle, say what the wrong
behaviour was. Commit messages describe the defect, the cause and the measurement; end each with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Player-facing copy is mechanics first and
flavour second, with no exclamation marks.
