/**
 * Play Pip (prototype)'s combat sounds, synthesised with WebAudio and no asset files: a whoosh for each swing, an impact
 * on contact and a softer whiff for a swing that met nothing. They are lab placeholders for the M9 audio engine
 * (Mechanics, Audio), tuned in the spirit of its brief for the player's tech: short, mechanical, a metallic transient.
 *
 * The parameter maps (pitch per hit, envelope times, gains) are plain data with pure helpers, and every graph is built
 * through a BaseAudioContext the caller hands in, so the unit tests drive them with a stand-in context and the page
 * renders each sound to a WAV with an OfflineAudioContext for the evidence. The live AudioContext is created, or resumed,
 * only on a real user gesture (a trusted pointerdown or keydown), as autoplay rules ask; until then every sound is
 * skipped without a word, so the page logs no autoplay warning. Sounds are timed on the audio clock from the frame they
 * are asked on, never on the combo's clock, so a hit-stop holds the swing but not the sound.
 */
import type { ComboStep, HitContract } from '../world/combo';

/** A swing's whoosh: noise through a band-pass whose centre sweeps up to the strike and down after it. */
export interface WhooshParams {
  /** Seconds from the hit's start to the whoosh's peak: the strike, a little early, where the blade moves fastest. */
  rise: number;
  /** Seconds the whoosh dies away over after its peak. */
  fall: number;
  /** The band-pass centre at the start, at the peak and at the end, in hertz. */
  startHz: number;
  peakHz: number;
  endHz: number;
  /** The band-pass's Q: a narrow band whistles, a wide one rushes. */
  q: number;
  /** The peak gain, before the master volume. */
  gain: number;
}

/** The per-hit part of a whoosh: its pitch, its band, its gain and how long it dies away. */
interface WhooshVoice {
  startHz: number;
  peakHz: number;
  endHz: number;
  q: number;
  gain: number;
  fall: number;
}

/**
 * Each hit's whoosh voice, attack_1 to attack_3: the forehand's mid sweep, the backhand's a fourth or so higher, so a
 * chain climbs, and the finisher's lower, wider, louder and longer, the heavy blow. The band-pass keeps a fifth or so of
 * the noise's level, so rendered at full volume the whooshes peak at about half an impact's (0.31 to 0.37 against 0.73
 * and 0.80): the cut is heard, and the contact lands over it.
 */
export const WHOOSH_VOICES: Readonly<Record<ComboStep, WhooshVoice>> = {
  1: { startHz: 500, peakHz: 1800, endHz: 900, q: 2.2, gain: 0.8, fall: 0.14 },
  2: { startHz: 650, peakHz: 2300, endHz: 1100, q: 2.4, gain: 0.72, fall: 0.13 },
  3: { startHz: 260, peakHz: 1100, endHz: 420, q: 1.6, gain: 1, fall: 0.3 },
};
/** The whoosh peaks this share of the way to the strike, as the blade's speed peaks just before it lands. */
export const WHOOSH_PEAK_SHARE = 0.92;
/** The share of the peak the wind-up's first half rises to before the cut's rush: a quiet draw, then the swing. */
export const WHOOSH_WINDUP_LEVEL = 0.12;

/** A hit's whoosh, from its voice and its contract: it peaks a little before the strike and dies away after it. */
export function whooshParams(step: ComboStep, contract: HitContract): WhooshParams {
  const voice = WHOOSH_VOICES[step];
  return { rise: Math.max(0.02, contract.strike * WHOOSH_PEAK_SHARE), ...voice };
}

/** An impact: a tonal thunk falling in pitch, a short metallic click and a noise transient, on the contact frame. */
export interface ImpactParams {
  /** The thunk's pitch at the contact and at its end, in hertz, and how long it sounds, in seconds. */
  thunkFromHz: number;
  thunkToHz: number;
  thunkSeconds: number;
  thunkGain: number;
  /** The metallic click: a square wave at this pitch, through a high-pass, for this long. */
  clickHz: number;
  clickSeconds: number;
  clickGain: number;
  /** The noise transient: a band of noise at this centre, for this long. */
  noiseHz: number;
  noiseSeconds: number;
  noiseGain: number;
  /** A sub layer under the finisher's thunk (0 gain on a light hit). */
  subFromHz: number;
  subToHz: number;
  subGain: number;
}

/** A light hit's impact and the finisher's, heavier, lower and longer, with a sub layer under it. */
export const IMPACT_LIGHT: Readonly<ImpactParams> = {
  thunkFromHz: 190,
  thunkToHz: 85,
  thunkSeconds: 0.09,
  thunkGain: 0.55,
  clickHz: 2600,
  clickSeconds: 0.025,
  clickGain: 0.16,
  noiseHz: 3200,
  noiseSeconds: 0.045,
  noiseGain: 0.4,
  subFromHz: 0,
  subToHz: 0,
  subGain: 0,
};
export const IMPACT_FINISHER: Readonly<ImpactParams> = {
  thunkFromHz: 140,
  thunkToHz: 52,
  thunkSeconds: 0.18,
  thunkGain: 0.75,
  clickHz: 1900,
  clickSeconds: 0.035,
  clickGain: 0.2,
  noiseHz: 2200,
  noiseSeconds: 0.08,
  noiseGain: 0.55,
  subFromHz: 70,
  subToHz: 40,
  subGain: 0.45,
};

export function impactParams(finisher: boolean): Readonly<ImpactParams> {
  return finisher ? IMPACT_FINISHER : IMPACT_LIGHT;
}

/** A whiff: a soft puff of low-passed noise at the end of a swing that met nothing, quieter than any whoosh. */
export interface WhiffParams {
  cutoffHz: number;
  seconds: number;
  gain: number;
}
export const WHIFF: Readonly<WhiffParams> = { cutoffHz: 900, seconds: 0.12, gain: 0.18 };

/** The master gain the feel asks for: the volume, or 0 muted. */
export function masterGain(feel: { mute: boolean; volume: number }): number {
  return feel.mute ? 0 : Math.min(1, Math.max(0, feel.volume));
}

/** The quietest a gain envelope reaches: exponential ramps cannot reach 0. */
const SILENT = 1e-4;
/** Seconds of noise the noise buffer holds, enough for the longest sound, read from a random offset each time. */
export const NOISE_SECONDS = 1;
/** The seed the noise buffer is filled from, so every load and the offline renders sound alike. */
export const NOISE_SEED = 4411;

/** A small seeded generator (mulberry32), for the noise buffer. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One channel of seeded white noise, NOISE_SECONDS long, at the context's rate. */
export function makeNoiseBuffer(ctx: BaseAudioContext, seed = NOISE_SEED): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(NOISE_SECONDS * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seeded(seed);
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
  return buffer;
}

/** A noise source started `when`, read from `offset` seconds into the buffer, stopped `seconds` later. */
function noiseSource(ctx: BaseAudioContext, noise: AudioBuffer, when: number, seconds: number, offset: number): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.start(when, Math.max(0, Math.min(NOISE_SECONDS - seconds, offset)), seconds);
  return source;
}

/**
 * Schedules a whoosh at `when` on `ctx`'s clock into `out`: noise through a band-pass sweeping from startHz up to
 * peakHz at the peak and down to endHz as it dies away, its gain rising quietly through the first half of the wind-up,
 * then swelling to the peak at `rise` and falling away over `fall`. Returns when it ends.
 */
export function scheduleWhoosh(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, p: WhooshParams, when: number, offset = 0): number {
  const end = when + p.rise + p.fall;
  const source = noiseSource(ctx, noise, when, p.rise + p.fall, offset);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = p.q;
  band.frequency.setValueAtTime(p.startHz, when);
  band.frequency.exponentialRampToValueAtTime(p.peakHz, when + p.rise);
  band.frequency.exponentialRampToValueAtTime(p.endHz, end);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(SILENT, when);
  gain.gain.linearRampToValueAtTime(p.gain * WHOOSH_WINDUP_LEVEL, when + p.rise * 0.5);
  gain.gain.exponentialRampToValueAtTime(p.gain, when + p.rise);
  gain.gain.exponentialRampToValueAtTime(SILENT, end);
  source.connect(band).connect(gain).connect(out);
  return end;
}

/** A pitched voice falling from `fromHz` to `toHz` over `seconds` with a sharp attack and an exponential decay. */
function fallingTone(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, fromHz: number, toHz: number, seconds: number, peak: number, when: number): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(fromHz, when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), when + seconds);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(SILENT, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.004);
  gain.gain.exponentialRampToValueAtTime(SILENT, when + seconds);
  osc.connect(gain).connect(out);
  osc.start(when);
  osc.stop(when + seconds + 0.01);
}

/**
 * Schedules an impact at `when`: a triangle thunk falling in pitch, a square click through a high-pass for the metallic
 * transient, a band of noise for the crack, and on the finisher a sine sub falling under the thunk. Returns when it ends.
 */
export function scheduleImpact(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, p: Readonly<ImpactParams>, when: number, offset = 0.3): number {
  fallingTone(ctx, out, 'triangle', p.thunkFromHz, p.thunkToHz, p.thunkSeconds, p.thunkGain, when);
  const click = ctx.createGain();
  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 1500;
  high.connect(click).connect(out);
  click.gain.value = 1;
  fallingTone(ctx, high, 'square', p.clickHz, p.clickHz * 0.8, p.clickSeconds, p.clickGain, when);
  const source = noiseSource(ctx, noise, when, p.noiseSeconds, offset);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = p.noiseHz;
  band.Q.value = 0.8;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(p.noiseGain, when);
  gain.gain.exponentialRampToValueAtTime(SILENT, when + p.noiseSeconds);
  source.connect(band).connect(gain).connect(out);
  if (p.subGain > 0) fallingTone(ctx, out, 'sine', p.subFromHz, p.subToHz, p.thunkSeconds + 0.04, p.subGain, when);
  return when + Math.max(p.thunkSeconds + (p.subGain > 0 ? 0.04 : 0), p.noiseSeconds, p.clickSeconds);
}

/** Schedules a whiff at `when`: low-passed noise that swells and fades over its length. Returns when it ends. */
export function scheduleWhiff(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, p: Readonly<WhiffParams>, when: number, offset = 0.6): number {
  const source = noiseSource(ctx, noise, when, p.seconds, offset);
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = p.cutoffHz;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(SILENT, when);
  gain.gain.linearRampToValueAtTime(p.gain, when + p.seconds * 0.3);
  gain.gain.exponentialRampToValueAtTime(SILENT, when + p.seconds);
  source.connect(low).connect(gain).connect(out);
  return when + p.seconds;
}

/** The kinds of sound, as the reading counts them and the offline renders name them. */
export type SoundKind = 'whoosh' | 'impact' | 'whiff';

/** What the reading tells of the sounds. */
export interface SoundReading {
  /** The audio context's state, or 'locked' before the first gesture made one. */
  state: AudioContextState | 'locked';
  /** Whether a real gesture has unlocked the sounds. */
  unlocked: boolean;
  muted: boolean;
  /** The master gain applied now. */
  gain: number;
  /**
   * Sounds asked for since the gesture unlocked them, by kind; of those and any before it, the ones played, and the
   * ones skipped (locked, muted, or the context not running).
   */
  asked: Record<SoundKind, number>;
  played: Record<SoundKind, number>;
  skipped: Record<SoundKind, number>;
  /** Errors the audio device or renderer raised (each suspends the context, which the next frames try to resume). */
  deviceErrors: number;
}

export interface CombatSound {
  /** A swing begins: its whoosh, peaking near its strike. */
  whoosh(step: ComboStep, contract: HitContract): void;
  /** A hit connects: its impact, now. */
  impact(finisher: boolean): void;
  /** A swing ended having met nothing: the whiff, now. */
  whiff(step: ComboStep): void;
  /** Each frame: the master gain and the context's suspension follow the feel's volume and mute. */
  sync(): void;
  reading(): SoundReading;
}

/**
 * Frames between tries to resume a context the audio device suspended (an error from the device or the renderer, such as
 * an output unplugged): about a second at 60 fps, so a lost device is tried again without a try on every frame.
 */
export const RESUME_RETRY_FRAMES = 60;

/** What the sound engine reads and where it listens for the gesture; the context maker is swapped in tests. */
export interface CombatSoundOptions {
  feel: { mute: boolean; volume: number };
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  makeContext?: () => AudioContext;
}

/**
 * The page's combat sounds. Nothing is made until a trusted pointerdown or keydown reaches `target` (the window, in its
 * capture phase, so a key the panel swallows still counts): then the AudioContext is created with its master gain and
 * noise buffer and resumed. An event the page dispatched itself (isTrusted false) is not a gesture, and making a
 * context on one would draw Chromium's autoplay warning. Muted, the master gain is 0 and the context is suspended; the
 * sounds asked for meanwhile are skipped and counted.
 */
export function createCombatSound(o: CombatSoundOptions): CombatSound {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let suspendedForMute = false;
  let noiseOffset = 0;
  let deviceErrors = 0;
  let retryIn = 0;
  const asked: Record<SoundKind, number> = { whoosh: 0, impact: 0, whiff: 0 };
  const played: Record<SoundKind, number> = { whoosh: 0, impact: 0, whiff: 0 };
  const skipped: Record<SoundKind, number> = { whoosh: 0, impact: 0, whiff: 0 };

  const unlock = (event: Event): void => {
    if (!event.isTrusted) return;
    if (!ctx) {
      ctx = (o.makeContext ?? (() => new AudioContext()))();
      master = ctx.createGain();
      master.gain.value = masterGain(o.feel);
      master.connect(ctx.destination);
      noise = makeNoiseBuffer(ctx);
      // The device or the renderer failed and the context suspended itself: counted, and resumed from sync().
      ctx.addEventListener('error', () => {
        deviceErrors += 1;
        retryIn = 0;
      });
    }
    if (!o.feel.mute && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    if (ctx.state === 'running' || !o.feel.mute) {
      o.target.removeEventListener('pointerdown', unlock, true);
      o.target.removeEventListener('keydown', unlock, true);
    }
  };
  o.target.addEventListener('pointerdown', unlock, true);
  o.target.addEventListener('keydown', unlock, true);

  /** The context and its nodes when a sound may play now, or null (locked, not yet running, or muted). */
  const ready = (kind: SoundKind): { ctx: AudioContext; master: GainNode; noise: AudioBuffer } | null => {
    if (ctx) asked[kind] += 1;
    if (!ctx || !master || !noise || ctx.state !== 'running' || o.feel.mute) {
      skipped[kind] += 1;
      return null;
    }
    played[kind] += 1;
    // Each sound reads its noise from a fresh offset, so two whooshes in a row do not phase against each other.
    noiseOffset = (noiseOffset + 0.137) % (NOISE_SECONDS * 0.6);
    return { ctx, master, noise };
  };

  return {
    whoosh(step, contract) {
      const live = ready('whoosh');
      if (live) scheduleWhoosh(live.ctx, live.master, live.noise, whooshParams(step, contract), live.ctx.currentTime, noiseOffset);
    },
    impact(finisher) {
      const live = ready('impact');
      if (live) scheduleImpact(live.ctx, live.master, live.noise, impactParams(finisher), live.ctx.currentTime, noiseOffset);
    },
    whiff() {
      const live = ready('whiff');
      if (live) scheduleWhiff(live.ctx, live.master, live.noise, WHIFF, live.ctx.currentTime, noiseOffset);
    },
    sync() {
      if (!ctx || !master) return;
      const gain = masterGain(o.feel);
      if (master.gain.value !== gain) master.gain.value = gain;
      // Suspended once on mute. Unmuted, a suspended context is resumed at once and, while it stays suspended, tried
      // again every RESUME_RETRY_FRAMES frames: a resume can fail or hang under load, and the device can suspend the
      // context on its own (an error from it or its renderer). Resumed once only, an unmute that failed left the sounds
      // off for good (in the browser tests' parallel headless browsers it had not resumed after 30 s).
      if (o.feel.mute) {
        if (!suspendedForMute && ctx.state === 'running') {
          suspendedForMute = true;
          void ctx.suspend().catch(() => undefined);
        }
        return;
      }
      suspendedForMute = false;
      if (ctx.state !== 'suspended') {
        retryIn = 0;
        return;
      }
      retryIn -= 1;
      if (retryIn <= 0) {
        retryIn = RESUME_RETRY_FRAMES;
        void ctx.resume().catch(() => undefined);
      }
    },
    reading() {
      return {
        state: ctx ? ctx.state : 'locked',
        unlocked: ctx !== null,
        muted: o.feel.mute,
        gain: master ? master.gain.value : 0,
        asked: { ...asked },
        played: { ...played },
        skipped: { ...skipped },
        deviceErrors,
      };
    },
  };
}

/** How long each kind of sound lasts at most, in seconds, for an offline render with room for its tail. */
function renderSeconds(kind: SoundKind, step: ComboStep, contract: HitContract): number {
  if (kind === 'whoosh') {
    const p = whooshParams(step, contract);
    return p.rise + p.fall + 0.05;
  }
  return kind === 'impact' ? 0.3 : WHIFF.seconds + 0.05;
}

/**
 * Renders one sound offline, at full volume, and returns its samples: the evidence WAVs (docs/evidence/m1/
 * combat-sounds/). `impact` takes the finisher's for step 3 and a light hit's otherwise.
 */
export async function renderSound(kind: SoundKind, step: ComboStep, contract: HitContract, sampleRate = 22050): Promise<Float32Array> {
  const seconds = renderSeconds(kind, step, contract);
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const noise = makeNoiseBuffer(ctx);
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(ctx.destination);
  if (kind === 'whoosh') scheduleWhoosh(ctx, out, noise, whooshParams(step, contract), 0);
  else if (kind === 'impact') scheduleImpact(ctx, out, noise, impactParams(step === 3), 0);
  else scheduleWhiff(ctx, out, noise, WHIFF, 0);
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

/** Samples as a 16-bit mono PCM WAV file, each clipped to -1..1. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return bytes;
}
