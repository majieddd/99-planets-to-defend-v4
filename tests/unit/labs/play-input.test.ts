import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayInput, type PlayInput } from '../../../src/labs/world/playInput';

/**
 * The play controls read only events, so plain EventTargets stand in for the window, the pad, the knob, the canvas and
 * the Attack button, and the test runs without a DOM. A click is built as a CustomEvent with the detail a MouseEvent
 * would carry, which the button's click listener no longer reads, so that a click of either detail is tried.
 */
describe('the play prototype controls', () => {
  let button: EventTarget;
  let input: PlayInput;

  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
    // The keydown listener asks whether a panel field has the key; none of these is ever the target here.
    for (const name of ['HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLInputElement']) vi.stubGlobal(name, class {});
    button = new EventTarget();
    // Stopping play recentres the knob through its style, the one element property the controls write.
    const element = () => Object.assign(new EventTarget(), { style: {} }) as unknown as HTMLElement;
    input = createPlayInput(element(), element(), button as unknown as HTMLElement, element());
    input.setActive(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const click = (detail: number) => button.dispatchEvent(new CustomEvent('click', { detail }));
  const press = () => button.dispatchEvent(new Event('pointerdown', { cancelable: true }));

  it('swings for Enter, Space or a screen reader on the Attack button, whose click comes with no pointer press', () => {
    // A keyboard's activation clicks with a detail of 0 and nothing before it.
    click(0);
    expect(input.takeAttack()).toBe(true);
    expect(input.takeAttack()).toBe(false);
    // An assistive technology may click with a detail of 1 and no press, which the detail check used to ignore.
    click(1);
    expect(input.takeAttack()).toBe(true);
  });

  it('swings once for a tap, whose pointerdown asks and whose click after it does not ask again', () => {
    const pressed = new Event('pointerdown', { cancelable: true });
    button.dispatchEvent(pressed);
    // The press is the button's alone, so no focus ring or text selection follows it.
    expect(pressed.defaultPrevented).toBe(true);
    expect(input.takeAttack()).toBe(true);
    click(1);
    expect(input.takeAttack()).toBe(false);
    // The tap's click took the press, so the next click without one asks again.
    click(1);
    expect(input.takeAttack()).toBe(true);
  });

  it('lets a cancelled press, which clicks nothing, leave the next click its own swing', () => {
    press();
    expect(input.takeAttack()).toBe(true);
    button.dispatchEvent(new Event('pointercancel'));
    click(1);
    expect(input.takeAttack()).toBe(true);
  });

  it('asks nothing while play is off, and drops an attack asked before it stopped', () => {
    press();
    input.setActive(false);
    expect(input.takeAttack()).toBe(false);
    click(0);
    press();
    expect(input.takeAttack()).toBe(false);
    // Stopping drops a press still waiting for its click, so the first click back in play is its own swing.
    input.setActive(false);
    input.setActive(true);
    click(0);
    expect(input.takeAttack()).toBe(true);
  });

  it('swings once for F, not again for its repeats while held', () => {
    const key = (repeat: boolean) =>
      window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { code: 'KeyF', key: 'f', repeat, ctrlKey: false, metaKey: false, altKey: false }));
    key(false);
    expect(input.takeAttack()).toBe(true);
    key(true);
    expect(input.takeAttack()).toBe(false);
  });

  it("asks for the combat arena's reset on R, once a press, under F's rules, and only on a page that asked for the key", () => {
    const keyR = (fields: Partial<{ repeat: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { code: 'KeyR', key: 'r', repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...fields });
      window.dispatchEvent(event);
      return event;
    };
    // The Asset World's input has no reset key, and leaves R to the browser.
    const world = keyR();
    expect(input.takeReset()).toBe(false);
    expect(world.defaultPrevented).toBe(false);
    input.setActive(false);
    const element = () => Object.assign(new EventTarget(), { style: {} }) as unknown as HTMLElement;
    const arena = createPlayInput(element(), element(), new EventTarget() as unknown as HTMLElement, element(), { resetKey: true });
    arena.setActive(true);
    expect(keyR().defaultPrevented).toBe(true);
    expect(arena.takeReset()).toBe(true);
    expect(arena.takeReset()).toBe(false);
    // Held, its repeats ask nothing more; with a modifier it is the browser's (Ctrl+R reloads), not a reset.
    keyR({ repeat: true });
    expect(arena.takeReset()).toBe(false);
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      keyR({ [modifier]: true });
      expect(arena.takeReset(), modifier).toBe(false);
    }
    // Out of play it asks nothing, and stopping drops a reset not yet taken.
    keyR();
    arena.setActive(false);
    expect(arena.takeReset()).toBe(false);
    keyR();
    expect(arena.takeReset()).toBe(false);
  });
});
