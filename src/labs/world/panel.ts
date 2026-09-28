import GUI, { type Controller } from 'lil-gui';
import type { TierName } from '../../render/quality';
import { NARROW_SCREEN } from '../style/referenceBoard';
import { HEART_STAGES } from './layout';
import { MEMBERS, ZONES } from './registry';
import { CHARACTER_FAMILIES, CHARACTERS, OVERVIEW } from './views';

const TITLE = 'Asset World';
/** The phone title: short enough that the closed panel leaves the canvas clear, as the Style Lab's "Dials" does. */
const NARROW_TITLE = 'World';

/** The fastest the animation speed dial runs the clips and tower sweeps, as a multiple of their authored speed. */
export const MAX_ANIMATION_SPEED = 2;

export interface WorldPanelState {
  /** The overview, the characters or a family. */
  view: string;
  /** A member of the view, or '' for the whole view. */
  member: string;
  turntable: boolean;
  labels: boolean;
  heartLevel: number;
  speed: number;
  paused: boolean;
  tier: TierName;
}

export interface WorldPanelHandlers {
  onFocus(): void;
  onHeartLevel(level: number): void;
  onTier(tier: TierName): void;
  openStyleLab(): void;
}

/** The view dropdown: the overview and the characters, then the families in the order the zones stand. */
export function viewOptions(): Record<string, string> {
  const options: Record<string, string> = { Overview: OVERVIEW, 'Characters (Husk and Bulwark)': CHARACTERS };
  for (const zone of ZONES) options[`${zone.label} (${zone.family})`] = zone.family;
  return options;
}

/** The member dropdown for a view: the whole view first, then each member it frames, by label and name. */
export function memberOptions(view: string): Record<string, string> {
  const options: Record<string, string> = { 'Whole view': '' };
  const inView = MEMBERS.filter((m) => view === OVERVIEW || (view === CHARACTERS ? CHARACTER_FAMILIES.includes(m.family) : m.family === view));
  for (const m of inView) options[m.label ? `${m.label} (${m.name})` : m.name] = m.name;
  return options;
}

export interface WorldPanel {
  /** Rebuilds the member dropdown for the current view and redraws every control from the state. */
  refresh(): void;
}

export function createWorldPanel(state: WorldPanelState, handlers: WorldPanelHandlers): WorldPanel {
  // On a phone the panel starts closed behind a short title, as the Style Lab's dials do, so the canvas starts clear.
  const narrow = matchMedia(NARROW_SCREEN);
  const title = (): string => (narrow.matches ? NARROW_TITLE : TITLE);
  const gui = new GUI({ title: title() });
  if (narrow.matches) gui.close();
  narrow.addEventListener('change', () => gui.title(title()));
  // The phone layout hides the banner and the look note under the open panel by this class (world.css), as the Style
  // Lab's does; lil-gui calls back only on a change, so the state at creation is set here once.
  const syncOpenClass = (): void => {
    document.body.classList.toggle('panel-open', !gui._closed);
  };
  gui.onOpenClose(syncOpenClass);
  syncOpenClass();

  gui
    .add(state, 'view', viewOptions())
    .name('view')
    .onChange(() => {
      state.member = '';
      rebuildMembers();
      handlers.onFocus();
    });
  const memberControl: Controller = gui
    .add(state, 'member', memberOptions(state.view))
    .name('member')
    .onChange(() => handlers.onFocus());
  // A dropdown's options() swaps its choices in place and keeps its handler (lil-gui's OptionController), so the member
  // list follows the view without the control moving to the end of the panel.
  const rebuildMembers = (): void => {
    memberControl.options(memberOptions(state.view));
  };
  // The frame loop reads the turntable and the labels from the state every frame, so neither toggle needs a handler.
  gui.add(state, 'turntable').name('turntable');
  gui.add(state, 'labels').name('labels');
  // The slider's top is the heart's last stage, read from HEART_STAGES rather than kept as a copy that could drift.
  gui.add(state, 'heartLevel', 0, HEART_STAGES - 1, 1).name('slider heart level').onChange((level: number) => handlers.onHeartLevel(level));
  gui.add(state, 'speed', 0, MAX_ANIMATION_SPEED, 0.05).name('animation speed');
  gui.add(state, 'paused').name('pause animation');
  gui.add(state, 'tier', ['high', 'medium', 'low']).name('quality tier').onChange((tier: TierName) => handlers.onTier(tier));
  gui.add({ open: () => handlers.openStyleLab() }, 'open').name('Open this look in the Style Lab');

  return {
    refresh() {
      rebuildMembers();
      for (const controller of gui.controllersRecursive()) controller.updateDisplay();
    },
  };
}
