import GUI, { type Controller } from 'lil-gui';
import type { TierName } from '../../render/quality';
import { NARROW_SCREEN } from '../style/referenceBoard';
import { COMBAT_FEEL_KEYS, COMBAT_FEEL_RANGES, combatFeelJson, defaultCombatFeel, type CombatFeel } from './combatFeel';
import { HEART_STAGES } from './layout';
import { MEMBERS, ZONES, type WorldMember } from './registry';
import { CHARACTER_FAMILIES, CHARACTERS, OVERVIEW } from './views';

const TITLE = 'Asset World';
/** The phone title: short enough that the closed panel leaves the canvas clear, as the Style Lab's "Dials" does. */
const NARROW_TITLE = 'World';

/** The copy button's name, and its name for a moment after a copy, so the owner sees that the clipboard took it. */
const COPY_FEEL = 'Copy combat feel settings';
const COPIED_FEEL = 'Copied to the clipboard';
/** How long the copy button says it copied, in milliseconds. */
const COPIED_SHOWN_MS = 1500;

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
  /** Whether Pip (commander) is out on the patch under the keys (the play prototype, play.ts). */
  play: boolean;
}

export interface WorldPanelHandlers {
  onFocus(): void;
  onPlay(on: boolean): void;
  onHeartLevel(level: number): void;
  onTier(tier: TierName): void;
  openStyleLab(): void;
  /** Puts a line in the page's banner: the copy button's fallback when the clipboard refuses the settings. */
  notice(text: string): void;
}

/** The view dropdown: the overview and the characters, then the families in the order the zones stand. */
export function viewOptions(): Record<string, string> {
  const options: Record<string, string> = { Overview: OVERVIEW, 'Characters (Husk and commanders)': CHARACTERS };
  for (const zone of ZONES) options[`${zone.label} (${zone.family})`] = zone.family;
  return options;
}

/**
 * A member's name in the member dropdown: its label and its address, with the character first for a member that shows
 * one, "Pip (commander) idle (pip_idle)" beside "Bulwark idle (bulwark_idle)". The list used to read "Idle (pip_idle)"
 * beside "Idle (bulwark_idle)", so the panel never named Pip (commander) and only the addresses told the two apart.
 */
export function memberOptionText(m: WorldMember): string {
  if (!m.label) return m.name;
  return m.character ? `${m.character} ${m.label.toLowerCase()} (${m.name})` : `${m.label} (${m.name})`;
}

/** The member dropdown for a view: the whole view first, then each member it frames, by memberOptionText. */
export function memberOptions(view: string): Record<string, string> {
  const options: Record<string, string> = { 'Whole view': '' };
  const inView = MEMBERS.filter((m) => view === OVERVIEW || (view === CHARACTERS ? CHARACTER_FAMILIES.includes(m.zone) : m.zone === view));
  for (const m of inView) options[memberOptionText(m)] = m.name;
  return options;
}

export interface WorldPanel {
  /** Rebuilds the member dropdown for the current view and redraws every control from the state. */
  refresh(): void;
}

/**
 * The panel. `feel` is the page's one combat feel object (combatFeel.ts), which Play Pip reads every frame: its folder's
 * sliders write it directly, so a change takes effect on the next frame.
 */
export function createWorldPanel(state: WorldPanelState, handlers: WorldPanelHandlers, feel: CombatFeel): WorldPanel {
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
  // lil-gui stops every key event that starts inside a controller from reaching the window, so that typing in a field
  // fires no page shortcut. A checkbox or a button keeps the focus after a click, though, so it swallowed Play Pip's
  // keys: after ticking Play Pip itself, or after the copy button, WASD and F did nothing until a click elsewhere
  // (measured: S held for 0.7 s after the copy button moved him 0.00 m). The controls Play Pip's keys follow hand the
  // focus back to the page once they have acted.
  const releaseFocus = (): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && gui.domElement.contains(active)) active.blur();
  };

  // First, so the owner finds it without scrolling the panel on a phone.
  gui
    .add(state, 'play')
    .name('Play Pip (prototype)')
    .onChange((on: boolean) => {
      handlers.onPlay(on);
      releaseFocus();
    });
  const viewControl: Controller = gui
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
  const turntableControl = gui.add(state, 'turntable').name('turntable');
  gui.add(state, 'labels').name('labels');
  // The slider's top is the heart's last stage, read from HEART_STAGES rather than kept as a copy that could drift.
  gui.add(state, 'heartLevel', 0, HEART_STAGES - 1, 1).name('slider heart level').onChange((level: number) => handlers.onHeartLevel(level));
  gui.add(state, 'speed', 0, MAX_ANIMATION_SPEED, 0.05).name('animation speed');
  gui.add(state, 'paused').name('pause animation');
  gui.add(state, 'tier', ['high', 'medium', 'low']).name('quality tier').onChange((tier: TierName) => handlers.onTier(tier));
  gui.add({ open: () => handlers.openStyleLab() }, 'open').name('Open this look in the Style Lab');

  // Play Pip's combat feel: one slider per setting, in COMBAT_FEEL_RANGES's order, so a setting added there (phase B's
  // hit-stop, lunge, shake and trail) arrives here with no change to this code. The readout shows the settings as the
  // JSON the copy button copies, so the owner can also select it by hand. On a phone the folder starts closed, as the
  // panel does, so it does not fill the small screen when the panel opens.
  const feelFolder = gui.addFolder('combat feel');
  if (narrow.matches) feelFolder.close();
  const readout = { settings: combatFeelJson(feel) };
  const syncReadout = (): void => {
    readout.settings = combatFeelJson(feel);
    readoutControl.updateDisplay();
  };
  for (const key of COMBAT_FEEL_KEYS) {
    const range = COMBAT_FEEL_RANGES[key];
    feelFolder.add(feel, key, range.min, range.max, range.step).name(range.label).onChange(syncReadout);
  }
  const readoutControl: Controller = feelFolder.add(readout, 'settings').name('settings');
  // The readout reports the settings; typing into it would change nothing, so it takes a selection but no edits.
  const readoutInput = readoutControl.domElement.querySelector('input');
  if (readoutInput) readoutInput.readOnly = true;
  const copyControl: Controller = feelFolder
    .add(
      {
        copy: () => {
          releaseFocus();
          const json = combatFeelJson(feel);
          // The clipboard may be missing (an insecure address) or refuse (no permission, the page not focused), and it
          // may throw at once or reject later; either way the settings go to the banner, where the owner can copy them.
          const refused = (error: unknown): void => handlers.notice(`The clipboard refused the combat feel settings (${String(error)}); they are: ${json}`);
          try {
            navigator.clipboard.writeText(json).then(() => {
              copyControl.name(COPIED_FEEL);
              setTimeout(() => copyControl.name(COPY_FEEL), COPIED_SHOWN_MS);
            }, refused);
          } catch (error) {
            refused(error);
          }
        },
      },
      'copy',
    )
    .name(COPY_FEEL);
  feelFolder
    .add(
      {
        reset: () => {
          releaseFocus();
          Object.assign(feel, defaultCombatFeel());
          for (const controller of feelFolder.controllers) controller.updateDisplay();
          syncReadout();
        },
      },
      'reset',
    )
    .name('Reset combat feel to the defaults');

  return {
    refresh() {
      rebuildMembers();
      // While he plays, the camera follows him, so the controls that would glide it to a view or turn it wait.
      for (const controller of [viewControl, memberControl, turntableControl]) controller.enable(!state.play);
      for (const controller of gui.controllersRecursive()) controller.updateDisplay();
      syncReadout();
    },
  };
}
