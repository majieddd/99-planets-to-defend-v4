// Whether Node was started on a given module, for the tools that are both a command and a module their tests import.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * True when the script Node was started on is the module at `url` (pass import.meta.url). Both sides are compared as
 * real paths: Node resolves symlinks and junctions in import.meta.url but not in argv[1], so a plain comparison is
 * false whenever the checkout sits behind a link. assets:check made that comparison, and through a junction it printed
 * nothing and exited 0 without checking anything, even with the manifest missing.
 */
export function isMain(url, argv = process.argv) {
  const entry = argv[1]; // absent under node -e, and realpathSync(undefined) throws
  return Boolean(entry) && realpathSync(entry) === realpathSync(fileURLToPath(url));
}
