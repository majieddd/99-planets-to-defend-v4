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

/**
 * Play Pip (prototype)'s sword trail: a ribbon of cyan energy along the blade's arc through a hit's active frames, which
 * fades quickly once they end. Its history is a fixed ring of blade samples (TrailBuffer) and its mesh a strip written
 * from them into buffers made once, so a frame of the trail builds nothing.
 */

/** The most blade samples the ribbon holds: a 0.2 s trail (the slider's top) at 60 fps with every frame subsampled. */
export const TRAIL_CAPACITY = 128;
/**
 * A fast arc is subsampled between frames so the ribbon curves rather than breaking into straight chords: a sample
 * every TRAIL_SUBSAMPLE_M of the tip's travel, at most TRAIL_SUBSAMPLES_MAX in a frame. The finisher's tip moves up to
 * 64 m/s (Pip's sidecar), about a metre a frame at 60 fps and 3.2 m at the labs' 1/20 s step, so 10 samples a frame
 * keep its chords to 0.1 m at 60 fps.
 */
export const TRAIL_SUBSAMPLE_M = 0.1;
export const TRAIL_SUBSAMPLES_MAX = 10;
/**
 * Metres of the tip's arc one tile of the brush atlas spans along the ribbon, and tiles across it: the atlas is drawn out
 * along the arc, so its strokes lie the way the blade moved, and it rides the arc, so a stroke stays put as it fades.
 */
export const TRAIL_BRUSH_TILE_M = 3;
export const TRAIL_BRUSH_ACROSS = 1.2;
/**
 * The emissive key at the ribbon's core, the band just inside its tip edge: over the bloom threshold's locked 1.0 plus
 * its 0.25 ramp, so the core glows, while the body of the ribbon, at a third of it, adds light without glowing (Pillar 5:
 * energy reads, decoration does not emit, and a whole ribbon of glow would read as a neon smear).
 */
export const TRAIL_CORE_KEY = 2.2;
/**
 * The pigment the ribbon lays down before its light, and how much of it: the frame under the stroke is multiplied toward
 * this cyan by up to this share. Light alone only brightens, and over the warm sky and the sunlit meadow a cyan glow
 * added to them read as a pale white sheet; taking out the red under it first, as a glaze would, keeps the stroke cyan
 * over any ground, and dark ground (the Husk's chitin) barely changes, so there the glow reads as before.
 */
export const TRAIL_TINT = '#46d8f5';
export const TRAIL_TINT_SHARE = 0.6;

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
  /** Whether it is taking samples (a hit's active frames). */
  emitting: boolean;
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
   * drawn now, and whether the hit is in its active frames. A stroke starts afresh on the first active frame, from the
   * pose the blade had on the frame before, so it spans the whole arc and never joins the last hit's tail; while active
   * it adds the frame's arc, subsampled; after, it fades over `fadeSeconds` and is cleared at 0. Samples older than
   * `lengthSeconds` drop off its tail.
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

  /** How bright a sample `age` seconds old is drawn: fading along the ribbon to its tail, times the stroke's fade. */
  shade(age: number, lengthSeconds: number): number {
    const along = 1 - Math.min(1, Math.max(0, age / Math.max(1e-3, lengthSeconds)));
    return along * along * this.fade;
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
attribute float aStroke;
varying float vEdge;
varying float vShade;
varying float vStroke;
void main() {
  vEdge = aEdge;
  vShade = aShade;
  vStroke = aStroke;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The stroke's shape, which both passes read: its paint at this pixel, and its core band. */
const TRAIL_SHAPE = /* glsl */ `
uniform sampler2D uBrush;
uniform float uBrushTile;
uniform float uBrushAcross;
varying float vEdge;
varying float vShade;
varying float vStroke;
float trailShape(out float core) {
  // Across the ribbon, from the blade's base (0) to its tip (1): nothing over the inner part of the blade, rising
  // toward the tip and falling softly at the very edge, so the trail reads as an arc of light swept by the blade's
  // outer half rather than a fan from the hand; the core is the band just inside the tip edge, where the blade moved
  // fastest.
  float across = smoothstep(0.12, 0.8, vEdge) * (1.0 - smoothstep(0.95, 1.0, vEdge));
  core = smoothstep(0.62, 0.88, vEdge) * (1.0 - smoothstep(0.93, 0.995, vEdge));
  // Dry brush: where the stroke is thin, at its edges and along its fading tail, its paint breaks into the brush
  // atlas's strokes, the thinnest paint first, so the ribbon reads as brushwork rather than a flat sheet.
  float coverage = across * vShade;
  float brush = texture2D(uBrush, vec2(vStroke / uBrushTile, vEdge * uBrushAcross)).r;
  float threshold = (1.0 - coverage) * 0.85;
  return coverage * smoothstep(threshold - 0.1, threshold + 0.1, brush);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uKey;
${TRAIL_SHAPE}
${ENERGY_OUTPUT}
void main() {
  float core;
  float shape = trailShape(core);
  float key = uKey * shape * (0.3 + 0.7 * core);
  vec3 hue = mix(uColor, vec3(1.0), 0.4 * core * vShade);
  gl_FragColor = energyOut(hue, key);
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

/** The sword trail's meshes, its light and its glaze over one strip of its ring of samples, with the stroke stepping it. */
export interface SwordTrail {
  readonly mesh: Mesh;
  readonly glaze: Mesh;
  readonly stroke: TrailStroke;
  /** Steps the stroke (TrailStroke.step) and rewrites the strip from it. */
  update(dt: number, base: Vector3, tip: Vector3, active: boolean, lengthSeconds: number, fadeSeconds: number): void;
  clear(): void;
  dispose(): void;
}

/**
 * The trail's mesh under `parent`, in world space: a strip of two vertices per sample, base and tip, written each frame
 * into attributes made once (positions, the side across the ribbon, the shade and the brush coordinate along it) with a
 * fixed index of the whole strip, drawn as far as the samples reach. It is energy (useEnergyBlending), on the noEdge
 * layer, so the edge pass's normals never see it and it carries no edge ink, and it casts no shadow. It is not inked:
 * ink marks the silhouettes of bodies, and a ribbon of light outlined in ink reads as a solid flat band and dims the
 * energy, while the bloom's ink gate takes the glow off any pixel as dark as the ink; the brush break-up is its painted
 * edge instead, as Pip's own cyan channels carry no ink line of theirs. Under the light the same strip is drawn first as
 * a glaze (TRAIL_TINT), multiplying the frame toward cyan and writing no key, so the bloom reads the light alone.
 * `brush` is the painted materials' shared brush atlas uniform (the flat grey stand-in without it).
 */
export function createSwordTrail(parent: Object3D, brush: IUniform<Texture | null>): SwordTrail {
  const stroke = new TrailStroke();
  const capacity = stroke.buffer.capacity;
  const geometry = new BufferGeometry();
  const positions = new Float32Array(capacity * 2 * 3);
  const edge = new Float32Array(capacity * 2);
  const shade = new Float32Array(capacity * 2);
  const along = new Float32Array(capacity * 2);
  for (let i = 0; i < capacity; i++) edge[i * 2 + 1] = 1;
  const index = new Uint16Array((capacity - 1) * 6);
  for (let i = 0; i < capacity - 1; i++) {
    const a = i * 2;
    index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  const position = new BufferAttribute(positions, 3);
  const shadeAttribute = new BufferAttribute(shade, 1);
  const strokeAttribute = new BufferAttribute(along, 1);
  geometry.setAttribute('position', position);
  geometry.setAttribute('aEdge', new BufferAttribute(edge, 1));
  geometry.setAttribute('aShade', shadeAttribute);
  geometry.setAttribute('aStroke', strokeAttribute);
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const material = useEnergyBlending(
    new ShaderMaterial({
      name: 'SwordTrail',
      defines: energyDefines(),
      uniforms: {
        uBrush: brush,
        uColor: { value: new Color(PLAYER_ENERGY) },
        uKey: { value: TRAIL_CORE_KEY },
        uBrushTile: { value: TRAIL_BRUSH_TILE_M },
        uBrushAcross: { value: TRAIL_BRUSH_ACROSS },
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
      uBrush: brush,
      uTint: { value: new Color(TRAIL_TINT) },
      uTintShare: { value: TRAIL_TINT_SHARE },
      uBrushTile: { value: TRAIL_BRUSH_TILE_M },
      uBrushAcross: { value: TRAIL_BRUSH_ACROSS },
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

  function write(lengthSeconds: number): void {
    const b = stroke.buffer;
    const n = b.count;
    const now = stroke.time;
    for (let i = 0; i < n; i++) {
      const s = b.slot(i);
      for (let k = 0; k < 3; k++) {
        positions[i * 6 + k] = b.base[s * 3 + k]!;
        positions[i * 6 + 3 + k] = b.tip[s * 3 + k]!;
      }
      const value = stroke.shade(now - b.time[s]!, lengthSeconds);
      shade[i * 2] = value;
      shade[i * 2 + 1] = value;
      along[i * 2] = b.arc[s]!;
      along[i * 2 + 1] = b.arc[s]!;
    }
    geometry.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
    mesh.visible = n > 1;
    glaze.visible = n > 1;
    if (n > 0) {
      position.needsUpdate = true;
      shadeAttribute.needsUpdate = true;
      strokeAttribute.needsUpdate = true;
    }
  }

  return {
    mesh,
    glaze,
    stroke,
    update(dt, base, tip, active, lengthSeconds, fadeSeconds) {
      stroke.step(dt, base, tip, active, lengthSeconds, fadeSeconds);
      write(lengthSeconds);
    },
    clear() {
      stroke.clear();
      write(0);
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
