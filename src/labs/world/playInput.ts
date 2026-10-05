import { isAttackClick, stickInput, type MoveInput } from './playMotion';

/** The keys that move him, by KeyboardEvent.code, so WASD sits under the same fingers on any keyboard layout. */
const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const SPRINT = ['ShiftLeft', 'ShiftRight'];
const HANDLED = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...SPRINT]);
/** The key that swings his sword, beside the movement keys under the left hand. */
const ATTACK = 'KeyF';

export interface PlayInput {
  /** The keys and the thumb pad together, as one move input. */
  read(): MoveInput;
  /** True once for each attack asked since the last call (F, a left click on the canvas, or the attack button). */
  takeAttack(): boolean;
  /** Starts or stops listening; stopping lets go of every held key and the pad, and drops an attack not yet taken. */
  setActive(on: boolean): void;
}

/**
 * The play prototype's controls: WASD or the arrow keys, Shift to sprint, F or a left click on the canvas to attack, and
 * on a touch screen a thumb pad in the bottom left and an attack button in the bottom right (world.css), whose elements
 * the page shows only while playing; the button also answers Enter, Space and a screen reader's activation. A
 * one-finger drag anywhere else still reaches the canvas and orbits, because a touch that starts on the pad or the
 * button never reaches OrbitControls, and a left drag on the canvas still orbits, because only a press that stays put
 * and lifts quickly counts as a click (isAttackClick).
 */
export function createPlayInput(pad: HTMLElement, knob: HTMLElement, attackButton: HTMLElement, canvas: HTMLElement): PlayInput {
  const held = new Set<string>();
  let active = false;
  let stick: MoveInput = { right: 0, forward: 0, sprint: false };
  let finger: number | null = null;
  let attackAsked = false;
  /** Whether the attack button's last pointer press has not yet had its click, which then asks nothing more. */
  let buttonPressed = false;
  let press: { id: number; x: number; y: number; at: number } | null = null;

  // A key typed into one of the panel's fields is the field's, not a step.
  const typing = (target: EventTarget | null): boolean =>
    target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== 'checkbox');

  window.addEventListener('keydown', (event) => {
    // On macOS a letter released while Cmd is held sends no keyup, so a W held into a Cmd shortcut ran on by itself.
    if (event.key === 'Meta') held.clear();
    // A shortcut is the browser's, not a step: taken as one, Ctrl+S walked him back and never reached the browser.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!active || typing(event.target)) return;
    if (event.code === ATTACK) {
      // A held F repeats its keydown; one swing per press, so holding it does not chain swings.
      if (!event.repeat) attackAsked = true;
      event.preventDefault();
      return;
    }
    if (!HANDLED.has(event.code)) return;
    held.add(event.code);
    // The arrows would otherwise scroll the panel or the page under him.
    event.preventDefault();
  });

  // A left mouse click on the canvas attacks; OrbitControls takes the same press as the start of a drag, so the press is
  // read on its way up and counts only if it stayed within PLAY_CLICK_SLOP_PX and lifted inside PLAY_CLICK_MAX_SECONDS.
  // A touch on the canvas orbits and never attacks; the attack button is the touch screen's trigger.
  canvas.addEventListener('pointerdown', (event) => {
    press = active && event.button === 0 && event.pointerType === 'mouse' ? { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp } : null;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!press || event.pointerId !== press.id) return;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (active && isAttackClick(moved, (event.timeStamp - press.at) / 1000)) attackAsked = true;
    press = null;
  });
  canvas.addEventListener('pointercancel', () => (press = null));
  attackButton.addEventListener('pointerdown', (event) => {
    if (active) attackAsked = true;
    buttonPressed = true;
    // No focus ring and no text selection from a press. No orbit starts under it either, but for another reason: the
    // canvas never receives a press that lands on a separate element, so nothing needs stopping here.
    event.preventDefault();
  });
  // A cancelled press clicks nothing, so it must not leave the flag up for the next click to be swallowed by.
  attackButton.addEventListener('pointercancel', () => (buttonPressed = false));
  // Enter or Space on the focused button, and a screen reader's activation (TalkBack's double tap), arrive as a click
  // with no pointer press before it, which the pointerdown above never saw, so the button did nothing for them. A
  // pointer's tap clicks too, after its pointerdown has already asked, so a click asks only when no press came before
  // it, and one tap stays one swing. The click's detail used to tell them apart (0 for a keyboard's click, 1 for a
  // tap's), but an assistive technology may click with a detail of 1 and no press, and that did nothing.
  attackButton.addEventListener('click', () => {
    if (active && !buttonPressed) attackAsked = true;
    buttonPressed = false;
  });
  window.addEventListener('keyup', (event) => held.delete(event.code));
  // A key released while the window was in the background never sends its keyup, and he would run on by himself.
  window.addEventListener('blur', () => held.clear());

  const reach = (): number => (pad.clientWidth - knob.offsetWidth) / 2;
  const moveKnob = (dx: number, dy: number): void => {
    const length = Math.hypot(dx, dy);
    const k = length > reach() ? reach() / length : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  };
  const release = (): void => {
    finger = null;
    stick = { right: 0, forward: 0, sprint: false };
    knob.style.transform = '';
  };
  const push = (event: PointerEvent): void => {
    const box = pad.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    stick = stickInput(dx, dy, reach());
    moveKnob(dx, dy);
  };
  pad.addEventListener('pointerdown', (event) => {
    if (finger !== null) return;
    finger = event.pointerId;
    pad.setPointerCapture(event.pointerId);
    push(event);
    event.preventDefault();
  });
  pad.addEventListener('pointermove', (event) => {
    if (event.pointerId === finger) push(event);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    pad.addEventListener(type, (event) => {
      if (event.pointerId === finger) release();
    });
  }

  const has = (codes: readonly string[]): number => (codes.some((code) => held.has(code)) ? 1 : 0);
  return {
    read() {
      const right = Math.max(-1, Math.min(1, has(RIGHT) - has(LEFT) + stick.right));
      const forward = Math.max(-1, Math.min(1, has(FORWARD) - has(BACK) + stick.forward));
      return { right, forward, sprint: has(SPRINT) === 1 || stick.sprint };
    },
    takeAttack() {
      const asked = attackAsked;
      attackAsked = false;
      return asked;
    },
    setActive(on) {
      active = on;
      if (!on) {
        held.clear();
        release();
        attackAsked = false;
        buttonPressed = false;
        press = null;
      }
    },
  };
}
