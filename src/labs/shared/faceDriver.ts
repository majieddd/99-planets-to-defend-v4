import { Quaternion, Vector3, type Mesh, type Object3D, type ShaderMaterial, type Vector2 } from 'three';
import { copyDecalMaterial, decalCellOffset, type DecalAtlas } from '../../render/materials/painted';
import { Rng, seedRng } from '../../sim/rng';

/**
 * A commander's face in the labs: an automatic blink and held expressions, written to the face morphs and the jaw bone,
 * or to the expression decals of an anime face, whose expressions are cells of an atlas (docs/blueprint.md, Kit,
 * Expression atlases). A face may have either kind or both, and the driver finds which from the rig. It is render and
 * lab code, driven by the lab's frame delta; the simulation knows nothing of faces. Its numbers have rows in
 * docs/blueprint.md (Numbers, Face driver).
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

/** The eye states a decal face can hold, each a cell its eyes atlas names. */
export const EYE_STATES = ['open', 'half', 'closed', 'happy'] as const;
export type EyeState = (typeof EYE_STATES)[number];
/** The mouth states a decal face can hold, each a cell its mouth atlas names. */
export const MOUTH_STATES = ['neutral', 'smile', 'talk', 'o'] as const;
export type MouthState = (typeof MOUTH_STATES)[number];

/**
 * A decal face blinks through its eye cells on the morph lids' own closure curve, so both kinds of face keep one timing:
 * open while the lids would be under a quarter closed, half from there to three quarters, closed beyond. The half cell
 * then lasts 20.8 ms on the way down and 31.3 ms on the way up (the smoothstep crosses 0.25 and 0.75 at 0.326 and 0.674
 * of each phase), both longer than a 60 Hz frame, so every blink drawn at 60 fps shows open, half, closed, half, open.
 * Split in thirds, the half cell would last 13.6 ms on the way down and fall between two frames at 31 of 167 frame
 * phases (checked every 0.1 ms).
 */
export const DECAL_HALF_CLOSURE = 0.25;
export const DECAL_CLOSED_CLOSURE = 0.75;
/**
 * While talking, the mouth alternates its talk and neutral cells this often: four open-and-shut cycles a second, near
 * the four to five syllables a second of conversational speech, and each cell held three frames of an anime's 24 a
 * second, the lip flap drawn on threes.
 */
export const TALK_FLAP_SECONDS = 0.125;

/** An expression decal the driver moves: the mesh, its atlas, and the cell offset its own material reads. */
export interface FaceDecal {
  mesh: Mesh;
  atlas: DecalAtlas;
  offset: Vector2;
}

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
  /** The expression decals painted by the loader (assets/loadAsset.ts), eyes and mouth, in the rig's order. */
  readonly decals: FaceDecal[] = [];
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
  private heldEyes: EyeState = 'open';
  private heldMouth: MouthState = 'neutral';
  private talking = false;
  private talkClock = 0;

  constructor(root: Object3D, options: FaceDriverOptions) {
    this.random = options.random;
    this.jawAxis = (options.jawAxis ?? new Vector3(1, 0, 0)).clone().normalize();
    const names: readonly string[] = [...BLINK_MORPHS, ...EXPRESSION_MORPHS];
    root.traverse((object) => {
      const dictionary = (object as Mesh).morphTargetDictionary;
      if (dictionary && names.some((name) => name in dictionary)) this.meshes.push(object as Mesh);
      this.adoptDecal(object as Mesh);
    });
    this.jaw = root.getObjectByName(JAW_BONE_NAME) ?? null;
    if (this.jaw) this.jawRest.copy(this.jaw.quaternion);
    this.untilBlink = this.nextInterval();
    // The decals open on the held states, open eyes and a neutral mouth, whichever cells the atlas gives them.
    this.applyDecals();
  }

  /** Whether the root carries anything this driver moves. */
  get hasFace(): boolean {
    return this.meshes.length > 0 || this.decals.length > 0 || this.jaw !== null;
  }

  /** Which kind of face the rig has: morphs (Pip-A), expression decals (the anime head), both, or neither. */
  get faceKind(): 'morph' | 'decal' | 'both' | null {
    if (this.meshes.length > 0) return this.decals.length > 0 ? 'both' : 'morph';
    return this.decals.length > 0 ? 'decal' : null;
  }

  /** How closed the lids are now, from 0 (open) to 1 (shut): the held weight while one is held, else the auto-blink's. */
  get blink(): number {
    return this.blinkHold ?? this.closure;
  }

  /**
   * The eye state a decal face shows now. Open eyes blink: the lids' closure, the auto-blink's or a held one, steps
   * them through half and closed (DECAL_HALF_CLOSURE). Any other held state holds, since a blink over happy or closed
   * eyes would flash them open, and a blink from half would read as a flicker.
   */
  get eyes(): EyeState {
    if (this.heldEyes !== 'open') return this.heldEyes;
    const lids = this.blink;
    return lids >= DECAL_CLOSED_CLOSURE ? 'closed' : lids >= DECAL_HALF_CLOSURE ? 'half' : 'open';
  }

  /** The mouth state a decal face shows now: the held one, or while talking, talk and neutral in turn from talk. */
  get mouth(): MouthState {
    if (!this.talking) return this.heldMouth;
    return Math.floor(this.talkClock / TALK_FLAP_SECONDS) % 2 === 0 ? 'talk' : 'neutral';
  }

  /**
   * Holds the eye decals at a state until it is set again; open hands them back to the blink. Like an expression, it
   * applies at once, frozen or not. A state that is not an eye state, or that no eye decal's atlas names, is refused
   * with a warning and the eyes stay as they were; the return says whether it was taken.
   */
  setEyes(state: EyeState): boolean {
    if (!this.accepts('eyes', state, EYE_STATES)) return false;
    this.heldEyes = state;
    this.applyDecals();
    return true;
  }

  /** Holds the mouth decal at a state until it is set again, on the terms setEyes keeps. Talking overrides it. */
  setMouth(state: MouthState): boolean {
    if (!this.accepts('mouth', state, MOUTH_STATES)) return false;
    this.heldMouth = state;
    this.applyDecals();
    return true;
  }

  /**
   * Starts or stops the talk cycle: talk and neutral in turn, TALK_FLAP_SECONDS each, from talk, while it is on, and the
   * held mouth again when it stops. It advances with update, so a frozen face holds its mouth mid-cycle.
   */
  setTalking(on: boolean): void {
    if (on && !this.talking) {
      this.talkClock = 0;
      if (!this.decals.some((decal) => decal.atlas.role === 'mouth' && decal.atlas.states.includes('talk'))) {
        console.warn('face: no mouth decal has a cell named "talk", so talking shows nothing');
      }
    }
    this.talking = on;
    this.applyDecals();
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
    if (this.talking) this.talkClock += deltaSeconds;
    this.apply();
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.elapsed = 0;
  }

  private nextInterval(): number {
    return BLINK_INTERVAL_MIN_SECONDS + (BLINK_INTERVAL_MAX_SECONDS - BLINK_INTERVAL_MIN_SECONDS) * this.random();
  }

  /**
   * Takes a mesh the loader painted as a decal into the driver, first giving it a material of its own if it shares its
   * source's: a clone of a rig (SkeletonUtils.clone) keeps the source's materials, and each face must hold its own cell
   * offset or every instance would show one expression and blink together. A decal that was never painted carries no
   * atlas on its material and is left alone.
   */
  private adoptDecal(mesh: Mesh): void {
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const material = mesh.material as ShaderMaterial;
    const atlas = material.userData['decalAtlas'] as DecalAtlas | undefined;
    if (!atlas) return;
    if (material.userData['decalOwner'] !== mesh.uuid) {
      const own = copyDecalMaterial(material);
      own.userData['decalOwner'] = mesh.uuid;
      mesh.material = own;
    }
    const offset = (mesh.material as ShaderMaterial).uniforms['uCellOffset']?.value as Vector2;
    this.decals.push({ mesh, atlas, offset });
  }

  private accepts(role: 'eyes' | 'mouth', state: string, known: readonly string[]): boolean {
    const [feature, stays] = role === 'eyes' ? ['eye', 'the eyes stay as they were'] : ['mouth', 'the mouth stays as it was'];
    if (!known.includes(state)) {
      console.warn(`face: "${state}" is not ${feature === 'eye' ? 'an' : 'a'} ${feature} state (${known.join(', ')}), so ${stays}`);
      return false;
    }
    if (!this.decals.some((decal) => decal.atlas.role === role && decal.atlas.states.includes(state))) {
      console.warn(`face: no ${feature} decal has a cell named "${state}", so ${stays}`);
      return false;
    }
    return true;
  }

  /**
   * Moves each decal to its feature's state's cell. A state its atlas lacks, a blink's half on an atlas with only open
   * and closed or talking without a talk cell, shows the held state instead, and a decal whose atlas names neither stays
   * where it is.
   */
  private applyDecals(): void {
    if (this.decals.length === 0) return;
    const now = { eyes: this.eyes, mouth: this.mouth };
    const held = { eyes: this.heldEyes, mouth: this.heldMouth };
    for (const { atlas, offset } of this.decals) {
      if (atlas.role === null) continue;
      let cell = atlas.states.indexOf(now[atlas.role]);
      if (cell < 0) cell = atlas.states.indexOf(held[atlas.role]);
      if (cell >= 0) decalCellOffset(atlas, cell, offset);
    }
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
    this.applyDecals();
  }
}
