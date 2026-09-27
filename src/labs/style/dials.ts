import GUI from 'lil-gui';
import { NUMERIC_RANGES, type RenderDials } from '../../render/defaults';
import type { TierName } from '../../render/quality';
import { NARROW_SCREEN } from './referenceBoard';
import { PRESETS, type BulwarkMode, type PresetName } from './scene';

const TITLE = 'Painted-Anime-Inkline 4.0';

export interface LabState {
  tier: TierName;
  preset: PresetName;
  heartStage: number;
  bulwark: BulwarkMode;
}

export interface LabHandlers {
  onDials(): void;
  onTier(tier: TierName): void;
  onPreset(preset: PresetName): void;
  onHeartStage(level: number): void;
  onBulwark(mode: BulwarkMode): void;
  audit(): void;
  copyDials(): void;
  reset(): void;
  screenshot(): void;
}

const GROUPS: Record<string, (keyof RenderDials)[]> = {
  Paint: ['bands', 'bandSoftness', 'terminatorNoise', 'paintStrength', 'saturation', 'shadowDepth', 'shadowTint', 'rimStrength', 'rimPower', 'standardBlend', 'ambientStrength', 'brushScale', 'terrainBrush'],
  Ink: ['inkWidthPx', 'inkColor', 'edgeStrength', 'edgeLineWidth', 'depthThreshold', 'normalThreshold', 'edgeFadeNear', 'edgeFadeFar'],
  Atmosphere: ['fogDensity', 'fogStart'],
  Post: ['exposure', 'contrast', 'bloomIntensity', 'bloomThreshold', 'grain', 'vignette'],
};

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
  lab.add(state, 'bulwark', ['cycle', 'idle', 'run', 'attack']).name('Bulwark').onChange((mode: BulwarkMode) => handlers.onBulwark(mode));
  for (const [group, keys] of Object.entries(GROUPS)) {
    const folder = gui.addFolder(group);
    for (const key of keys) {
      if (key === 'shadowTint' || key === 'inkColor') {
        folder.addColor(dials, key).onChange(() => handlers.onDials());
      } else {
        const [min, max, step] = NUMERIC_RANGES[key as Exclude<keyof RenderDials, 'shadowTint' | 'inkColor'>];
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
  return gui;
}
