import { stickInput, type MoveInput } from './playMotion';

/** The keys that move him, by KeyboardEvent.code, so WASD sits under the same fingers on any keyboard layout. */
const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const SPRINT = ['ShiftLeft', 'ShiftRight'];
const HANDLED = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...SPRINT]);

export interface PlayInput {
  /** The keys and the thumb pad together, as one move input. */
  read(): MoveInput;
  /** Starts or stops listening; stopping lets go of every held key and the pad. */
  setActive(on: boolean): void;
}

/**
 * The play prototype's controls: WASD or the arrow keys, Shift to sprint, and on a touch screen a thumb pad in the
 * bottom left (world.css), whose element the page shows only while playing. A one-finger drag anywhere else still
 * reaches the canvas and orbits, because a touch that starts on the pad never reaches OrbitControls.
 */
export function createPlayInput(pad: HTMLElement, knob: HTMLElement): PlayInput {
  const held = new Set<string>();
  let active = false;
  let stick: MoveInput = { right: 0, forward: 0, sprint: false };
  let finger: number | null = null;

  // A key typed into one of the panel's fields is the field's, not a step.
  const typing = (target: EventTarget | null): boolean =>
    target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== 'checkbox');

  window.addEventListener('keydown', (event) => {
    // On macOS a letter released while Cmd is held sends no keyup, so a W held into a Cmd shortcut ran on by itself.
    if (event.key === 'Meta') held.clear();
    // A shortcut is the browser's, not a step: taken as one, Ctrl+S walked him back and never reached the browser.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!active || !HANDLED.has(event.code) || typing(event.target)) return;
    held.add(event.code);
    // The arrows would otherwise scroll the panel or the page under him.
    event.preventDefault();
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
    setActive(on) {
      active = on;
      if (!on) {
        held.clear();
        release();
      }
    },
  };
}
