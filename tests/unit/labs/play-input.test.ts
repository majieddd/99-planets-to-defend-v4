import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayInput, type PlayInput } from '../../../src/labs/world/playInput';

/**
 * The play controls read only events, so plain EventTargets stand in for the window, the pad, the knob, the canvas and
 * the Attack button, and the test runs without a DOM. A click is built as a CustomEvent, whose detail is the one field
 * of a MouseEvent the button's click listener reads.
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
    // A keyboard's or an assistive technology's activation clicks with a detail of 0 and nothing before it.
    click(0);
    expect(input.takeAttack()).toBe(true);
    expect(input.takeAttack()).toBe(false);
  });

  it('swings once for a tap, whose pointerdown asks and whose click after it does not ask again', () => {
    const pressed = new Event('pointerdown', { cancelable: true });
    button.dispatchEvent(pressed);
    // The press is the button's alone, so no focus ring or text selection follows it.
    expect(pressed.defaultPrevented).toBe(true);
    expect(input.takeAttack()).toBe(true);
    click(1);
    expect(input.takeAttack()).toBe(false);
  });

  it('asks nothing while play is off, and drops an attack asked before it stopped', () => {
    press();
    input.setActive(false);
    expect(input.takeAttack()).toBe(false);
    click(0);
    press();
    expect(input.takeAttack()).toBe(false);
  });

  it('swings once for F, not again for its repeats while held', () => {
    const key = (repeat: boolean) =>
      window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { code: 'KeyF', key: 'f', repeat, ctrlKey: false, metaKey: false, altKey: false }));
    key(false);
    expect(input.takeAttack()).toBe(true);
    key(true);
    expect(input.takeAttack()).toBe(false);
  });
});
