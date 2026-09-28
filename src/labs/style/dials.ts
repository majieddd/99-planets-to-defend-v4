import GUI from 'lil-gui';
import { COLOR_DIALS, NUMERIC_RANGES, type RenderDials } from '../../render/defaults';
import type { TierName } from '../../render/quality';
import { NARROW_SCREEN } from './referenceBoard';
import { PRESETS, type BulwarkMode, type CommanderKind, type PresetName } from './scene';

const TITLE = 'Painted-Anime-Inkline 4.0';

/** The commander dropdown's choices, by the name the panel shows. The anime head is a tech-validation preview (main.ts). */
export const COMMANDER_OPTIONS: Readonly<Record<string, CommanderKind>> = { Bulwark: 'bulwark', 'Pip-A (preview)': 'pip', 'Anime head (test)': 'anime' };

export interface LabState {
  tier: TierName;
  preset: PresetName;
  heartStage: number;
  bulwark: BulwarkMode;
  commander: CommanderKind;
}

export interface LabHandlers {
  onDials(): void;
  onTier(tier: TierName): void;
  onPreset(preset: PresetName): void;
  onHeartStage(level: number): void;
  onBulwark(mode: BulwarkMode): void;
  onCommander(kind: CommanderKind): void;
  audit(): void;
  copyDials(): void;
  reset(): void;
  screenshot(): void;
  openWorld(): void;
}

type ColorDial = (typeof COLOR_DIALS)[number];

/** Every dial sits in exactly one folder, so none is missing from the panel (tests/unit/labs/dials.test.ts). */
export const GROUPS: Record<string, (keyof RenderDials)[]> = {
  Paint: [
    'bands',
    'bandSoftness',
    'terminatorNoise',
    'paintStrength',
    'saturation',
    'shadowDepth',
    'shadowTint',
    'shadowLift',
    'rimStrength',
    'rimPower',
    'standardBlend',
    'ambientStrength',
    'brushScale',
    'terrainBrush',
    'propBrush',
    'soilBreakup',
    'litSaturation',
  ],
  Ink: ['inkWidthPx', 'inkColor', 'edgeStrength', 'edgeLineWidth', 'depthThreshold', 'normalThreshold', 'edgeFadeNear', 'edgeFadeFar'],
  // The actor fill is a light, the camera's, so it sits with the sun it answers.
  Light: ['sunElevation', 'sunColor', 'sunIntensity', 'actorFill'],
  Atmosphere: ['fogDensity', 'fogStart', 'fogHeightFalloff'],
  Post: ['exposure', 'contrast', 'bloomIntensity', 'heartHalo', 'bloomThreshold', 'grain', 'vignette'],
};

/**
 * The codec's list decides which dials are colours. A hard-coded pair of names here would have handed a new colour dial
 * (sunColor) to the numeric branch, whose range lookup finds nothing for it, and the panel would have failed to build.
 */
export function isColorDial(key: keyof RenderDials): key is ColorDial {
  return (COLOR_DIALS as readonly string[]).includes(key);
}

export function createDialsPanel(dials: RenderDials, state: LabState, handlers: LabHandlers): GUI {
  // On a phone the open panel covered most of the canvas, so there it starts closed and its title bar is the toggle,
  // under a label short enough to leave the canvas clear. If the width later crosses the line (a turned tablet, a
  // resized window) the label follows the layout, but the panel stays open or closed as the viewer left it.
  const narrow = matchMedia(NARROW_SCREEN);
  const title = (): string => (narrow.matches ? 'Dials' : TITLE);
  const gui = new GUI({ title: title() });
  if (narrow.matches) gui.close();
  narrow.addEventListener('change', () => gui.title(title()));
  // The phone layout hides the banner under the open panel by this class. Matched with :has() instead, the rule was
  // merged by Vite's CSS minifier into the board rule's selector list, so a browser without :has() dropped both and the
  // banner painted over an open board. lil-gui calls back for every folder too, so this reads the root's own state; and
  // it calls back only on a change, so the state at creation is set here once.
  const syncOpenClass = (): void => {
    document.body.classList.toggle('dials-open', !gui._closed);
  };
  gui.onOpenClose(syncOpenClass);
  syncOpenClass();
  const lab = gui.addFolder('Lab');
  lab.add(state, 'tier', ['high', 'medium', 'low']).name('quality tier').onChange((tier: TierName) => handlers.onTier(tier));
  lab.add(state, 'preset', PRESETS).name('camera').onChange((preset: PresetName) => handlers.onPreset(preset));
  lab.add(state, 'heartStage', 0, 10, 1).name('heart level').onChange((level: number) => handlers.onHeartStage(level));
  lab.add(state, 'commander', COMMANDER_OPTIONS).name('commander').onChange((kind: CommanderKind) => handlers.onCommander(kind));
  // The mode drives whichever commander is shown; Pip-A holds his idle where Bulwark attacks (scene.ts).
  lab.add(state, 'bulwark', ['cycle', 'idle', 'run', 'attack']).name('commander mode').onChange((mode: BulwarkMode) => handlers.onBulwark(mode));
  for (const [group, keys] of Object.entries(GROUPS)) {
    const folder = gui.addFolder(group);
    for (const key of keys) {
      if (isColorDial(key)) {
        folder.addColor(dials, key).onChange(() => handlers.onDials());
      } else {
        const [min, max, step] = NUMERIC_RANGES[key];
        folder.add(dials, key, min, max, step).onChange(() => handlers.onDials());
      }
    }
    if (group !== 'Paint') folder.close();
  }
  const actions = gui.addFolder('Actions');
  actions.add({ run: () => handlers.audit() }, 'run').name('Run colour audit');
  actions.add({ copy: () => handlers.copyDials() }, 'copy').name('Copy dials link');
  actions.add({ shot: () => handlers.screenshot() }, 'shot').name('Save screenshot');
  const reset = () => {
    handlers.reset();
    // Controllers draw their value only when they change it, so after a reset every slider and swatch went on
    // showing the old values while the scene rendered the defaults.
    for (const controller of gui.controllersRecursive()) controller.updateDisplay();
  };
  actions.add({ reset }, 'reset').name('Reset dials');
  // The Asset World shows every generated asset in the look these dials make, through the same dials link.
  actions.add({ world: () => handlers.openWorld() }, 'world').name('Open the Asset World with these dials');
  return gui;
}
