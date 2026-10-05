import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  MaxEquation,
  Mesh,
  OneFactor,
  ShaderMaterial,
  SrcColorFactor,
  ZeroFactor,
  type IUniform,
  type Object3D,
  type Texture,
  type Vector3,
} from 'three';
import { LAYERS } from '../../render/layers';
import { ENERGY_OUTPUT, energyDefines, PLAYER_ENERGY, useEnergyBlending } from '../shared/energy';
import type { HitContract } from './combo';

/**
 * Play Pip (prototype)'s sword trail: one solid crescent of cyan energy along the blade's arc, the clearest single read
 * that a swing happened (the owner's reference is Link's sword in Tears of the Kingdom). It is widest and brightest where
 * the blade is now, tapers to a point at its tail, carries a bright core band along the tip's edge, and breaks into
 * brushwork only on its fading tail, so it reads as painted energy rather than a neon smear. Its history is a fixed ring
 * of blade samples (TrailBuffer) and its mesh a strip written from them into buffers made once, so a frame of the trail
 * builds nothing.
 *
 * It replaced a short grey-cyan wisp the reviewer found faint and pale: it covered only the blade's outer part (a
 * smoothstep from 0.12 to 0.8 of the way out), its shade fell as the square of its age, dry brush took its thin paint
 * everywhere, its body was keyed at 0.66, under the bloom's threshold, it kept 0.09 s of arc and sampled only the 0.13 s
 * active frames, and the ink and fog passes drew over it (render/post/energyPass.ts says how that was fixed).
 */

/**
 * The most a stroke may span, in seconds: the length slider's top (COMBAT_FEEL_RANGES.trailLength), and the fastest a
 * display may draw it, frames a second: a frame adds a sample at least, however short the blade's travel.
 */
export const TRAIL_LENGTH_MAX = 0.2;
export const TRAIL_FPS_MAX = 240;
/** The blade tip's fastest, metres a second: the finisher's peak of 64 m/s in Pip's sidecar, rounded up. */
export const TRAIL_TIP_SPEED_MAX = 65;
/**
 * A fast arc is subsampled between frames so the ribbon curves rather than breaking into straight chords: a sample
 * every TRAIL_SUBSAMPLE_M of the tip's travel, at most TRAIL_SUBSAMPLES_MAX in a frame. The finisher's tip moves up to
 * 64 m/s, about a metre a frame at 60 fps and 3.2 m at the labs' 1/20 s step, so 10 samples a frame keep its chords to
 * 0.1 m at 60 fps.
 */
export const TRAIL_SUBSAMPLE_M = 0.1;
export const TRAIL_SUBSAMPLES_MAX = 10;
/**
 * The most blade samples the ring holds: a stroke of TRAIL_LENGTH_MAX at the tip's fastest takes one sample each
 * TRAIL_SUBSAMPLE_M of its travel plus at most one more a frame (the subsampling rounds up), and at TRAIL_FPS_MAX
 * frames a second that is 0.2 x (650 + 240) = 178, plus the frame before's pose the stroke starts from. It was 128, a
 * 0.2 s trail at 60 fps, and a 0.2 s trail at 144 Hz needed about 145 (the ring then dropped the stroke's tail early).
 */
export const TRAIL_CAPACITY = Math.ceil(TRAIL_LENGTH_MAX * (TRAIL_TIP_SPEED_MAX / TRAIL_SUBSAMPLE_M + TRAIL_FPS_MAX)) + 1;
/**
 * When a hit's stroke takes samples: from TRAIL_EMIT_LEAD before its active frames, the late wind-up, where the hand-keyed
 * hits' coil has peaked and the blade sets off forward (their keys 3 frames before each strike), through TRAIL_EMIT_TAIL
 * after them, the early recovery, and never past the hit's cancel point, where the next hit takes over. Only the active
 * frames took samples, so the crescent began where the cut was already half done.
 */
export const TRAIL_EMIT_LEAD = 0.04;
export const TRAIL_EMIT_TAIL = 0.04;
/**
 * Metres of the tip's arc one tile of the brush atlas spans along the ribbon, and tiles across it: the atlas is drawn out
 * along the arc, so its strokes lie the way the blade moved, and it rides the arc, so a stroke stays put as it fades.
 */
export const TRAIL_BRUSH_TILE_M = 3;
export const TRAIL_BRUSH_ACROSS = 1.2;
/**
 * The emissive keys: TRAIL_CORE_KEY on the core band along the tip's edge and TRAIL_BODY_KEY on the crescent's body,
 * both over the bloom's locked threshold of 1.0 and its 0.25 ramp, so the whole crescent blooms and the core blooms most
 * (the key in alpha tops out at EMISSIVE_KEY_RANGE, 4). The body was keyed at 0.66, under the threshold, so only a thin
 * core glowed and the stroke read as a pale wisp.
 */
export const TRAIL_CORE_KEY = 3.4;
export const TRAIL_BODY_KEY = 1.6;
/**
 * The core band: the outer TRAIL_CORE_SHARE of the crescent's width at its widest, tapering in toward the tip's edge,
 * and the most white it mixes into the cyan there (TRAIL_CORE_WHITE): a little, at the head, so the band reads hot while
 * the crescent keeps its colour; the old ribbon mixed in 0.4 and read white-grey.
 */
export const TRAIL_CORE_SHARE = 0.35;
export const TRAIL_CORE_WHITE = 0.25;
/**
 * The light the crescent's body adds, as a share of the core's: energy's light is capped at EMISSIVE_PEAK whatever its
 * key, so at one strength the body and the core read alike and no band showed; at this share the core along the tip's
 * edge is the brightest line of the stroke while the body still blooms on its own key.
 */
export const TRAIL_BODY_LIGHT = 0.45;
/**
 * The share of the stroke's age past which its paint breaks into the brush atlas's strokes, rising to the tail: the head
 * and the body stay solid, and the fading tail turns to dry brush, which keeps it painted energy.
 */
export const TRAIL_BRUSH_FROM = 0.4;
/**
 * The pigment the ribbon lays down before its light, and how much of it: the frame under the stroke is multiplied toward
 * this cyan by up to this share. Light alone only brightens, and over the warm sky and the sunlit meadow a cyan glow
 * added to them read as a pale white sheet; taking out the red under it first, as a glaze would, keeps the stroke cyan
 * over any ground, and dark ground (the Husk's chitin) barely changes, so there the glow reads as before. A solid crescent
 * needs a deeper glaze than the old wisp's (#46d8f5 at 0.6): over the warm sky that left the sky's red under the light,
 * and the stroke read pale cyan-grey.
 */
export const TRAIL_TINT = '#06486e';
export const TRAIL_TINT_SHARE = 1;

/**
 * Whether a hit's stroke takes samples at `time` into it (TRAIL_EMIT_LEAD and TRAIL_EMIT_TAIL say when). Contracts with
 * other numbers move it with their active frames and cancel.
 */
export function trailEmitting(contract: HitContract, time: number): boolean {
  const end = Math.min(contract.activeTo + TRAIL_EMIT_TAIL, contract.cancel ?? contract.duration);
  return time >= contract.activeFrom - TRAIL_EMIT_LEAD && time < end;
}

/**
 * The trail's history: base and tip points with the combo clock's time each was taken at, in a ring that keeps the
 * newest TRAIL_CAPACITY. Arrays made once; push and trim move indices only.
 */
export class TrailBuffer {
  readonly capacity: number;
  readonly base: Float32Array;
  readonly tip: Float32Array;
  readonly time: Float64Array;
  /** Metres of the tip's arc from the stroke's start to each sample, for the brush along the ribbon. */
  readonly arc: Float32Array;
  private head = 0;
  private size = 0;

  constructor(capacity = TRAIL_CAPACITY) {
    this.capacity = capacity;
    this.base = new Float32Array(capacity * 3);
    this.tip = new Float32Array(capacity * 3);
    this.time = new Float64Array(capacity);
    this.arc = new Float32Array(capacity);
  }

  get count(): number {
    return this.size;
  }

  /** The ring's slot of the i-th oldest sample. */
  slot(i: number): number {
    return (this.head - this.size + i + this.capacity * 2) % this.capacity;
  }

  clear(): void {
    this.size = 0;
  }

  push(bx: number, by: number, bz: number, tx: number, ty: number, tz: number, time: number): void {
    const s = this.head;
    let arc = 0;
    if (this.size > 0) {
      const p = this.slot(this.size - 1);
      arc = this.arc[p]! + Math.hypot(tx - this.tip[p * 3]!, ty - this.tip[p * 3 + 1]!, tz - this.tip[p * 3 + 2]!);
    }
    this.base[s * 3] = bx;
    this.base[s * 3 + 1] = by;
    this.base[s * 3 + 2] = bz;
    this.tip[s * 3] = tx;
    this.tip[s * 3 + 1] = ty;
    this.tip[s * 3 + 2] = tz;
    this.time[s] = time;
    this.arc[s] = arc;
    this.head = (this.head + 1) % this.capacity;
    this.size = Math.min(this.capacity, this.size + 1);
  }

  /** Drops the samples taken more than `maxAge` seconds before `now`, oldest first. */
  trim(now: number, maxAge: number): void {
    while (this.size > 0 && now - this.time[this.slot(0)]! > maxAge) this.size -= 1;
  }
}

/** A blade pose: base and tip, as three numbers each. */
interface BladePoint {
  bx: number;
  by: number;
  bz: number;
  tx: number;
  ty: number;
  tz: number;
}

/**
 * The value at s of the cubic Hermite from p1 (the last pose) to p2 (now), its tangent at p1 the Catmull-Rom one from the
 * pose before, p0, and at p2 the last frame's move, both in units of the segment.
 */
function arcAt(p0: number, p1: number, p2: number, s: number): number {
  const m1 = (p2 - p0) / 2;
  const m2 = p2 - p1;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p1 + (s3 - 2 * s2 + s) * m1 + (-2 * s3 + 3 * s2) * p2 + (s3 - s2) * m2;
}

/** What the reading tells of the trail. */
export interface TrailReading {
  /** Samples the ribbon holds now. */
  points: number;
  /** The brightest a sample of it is drawn, from 0 (gone) to 1. */
  alpha: number;
  /** Whether it is taking samples (from the late wind-up through the early recovery, trailEmitting). */
  emitting: boolean;
}

/** A sample's age as a share of the stroke's length, from 0 at the blade to 1 at the tail. */
export function trailAgeShare(age: number, lengthSeconds: number): number {
  return Math.min(1, Math.max(0, age / Math.max(1e-3, lengthSeconds)));
}

/**
 * The share of the blade, from its tip inward, the crescent covers at a sample `share` of the way along its length
 * (trailAgeShare): `width` of the blade at the blade (the head), falling in a straight line to a point at the tail.
 */
export function crescentWidth(share: number, width: number): number {
  return Math.max(0, Math.min(1, width)) * (1 - share);
}

/** The trail's stepping, apart from three: the buffer, the stroke's fade, and how each frame adds and drops samples. */
export class TrailStroke {
  readonly buffer: TrailBuffer;
  /** The stroke's fade once it stops taking samples, 1 while it takes them, down to 0 over the fade time. */
  fade = 0;
  emitting = false;
  private now = 0;
  private readonly last: BladePoint = { bx: 0, by: 0, bz: 0, tx: 0, ty: 0, tz: 0 };
  private readonly before: BladePoint = { bx: 0, by: 0, bz: 0, tx: 0, ty: 0, tz: 0 };
  /** How many blade poses the stroke has seen in a row, up to 2: the Hermite reads the last two. */
  private seen = 0;

  constructor(capacity = TRAIL_CAPACITY) {
    this.buffer = new TrailBuffer(capacity);
  }

  /** The combo clock's time the stroke has reached. */
  get time(): number {
    return this.now;
  }

  /** Forgets the stroke and its history: a reset, a respawn, or leaving play. */
  clear(): void {
    this.buffer.clear();
    this.fade = 0;
    this.emitting = false;
    this.seen = 0;
  }

  /**
   * One frame: `dt` of the combo's clock (0 in a hit-stop, so the stroke holds as the hit does), the blade where it is
   * drawn now, and whether the hit's stroke takes samples (trailEmitting). A stroke starts afresh on its first emitting
   * frame, from the pose the blade had on the frame before, so it spans the whole arc and never joins the last hit's
   * tail; while emitting it adds the frame's arc, subsampled; after, it fades over `fadeSeconds` and is cleared at 0.
   * Samples older than `lengthSeconds` drop off its tail.
   */
  step(dt: number, base: Vector3, tip: Vector3, active: boolean, lengthSeconds: number, fadeSeconds: number): void {
    this.now += Math.max(0, dt);
    if (active && !this.emitting) {
      this.buffer.clear();
      if (this.seen > 0) this.buffer.push(this.last.bx, this.last.by, this.last.bz, this.last.tx, this.last.ty, this.last.tz, this.now - dt);
    }
    this.emitting = active;
    if (active) {
      this.fade = 1;
      if (dt > 0 || this.buffer.count === 0) this.addArc(base, tip);
    } else if (this.fade > 0) {
      this.fade = fadeSeconds > 0 ? Math.max(0, this.fade - dt / fadeSeconds) : 0;
      if (this.fade === 0) this.buffer.clear();
    }
    this.buffer.trim(this.now, Math.max(1e-3, lengthSeconds));
    if (dt > 0 || this.seen === 0) {
      if (this.seen > 0) Object.assign(this.before, this.last);
      this.last.bx = base.x;
      this.last.by = base.y;
      this.last.bz = base.z;
      this.last.tx = tip.x;
      this.last.ty = tip.y;
      this.last.tz = tip.z;
      this.seen = Math.min(2, this.seen + 1);
    }
  }

  /**
   * Adds the arc from the last sample to the blade's pose now, subsampled along a Hermite through the last two poses
   * (the tangent at the last pose from the one before it and now, at now from the last frame's move), so a fast cut
   * curves. With no earlier pose it adds the pose alone.
   */
  private addArc(base: Vector3, tip: Vector3): void {
    const b = this.buffer;
    if (b.count === 0 || this.seen === 0) {
      b.push(base.x, base.y, base.z, tip.x, tip.y, tip.z, this.now);
      return;
    }
    const p = this.last;
    const q = this.seen > 1 ? this.before : this.last;
    const travel = Math.hypot(tip.x - p.tx, tip.y - p.ty, tip.z - p.tz);
    const steps = Math.max(1, Math.min(TRAIL_SUBSAMPLES_MAX, Math.ceil(travel / TRAIL_SUBSAMPLE_M)));
    const t0 = b.time[b.slot(b.count - 1)]!;
    for (let i = 1; i <= steps; i++) {
      const s = i / steps;
      b.push(
        arcAt(q.bx, p.bx, base.x, s),
        arcAt(q.by, p.by, base.y, s),
        arcAt(q.bz, p.bz, base.z, s),
        arcAt(q.tx, p.tx, tip.x, s),
        arcAt(q.ty, p.ty, tip.y, s),
        arcAt(q.tz, p.tz, tip.z, s),
        t0 + (this.now - t0) * s,
      );
    }
  }

  /**
   * How bright a sample `age` seconds old is drawn: an ease out along the crescent, 1 - share squared, so its body
   * stays bright and only the tail falls away, times the stroke's fade. It fell as the square of what was left
   * ((1 - share) squared), so half way along a sample was a quarter as bright and the stroke read as a short wisp.
   */
  shade(age: number, lengthSeconds: number): number {
    const share = trailAgeShare(age, lengthSeconds);
    return (1 - share * share) * this.fade;
  }

  reading(lengthSeconds: number): TrailReading {
    const b = this.buffer;
    let alpha = 0;
    for (let i = 0; i < b.count; i++) alpha = Math.max(alpha, this.shade(this.now - b.time[b.slot(i)]!, lengthSeconds));
    return { points: b.count, alpha, emitting: this.emitting };
  }
}

const vertexShader = /* glsl */ `
attribute float aEdge;
attribute float aShade;
attribute float aAge;
attribute float aStroke;
varying float vEdge;
varying float vShade;
varying float vAge;
varying float vStroke;
void main() {
  vEdge = aEdge;
  vShade = aShade;
  vAge = aAge;
  vStroke = aStroke;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The crescent's shape, which both passes read: its paint at this pixel, and its core band. */
const TRAIL_SHAPE = /* glsl */ `
uniform sampler2D uBrush;
uniform float uBrushTile;
uniform float uBrushAcross;
uniform float uCoreShare;
uniform float uBrushFrom;
varying float vEdge;
varying float vShade;
varying float vAge;
varying float vStroke;
float trailShape(out float core) {
  // Across the crescent, from its inner edge (0), which the strip already tapers in toward the tip along its tail, to
  // the tip's edge (1): solid over its whole width, softening only at the inner edge, with a crisp outer edge, and the
  // core band along the tip's edge, its width a share of the crescent's.
  float body = smoothstep(0.0, 0.3, vEdge) * (1.0 - smoothstep(0.97, 1.0, vEdge));
  core = smoothstep(1.0 - uCoreShare, 1.0 - uCoreShare * 0.35, vEdge) * (1.0 - smoothstep(0.985, 1.0, vEdge));
  float paint = max(body, core) * vShade;
  // Dry brush on the fading tail alone: from uBrushFrom of the stroke's age the paint breaks into the brush atlas's
  // strokes, more toward the tail, so the head and the body stay one solid stroke and the tail reads as brushwork.
  float tail = smoothstep(uBrushFrom, 1.0, vAge);
  float brush = texture2D(uBrush, vec2(vStroke / uBrushTile, vEdge * uBrushAcross)).r;
  float threshold = tail;
  return paint * mix(1.0, smoothstep(threshold - 0.1, threshold + 0.1, brush), tail);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uBodyKey;
uniform float uCoreKey;
uniform float uCoreWhite;
uniform float uBodyLight;
uniform float uBrightness;
${TRAIL_SHAPE}
${ENERGY_OUTPUT}
void main() {
  float core;
  float shape = trailShape(core);
  float key = uBrightness * shape * mix(uBodyKey, uCoreKey, core);
  vec3 hue = mix(uColor, vec3(1.0), uCoreWhite * core * vShade);
  vec4 light = energyOut(hue, key);
  light.rgb *= mix(uBodyLight, 1.0, core);
  gl_FragColor = light;
}
`;

/** The glaze under the light: multiplies the frame toward the pigment where the stroke lies; writes no key. */
const tintShader = /* glsl */ `
uniform vec3 uTint;
uniform float uTintShare;
${TRAIL_SHAPE}
void main() {
  float core;
  float shape = trailShape(core);
  gl_FragColor = vec4(mix(vec3(1.0), uTint, shape * uTintShare), 0.0);
}
`;

/** The crescent's look, the combat feel's `trailWidth` and `trailBrightness` (labs/world/combatFeel.ts). */
export interface TrailLook {
  /** The share of the blade, from its tip inward, the crescent covers at the blade (crescentWidth). */
  width: number;
  /** A multiple of its emissive keys. */
  brightness: number;
}

/** The sword trail's meshes, its light and its glaze over one strip of its ring of samples, with the stroke stepping it. */
export interface SwordTrail {
  readonly mesh: Mesh;
  readonly glaze: Mesh;
  readonly stroke: TrailStroke;
  /** Steps the stroke (TrailStroke.step) and rewrites the strip from it in the look given. */
  update(dt: number, base: Vector3, tip: Vector3, active: boolean, lengthSeconds: number, fadeSeconds: number, look: TrailLook): void;
  clear(): void;
  dispose(): void;
}

/**
 * The trail's mesh under `parent`, in world space: a strip of two vertices per sample, written each frame into
 * attributes made once (positions, the side across the crescent, the shade, the age and the brush coordinate along it)
 * with a fixed index of the whole strip, drawn as far as the samples reach. Its tip vertex rides the blade's tip; its
 * inner vertex lies on the blade, crescentWidth of the way in from the tip by the sample's age, so the strip is widest at
 * the blade and comes to a point at the tail (it used to lie on the blade's base for every sample, a band of even width
 * that the shader then cut to its outer part). `parent` is the page's energy scene, on LAYERS.energy, which the pipeline
 * draws after the ink and the fog, so no edge ink or fog lands on it, and it casts no shadow. It is not inked: ink marks
 * the silhouettes of bodies, and a ribbon of light outlined in ink reads as a solid flat band and dims the energy, while
 * the bloom's ink gate takes the glow off any pixel as dark as the ink; the brush break on its tail is its painted edge
 * instead, as Pip's own cyan channels carry no ink line of theirs. Under the light the same strip is drawn first as a
 * glaze (TRAIL_TINT), multiplying the frame toward cyan and writing no key, so the bloom reads the light alone. `brush` is
 * the painted materials' shared brush atlas uniform (the flat grey stand-in without it).
 */
export function createSwordTrail(parent: Object3D, brush: IUniform<Texture | null>): SwordTrail {
  const stroke = new TrailStroke();
  const capacity = stroke.buffer.capacity;
  const geometry = new BufferGeometry();
  const positions = new Float32Array(capacity * 2 * 3);
  const edge = new Float32Array(capacity * 2);
  const shade = new Float32Array(capacity * 2);
  const age = new Float32Array(capacity * 2);
  const along = new Float32Array(capacity * 2);
  for (let i = 0; i < capacity; i++) edge[i * 2 + 1] = 1;
  const index = new Uint16Array((capacity - 1) * 6);
  for (let i = 0; i < capacity - 1; i++) {
    const a = i * 2;
    index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  const position = new BufferAttribute(positions, 3);
  const shadeAttribute = new BufferAttribute(shade, 1);
  const ageAttribute = new BufferAttribute(age, 1);
  const strokeAttribute = new BufferAttribute(along, 1);
  geometry.setAttribute('position', position);
  geometry.setAttribute('aEdge', new BufferAttribute(edge, 1));
  geometry.setAttribute('aShade', shadeAttribute);
  geometry.setAttribute('aAge', ageAttribute);
  geometry.setAttribute('aStroke', strokeAttribute);
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  // The across profile is in uniforms, so it can be tuned without a rebuild; the brightness follows the feel.
  const shapeUniforms = {
    uBrush: brush,
    uBrushTile: { value: TRAIL_BRUSH_TILE_M },
    uBrushAcross: { value: TRAIL_BRUSH_ACROSS },
    uCoreShare: { value: TRAIL_CORE_SHARE },
    uBrushFrom: { value: TRAIL_BRUSH_FROM },
  };
  const brightness = { value: 1 };
  const material = useEnergyBlending(
    new ShaderMaterial({
      name: 'SwordTrail',
      defines: energyDefines(),
      uniforms: {
        ...shapeUniforms,
        uColor: { value: new Color(PLAYER_ENERGY) },
        uBodyKey: { value: TRAIL_BODY_KEY },
        uCoreKey: { value: TRAIL_CORE_KEY },
        uCoreWhite: { value: TRAIL_CORE_WHITE },
        uBodyLight: { value: TRAIL_BODY_LIGHT },
        uBrightness: brightness,
      },
      vertexShader,
      fragmentShader,
      side: DoubleSide,
    }),
  );
  // The glaze multiplies (the frame times the fragment's colour) and keeps the frame's key by taking the larger alpha,
  // its own being 0.
  const glazeMaterial = new ShaderMaterial({
    name: 'SwordTrailGlaze',
    uniforms: {
      ...shapeUniforms,
      uTint: { value: new Color(TRAIL_TINT) },
      uTintShare: { value: TRAIL_TINT_SHARE },
    },
    vertexShader,
    fragmentShader: tintShader,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: ZeroFactor,
    blendDst: SrcColorFactor,
    blendEquationAlpha: MaxEquation,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
  });
  const meshes = [new Mesh(geometry, glazeMaterial), new Mesh(geometry, material)] as const;
  const [glaze, mesh] = meshes;
  glaze.name = 'sword_trail_glaze';
  mesh.name = 'sword_trail';
  meshes.forEach((each, order) => {
    each.frustumCulled = false;
    each.castShadow = false;
    each.receiveShadow = false;
    each.layers.set(LAYERS.energy);
    each.renderOrder = 9 + order;
    parent.add(each);
  });

  function write(lengthSeconds: number, width: number): void {
    const b = stroke.buffer;
    const n = b.count;
    const now = stroke.time;
    // The stroke's own span: its length once it has run that long, its age until then, so the crescent comes to a point
    // at its tail from its first frames. Tapered over the whole length instead, a stroke younger than it (every stroke
    // at its contact, 0.07 to 0.11 s into a 0.16 s length) ended in a broad square tail.
    const span = n > 0 ? Math.min(Math.max(1e-3, lengthSeconds), Math.max(1e-3, now - b.time[b.slot(0)]!)) : 1;
    for (let i = 0; i < n; i++) {
      const s = b.slot(i);
      const sampleAge = now - b.time[s]!;
      const share = trailAgeShare(sampleAge, span);
      // The inner vertex on the blade, crescentWidth of the way in from the tip: wide at the blade, a point at the tail.
      const inward = crescentWidth(share, width);
      for (let k = 0; k < 3; k++) {
        const tipValue = b.tip[s * 3 + k]!;
        positions[i * 6 + k] = tipValue + (b.base[s * 3 + k]! - tipValue) * inward;
        positions[i * 6 + 3 + k] = tipValue;
      }
      const value = stroke.shade(sampleAge, lengthSeconds);
      shade[i * 2] = value;
      shade[i * 2 + 1] = value;
      age[i * 2] = share;
      age[i * 2 + 1] = share;
      along[i * 2] = b.arc[s]!;
      along[i * 2 + 1] = b.arc[s]!;
    }
    geometry.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
    mesh.visible = n > 1;
    glaze.visible = n > 1;
    if (n > 0) {
      position.needsUpdate = true;
      shadeAttribute.needsUpdate = true;
      ageAttribute.needsUpdate = true;
      strokeAttribute.needsUpdate = true;
    }
  }

  return {
    mesh,
    glaze,
    stroke,
    update(dt, base, tip, active, lengthSeconds, fadeSeconds, look) {
      stroke.step(dt, base, tip, active, lengthSeconds, fadeSeconds);
      brightness.value = Math.max(0, look.brightness);
      write(lengthSeconds, look.width);
    },
    clear() {
      stroke.clear();
      write(1, 0);
    },
    dispose() {
      mesh.removeFromParent();
      glaze.removeFromParent();
      geometry.dispose();
      material.dispose();
      glazeMaterial.dispose();
    },
  };
}
