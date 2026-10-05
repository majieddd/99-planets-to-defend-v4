import GUI from 'lil-gui';
import type { TierName } from '../../render/quality';
import { NARROW_SCREEN } from '../style/referenceBoard';
import type { CombatFeel } from '../world/combatFeel';
import { addCombatFeelFolder, handFocusBack, type CombatFeelHandlers } from '../world/panel';

const TITLE = 'Combat arena';
/** The phone title: short enough that the closed panel leaves the controls card its room, as the world's "World" does. */
const NARROW_TITLE = 'Arena';
/** The reset button's name: what it does, and the key that does the same. */
export const RESET_NAME = 'Reset the dummies and Pip (R)';

export interface ArenaPanelState {
  tier: TierName;
}

export interface ArenaPanelHandlers extends CombatFeelHandlers {
  onTier(tier: TierName): void;
  reset(): void;
}

export interface ArenaPanel {
  refresh(): void;
}

/**
 * The combat arena's panel: the reset, the quality tier and the combat feel folder, open, since tuning the feel is what
 * the arena is for; none of the Asset World's view, member, label or heart controls, which have nothing to show here.
 * On a phone, or on any touch screen, the panel starts closed behind its title, so the thumb pad and the Attack button
 * are clear from the first frame; its open height stops above them (combat.css).
 */
export function createArenaPanel(state: ArenaPanelState, handlers: ArenaPanelHandlers, feel: CombatFeel): ArenaPanel {
  const narrow = matchMedia(NARROW_SCREEN);
  const coarse = matchMedia('(pointer: coarse)');
  const title = (): string => (narrow.matches ? NARROW_TITLE : TITLE);
  const gui = new GUI({ title: title() });
  if (narrow.matches || coarse.matches) gui.close();
  narrow.addEventListener('change', () => gui.title(title()));
  // The phone layout hides the banner and the controls card under the open panel by this class (world.css).
  const syncOpenClass = (): void => {
    document.body.classList.toggle('panel-open', !gui._closed);
  };
  gui.onOpenClose(syncOpenClass);
  syncOpenClass();
  handFocusBack(gui);

  gui.add({ reset: () => handlers.reset() }, 'reset').name(RESET_NAME);
  gui.add(state, 'tier', ['high', 'medium', 'low']).name('quality tier').onChange((tier: TierName) => handlers.onTier(tier));
  const feelFolder = addCombatFeelFolder(gui, feel, handlers, true);

  return {
    refresh() {
      for (const controller of gui.controllersRecursive()) controller.updateDisplay();
      feelFolder.sync();
    },
  };
}
