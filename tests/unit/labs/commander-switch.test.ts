import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import type { LoadedAsset } from '../../../src/render/assets/loadAsset';
import type { CommanderKind } from '../../../src/labs/shared/commanders';
import { createCommanderSwitch, loadPipOnce, PIP_FAILED, PIP_NOT_BUILT, type CommanderStage } from '../../../src/labs/style/commanderSwitch';

/** A promise the test settles itself, so a load can be held in flight while the switch is driven. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  return { promise, resolve, reject };
}

const pipAsset = (): LoadedAsset => ({ root: new Group(), animations: [] });

/** A stage that shows whatever it is told, as the style scene does, and keeps every switch it was given. */
function stageOn(start: CommanderKind): CommanderStage & { switches: [CommanderKind, LoadedAsset | undefined][] } {
  let shown = start;
  const switches: [CommanderKind, LoadedAsset | undefined][] = [];
  return {
    switches,
    setCommander(kind, asset) {
      switches.push([kind, asset]);
      shown = kind;
    },
    commander: () => shown,
  };
}

/** Lets every settled promise's callbacks run. */
const settle = () => new Promise<void>((done) => setTimeout(done, 0));

describe('the Style Lab commander switch', () => {
  it('loads Pip once however often he is asked for, and turns a failed load into null, one report and the failed line', async () => {
    let loads = 0;
    const asset = pipAsset();
    const shared = loadPipOnce(async () => {
      loads += 1;
      return asset;
    });
    expect(await Promise.all([shared.asset(), shared.asset()])).toEqual([asset, asset]);
    expect(await shared.asset()).toBe(asset);
    expect(loads).toBe(1);

    const reports: unknown[] = [];
    let attempts = 0;
    const broken = loadPipOnce(async () => {
      attempts += 1;
      throw new Error('asset commander_pip failed to load from assets/commanders/commander_pip.glb: 404');
    }, (error) => reports.push(error));
    expect(broken.missing()).toBe(PIP_NOT_BUILT);
    await expect(broken.asset()).resolves.toBeNull();
    // Not tried again: the file is missing or broken until the next build.
    await expect(broken.asset()).resolves.toBeNull();
    expect(attempts).toBe(1);
    expect(reports.map(String)).toEqual(['Error: asset commander_pip failed to load from assets/commanders/commander_pip.glb: 404']);
    expect(broken.missing()).toBe(PIP_FAILED);
    expect(PIP_FAILED).toBe('Pip (commander) failed to load; showing Bulwark.');

    // A loader that throws before it returns a promise is caught the same way.
    const thrown = loadPipOnce(
      () => {
        throw new Error('no loader');
      },
      () => undefined,
    );
    await expect(thrown.asset()).resolves.toBeNull();
    expect(thrown.missing()).toBe(PIP_FAILED);

    // A manifest without Pip is not a failure.
    const absent = loadPipOnce(async () => null);
    await expect(absent.asset()).resolves.toBeNull();
    expect(absent.missing()).toBe(PIP_NOT_BUILT);
  });

  it('falls back to Bulwark with the failed line when Pip fails to load, and resolves instead of rejecting', async () => {
    const stage = stageOn('bulwark');
    const notes: string[] = [];
    const reports: unknown[] = [];
    const show = createCommanderSwitch(
      stage,
      loadPipOnce(async () => Promise.reject(new Error('corrupt GLB')), (error) => reports.push(error)),
      (text) => notes.push(text),
    );
    await expect(show('pip')).resolves.toBe('bulwark');
    expect(stage.commander()).toBe('bulwark');
    expect(stage.switches).toEqual([['bulwark', undefined]]);
    expect(notes).toEqual([PIP_FAILED]);
    expect(reports).toHaveLength(1);
    // Asked again, he is not loaded again, and the lab says why again.
    await expect(show('pip')).resolves.toBe('bulwark');
    expect(reports).toHaveLength(1);
    expect(notes).toEqual([PIP_FAILED, PIP_FAILED]);
  });

  it('names a Pip the build lacks, and one the placeholders cannot have, as not built', async () => {
    const notes: string[] = [];
    const built = createCommanderSwitch(stageOn('bulwark'), loadPipOnce(async () => null), (text) => notes.push(text));
    await expect(built('pip')).resolves.toBe('bulwark');
    const placeholders = createCommanderSwitch(stageOn('bulwark'), null, (text) => notes.push(text));
    await expect(placeholders('pip')).resolves.toBe('bulwark');
    expect(notes).toEqual([PIP_NOT_BUILT, PIP_NOT_BUILT]);
  });

  it('shows only the latest choice while Pip loads, and starts one load for every switch to him', async () => {
    const stage = stageOn('bulwark');
    const load = deferred<LoadedAsset | null>();
    let loads = 0;
    const show = createCommanderSwitch(
      stage,
      loadPipOnce(() => {
        loads += 1;
        return load.promise;
      }),
      () => undefined,
    );
    // Pip, then Bulwark again before his load is in: the load resolving late must not bring Pip on.
    const toPip = show('pip');
    const back = show('bulwark');
    await expect(back).resolves.toBe('bulwark');
    const asset = pipAsset();
    load.resolve(asset);
    await expect(toPip).resolves.toBe('bulwark');
    await settle();
    expect(stage.commander()).toBe('bulwark');
    expect(stage.switches.map(([kind]) => kind)).toEqual(['bulwark']);
    // The next switch to him uses the load already made, and two at once still share it.
    const [first, second] = await Promise.all([show('pip'), show('pip')]);
    expect([first, second]).toEqual(['pip', 'pip']);
    expect(stage.switches.at(-1)).toEqual(['pip', asset]);
    expect(loads).toBe(1);
  });

  it('shows Pip when he is chosen again before his load is in', async () => {
    const stage = stageOn('bulwark');
    const load = deferred<LoadedAsset | null>();
    let loads = 0;
    const show = createCommanderSwitch(
      stage,
      loadPipOnce(() => {
        loads += 1;
        return load.promise;
      }),
      () => undefined,
    );
    const first = show('pip');
    void show('bulwark');
    const again = show('pip');
    load.resolve(pipAsset());
    expect(await Promise.all([first, again])).toEqual(['pip', 'pip']);
    expect(stage.commander()).toBe('pip');
    expect(loads).toBe(1);
  });
});
