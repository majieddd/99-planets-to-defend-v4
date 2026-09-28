import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NodeIO } from '@gltf-transform/core';
import { Box3, Matrix4, OrthographicCamera, Quaternion, Vector3, type InstancedMesh, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { placeholderAssets } from '../../../src/labs/style/placeholders';
import { buildStyleScene, ROCK_LEAN, SCATTER_LEAN, SCATTER_PLAN, SCATTER_SIZE_MAX } from '../../../src/labs/style/scene';
import type { MaterialContext } from '../../../src/render/assets/loadAsset';
import { DEFAULT_DIALS, NUMERIC_RANGES } from '../../../src/render/defaults';
import { createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';
import { LAYERS } from '../../../src/render/layers';
import { createPaintUniforms } from '../../../src/render/materials/painted';
import { createStylePatch, STYLE_PLANET_RADIUS } from '../../../src/render/terrain/stylePatch';
import { sunDirection, VERDANT } from '../../../src/render/themes';
import { assetIO } from '../../../tools/assets/optimize.mjs';

// The Style Lab's sun casts into a square box SHADOW_HALF_WIDTH to each side (main.ts): the scatter plan's reach plus
// SHADOW_CROWN_MARGIN, because a tree at the edge of its ring leans out with the planet's curve and its crown, at the
// largest scatter size, reaches past its root. A caster outside the box loses its shadow (the old 45 m box cut the
// outermost conifer's at 85 degrees). The margin rested on a measurement made once in the browser; this holds it for the
// kit the lab ships with, read from its GLB, and for the placeholder kit the lab falls back to without one.

const paint = createPaintUniforms(VERDANT, DEFAULT_DIALS, null);
const ctx: MaterialContext = { paint, hullMaterial: createHullMaterial(createInkUniforms(DEFAULT_DIALS)), hullLayer: LAYERS.hull };
// surfaceAt is analytic, so a coarse patch places everything exactly where a tier's patch would.
const patch = createStylePatch(VERDANT, paint, 8);
const CENTER = new Vector3(0, -STYLE_PLANET_RADIUS, 0);
const UP = new Vector3(0, 1, 0);
const style = buildStyleScene(patch, placeholderAssets(ctx), ctx, 1);

// main.ts builds a renderer on load, so the shadow box is read from its text, as styleScene.test.ts reads its layer lines.
const MAIN = readFileSync(new URL('../../../src/labs/style/main.ts', import.meta.url), 'utf8');

function mainConstant(name: string): number {
  const match = new RegExp(`^const ${name} = (-?\\d+(?:\\.\\d+)?);`, 'm').exec(MAIN);
  if (!match) throw new Error(`main.ts no longer declares ${name} as a plain number, so this test cannot read the shadow box`);
  return Number(match[1]);
}

const SCATTER_REACH = Math.max(...SCATTER_PLAN.map(([, , , maxRadius]) => maxRadius));
const SHADOW_HALF_WIDTH = SCATTER_REACH + mainConstant('SHADOW_CROWN_MARGIN');
const SUN_DISTANCE = mainConstant('SUN_DISTANCE');
const SHADOW_NEAR = mainConstant('SHADOW_NEAR');
const SHADOW_FAR = mainConstant('SHADOW_FAR');

// Every sun elevation the dial allows, at its own step.
const [ELEVATION_MIN, ELEVATION_MAX, ELEVATION_STEP] = NUMERIC_RANGES.sunElevation;
const ELEVATIONS = Array.from({ length: Math.round((ELEVATION_MAX - ELEVATION_MIN) / ELEVATION_STEP) + 1 }, (_, i) => ELEVATION_MIN + i * ELEVATION_STEP);

/** The unit vector toward the sun at an elevation, as main.ts forms it from the theme's azimuth. */
function toSunAt(elevation: number): Vector3 {
  return new Vector3(...sunDirection({ ...VERDANT, sun: { ...VERDANT.sun, elevationDeg: elevation } }));
}

// The patch's half extent on the plane tangent at the pole, read back from its mesh because stylePatch.ts keeps
// HALF_EXTENT to itself, so a wider patch widens the ground this test holds. A vertex's tangent coordinates are its
// offsets from the pole axis over its height above the planet's centre, times the radius, whatever its relief.
const PATCH_HALF_EXTENT = ((): number => {
  const position = patch.mesh.geometry.getAttribute('position');
  let half = 0;
  for (let i = 0; i < position.count; i++) {
    const scale = STYLE_PLANET_RADIUS / (position.getY(i) - CENTER.y);
    half = Math.max(half, Math.abs(position.getX(i)) * scale, Math.abs(position.getZ(i)) * scale);
  }
  return half;
})();

// A root every degree round each ring. The reach changes smoothly with the root's azimuth: a root every half degree
// measured the same worst case to the millimetre.
const AZIMUTHS = 360;

/** scatter() in scene.ts leans rocks into their slope and stands every other piece near plumb. */
const leanOf = (name: string): number => (name.startsWith('rock') ? ROCK_LEAN : SCATTER_LEAN);

/** A box's eight corners, carried by the piece's node transform into the kit's frame, where scatter() draws it. */
function corners(box: Box3, node: Matrix4): Vector3[] {
  const out: Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new Vector3(x, y, z).applyMatrix4(node));
  return out;
}

/** The kit pieces whose instances cast shadows in the style scene, which leaves the grass out. */
function castingPieces(): string[] {
  return SCATTER_PLAN.map(([name]) => name).filter((name) => (style.root.getObjectByName(`${name}_instances`) as InstancedMesh).castShadow);
}

/** The shipped kit's pieces, from the GLB the manifest names: each mesh's position bounds under its node's transform. */
async function shippedKit(names: readonly string[]): Promise<Map<string, Vector3[]>> {
  const manifest = JSON.parse(readFileSync(new URL('../../../public/assets/manifest.json', import.meta.url), 'utf8')) as { assets: { name: string; file: string }[] };
  const file = manifest.assets.find((asset) => asset.name === 'verdant_kit')?.file;
  if (!file) throw new Error('the manifest lists no verdant_kit');
  const io: NodeIO = await assetIO();
  const doc = await io.read(fileURLToPath(new URL(`../../../public/assets/${file}`, import.meta.url)));
  const nodes = doc.getRoot().listNodes();
  return new Map(
    names.map((name): [string, Vector3[]] => {
      const node = nodes.find((candidate) => candidate.getName() === name);
      const mesh = node?.getMesh();
      if (!node || !mesh) throw new Error(`the kit has no mesh node named ${name}`);
      const box = new Box3();
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        // M0c quantizes positions to normalised integers, so the raw bounds are integer steps; three draws the
        // normalised values, and the node's transform scales them back to metres.
        box.expandByPoint(new Vector3().fromArray(position.getMinNormalized([])));
        box.expandByPoint(new Vector3().fromArray(position.getMaxNormalized([])));
      }
      return [name, corners(box, new Matrix4().fromArray(node.getWorldMatrix()))];
    }),
  );
}

/** The placeholder kit's pieces, from each stand-in's geometry bounds under its transform. */
function placeholderKit(names: readonly string[]): Map<string, Vector3[]> {
  const kit = placeholderAssets(ctx).kit.root;
  kit.updateMatrixWorld(true);
  return new Map(
    names.map((name): [string, Vector3[]] => {
      const mesh = kit.getObjectByName(name) as Mesh;
      mesh.geometry.computeBoundingBox();
      return [name, corners(mesh.geometry.boundingBox as Box3, mesh.matrixWorld)];
    }),
  );
}

interface Reach {
  /** The farthest any piece reaches from the middle of the sun's view, across either side of the box, in metres. */
  lateral: number;
  piece: string;
  elevation: number;
  /** The depth the pieces span along the sun's view, from the sun, in metres. */
  nearest: number;
  farthest: number;
}

/**
 * Every piece at the outer edge of its ring, at every degree of azimuth, at the largest scatter size and at every yaw,
 * seen from the sun at every elevation the dial allows. The yaw turns a piece about its own up axis, so the cylinder
 * about that axis through the box's farthest corner holds the box at any yaw, and the cylinder's extent along any
 * direction is exact: its axis's two ends plus its rim's radius across that direction. The bound therefore covers every
 * yaw at once, where the browser measurement sampled eight.
 */
function reach(kit: Map<string, Vector3[]>): Reach {
  // A root's place on the ground and its tilted up depend on the azimuth alone, so they are found once.
  const placed = [...kit].flatMap(([name, points]) => {
    const maxRadius = SCATTER_PLAN.find(([piece]) => piece === name)?.[3] ?? Number.NaN;
    const radius = SCATTER_SIZE_MAX * Math.max(...points.map((p) => Math.hypot(p.x, p.z)));
    const low = SCATTER_SIZE_MAX * Math.min(...points.map((p) => p.y));
    const high = SCATTER_SIZE_MAX * Math.max(...points.map((p) => p.y));
    return Array.from({ length: AZIMUTHS }, (_, a) => {
      const angle = (a / AZIMUTHS) * 2 * Math.PI;
      const surface = patch.surfaceAt(Math.cos(angle) * maxRadius, Math.sin(angle) * maxRadius);
      return { name, root: surface.position, axis: surface.up.clone().lerp(surface.normal, leanOf(name)).normalize(), radius, low, high };
    });
  });
  const result: Reach = { lateral: 0, piece: '', elevation: Number.NaN, nearest: Infinity, farthest: -Infinity };
  const camera = new OrthographicCamera();
  for (const elevation of ELEVATIONS) {
    // As main.ts places the sun and three aims its shadow camera: SUN_DISTANCE out toward the sun, facing the centre.
    const toSun = toSunAt(elevation);
    camera.position.copy(toSun).multiplyScalar(SUN_DISTANCE);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    for (const p of placed) {
      const span = (u: Vector3): [number, number] => {
        const along = u.dot(p.axis);
        const rim = p.radius * Math.sqrt(Math.max(0, 1 - along * along));
        const centre = u.dot(p.root);
        return [centre + Math.min(p.low * along, p.high * along) - rim, centre + Math.max(p.low * along, p.high * along) + rim];
      };
      // The view's sides pass through the centre, the sun's target, so a point's place across the box is its dot product
      // with the view's right and up axes.
      for (const axis of [right, up]) {
        const [low, high] = span(axis);
        const lateral = Math.max(-low, high);
        if (lateral > result.lateral) Object.assign(result, { lateral, piece: p.name, elevation });
      }
      const [low, high] = span(toSun);
      result.nearest = Math.min(result.nearest, SUN_DISTANCE - high);
      result.farthest = Math.max(result.farthest, SUN_DISTANCE - low);
    }
  }
  return result;
}

describe('the Style Lab shadow box', () => {
  it("is the scatter plan's reach plus the crown margin to each side and SHADOW_NEAR to SHADOW_FAR deep, from a sun SUN_DISTANCE out aimed at the centre", () => {
    for (const line of [
      'const theme = VERDANT;',
      'const SCATTER_REACH = Math.max(...SCATTER_PLAN.map(([, , , maxRadius]) => maxRadius));',
      'const SHADOW_HALF_WIDTH = SCATTER_REACH + SHADOW_CROWN_MARGIN;',
      'left: -SHADOW_HALF_WIDTH,',
      'right: SHADOW_HALF_WIDTH,',
      'top: SHADOW_HALF_WIDTH,',
      'bottom: -SHADOW_HALF_WIDTH,',
      'near: SHADOW_NEAR,',
      'far: SHADOW_FAR,',
      'scene.add(sun, sun.target);',
    ]) {
      expect(MAIN, line).toContain(line);
    }
    // The sun is placed twice, at creation and in syncSun, and syncSun's copy is the one that holds: it runs at start and
    // on every dial change. toContain passed while either survived, so a syncSun that put the sun 0.3 times as far out
    // passed every test here.
    const placement = 'sun.position.copy(sunDir).multiplyScalar(SUN_DISTANCE);';
    expect(MAIN.split(placement).length - 1, `${placement} at creation and in syncSun`).toBe(2);
    // reach() aims the shadow camera at the centre, where three's DirectionalLight keeps its target unless something
    // moves it, and a moved target would slide the whole box off the scatter this test holds inside it.
    expect(MAIN, 'main.ts moves or replaces the sun\'s target, which reach() assumes stays at the centre').not.toMatch(/\bsun\.target(?:\.position\b|\s*=(?!=))/);
  });

  it('measures each piece where the scene puts it: leaned by its own share, and never over the largest scatter size', () => {
    // The placeholder kit's pieces carry no node transform, so each instance's matrix is its placement alone.
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    let worstLean = 0;
    let largest = 0;
    let instances = 0;
    for (const [name] of SCATTER_PLAN) {
      const instanced = style.root.getObjectByName(`${name}_instances`) as InstancedMesh;
      for (let i = 0; i < instanced.count; i++) {
        instanced.getMatrixAt(i, matrix);
        matrix.decompose(position, rotation, scale);
        const d = position.clone().sub(CENTER);
        const surface = patch.surfaceAt((d.x / d.y) * STYLE_PLANET_RADIUS, (d.z / d.y) * STYLE_PLANET_RADIUS);
        const leaned = surface.up.clone().lerp(surface.normal, leanOf(name)).normalize();
        worstLean = Math.max(worstLean, UP.clone().applyQuaternion(rotation).distanceTo(leaned));
        largest = Math.max(largest, scale.x);
        instances += 1;
      }
    }
    expect(instances).toBe(SCATTER_PLAN.reduce((sum, [, baseCount]) => sum + baseCount, 0));
    // Instance matrices are float32, which leaves each up axis within about 1e-7 of the lean this test assumes (measured
    // 4.2e-8). The largest size drawn is 1.2487, so the cap is the size worth testing at.
    expect(worstLean).toBeLessThan(1e-5);
    expect(largest).toBeLessThanOrEqual(SCATTER_SIZE_MAX + 1e-6);
  });

  it('holds every casting piece of the shipped kit at the edge of its ring, at any yaw and every sun elevation', async () => {
    const pieces = castingPieces();
    expect(pieces).not.toContain('grass_tuft');
    const result = reach(await shippedKit(pieces));
    // Measured 49.35 m (a conifer) against the 50 m box, and 41.3 to 139.2 m deep against 1 to 220 m. At the 72 azimuths
    // and 8 yaws of the first browser measurement the same bounds reach 49.24 m.
    expect(result.lateral, JSON.stringify(result)).toBeLessThanOrEqual(SHADOW_HALF_WIDTH);
    expect(result.nearest, JSON.stringify(result)).toBeGreaterThanOrEqual(SHADOW_NEAR);
    expect(result.farthest, JSON.stringify(result)).toBeLessThanOrEqual(SHADOW_FAR);
    // The crowns do reach past the rings, so the margin earns its place, and the boxes were read at their real size: bare
    // roots at the rings' edges reach only 46.4 m.
    expect(result.lateral).toBeGreaterThan(SCATTER_REACH);
  });

  it('holds the placeholder kit the lab falls back to, whose pieces are not the shipped ones', () => {
    const result = reach(placeholderKit(castingPieces()));
    // Measured 49.31 m (the stand-in conifer), and 41.4 to 139.2 m deep.
    expect(result.lateral, JSON.stringify(result)).toBeLessThanOrEqual(SHADOW_HALF_WIDTH);
    expect(result.nearest, JSON.stringify(result)).toBeGreaterThanOrEqual(SHADOW_NEAR);
    expect(result.farthest, JSON.stringify(result)).toBeLessThanOrEqual(SHADOW_FAR);
    expect(result.lateral).toBeGreaterThan(SCATTER_REACH);
  });

  it("holds the patch's ground inside its depth at every sun elevation, out to the patch's corners", () => {
    // three leaves a receiver past the far plane lit, so ground deeper than SHADOW_FAR would drop the long shadows a low
    // sun lays across it: at a 150 m far plane the casters all fit and the far ground did not. The corners bound the
    // patch's ground: sampled every 0.5 m across the whole patch, relief included, its depth peaked at a corner at every
    // elevation, and its least depth over every elevation was a corner's under the lowest sun. Under a high sun the
    // heart is the nearest ground, but it lies near SUN_DISTANCE deep, far past the near plane.
    let nearest = Infinity;
    let farthest = { depth: -Infinity, elevation: Number.NaN, x: 0, z: 0 };
    for (const elevation of ELEVATIONS) {
      const toSun = toSunAt(elevation);
      for (const x of [-PATCH_HALF_EXTENT, PATCH_HALF_EXTENT]) {
        for (const z of [-PATCH_HALF_EXTENT, PATCH_HALF_EXTENT]) {
          const depth = SUN_DISTANCE - toSun.dot(patch.surfaceAt(x, z).position);
          nearest = Math.min(nearest, depth);
          if (depth > farthest.depth) farthest = { depth, elevation, x, z };
        }
      }
    }
    // Measured 7.9 m (the corner nearest a 3 degree sun) to 178.7 m deep against 1 to 220 m.
    expect(nearest).toBeGreaterThanOrEqual(SHADOW_NEAR);
    expect(farthest.depth, JSON.stringify(farthest)).toBeLessThanOrEqual(SHADOW_FAR);
    // The figure SUN_DISTANCE's note in main.ts gives: the corner at (80, 80), at most 178.7 m deep. It also shows the
    // corners were read at the patch's real extent, since corners at the centre would pass the two bounds above.
    expect(farthest.depth, `${JSON.stringify(farthest)}: update SUN_DISTANCE's note in main.ts`).toBeCloseTo(178.7, 1);
  });
});
