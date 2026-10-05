import { Quaternion, Vector3, type Mesh, type Object3D } from 'three';
import { Rng, seedRng } from '../../sim/rng';

/**
 * A commander's face in the labs: an automatic blink and held expressions, written to the face morphs and the jaw bone.
 * It is render and lab code, driven by the lab's frame delta; the simulation knows nothing of faces. Its numbers have
 * rows in docs/blueprint.md (Numbers, Face driver).
 */

/** The lids, which blink together. */
export const BLINK_MORPHS = ['blink_L', 'blink_R'] as const;
/** The expressions a lab can hold for a demo. */
export const EXPRESSION_MORPHS = ['smile', 'brows_up', 'pucker'] as const;
export type Expression = (typeof EXPRESSION_MORPHS)[number];

/**
 * The wait between blinks is drawn evenly from this range, so the face never settles into a metronome; people at rest
 * blink every few seconds, and a slower rate reads as a stare on a face this close to the camera.
 */
export const BLINK_INTERVAL_MIN_SECONDS = 2.5;
export const BLINK_INTERVAL_MAX_SECONDS = 5;
/** A lid closes quickly and opens more slowly, 150 ms in all, inside a real blink's 100 to 400 ms. */
export const BLINK_CLOSE_SECONDS = 0.06;
export const BLINK_OPEN_SECONDS = 0.09;
/** Now and then a blink comes twice, this short gap apart, which reads as life rather than a timer. */
export const DOUBLE_BLINK_CHANCE = 0.2;
export const DOUBLE_BLINK_GAP_SECONDS = 0.1;
/** How far the jaw bone turns at a jaw of 1: a mouth open to speak, not a yawn. */
export const JAW_OPEN_MAX_DEG = 14;
/** The jaw bone's node name in the commander's GLB. */
export const JAW_BONE_NAME = 'jaw';

export interface FaceDriverOptions {
  /** Draws from 0 (inclusive) to 1 (exclusive); inject one for reproducible timing. */
  random: () => number;
  /** The axis, in the jaw bone's own frame, about which it opens; the commander's rig decides it. */
  jawAxis?: Vector3;
}

/** A reproducible draw for the driver from one seed, on the simulation's generator so labs share one RNG kind. */
export function seededFaceRandom(seed: number): () => number {
  const rng = new Rng(seedRng(seed));
  return () => rng.next();
}

type Phase = 'wait' | 'close' | 'open' | 'gap';

const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

export class FaceDriver {
  /** The meshes that carry any face morph: the body, and its hull, which shares the body's influences anyway. */
  readonly meshes: Mesh[] = [];
  readonly jaw: Object3D | null;
  private readonly random: () => number;
  private readonly jawAxis: Vector3;
  private readonly jawRest = new Quaternion();
  private readonly jawTurn = new Quaternion();
  private readonly held: Record<Expression, number> = { smile: 0, brows_up: 0, pucker: 0 };
  private jawOpen = 0;
  private phase: Phase = 'wait';
  private elapsed = 0;
  private untilBlink: number;
  private doublePending = false;
  private frozen = false;
  private closure = 0;
  private blinkHold: number | null = null;

  constructor(root: Object3D, options: FaceDriverOptions) {
    this.random = options.random;
    this.jawAxis = (options.jawAxis ?? new Vector3(1, 0, 0)).clone().normalize();
    const names: readonly string[] = [...BLINK_MORPHS, ...EXPRESSION_MORPHS];
    root.traverse((object) => {
      const dictionary = (object as Mesh).morphTargetDictionary;
      if (dictionary && names.some((name) => name in dictionary)) this.meshes.push(object as Mesh);
    });
    this.jaw = root.getObjectByName(JAW_BONE_NAME) ?? null;
    if (this.jaw) this.jawRest.copy(this.jaw.quaternion);
    this.untilBlink = this.nextInterval();
  }

  /** Whether the root carries anything this driver moves. */
  get hasFace(): boolean {
    return this.meshes.length > 0 || this.jaw !== null;
  }

  /** How closed the lids are now, from 0 (open) to 1 (shut): the held weight while one is held, else the auto-blink's. */
  get blink(): number {
    return this.blinkHold ?? this.closure;
  }

  /**
   * Holds both lids at a weight from 0 to 1, so a frozen evidence frame can show a closed lid, or with null hands them
   * back to the auto-blink, whose timing ran on underneath. Like an expression, it applies at once, frozen or not.
   */
  setBlinkHold(weight: number | null): void {
    this.blinkHold = weight === null ? null : clamp01(weight);
    this.apply();
  }

  /**
   * Holds the face while the lab is frozen, mid-blink included, so a frozen frame is the same frame on every load. The
   * labs already pass a delta of 0 while frozen; this holds the face against any other caller too.
   */
  setFrozen(on: boolean): void {
    this.frozen = on;
  }

  /** Holds an expression at a weight from 0 to 1 until it is set again. Like a dial, it applies at once, frozen or not. */
  setExpression(name: Expression, weight: number): void {
    this.held[name] = clamp01(weight);
    this.apply();
  }

  /** Opens the jaw bone, if the rig has one, from 0 (rest) to 1 (JAW_OPEN_MAX_DEG about the jaw axis). */
  setJaw(open: number): void {
    this.jawOpen = clamp01(open);
    this.apply();
  }

  /**
   * Advances the blink by the lab's frame delta, in seconds, and writes the face. A long delta runs through every phase
   * it spans, so the timing does not depend on the frame rate. Call it after the animation mixer, which would otherwise
   * overwrite the face with any morph or jaw track its clips carry.
   */
  update(deltaSeconds: number): void {
    if (this.frozen || !(deltaSeconds > 0)) return;
    let remaining = deltaSeconds;
    while (remaining > 0) {
      if (this.phase === 'wait') {
        if (remaining < this.untilBlink) {
          this.untilBlink -= remaining;
          remaining = 0;
        } else {
          remaining -= this.untilBlink;
          this.doublePending = this.random() < DOUBLE_BLINK_CHANCE;
          this.enter('close');
        }
        continue;
      }
      const length = this.phase === 'close' ? BLINK_CLOSE_SECONDS : this.phase === 'open' ? BLINK_OPEN_SECONDS : DOUBLE_BLINK_GAP_SECONDS;
      const left = length - this.elapsed;
      if (remaining < left) {
        this.elapsed += remaining;
        remaining = 0;
        continue;
      }
      remaining -= left;
      if (this.phase === 'close') this.enter('open');
      else if (this.phase === 'gap') this.enter('close');
      else if (this.doublePending) {
        // The second blink of a pair is never followed by a third.
        this.doublePending = false;
        this.enter('gap');
      } else {
        this.untilBlink = this.nextInterval();
        this.enter('wait');
      }
    }
    this.closure = this.phase === 'close' ? smooth(this.elapsed / BLINK_CLOSE_SECONDS) : this.phase === 'open' ? 1 - smooth(this.elapsed / BLINK_OPEN_SECONDS) : 0;
    this.apply();
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.elapsed = 0;
  }

  private nextInterval(): number {
    return BLINK_INTERVAL_MIN_SECONDS + (BLINK_INTERVAL_MAX_SECONDS - BLINK_INTERVAL_MIN_SECONDS) * this.random();
  }

  private apply(): void {
    const lids = this.blink;
    for (const mesh of this.meshes) {
      const dictionary = mesh.morphTargetDictionary as Record<string, number>;
      const influences = mesh.morphTargetInfluences as number[];
      for (const name of BLINK_MORPHS) {
        const index = dictionary[name];
        if (index !== undefined) influences[index] = lids;
      }
      for (const name of EXPRESSION_MORPHS) {
        const index = dictionary[name];
        if (index !== undefined) influences[index] = this.held[name];
      }
    }
    if (this.jaw) {
      const angle = (this.jawOpen * JAW_OPEN_MAX_DEG * Math.PI) / 180;
      this.jaw.quaternion.copy(this.jawRest).multiply(this.jawTurn.setFromAxisAngle(this.jawAxis, angle));
    }
  }
}
