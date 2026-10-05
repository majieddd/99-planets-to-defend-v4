/**
 * The Style Lab's commander switch and its one load of Pip's model, kept apart from the page so the unit test drives
 * them with promises it settles itself (tests/unit/labs/commander-switch.test.ts). Lab code, outside the simulation.
 */

import type { LoadedAsset } from '../../render/assets/loadAsset';
import { COMMANDER_LABELS, type CommanderKind } from '../shared/commanders';

/** The banner's line when the build has no Pip to show: the manifest does not list `commander_pip`. */
export const PIP_NOT_BUILT = `${COMMANDER_LABELS.pip} is not in the built assets (npm run assets); showing ${COMMANDER_LABELS.bulwark}.`;
/** The banner's line when the manifest lists Pip but his model failed to load: a missing or corrupt GLB. */
export const PIP_FAILED = `${COMMANDER_LABELS.pip} failed to load; showing ${COMMANDER_LABELS.bulwark}.`;

export interface PipLoad {
  /** Pip's model, or null when the build lacks him or his load failed. Every call shares the one load. */
  asset(): Promise<LoadedAsset | null>;
  /** The banner's line for a null asset: PIP_FAILED once his load has failed, else PIP_NOT_BUILT. */
  missing(): string;
}

/**
 * Loads Pip's model at most once in the page's life, however often the opening load and the panel ask, and turns a
 * failed load into a null asset and one console error. Pip used to load inside the same Promise.all as the core models,
 * so a missing or corrupt commander_pip GLB rejected the lab's start and the page showed "Style Lab failed to start"
 * with no Bulwark to fall back on; a failed load from the panel reached fail() and stopped a lab that was running. A
 * failed load is not tried again: the file stays missing or broken until the next build, and each retry would add a
 * console error and a banner line for the same file. A reload tries it afresh.
 */
export function loadPipOnce(load: () => Promise<LoadedAsset | null>, report: (error: unknown) => void = (error) => console.error(error)): PipLoad {
  let pending: Promise<LoadedAsset | null> | null = null;
  let failed = false;
  return {
    asset() {
      // Started inside a promise, so a loader that throws before it returns one is caught here too.
      pending ??= Promise.resolve()
        .then(load)
        .catch((error: unknown) => {
          failed = true;
          report(error);
          return null;
        });
      return pending;
    },
    missing: () => (failed ? PIP_FAILED : PIP_NOT_BUILT),
  };
}

/** The scene's half of a switch: StyleScene's setCommander and commander. */
export interface CommanderStage {
  setCommander(kind: CommanderKind, asset?: LoadedAsset): void;
  commander(): CommanderKind;
}

/**
 * The panel's and the test handle's switch: shows the commander asked for and resolves to the one shown, which is
 * Bulwark, with a note for the banner and the console, when Pip cannot be shown. `pip` is null when the lab runs on its
 * placeholders, which have no Pip to load.
 *
 * Only the latest choice is shown. In a lab opened on Bulwark the first switch to Pip waits on his load, and a switch
 * back to Bulwark in the meantime used to be undone when the load resolved, showing Pip after Bulwark had been chosen
 * again; each call now checks, once the load is in, that its commander is still the one last asked for. Two quick
 * switches to Pip used to start two loads; every switch now shares the one (loadPipOnce).
 */
export function createCommanderSwitch(stage: CommanderStage, pip: PipLoad | null, note: (text: string) => void): (kind: CommanderKind) => Promise<CommanderKind> {
  let wanted = stage.commander();
  return async (kind) => {
    wanted = kind;
    const asset = kind === 'pip' && pip ? await pip.asset() : null;
    // A later choice came in while this one waited on Pip's load, and that call shows its own commander.
    if (kind !== wanted) return stage.commander();
    if (kind === 'pip' && !asset) {
      note(pip ? pip.missing() : PIP_NOT_BUILT);
      stage.setCommander('bulwark');
    } else stage.setCommander(kind, asset ?? undefined);
    return stage.commander();
  };
}
