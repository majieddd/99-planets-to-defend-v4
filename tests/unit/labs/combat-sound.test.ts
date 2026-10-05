import { describe, expect, it } from 'vitest';
import {
  createCombatSound,
  encodeWav,
  IMPACT_FINISHER,
  IMPACT_LIGHT,
  impactParams,
  masterGain,
  NOISE_SECONDS,
  RESUME_RETRY_FRAMES,
  scheduleImpact,
  scheduleWhiff,
  scheduleWhoosh,
  WHIFF,
  WHOOSH_PEAK_SHARE,
  WHOOSH_VOICES,
  whooshParams,
} from '../../../src/labs/shared/combatSound';
import { COMBO_HITS } from '../../../src/labs/world/combo';

// Play Pip's combat sounds (labs/shared/combatSound.ts): the parameter maps, the graphs they schedule, the gesture that
// unlocks them and the mute, with a stand-in AudioContext, since node has no WebAudio.

/** An AudioParam stand-in that records its automation. */
class Param {
  value = 0;
  readonly calls: [string, number, number][] = [];
  setValueAtTime(v: number, t: number): this {
    this.calls.push(['set', v, t]);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.calls.push(['linear', v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    this.calls.push(['exp', v, t]);
    return this;
  }
}

/** Nodes as the stand-in context makes them: each records its kind and what it connects to. */
class Node {
  readonly to: Node[] = [];
  readonly gain = new Param();
  readonly frequency = new Param();
  readonly Q = new Param();
  type = '';
  buffer: unknown = null;
  loop = false;
  started: number[] = [];
  stopped: number[] = [];
  constructor(readonly kind: string) {}
  connect(node: Node): Node {
    this.to.push(node);
    return node;
  }
  start(when: number): void {
    this.started.push(when);
  }
  stop(when: number): void {
    this.stopped.push(when);
  }
}

class FakeContext {
  readonly nodes: Node[] = [];
  readonly destination = new Node('destination');
  sampleRate = 8000;
  currentTime = 1.5;
  state: 'suspended' | 'running' = 'suspended';
  resumes = 0;
  suspends = 0;
  readonly listeners = new Map<string, () => void>();
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }
  /** The device fails: the context suspends itself and tells its error listener. */
  fail(): void {
    this.state = 'suspended';
    this.listeners.get('error')?.();
  }
  private make(kind: string): Node {
    const node = new Node(kind);
    this.nodes.push(node);
    return node;
  }
  createGain(): Node {
    return this.make('gain');
  }
  createBiquadFilter(): Node {
    return this.make('filter');
  }
  createBufferSource(): Node {
    return this.make('source');
  }
  createOscillator(): Node {
    return this.make('oscillator');
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  }
  resume(): Promise<void> {
    this.resumes += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspends += 1;
    this.state = 'suspended';
    return Promise.resolve();
  }
}

const asContext = (ctx: FakeContext) => ctx as unknown as AudioContext;
const [HIT1, HIT2, HIT3] = COMBO_HITS as [(typeof COMBO_HITS)[number], (typeof COMBO_HITS)[number], (typeof COMBO_HITS)[number]];

describe('the combat sounds (labs/shared/combatSound.ts)', () => {
  it("pitch each hit's whoosh apart, the finisher lower, louder and longer, each peaking just before its strike", () => {
    const [w1, w2, w3] = [whooshParams(1, HIT1), whooshParams(2, HIT2), whooshParams(3, HIT3)];
    expect(w2.peakHz).toBeGreaterThan(w1.peakHz);
    expect(w3.peakHz).toBeLessThan(w1.peakHz);
    expect(w3.gain).toBeGreaterThan(Math.max(w1.gain, w2.gain));
    expect(w3.fall).toBeGreaterThan(Math.max(w1.fall, w2.fall));
    expect(w1.rise).toBeCloseTo(HIT1.strike * WHOOSH_PEAK_SHARE, 12);
    expect(w3.rise).toBeCloseTo(HIT3.strike * WHOOSH_PEAK_SHARE, 12);
    for (const step of [1, 2, 3] as const) {
      const v = WHOOSH_VOICES[step];
      expect(v.peakHz).toBeGreaterThan(v.startHz);
      expect(v.peakHz).toBeGreaterThan(v.endHz);
    }
  });

  it("runs a whoosh at its hit's playback speed, and loops the noise so the slowest finisher keeps its tail", () => {
    // Every moment of a hit divides by its speed in real seconds, the whoosh's rise to its peak and its fall too.
    for (const speed of [0.8, 1.6]) {
      const p = whooshParams(3, HIT3, speed);
      expect(p.rise, `${speed}`).toBeCloseTo((HIT3.strike * WHOOSH_PEAK_SHARE) / speed, 12);
      expect(p.fall, `${speed}`).toBeCloseTo(WHOOSH_VOICES[3].fall / speed, 12);
    }
    // At 0.8 the Quaternius finisher's whoosh lasts 1.14 s, past the 1 s noise buffer, which a one-shot read cut off.
    const slow = whooshParams(3, HIT3, 0.8);
    expect(slow.rise + slow.fall).toBeCloseTo(1.142, 3);
    expect(slow.rise + slow.fall).toBeGreaterThan(NOISE_SECONDS);
    const ctx = new FakeContext();
    const end = scheduleWhoosh(asContext(ctx), ctx.destination as unknown as AudioNode, {} as AudioBuffer, slow, 2);
    const source = ctx.nodes.find((node) => node.kind === 'source')!;
    expect(source.loop).toBe(true);
    expect(source.started).toEqual([2]);
    expect(end).toBeCloseTo(2 + slow.rise + slow.fall, 12);
  });

  it('schedules a whoosh as noise through a band-pass sweeping up to the peak and down, its gain peaking at the strike', () => {
    const ctx = new FakeContext();
    const out = ctx.destination;
    const p = whooshParams(1, HIT1);
    const end = scheduleWhoosh(asContext(ctx), out as unknown as AudioNode, {} as AudioBuffer, p, 2);
    expect(end).toBeCloseTo(2 + p.rise + p.fall, 12);
    const filter = ctx.nodes.find((node) => node.kind === 'filter')!;
    expect(filter.type).toBe('bandpass');
    expect(filter.frequency.calls).toEqual([
      ['set', p.startHz, 2],
      ['exp', p.peakHz, 2 + p.rise],
      ['exp', p.endHz, end],
    ]);
    const gain = ctx.nodes.find((node) => node.kind === 'gain')!;
    const peak = gain.gain.calls.find(([, value]) => value === p.gain)!;
    expect(peak[2]).toBeCloseTo(2 + p.rise, 12);
    expect(gain.to).toEqual([out]);
    expect(ctx.nodes.find((node) => node.kind === 'source')!.started).toEqual([2]);
  });

  it("makes the finisher's impact heavier than a light one, with a sub under its thunk", () => {
    expect(impactParams(false)).toBe(IMPACT_LIGHT);
    expect(impactParams(true)).toBe(IMPACT_FINISHER);
    expect(IMPACT_FINISHER.thunkFromHz).toBeLessThan(IMPACT_LIGHT.thunkFromHz);
    expect(IMPACT_FINISHER.thunkSeconds).toBeGreaterThan(IMPACT_LIGHT.thunkSeconds);
    expect(IMPACT_FINISHER.noiseGain).toBeGreaterThan(IMPACT_LIGHT.noiseGain);
    const kinds = (finisher: boolean) => {
      const ctx = new FakeContext();
      scheduleImpact(asContext(ctx), ctx.destination as unknown as AudioNode, {} as AudioBuffer, impactParams(finisher), 0);
      return ctx.nodes.filter((node) => node.kind === 'oscillator').map((node) => node.type);
    };
    expect(kinds(false)).toEqual(['triangle', 'square']);
    expect(kinds(true)).toEqual(['triangle', 'square', 'sine']);
    // A whiff is a soft puff of low-passed noise, quieter than any whoosh.
    const ctx = new FakeContext();
    const end = scheduleWhiff(asContext(ctx), ctx.destination as unknown as AudioNode, {} as AudioBuffer, WHIFF, 1);
    expect(end).toBeCloseTo(1 + WHIFF.seconds, 12);
    expect(ctx.nodes.find((node) => node.kind === 'filter')!.type).toBe('lowpass');
    expect(WHIFF.gain).toBeLessThan(Math.min(...Object.values(WHOOSH_VOICES).map((v) => v.gain)));
  });

  it('stays silent and makes no context until a real gesture, then plays, and mute zeroes the gain and suspends it', () => {
    const listeners = new Map<string, (event: Event) => void>();
    const target = {
      addEventListener: (type: string, listener: (event: Event) => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as Window;
    const feel = { mute: false, volume: 0.7 };
    let made: FakeContext | null = null;
    const sound = createCombatSound({ feel, target, makeContext: () => asContext((made = new FakeContext())) });
    // Before any gesture: skipped, with no context made (and so no autoplay warning).
    sound.whoosh(1, HIT1);
    expect(made).toBeNull();
    expect(sound.reading()).toMatchObject({ state: 'locked', unlocked: false, skipped: { whoosh: 1 }, played: { whoosh: 0 } });
    // An event the page dispatched itself is no gesture.
    listeners.get('keydown')!({ isTrusted: false } as Event);
    expect(made).toBeNull();
    // A real key: the context is made and resumed, and the listeners go.
    listeners.get('keydown')!({ isTrusted: true } as Event);
    expect(made).not.toBeNull();
    expect(made!.resumes).toBe(1);
    expect(listeners.size).toBe(0);
    sound.sync();
    expect(sound.reading()).toMatchObject({ state: 'running', unlocked: true, gain: 0.7 });
    sound.whoosh(1, HIT1);
    sound.impact(true);
    sound.whiff(1);
    expect(sound.reading().played).toEqual({ whoosh: 1, impact: 1, whiff: 1 });
    // Asked counts only from the gesture on: the whoosh before it was skipped, never asked.
    expect(sound.reading().asked).toEqual({ whoosh: 1, impact: 1, whiff: 1 });
    // Muted: gain 0 and the context suspended, once however many frames; sounds asked for meanwhile are skipped.
    feel.mute = true;
    sound.sync();
    sound.sync();
    expect(made!.suspends).toBe(1);
    expect(sound.reading()).toMatchObject({ gain: 0, muted: true, state: 'suspended' });
    sound.impact(false);
    expect(sound.reading().skipped.impact).toBe(1);
    expect(sound.reading().asked.impact).toBe(2);
    // Unmuted: resumed, at the volume.
    feel.mute = false;
    feel.volume = 0.4;
    sound.sync();
    expect(made!.resumes).toBe(2);
    expect(sound.reading()).toMatchObject({ gain: 0.4, state: 'running' });
    // The device fails and suspends the context: counted, resumed on the next frame and not again for RESUME_RETRY_FRAMES.
    made!.fail();
    made!.resume = function (this: FakeContext) {
      this.resumes += 1;
      return Promise.resolve();
    };
    sound.sync();
    expect(made!.resumes).toBe(3);
    for (let i = 0; i < RESUME_RETRY_FRAMES - 1; i++) sound.sync();
    expect(made!.resumes).toBe(3);
    sound.sync();
    expect(made!.resumes).toBe(4);
    expect(sound.reading().deviceErrors).toBe(1);
    expect(masterGain({ mute: false, volume: 1.4 })).toBe(1);
    expect(masterGain({ mute: true, volume: 1 })).toBe(0);
  });

  it('writes 16-bit mono PCM WAV files, clipping each sample', () => {
    const wav = new DataView(encodeWav(new Float32Array([0, 1, -1, 2]), 22050));
    const text = (at: number, length: number) => String.fromCharCode(...Array.from({ length }, (_, i) => wav.getUint8(at + i)));
    expect([text(0, 4), text(8, 4), text(12, 4), text(36, 4)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect([wav.getUint16(20, true), wav.getUint16(22, true), wav.getUint32(24, true), wav.getUint16(34, true), wav.getUint32(40, true)]).toEqual([1, 1, 22050, 16, 8]);
    expect([wav.getInt16(44, true), wav.getInt16(46, true), wav.getInt16(48, true), wav.getInt16(50, true)]).toEqual([0, 32767, -32768, 32767]);
  });
});
