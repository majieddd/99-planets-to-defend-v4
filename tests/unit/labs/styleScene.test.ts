import { readFileSync } from 'node:fs';
import {
  AnimationClip,
  Box3,
  Color,
  InstancedMesh,
  Line3,
  Matrix4,
  NumberKeyframeTrack,
  Quaternion,
  Vector3,
  type BoxGeometry,
  type CapsuleGeometry,
  type Mesh,
  type Object3D,
  type ShaderMaterial,
} from 'three';
import { describe, expect, it } from 'vitest';
import { rgbToHsv } from '../../../src/labs/style/audit';
import { NO_EDGE_PIECES } from '../../../src/labs/shared/meadow';
import { placeholderAssets } from '../../../src/labs/style/placeholders';
import {
  buildStyleScene,
  BULWARK_HOME,
  HUSK_RADIUS,
  HUSK_SPEED,
  PRESETS,
  RUN_RADIUS,
  RUN_SPEED,
  SCATTER_PLAN,
  TURN_RATE,
  TURRET_ANGLES_DEG,
  TURRET_RING_RADIUS,
  type StyleAssets,
  type StyleScene,
} from '../../../src/labs/style/scene';
import type { MaterialContext } from '../../../src/render/assets/loadAsset';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';
import { LAYERS } from '../../../src/render/layers';
import { createPaintUniforms } from '../../../src/render/materials/painted';
import { BLOOM_SMOOTHING } from '../../../src/render/post/pipeline';
import { createStylePatch, STYLE_PLANET_RADIUS } from '../../../src/render/terrain/stylePatch';
import { VERDANT } from '../../../src/render/themes';

const paint = createPaintUniforms(VERDANT, DEFAULT_DIALS, null);
const hullMaterial = createHullMaterial(createInkUniforms(DEFAULT_DIALS));
const ctx: MaterialContext = { paint, hullMaterial, hullLayer: LAYERS.hull };
// surfaceAt is analytic, so a coarse patch places everything exactly where a tier's patch would.
const patch = createStylePatch(VERDANT, paint, 32);
const CENTER = new Vector3(0, -STYLE_PLANET_RADIUS, 0);
const SCALE = 0.4; // the low tier's scatter scale
const DT = 1 / 60;

function build(assets: StyleAssets = placeholderAssets(ctx), scale = SCALE): { assets: StyleAssets; style: StyleScene } {
  return { assets, style: buildStyleScene(patch, assets, ctx, scale) };
}

function step(style: StyleScene, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) style.update(DT);
}

const isHull = (object: Object3D) => (object as Mesh).isMesh === true && (object as Mesh).material === hullMaterial;

function maxInk(mesh: Mesh): number {
  const ink = mesh.geometry.getAttribute('inkWidth');
  let max = 0;
  for (let i = 0; ink && i < ink.count; i++) max = Math.max(max, ink.getX(i));
  return max;
}

function meshesUnder(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((object) => {
    if ((object as Mesh).isMesh) out.push(object as Mesh);
  });
  return out;
}

/** The point on the plane tangent at the pole that surfaceAt maps to p. */
function tangentOf(p: Vector3): { x: number; z: number } {
  const d = p.clone().sub(CENTER);
  return { x: (d.x / d.y) * STYLE_PLANET_RADIUS, z: (d.z / d.y) * STYLE_PLANET_RADIUS };
}

function tangentRadius(p: Vector3): number {
  const t = tangentOf(p);
  return Math.hypot(t.x, t.z);
}

function heightAboveGround(p: Vector3): number {
  const t = tangentOf(p);
  return p.distanceTo(CENTER) - patch.surfaceAt(t.x, t.z).position.distanceTo(CENTER);
}

/** How close the sight line from a to b comes to the heart's axis, measured across the ground. */
function nearestToHeartAxis(a: Vector3, b: Vector3): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const u = Math.min(1, Math.max(0, -(a.x * dx + a.z * dz) / (dx * dx + dz * dz)));
  return Math.hypot(a.x + dx * u, a.z + dz * u);
}

/** The shortest distance between segments ab and cd (Ericson, Real-Time Collision Detection, section 5.1.9). */
function segmentDistance(a: Vector3, b: Vector3, c: Vector3, d: Vector3): number {
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  const u = b.clone().sub(a);
  const v = d.clone().sub(c);
  const w = a.clone().sub(c);
  const uu = u.dot(u);
  const uv = u.dot(v);
  const vv = v.dot(v);
  const uw = u.dot(w);
  const vw = v.dot(w);
  const denominator = uu * vv - uv * uv; // zero for parallel segments, where any point of ab will do
  let s = denominator > 1e-12 ? clamp01((uv * vw - uw * vv) / denominator) : 0;
  let t = (uv * s + vw) / vv;
  if (t < 0) {
    t = 0;
    s = clamp01(-uw / uu);
  } else if (t > 1) {
    t = 1;
    s = clamp01((uv - uw) / uu);
  }
  return a.clone().addScaledVector(u, s).distanceTo(c.clone().addScaledVector(v, t));
}

const worldPosition = (object: Object3D) => object.getWorldPosition(new Vector3());
const worldQuaternion = (object: Object3D) => object.getWorldQuaternion(new Quaternion());
// glTF characters face +Z, with +X on their left.
const facing = (object: Object3D) => new Vector3(0, 0, 1).applyQuaternion(worldQuaternion(object));
const leftOf = (object: Object3D) => new Vector3(1, 0, 0).applyQuaternion(worldQuaternion(object));

/** Bulwark's body axis, the core of the stand-in's capsule, and the capsule's radius. */
function bulwarkAxis(assets: StyleAssets): { axis: Line3; radius: number } {
  const body = assets.bulwark.root.getObjectByName('bulwark') as Mesh;
  const { radius, height } = (body.geometry as CapsuleGeometry).parameters;
  body.updateWorldMatrix(true, false);
  const axis = new Line3(new Vector3(0, -height / 2, 0), new Vector3(0, height / 2, 0)).applyMatrix4(body.matrixWorld);
  return { axis, radius };
}

/** Degrees between each turret's rail and the line from its pitch pivot to the Husk's body. */
function railErrors(style: StyleScene, husk: Object3D): number[] {
  style.root.updateMatrixWorld(true);
  const body = worldPosition(husk).add(new Vector3(0, 0.8, 0));
  return [1, 2, 3].map((level) => {
    const pitch = style.root.getObjectByName(`bolt_mk${level}_pitch`) as Object3D;
    const rail = new Vector3(0, 0, 1).transformDirection(pitch.matrixWorld);
    return (rail.angleTo(body.clone().sub(worldPosition(pitch))) * 180) / Math.PI;
  });
}

/** Stand-ins with clips for Bulwark that each hold his body at their own x, so the body's x shows what is playing. */
function withBulwarkClips(x: { idle: number; run: number; attack: number }): { assets: StyleAssets; body: Object3D } {
  const pose = (value: number, duration: number) => new NumberKeyframeTrack('bulwark.position[x]', [0, duration], [value, value]);
  const assets = placeholderAssets(ctx);
  const clips = [
    new AnimationClip('idle', 2, [pose(x.idle, 2)]),
    new AnimationClip('run', 0.6, [pose(x.run, 0.6)]),
    new AnimationClip('attack', 0.85, [pose(x.attack, 0.85)]),
  ];
  const body = assets.bulwark.root.getObjectByName('bulwark') as Object3D;
  return { assets: { ...assets, bulwark: { root: assets.bulwark.root, animations: clips } }, body };
}

/** The stretches of frames in which the Husk stood still, over the first `seconds` of updates. */
function huskPauses(style: StyleScene, husk: Object3D, seconds: number): { start: number; seconds: number }[] {
  const angles: number[] = [];
  for (let i = 0; i < seconds * 60; i++) {
    style.update(DT);
    const p = worldPosition(husk);
    angles.push(Math.atan2(p.z, p.x)); // 18 s covers at most 2.6 rad, so atan2 never wraps
  }
  const pauses: { start: number; seconds: number }[] = [];
  for (let i = 1; i < angles.length; i++) {
    if (Math.abs(angles[i]! - angles[i - 1]!) > 1e-12) continue;
    const last = pauses.at(-1);
    if (last && Math.abs(last.start + last.seconds - i * DT) < DT / 2) last.seconds += DT;
    else pauses.push({ start: i * DT, seconds: DT });
  }
  return pauses;
}

describe('placeholderAssets', () => {
  it('carries every node name the style scene looks up', () => {
    const assets = placeholderAssets(ctx);
    for (const level of [1, 2, 3]) {
      for (const suffix of ['', '_yaw', '_pitch']) expect(assets.bolt.root.getObjectByName(`bolt_mk${level}${suffix}`)).toBeDefined();
    }
    for (let level = 0; level <= 10; level++) {
      expect(assets.heart.root.getObjectByName(`heart_stage_${String(level).padStart(2, '0')}`)).toBeDefined();
    }
    for (const [name] of SCATTER_PLAN) expect(assets.kit.root.getObjectByName(name)).toBeDefined();
  });

  it('inks every stand-in with nonzero ink exactly once and never inks a hull', () => {
    const assets = placeholderAssets(ctx);
    let inked = 0;
    let bare = 0;
    for (const { root } of Object.values(assets)) {
      for (const mesh of meshesUnder(root)) {
        const hulls = mesh.children.filter(isHull);
        if (isHull(mesh)) {
          expect(hulls).toHaveLength(0);
          continue;
        }
        const ink = maxInk(mesh);
        expect(hulls).toHaveLength(ink > 0 ? 1 : 0);
        if (ink > 0) inked += 1;
        else bare += 1;
      }
    }
    // Bulwark, the Husk, 3 marks of 4 parts, the plinth and 11 stages, the nest and 7 kit pieces; only grass is bare.
    expect([inked, bare]).toEqual([34, 1]);
  });

  it('roots each stand-in placed one by one at its ground contact point, the turret marks as empties, with the parts above seated on their bases', () => {
    const assets = placeholderAssets(ctx);
    const box = (root: Object3D, name: string) => {
      root.updateMatrixWorld(true);
      const mesh = root.getObjectByName(name) as Mesh;
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    };
    // Geometry positions are float32, so these hold to about 1e-8 m.
    // The assets the scene places one by one (Bulwark, the Husk, the nest, the heart and the three turret marks) each
    // keep M0c's ground rule with no sink: the lowest point on the root, neither over the ground nor under it. The
    // Husk's ball once floated 0.2 m, and the nest's ball reached 1.4 m underground. The check leaves out the kit,
    // which the scene scatters, and M0c's rule itself allows a declared sink, such as the real nest's 0.123 m.
    const placed: [string, Object3D][] = [
      ['bulwark', assets.bulwark.root],
      ['husk', assets.husk.root],
      ['nest', assets.nest.root],
      ['heart', assets.heart.root],
      ...[1, 2, 3].map((level): [string, Object3D] => [`bolt_mk${level}`, assets.bolt.root.getObjectByName(`bolt_mk${level}`) as Object3D]),
    ];
    // The box is measured from the vertices: by default each part adds its local box after its transform, which reaches
    // lower than the part once the part is tilted within its root.
    for (const [name, root] of placed) expect(new Box3().setFromObject(root, true).min.y, name).toBeCloseTo(0, 6);
    for (const level of [1, 2, 3]) {
      // M0c's tree: the mark is an empty at the asset origin, which is its ground contact point, with the base, the
      // yaw ring and the pitch head hung under it in that order. The scene aims each head in its parent's frame. An
      // empty is a node with no mesh, so the check is on that property, not on a class: the GLB's bolt_mkN loads as a
      // plain Object3D and the stand-in's is a Group.
      const mark = assets.bolt.root.getObjectByName(`bolt_mk${level}`) as Object3D;
      expect((mark as Mesh).isMesh).toBeUndefined();
      expect([...mark.position.toArray(), ...mark.quaternion.toArray()]).toEqual([0, 0, 0, 0, 0, 0, 1]);
      const parents = ['_base', '_yaw', '_pitch'].map((suffix) => assets.bolt.root.getObjectByName(`bolt_mk${level}${suffix}`)?.parent?.name);
      expect(parents).toEqual(['', '_base', '_yaw'].map((suffix) => `bolt_mk${level}${suffix}`));
      const base = box(assets.bolt.root, `bolt_mk${level}_base`);
      expect(base.min.y).toBeCloseTo(0, 6);
      expect(box(assets.bolt.root, `bolt_mk${level}_yaw`).min.y).toBeCloseTo(base.max.y, 6);
    }
    const plinth = box(assets.heart.root, 'heart_plinth');
    expect([plinth.min.y, plinth.max.y]).toEqual([0, 0.4].map((v) => expect.closeTo(v, 6)));
    for (let level = 0; level <= 10; level++) {
      expect(box(assets.heart.root, `heart_stage_${String(level).padStart(2, '0')}`).min.y).toBeCloseTo(0.4, 6);
    }
  });

  it("keeps the sphere's own normals on the nest's dome, so it lights as one dome and not as flat facets", () => {
    // The sphere's own normals point straight out from its centre, the root, so the dome lights as one broad dome.
    // Unindexed with its normals recomputed, it lit as 40 flat facets, and no other check here tells the two apart.
    // Measured against the unit vector out to each vertex, the facets' normals were up to 0.36 off and the sphere's are
    // 4.3e-8 off, float32's rounding.
    const { geometry } = placeholderAssets(ctx).nest.root.getObjectByName('nest') as Mesh;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    let worst = 0;
    for (let i = 0; i < position.count; i++) {
      const radial = new Vector3().fromBufferAttribute(position, i).normalize();
      worst = Math.max(worst, new Vector3().fromBufferAttribute(normal, i).distanceTo(radial));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('gives only the energy an emissive key, each one enough to glow at the default threshold', () => {
    // The key the painted shader writes: the brightest channel of emissive colour times intensity (no map here).
    const keyOf = (mesh: Mesh): number => {
      const u = (mesh.material as ShaderMaterial).uniforms;
      const c = u['uEmissiveColor']!.value as Color;
      return Math.max(c.r, c.g, c.b) * (u['uEmissiveIntensity']!.value as number);
    };
    const energy = /^(bolt_mk\d_rail|nest|heart_stage_\d\d)$/;
    let glowing = 0;
    for (const { root } of Object.values(placeholderAssets(ctx))) {
      for (const mesh of meshesUnder(root)) {
        if (isHull(mesh)) continue;
        if (energy.test(mesh.name)) {
          expect(keyOf(mesh), mesh.name).toBeGreaterThanOrEqual(DEFAULT_DIALS.bloomThreshold + BLOOM_SMOOTHING);
          glowing += 1;
        } else expect(keyOf(mesh), mesh.name).toBe(0);
      }
    }
    expect(glowing).toBe(3 + 1 + 11); // three rails, the nest, eleven heart stages
  });

  it('glows the heart amber-gold at full chroma, which AgX keeps from white', () => {
    // The palette's pale core (#ffc36b, saturation 0.58) left AgX near white; blue in a glow whitens first.
    const stage = placeholderAssets(ctx).heart.root.getObjectByName('heart_stage_03') as Mesh;
    const srgb = ((stage.material as ShaderMaterial).uniforms['uEmissiveColor']!.value as Color).getHex();
    const [hue, saturation] = rgbToHsv((srgb >> 16) & 255, (srgb >> 8) & 255, srgb & 255);
    expect(hue).toBeGreaterThanOrEqual(35);
    expect(hue).toBeLessThanOrEqual(45);
    expect(saturation).toBeGreaterThanOrEqual(0.85);
  });
});

describe('Style Lab camera layers', () => {
  // main.ts builds a renderer on load, so its two layer lines are held by their text.
  const main = readFileSync('src/labs/style/main.ts', 'utf8');

  it('draws the noEdge layer and casts its shadows', () => {
    // r186's shadow map tests the main camera's layers; the shadow camera's line keeps flowers casting if that changes.
    expect(main).toMatch(/^\s*camera\.layers\.enable\(LAYERS\.noEdge\);/m);
    expect(main).toMatch(/^\s*sun\.shadow\.camera\.layers\.enable\(LAYERS\.noEdge\);/m);
  });
});

describe('buildStyleScene', () => {
  it('scatters one instanced mesh per kit piece at the tier scale, on the ground and inked except the grass', () => {
    const { style } = build();
    expect(style.root.children.filter((child) => (child as InstancedMesh).isInstancedMesh)).toHaveLength(SCATTER_PLAN.length);
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    for (const [name, baseCount, minRadius, maxRadius] of SCATTER_PLAN) {
      const instanced = style.root.getObjectByName(`${name}_instances`) as InstancedMesh;
      expect(instanced.isInstancedMesh).toBe(true);
      expect(instanced.count).toBe(Math.max(1, Math.round(baseCount * SCALE)));
      expect(instanced.boundingSphere).not.toBeNull();
      const hulls = instanced.children.filter(isHull) as InstancedMesh[];
      if (name === 'grass_tuft') {
        expect(hulls).toHaveLength(0);
      } else {
        expect(hulls).toHaveLength(1);
        expect(hulls[0]!.instanceMatrix).toBe(instanced.instanceMatrix);
        expect(hulls[0]!.count).toBe(instanced.count);
      }
      // Instance matrices are stored as float32: about 1e-6 m at 40 m out (worst seen 4e-7 m off the ground).
      for (let i = 0; i < instanced.count; i++) {
        instanced.getMatrixAt(i, matrix);
        matrix.decompose(position, rotation, scale);
        const radius = tangentRadius(position);
        expect(radius).toBeGreaterThan(minRadius - 1e-4);
        expect(radius).toBeLessThan(maxRadius + 1e-4);
        expect(Math.abs(heightAboveGround(position))).toBeLessThan(1e-5);
        expect(scale.x).toBeGreaterThan(0.8 - 1e-5);
        expect(scale.x).toBeLessThan(1.25 + 1e-5);
      }
    }
    // The scene as a whole keeps the ink invariant too: one hull per inked mesh, none on a hull.
    for (const mesh of meshesUnder(style.root)) {
      const hulls = mesh.children.filter(isHull);
      expect(hulls).toHaveLength(isHull(mesh) || maxInk(mesh) <= 0 ? 0 : 1);
    }
  });

  it('draws the grass and the flowers on the noEdge layer alone, out of the edge pass, and the flowers keep their hull', () => {
    // On the world layer the edge pass outlined every grass cone, and the open meadow read as scribble.
    expect(LAYERS.noEdge).toBe(3);
    expect(new Set(Object.values(LAYERS)).size).toBe(Object.keys(LAYERS).length);
    expect([...NO_EDGE_PIECES].sort()).toEqual(['flowers', 'grass_tuft']);
    const { style } = build();
    for (const [name] of SCATTER_PLAN) {
      const instanced = style.root.getObjectByName(`${name}_instances`) as InstancedMesh;
      // Layer masks, not a test against one layer: noEdge alone, never noEdge and world together.
      expect(instanced.layers.mask, name).toBe(NO_EDGE_PIECES.includes(name) ? 1 << LAYERS.noEdge : 1 << LAYERS.world);
      for (const hull of instanced.children.filter(isHull)) expect(hull.layers.mask, `${name} hull`).toBe(1 << LAYERS.hull);
    }
    const flowers = style.root.getObjectByName('flowers_instances') as InstancedMesh;
    expect(flowers.children.filter(isHull)).toHaveLength(1);
    expect(flowers.castShadow).toBe(true);
  });

  it('lays out each lower tier as the first instances of every piece at the high tier', () => {
    const high = build(placeholderAssets(ctx), 1).style;
    for (const scale of [0.7, 0.4]) {
      const low = build(placeholderAssets(ctx), scale).style;
      const differing: Record<string, number> = {};
      for (const [name, baseCount] of SCATTER_PLAN) {
        const full = high.root.getObjectByName(`${name}_instances`) as InstancedMesh;
        const part = low.root.getObjectByName(`${name}_instances`) as InstancedMesh;
        expect(full.count).toBe(baseCount);
        expect(part.count).toBe(Math.max(1, Math.round(baseCount * scale)));
        differing[name] = 0;
        for (let i = 0; i < part.count; i++) {
          for (let k = 0; k < 16; k++) {
            if (part.instanceMatrix.array[i * 16 + k] === full.instanceMatrix.array[i * 16 + k]) continue;
            differing[name] += 1;
            break;
          }
        }
      }
      // Counts of instances whose matrix differs from the high tier's at the same index, which must all be zero.
      expect(differing).toEqual(Object.fromEntries(SCATTER_PLAN.map(([name]) => [name, 0])));
    }
  });

  it("keeps every rock and bush 2 m off the Husk's ring", () => {
    // The high tier holds every lower tier's instances (see the test above), so it speaks for all three.
    const { style } = build(placeholderAssets(ctx), 1);
    const solids = SCATTER_PLAN.filter(([name]) => name.startsWith('rock') || name === 'bush');
    expect(solids.map(([name]) => name)).toEqual(['rock_a', 'rock_b', 'rock_c', 'bush']);
    const matrix = new Matrix4();
    const position = new Vector3();
    let nearest = Infinity;
    let checked = 0;
    for (const [name] of solids) {
      const instanced = style.root.getObjectByName(`${name}_instances`) as InstancedMesh;
      for (let i = 0; i < instanced.count; i++) {
        instanced.getMatrixAt(i, matrix);
        nearest = Math.min(nearest, Math.abs(tangentRadius(position.setFromMatrixPosition(matrix)) - HUSK_RADIUS));
        checked += 1;
      }
    }
    expect(checked).toBe(solids.reduce((sum, [, baseCount]) => sum + baseCount, 0));
    // 2 m holds the largest stand-in rock at its largest scale (1.25 m) and the Husk's body (0.6 m). Measured 2.069 m.
    expect(nearest).toBeGreaterThanOrEqual(2 - 1e-4);
  });

  it("draws each kit piece with its node's transform, so a quantized GLB piece keeps its size", () => {
    const plain = build().style.root.getObjectByName('rock_b_instances') as InstancedMesh;
    const assets = placeholderAssets(ctx);
    const rock = assets.kit.root.getObjectByName('rock_b') as Mesh;
    // What quantization does to a GLB piece: the geometry squeezed into a unit box, the scale and offset moved onto the node.
    const offset = new Vector3(0.2, 0.5, -0.1);
    const size = 1.6;
    rock.geometry = rock.geometry.clone().translate(-offset.x, -offset.y, -offset.z).scale(1 / size, 1 / size, 1 / size);
    rock.position.copy(offset);
    rock.scale.setScalar(size);
    const quantized = build(assets).style.root.getObjectByName('rock_b_instances') as InstancedMesh;
    expect(quantized.boundingSphere!.center.distanceTo(plain.boundingSphere!.center)).toBeLessThan(1e-5);
    expect(quantized.boundingSphere!.radius).toBeCloseTo(plain.boundingSphere!.radius, 5);
    const a = new Matrix4();
    const b = new Matrix4();
    for (let i = 0; i < plain.count; i++) {
      plain.getMatrixAt(i, a);
      quantized.getMatrixAt(i, b);
      const vertex = new Vector3().fromBufferAttribute(plain.geometry.getAttribute('position'), 7).applyMatrix4(a);
      const moved = new Vector3().fromBufferAttribute(quantized.geometry.getAttribute('position'), 7).applyMatrix4(b);
      expect(moved.distanceTo(vertex)).toBeLessThan(1e-5);
    }
  });

  it('shows exactly one heart stage', () => {
    const { style } = build();
    const visible = () =>
      Array.from({ length: 11 }, (_, level) => style.root.getObjectByName(`heart_stage_${String(level).padStart(2, '0')}`)!.visible);
    expect(visible()).toEqual(Array.from({ length: 11 }, (_, level) => level === 3));
    style.setHeartStage(7);
    expect(visible()).toEqual(Array.from({ length: 11 }, (_, level) => level === 7));
  });

  it('places each turret mark on the ring at its ground contact point, its base on the ground and its pivots above', () => {
    const { style } = build();
    TURRET_ANGLES_DEG.forEach((degrees, index) => {
      const level = index + 1;
      const angle = (degrees * Math.PI) / 180;
      const mark = style.root.getObjectByName(`bolt_mk${level}`) as Object3D;
      // Nothing stands between the mark and the scene: place() alone sets it on the ground, as it does every asset.
      expect(mark.parent).toBe(style.root);
      const ground = patch.surfaceAt(Math.cos(angle) * TURRET_RING_RADIUS, Math.sin(angle) * TURRET_RING_RADIUS);
      expect(worldPosition(mark).distanceTo(ground.position)).toBeLessThan(1e-9);
      // Its up lies half way from the planet's up to the ground's normal, and it faces out from the heart. The heading
      // is read across the ground, where a turn away from the ring's bearing moves it one for one and the tilt only at
      // second order: place() yaws the mark level and then tilts it by the angle t between its up and the pole's,
      // which turns the facing's bearing by pi / 2 - 2 atan(sqrt(cos t)) at most, about t squared over 4. That is
      // 0.058 to 0.066 degrees at these marks' 3.65 to 3.88 degree tilts. Measured 0.002 degrees at most, because each
      // mark leans within a degree of its facing, but the bound holds whichever way the ground leans. The 1e-12 on the
      // bound absorbs rounding where the bound comes out as 0: below about 1e-8 rad, cos t rounds to 1, so a correct
      // mark on level ground would otherwise fail on atan2 rounding alone (measured 2.4e-16 rad at these bearings).
      const up = new Vector3(0, 1, 0).applyQuaternion(worldQuaternion(mark));
      expect(up.distanceTo(ground.up.clone().lerp(ground.normal, 0.5).normalize())).toBeLessThan(1e-9);
      const tilt = up.angleTo(new Vector3(0, 1, 0));
      const bearing = Math.atan2(facing(mark).z, facing(mark).x) - angle;
      const error = Math.abs(Math.atan2(Math.sin(bearing), Math.cos(bearing)));
      expect(error).toBeLessThanOrEqual(Math.PI / 2 - 2 * Math.atan(Math.sqrt(Math.cos(tilt))) + 1e-12);
      // The base's bottom centre is on the ground point, not half the base below it, and the pivots stand where the
      // old site groups held them: the yaw ring's centre 0.1 m over the base's top, and the pitch pivot 0.35 m over
      // the yaw ring's centre, so 0.45 m over the base's top.
      const baseHeight = 0.35 + 0.12 * index;
      const over = (height: number) => ground.position.clone().addScaledVector(up, height);
      const base = mark.getObjectByName(`bolt_mk${level}_base`) as Object3D;
      expect(base.localToWorld(new Vector3(0, -baseHeight / 2, 0)).distanceTo(ground.position)).toBeLessThan(1e-9);
      expect(worldPosition(mark.getObjectByName(`bolt_mk${level}_yaw`) as Object3D).distanceTo(over(baseHeight + 0.1))).toBeLessThan(1e-9);
      expect(worldPosition(mark.getObjectByName(`bolt_mk${level}_pitch`) as Object3D).distanceTo(over(baseHeight + 0.45))).toBeLessThan(1e-9);
    });
  });

  it('places every actor before the first update, so the startup preset frames Bulwark from behind', () => {
    const { assets, style } = build();
    const body = worldPosition(assets.bulwark.root);
    expect(body.distanceTo(patch.surfaceAt(BULWARK_HOME.x, BULWARK_HOME.z).position)).toBeLessThan(1e-9);
    expect(worldPosition(assets.husk.root).distanceTo(patch.surfaceAt(HUSK_RADIUS, 0).position)).toBeLessThan(1e-9);
    const forward = facing(assets.bulwark.root);
    const hero = style.preset('hero');
    // 5.5 m behind Bulwark, looking past it along its facing; the preset's 2.4 m lift adds under 0.04 m here.
    expect(Math.abs(hero.position.clone().sub(body).dot(forward) + 5.5)).toBeLessThan(0.1);
    expect(hero.target.clone().sub(hero.position).dot(forward)).toBeGreaterThan(9);
    expect(Math.hypot(hero.position.x, hero.position.z)).toBeGreaterThan(8);
    // The hero camera's sight line passes 3.2 m wide of the Worldheart's axis instead of through the crystal.
    expect(nearestToHeartAxis(hero.position, hero.target)).toBeGreaterThan(3);
    for (const name of PRESETS) {
      const { position, target } = style.preset(name);
      expect([...position.toArray(), ...target.toArray()].every(Number.isFinite)).toBe(true);
      // Measured: hero 2.59 m, strategic 40.1 m, closeup 1.62 m, horizon 3.31 m above the ground under the camera.
      expect(heightAboveGround(position)).toBeGreaterThan(1.5);
    }
  });

  it('frames the hero and close-up presets on the home pose, the same mid-lap as at the start', () => {
    const { assets, style } = build();
    const framing = () =>
      (['hero', 'closeup'] as const).flatMap((name) => {
        const { position, target } = style.preset(name);
        return [...position.toArray(), ...target.toArray()];
      });
    const atStart = framing();
    step(style, 8);
    // 8 s is 2 s into the lap: 14 m round it, 7.9 m from home.
    expect(worldPosition(assets.bulwark.root).distanceTo(patch.surfaceAt(BULWARK_HOME.x, BULWARK_HOME.z).position)).toBeGreaterThan(7);
    expect(framing()).toEqual(atStart);
  });

  it('stands the close-up camera on his left, toward the heart, clear of the lap through home', () => {
    const { assets, style } = build();
    const camera = style.preset('closeup').position;
    const home = worldPosition(assets.bulwark.root);
    expect(leftOf(assets.bulwark.root).dot(camera.clone().sub(home))).toBeGreaterThan(0.55);
    // Measured 2.58 m from the heart's axis, 1.42 m inside the lap.
    expect(tangentRadius(camera)).toBeLessThan(RUN_RADIUS - 1);
    let nearest = Infinity;
    const closest = new Vector3();
    for (let i = 0; i < 12 * 60; i++) {
      style.update(DT);
      const { axis } = bulwarkAxis(assets);
      nearest = Math.min(nearest, axis.closestPointToPoint(camera, true, closest).distanceTo(camera));
    }
    // Measured 1.44 m; on his right, 0.6 m the other way, his axis would pass 0.29 m from the lens.
    expect(nearest).toBeGreaterThan(1);
  });

  it(`walks the Husk around its ${HUSK_RADIUS} m circle at ${HUSK_SPEED} m/s, facing along its path`, () => {
    const { assets, style } = build();
    step(style, 5);
    const p = worldPosition(assets.husk.root);
    const angle = Math.atan2(p.z, p.x);
    expect(tangentRadius(p)).toBeCloseTo(HUSK_RADIUS, 9);
    // Across the ground the ring is 12.90 to 12.94 m from the axis: the sphere pulls it in and the hollow it crosses sinks.
    expect(Math.abs(Math.hypot(p.x, p.z) - HUSK_RADIUS)).toBeLessThan(0.2);
    expect(HUSK_RADIUS * angle).toBeCloseTo(HUSK_SPEED * 5, 6);
    expect(facing(assets.husk.root).dot(new Vector3(-Math.sin(angle), 0, Math.cos(angle)))).toBeGreaterThan(0.9999);
  });

  it('stops the Husk for its 1.4 s attack every 7 s', () => {
    const { assets, style } = build();
    const pauses = huskPauses(style, assets.husk.root, 16);
    expect(pauses).toHaveLength(2);
    for (const pause of pauses) expect(pause.seconds).toBeCloseTo(1.4, 1);
    expect(pauses[0]!.start).toBeGreaterThan(7);
    expect(pauses[0]!.start).toBeLessThan(7.1);
    expect(pauses[1]!.start - pauses[0]!.start).toBeCloseTo(7, 1);
  });

  it("stops the Husk for its attack clip's length when it has one", () => {
    const assets = placeholderAssets(ctx);
    const hold = (duration: number) => new NumberKeyframeTrack('husk.position[y]', [0, duration], [0.6, 0.6]);
    const clips = [new AnimationClip('walk', 1, [hold(1)]), new AnimationClip('attack', 2.2, [hold(2.2)])];
    const { style } = build({ ...assets, husk: { root: assets.husk.root, animations: clips } });
    const pauses = huskPauses(style, assets.husk.root, 18);
    expect(pauses).toHaveLength(2);
    for (const pause of pauses) expect(pause.seconds).toBeCloseTo(2.2, 1);
    expect(pauses[1]!.start - pauses[0]!.start).toBeCloseTo(7, 1);
  });

  it(`keeps every rail on the Husk from the first frame and turns heads at ${TURN_RATE} rad/s`, () => {
    const { assets, style } = build();
    for (const error of railErrors(style, assets.husk.root)) expect(error).toBeLessThan(0.01);
    step(style, 5);
    for (const error of railErrors(style, assets.husk.root)) expect(error).toBeLessThan(0.01);
    const yaw = style.root.getObjectByName('bolt_mk2_yaw') as Object3D;
    yaw.rotation.y += 1;
    const before = yaw.rotation.y;
    style.update(DT);
    expect(before - yaw.rotation.y).toBeCloseTo(TURN_RATE * DT, 9);
    step(style, 0.2);
    for (const error of railErrors(style, assets.husk.root)) expect(error).toBeLessThan(0.01);
  });

  it("keeps every rail out of Bulwark's body through a full lap of the Husk", () => {
    const { assets, style } = build();
    const rails = [1, 2, 3].map((level) => {
      const rail = style.root.getObjectByName(`bolt_mk${level}_rail`) as Mesh;
      const { width, height, depth } = (rail.geometry as BoxGeometry).parameters;
      // The rail's centreline and the reach of its edges from it.
      return { rail, back: new Vector3(0, 0, -depth / 2), front: new Vector3(0, 0, depth / 2), reach: Math.hypot(width, height) / 2 };
    });
    const husk = assets.husk.root;
    let previous = Math.atan2(worldPosition(husk).z, worldPosition(husk).x);
    let turned = 0;
    let frames = 0;
    let nearest = Infinity;
    let radius = 0;
    while (turned < 2 * Math.PI) {
      style.update(DT);
      frames += 1;
      const p = worldPosition(husk);
      const angle = Math.atan2(p.z, p.x);
      turned += Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous));
      previous = angle;
      style.root.updateMatrixWorld(true);
      const body = bulwarkAxis(assets);
      radius = body.radius;
      for (const { rail, back, front, reach } of rails) {
        const gap = segmentDistance(body.axis.start, body.axis.end, back.clone().applyMatrix4(rail.matrixWorld), front.clone().applyMatrix4(rail.matrixWorld));
        nearest = Math.min(nearest, gap - reach);
      }
    }
    // The Husk's lap with its attack pauses takes 54 s, four and a half of Bulwark's 12 s cycles.
    expect(frames * DT).toBeGreaterThan(48);
    // Measured 1.47 m between a rail's edge and his axis at the closest, against his 0.35 m radius.
    expect(nearest).toBeGreaterThan(radius);
  });

  it(`runs Bulwark round the ${RUN_RADIUS} m lap from home at ${RUN_SPEED} m/s in run mode, the heart on his left`, () => {
    const { assets, style } = build();
    const root = assets.bulwark.root;
    style.setBulwarkMode('run');
    const previous = worldPosition(root);
    expect(previous.distanceTo(patch.surfaceAt(BULWARK_HOME.x, BULWARK_HOME.z).position)).toBeLessThan(1e-9);
    // The step to each frame from the one before is half a frame's turn (0.84 degrees) off his facing there.
    const alongPath = Math.cos((RUN_SPEED / RUN_RADIUS) * DT);
    let travelled = 0;
    for (let i = 0; i < 60; i++) {
      style.update(DT);
      const p = worldPosition(root);
      expect(tangentRadius(p)).toBeCloseTo(RUN_RADIUS, 9);
      const stride = p.clone().sub(previous);
      travelled += stride.length();
      expect(facing(root).dot(stride.normalize())).toBeGreaterThan(alongPath);
      // His left points at the heart's axis, lifted only by the 1.4 degree tilt of his up away from the pole's.
      expect(leftOf(root).dot(new Vector3(-p.x, 0, -p.z).normalize())).toBeGreaterThan(0.999);
      previous.copy(p);
    }
    // Measured 6.998 m in the second: the ground circle is 3.999 m from the axis.
    expect(travelled).toBeCloseTo(RUN_SPEED, 1);
  });

  it('keeps Bulwark at home through idle and attack, then runs one lap from home back to home', () => {
    const { assets, style } = build();
    const home = patch.surfaceAt(BULWARK_HOME.x, BULWARK_HOME.z).position;
    // The cycle sets his lap angle on a line of its own, apart from run mode's step, so the run-mode test's checks on
    // his direction are repeated on every lap frame: with that line's sign flipped he would run the lap backward and
    // still leave and rejoin home on time. Home is on the lap, so the step off it is a stride along the lap too.
    // Measured 0.84 degrees at worst between his stride and his facing, and 1.43 between his left and the heart.
    const alongPath = Math.cos((RUN_SPEED / RUN_RADIUS) * DT);
    const previous = worldPosition(assets.bulwark.root);
    const away: number[] = [];
    for (let i = 1; i <= 12 * 60; i++) {
      style.update(DT);
      const p = worldPosition(assets.bulwark.root);
      const stride = p.clone().sub(previous);
      previous.copy(p);
      if (p.distanceTo(home) < 1e-9) continue;
      expect(tangentRadius(p)).toBeCloseTo(RUN_RADIUS, 9);
      expect(facing(assets.bulwark.root).dot(stride.normalize())).toBeGreaterThan(alongPath);
      expect(leftOf(assets.bulwark.root).dot(new Vector3(-p.x, 0, -p.z).normalize())).toBeGreaterThan(0.999);
      away.push(i * DT);
    }
    // Idle to 3 s, the attack to 3.85 s and idle again to 6 s, then the lap: 2 pi 4 / 7 = 3.59 s, back by 9.59 s.
    const lap = (2 * Math.PI * RUN_RADIUS) / RUN_SPEED;
    expect(Math.abs(away[0]! - 6)).toBeLessThanOrEqual(DT + 1e-9);
    expect(Math.abs(away.at(-1)! - (6 + lap))).toBeLessThanOrEqual(DT + 1e-9);
    expect(away.at(-1)! - away[0]!).toBeCloseTo((away.length - 1) * DT, 9); // one unbroken stretch
  });

  it('moves Bulwark at most one run step and turns him under 40 degrees a frame, through three cycles', () => {
    const { assets, style } = build();
    const root = assets.bulwark.root;
    let position = worldPosition(root);
    let forward = facing(root);
    let largestMove = 0;
    let largestTurn = 0;
    // Three cycles, because a lap angle summed frame by frame instead of read off the cycle clock drifts by part of a
    // step each lap, and its step off home first passes a run step as the third lap starts (measured 0.134 m at 30 s).
    for (let i = 0; i < 36 * 60; i++) {
      style.update(DT);
      const p = worldPosition(root);
      const f = facing(root);
      largestMove = Math.max(largestMove, p.distanceTo(position));
      largestTurn = Math.max(largestTurn, (f.angleTo(forward) * 180) / Math.PI);
      position = p;
      forward = f;
    }
    // Measured 0.1166 m, a frame at 7 m/s; he did run.
    expect(largestMove).toBeGreaterThan(0.9 * RUN_SPEED * DT);
    expect(largestMove).toBeLessThan(RUN_SPEED * DT + 1e-6);
    // Where the lap meets home he turns through the 37 degrees between his home facing and the lap's direction
    // there, plus at most one frame of the lap's own turn (1.7 degrees). Measured 37.6 degrees.
    expect(largestTurn).toBeLessThan(40);
  });

  it("starts run mode's lap from home, wherever a switch cut the cycle's lap short", () => {
    const { assets, style } = build();
    const home = patch.surfaceAt(BULWARK_HOME.x, BULWARK_HOME.z).position;
    step(style, 7.5);
    // 7.5 s is 1.5 s into the cycle's lap: 10.5 m round it, 7.73 m from home.
    expect(worldPosition(assets.bulwark.root).distanceTo(home)).toBeGreaterThan(7);
    style.setBulwarkMode('idle');
    style.update(DT);
    style.setBulwarkMode('run');
    style.update(DT);
    // One step from home. Had run mode taken up the lap at the angle the cycle left, he would have jumped 7.76 m.
    expect(worldPosition(assets.bulwark.root).distanceTo(home)).toBeLessThan(RUN_SPEED * DT + 1e-6);
  });

  it('restarts a repeated strike in place instead of fading it in from the bind pose', () => {
    // The strike holds the body at x = 1 and the other clips at 0, as does the body's own (bind) pose, so a strike
    // that fades in from zero weight shows as x dipping toward 0.
    const { assets, body } = withBulwarkClips({ idle: 0, run: 0, attack: 1 });
    const { style } = build(assets);
    style.setBulwarkMode('attack');
    step(style, 1.5);
    expect(body.position.x).toBeCloseTo(0, 9); // idle until the first strike at 1.6 s
    step(style, 1); // 2.5 s: the first strike crossfaded in from idle and holds its last frame
    expect(body.position.x).toBeCloseTo(1, 9);
    let lowest = Infinity;
    for (let i = 0; i < 90; i++) {
      style.update(DT); // through the second strike at 3.2 s
      lowest = Math.min(lowest, body.position.x);
    }
    expect(lowest).toBeCloseTo(1, 9);
  });

  it('idles Bulwark from the switch to attack mode until the first strike, whatever played before', () => {
    const { assets, body } = withBulwarkClips({ idle: 0, run: 2, attack: 1 });
    const { style } = build(assets);
    style.setBulwarkMode('run');
    step(style, 1);
    expect(body.position.x).toBeCloseTo(2, 9); // the run at full weight
    style.setBulwarkMode('attack');
    const trace: number[] = [];
    for (let i = 0; i < 93; i++) {
      style.update(DT); // to 1.55 s, short of the first strike at 1.6 s
      trace.push(body.position.x);
    }
    // The run hands over to idle across the 0.18 s blend, then idle holds the body at 0 until the strike.
    for (let i = 1; i < 12; i++) expect(trace[i]!).toBeLessThanOrEqual(trace[i - 1]!);
    expect(Math.max(...trace.slice(12).map(Math.abs))).toBeLessThan(1e-9);
    step(style, 0.95); // 2.5 s: the strike crossfaded in from idle and holds its last frame
    expect(body.position.x).toBeCloseTo(1, 9);
  });
});
