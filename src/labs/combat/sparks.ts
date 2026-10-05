import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial, Vector3, type IUniform, type Object3D, type Texture } from 'three';
import { LAYERS } from '../../render/layers';
import { ENERGY_OUTPUT, energyDefines, PLAYER_ENERGY, useEnergyBlending } from '../shared/energy';

/**
 * The spark at the wound (Pillar 4): on a hit that connects, a burst of short cyan and white streaks thrown off the
 * contact, falling a little and dying within a quarter of a second, over a flash that fades in under a tenth. All of it
 * is one mesh of quads made once and rewritten each frame, the sparks taken in turn from a fixed pool, so a hit builds
 * nothing. It is player energy (useEnergyBlending), keyed for the bloom as Pip's channels are, on the noEdge layer, so
 * it carries no edge ink, and it runs on the frame's clock, so it flies through the hit-stop.
 */

/** The sparks a light hit and the finisher throw. */
export const SPARKS_LIGHT = 12;
export const SPARKS_FINISHER = 20;
/** The pool: three finisher bursts' worth, more than a chain can have alive at once (a burst lives under 0.3 s). */
export const SPARK_POOL = 64;
/** Flashes alive at once. */
export const FLASH_POOL = 3;
/** A spark's speed off the contact, in metres a second, and the finisher's share more. */
export const SPARK_SPEED_MIN = 2.5;
export const SPARK_SPEED_MAX = 6;
export const SPARK_FINISHER_SPEED = 1.25;
/** A spark's life, in seconds, drawn evenly between these. */
export const SPARK_LIFE_MIN = 0.15;
export const SPARK_LIFE_MAX = 0.28;
/** The pull down on a spark, in metres a second squared, and the share of its speed it loses each second. */
export const SPARK_GRAVITY = 9.8;
export const SPARK_DRAG = 3;
/** A streak trails its spark by this many seconds of its own flight, and is this wide, in metres. */
export const SPARK_STREAK_SECONDS = 0.045;
export const SPARK_WIDTH_M = 0.03;
/** The share of the sparks that burn white rather than cyan. */
export const SPARK_WHITE_SHARE = 0.35;
/** The flash: its width at the start on a light hit and on the finisher, in metres, and its life, in seconds. */
export const FLASH_LIGHT_M = 0.4;
export const FLASH_FINISHER_M = 0.6;
export const FLASH_SECONDS = 0.09;
/** The emissive key at a spark's head and at the flash's heart, as the trail's core is keyed (over the bloom's 1.25). */
export const SPARK_KEY = 2.8;

/** A point or direction, shaped as three's Vector3 is. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A small seeded generator (mulberry32), so a burst is the same burst on every run and the evidence repeats. */
export function sparkRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed the pool's generator starts from, and starts from again on every reset. */
export const SPARK_SEED = 9901;

/** One spark of the pool. */
interface Spark {
  alive: boolean;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  white: number;
}

interface Flash {
  alive: boolean;
  px: number;
  py: number;
  pz: number;
  age: number;
  size: number;
}

/**
 * The pool's stepping, apart from three: sparks thrown, flown and killed. `burst` throws sparks off a contact: along
 * the body's surface normal there (`normal`, unit) and the blade's sweep (`sweep`, unit), spread by a random part, a
 * little up, at a random speed and life.
 */
export class SparkPool {
  readonly sparks: Spark[];
  readonly flashes: Flash[];
  private next = 0;
  private nextFlash = 0;
  private random = sparkRandom(SPARK_SEED);
  lastCount = 0;
  readonly lastPosition = { x: 0, y: 0, z: 0 };
  bursts = 0;

  constructor(size = SPARK_POOL, flashes = FLASH_POOL) {
    this.sparks = Array.from({ length: size }, () => ({ alive: false, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, white: 0 }));
    this.flashes = Array.from({ length: flashes }, () => ({ alive: false, px: 0, py: 0, pz: 0, age: 0, size: 0 }));
  }

  get alive(): number {
    let count = 0;
    for (const spark of this.sparks) if (spark.alive) count += 1;
    return count;
  }

  reset(): void {
    for (const spark of this.sparks) spark.alive = false;
    for (const flash of this.flashes) flash.alive = false;
    this.random = sparkRandom(SPARK_SEED);
    this.next = 0;
    this.nextFlash = 0;
    this.lastCount = 0;
    this.bursts = 0;
  }

  burst(at: Vec3, normal: Vec3, sweep: Vec3, finisher: boolean): void {
    const count = finisher ? SPARKS_FINISHER : SPARKS_LIGHT;
    const boost = finisher ? SPARK_FINISHER_SPEED : 1;
    for (let i = 0; i < count; i++) {
      const spark = this.sparks[this.next]!;
      this.next = (this.next + 1) % this.sparks.length;
      let dx = normal.x * 0.7 + sweep.x * 0.9 + (this.random() * 2 - 1) * 0.7;
      let dy = normal.y * 0.7 + sweep.y * 0.9 + (this.random() * 2 - 1) * 0.7 + 0.35;
      let dz = normal.z * 0.7 + sweep.z * 0.9 + (this.random() * 2 - 1) * 0.7;
      const length = Math.hypot(dx, dy, dz) || 1;
      const speed = (SPARK_SPEED_MIN + (SPARK_SPEED_MAX - SPARK_SPEED_MIN) * this.random()) * boost;
      dx = (dx / length) * speed;
      dy = (dy / length) * speed;
      dz = (dz / length) * speed;
      spark.alive = true;
      spark.px = at.x;
      spark.py = at.y;
      spark.pz = at.z;
      spark.vx = dx;
      spark.vy = dy;
      spark.vz = dz;
      spark.age = 0;
      spark.life = SPARK_LIFE_MIN + (SPARK_LIFE_MAX - SPARK_LIFE_MIN) * this.random();
      spark.white = this.random() < SPARK_WHITE_SHARE ? 1 : 0;
    }
    const flash = this.flashes[this.nextFlash]!;
    this.nextFlash = (this.nextFlash + 1) % this.flashes.length;
    flash.alive = true;
    flash.px = at.x;
    flash.py = at.y;
    flash.pz = at.z;
    flash.age = 0;
    flash.size = finisher ? FLASH_FINISHER_M : FLASH_LIGHT_M;
    this.lastCount = count;
    this.lastPosition.x = at.x;
    this.lastPosition.y = at.y;
    this.lastPosition.z = at.z;
    this.bursts += 1;
  }

  /** Flies every live spark by `dt`: the pull down, the drag, then the move; a spark past its life dies. */
  step(dt: number): void {
    if (!(dt > 0)) return;
    const keep = Math.max(0, 1 - SPARK_DRAG * dt);
    for (const spark of this.sparks) {
      if (!spark.alive) continue;
      spark.age += dt;
      if (spark.age >= spark.life) {
        spark.alive = false;
        continue;
      }
      spark.vy -= SPARK_GRAVITY * dt;
      spark.vx *= keep;
      spark.vy *= keep;
      spark.vz *= keep;
      spark.px += spark.vx * dt;
      spark.py += spark.vy * dt;
      spark.pz += spark.vz * dt;
    }
    for (const flash of this.flashes) {
      if (!flash.alive) continue;
      flash.age += dt;
      if (flash.age >= FLASH_SECONDS) flash.alive = false;
    }
  }
}

const vertexShader = /* glsl */ `
attribute vec2 aUv;
attribute float aShade;
attribute float aWhite;
attribute float aKind;
varying vec2 vUv;
varying float vShade;
varying float vWhite;
varying float vKind;
void main() {
  vUv = aUv;
  vShade = aShade;
  vWhite = aWhite;
  vKind = aKind;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uBrush;
uniform vec3 uColor;
uniform float uKey;
varying vec2 vUv;
varying float vShade;
varying float vWhite;
varying float vKind;
${ENERGY_OUTPUT}
void main() {
  float shape;
  vec3 hue;
  if (vKind < 0.5) {
    // A streak, from its tail (u 0) to its head (u 1), across from -1 to 1: brightest and widest at the head.
    float across = 1.0 - smoothstep(0.3 + 0.4 * vUv.x, 1.0, abs(vUv.y));
    shape = across * smoothstep(0.0, 0.75, vUv.x);
    hue = mix(uColor, vec3(1.0), vWhite);
  } else {
    // The flash: a disc whose rim breaks into the brush atlas's strokes, white at its heart and cyan at its edge.
    float r = length(vUv);
    float brush = texture2D(uBrush, vUv * 0.35 + 0.5).r;
    shape = 1.0 - smoothstep(0.2 + 0.45 * brush, 1.0, r);
    hue = mix(uColor, vec3(1.0), (1.0 - r) * vWhite);
  }
  gl_FragColor = energyOut(hue, uKey * shape * vShade);
}
`;

/** The sparks' mesh and pool, stepped and redrawn each frame. */
export interface SparkBurst {
  readonly mesh: Mesh;
  readonly pool: SparkPool;
  burst(at: Vec3, normal: Vec3, sweep: Vec3, finisher: boolean): void;
  /** Steps the pool by the frame's `dt` and rewrites the quads, each streak and the flash turned to face `eye`. */
  update(dt: number, eye: Vector3): void;
  reset(): void;
  dispose(): void;
}

/**
 * The sparks under `parent`: one quad per spark of the pool and per flash, written each frame into attributes made
 * once; a dead spark's quad folds to a point, so it draws nothing. `brush` is the painted materials' shared brush atlas
 * uniform, which breaks the flash's rim into strokes.
 */
export function createSparks(parent: Object3D, brush: IUniform<Texture | null>): SparkBurst {
  const pool = new SparkPool();
  const quads = pool.sparks.length + pool.flashes.length;
  const positions = new Float32Array(quads * 4 * 3);
  const uvs = new Float32Array(quads * 4 * 2);
  const shade = new Float32Array(quads * 4);
  const white = new Float32Array(quads * 4);
  const kind = new Float32Array(quads * 4);
  const index = new Uint16Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const v = q * 4;
    index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], q * 6);
    const flash = q >= pool.sparks.length;
    // Corners: tail or left (u 0, or -1 for the flash), head or right; v from -1 to 1 across.
    uvs.set(flash ? [-1, -1, 1, -1, -1, 1, 1, 1] : [0, -1, 1, -1, 0, 1, 1, 1], v * 2);
    kind.fill(flash ? 1 : 0, v, v + 4);
    if (flash) white.fill(1, v, v + 4);
  }
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(positions, 3);
  const shadeAttribute = new BufferAttribute(shade, 1);
  const whiteAttribute = new BufferAttribute(white, 1);
  geometry.setAttribute('position', position);
  geometry.setAttribute('aUv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('aShade', shadeAttribute);
  geometry.setAttribute('aWhite', whiteAttribute);
  geometry.setAttribute('aKind', new BufferAttribute(kind, 1));
  geometry.setIndex(new BufferAttribute(index, 1));
  const material = useEnergyBlending(
    new ShaderMaterial({
      name: 'HitSparks',
      defines: energyDefines(),
      uniforms: { uBrush: brush, uColor: { value: new Color(PLAYER_ENERGY) }, uKey: { value: SPARK_KEY } },
      vertexShader,
      fragmentShader,
      side: DoubleSide,
    }),
  );
  const mesh = new Mesh(geometry, material);
  mesh.name = 'hit_sparks';
  mesh.frustumCulled = false;
  mesh.layers.set(LAYERS.noEdge);
  mesh.renderOrder = 11;
  mesh.visible = false;
  parent.add(mesh);

  const head = new Vector3();
  const tail = new Vector3();
  const side = new Vector3();
  const toEye = new Vector3();
  const up = new Vector3();

  /** Writes one quad's four corners: a, b at its tail or left edge's two ends, c, d at the other's. */
  function corners(q: number, ax: number, ay: number, az: number, sx: number, sy: number, sz: number, bx: number, by: number, bz: number, value: number): void {
    const o = q * 12;
    positions[o] = ax - sx;
    positions[o + 1] = ay - sy;
    positions[o + 2] = az - sz;
    positions[o + 3] = bx - sx;
    positions[o + 4] = by - sy;
    positions[o + 5] = bz - sz;
    positions[o + 6] = ax + sx;
    positions[o + 7] = ay + sy;
    positions[o + 8] = az + sz;
    positions[o + 9] = bx + sx;
    positions[o + 10] = by + sy;
    positions[o + 11] = bz + sz;
    shade.fill(value, q * 4, q * 4 + 4);
  }

  function write(eye: Vector3): void {
    let any = false;
    for (let q = 0; q < pool.sparks.length; q++) {
      const spark = pool.sparks[q]!;
      if (!spark.alive) {
        corners(q, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        continue;
      }
      any = true;
      const life = 1 - spark.age / spark.life;
      head.set(spark.px, spark.py, spark.pz);
      tail.set(spark.vx, spark.vy, spark.vz).multiplyScalar(-SPARK_STREAK_SECONDS).add(head);
      toEye.subVectors(eye, head);
      side.subVectors(head, tail).cross(toEye);
      const length = side.length();
      if (length < 1e-9) side.set(0, 0, 0);
      else side.multiplyScalar((SPARK_WIDTH_M * (0.5 + 0.5 * life)) / length);
      corners(q, tail.x, tail.y, tail.z, side.x, side.y, side.z, head.x, head.y, head.z, life * life);
      white.fill(spark.white, q * 4, q * 4 + 4);
    }
    for (let i = 0; i < pool.flashes.length; i++) {
      const flash = pool.flashes[i]!;
      const q = pool.sparks.length + i;
      if (!flash.alive) {
        corners(q, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        continue;
      }
      any = true;
      const u = flash.age / FLASH_SECONDS;
      const half = (flash.size * (0.7 + 0.6 * u)) / 2;
      // A square facing the eye: across is the eye's right on the ground, up its up.
      toEye.set(eye.x - flash.px, eye.y - flash.py, eye.z - flash.pz).normalize();
      side.set(0, 1, 0).cross(toEye).normalize().multiplyScalar(half);
      up.copy(toEye).cross(side).normalize().multiplyScalar(half);
      corners(q, flash.px - up.x, flash.py - up.y, flash.pz - up.z, side.x, side.y, side.z, flash.px + up.x, flash.py + up.y, flash.pz + up.z, (1 - u) * (1 - u));
    }
    mesh.visible = any;
    position.needsUpdate = true;
    shadeAttribute.needsUpdate = true;
    whiteAttribute.needsUpdate = true;
  }

  return {
    mesh,
    pool,
    burst(at, normal, sweep, finisher) {
      pool.burst(at, normal, sweep, finisher);
    },
    update(dt, eye) {
      pool.step(dt);
      write(eye);
    },
    reset() {
      pool.reset();
      mesh.visible = false;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
