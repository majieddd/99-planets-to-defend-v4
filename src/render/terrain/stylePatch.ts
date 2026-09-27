import { BufferAttribute, BufferGeometry, Color, Mesh, SphereGeometry, Vector3 } from 'three';
import { createPaintedMaterial, type PaintUniforms } from '../materials/painted';
import type { Theme } from '../themes';
import { fbm3 } from './noise';

/** The style scene sits at the north pole of a planet of the blueprint's standard radius. */
export const STYLE_PLANET_RADIUS = 160;
const HALF_EXTENT = 80; // metres from the centre to the patch edge on the plane tangent at the pole (about 74 m of ground)
const CENTER = new Vector3(0, -STYLE_PLANET_RADIUS, 0);
// Metres from the pole axis. Relief fades out between the first two, so the rim lies level on the sphere instead of
// floating over the low planet or dipping under it, and the rim's colour fades to the low planet's by the third
// (the patch edge's nearest point, 160 sin(atan(80 / 160))), so the edge never shows as a line.
const RELIEF_FADE_START = 50;
const RELIEF_FADE_END = 64;
const RIM_BLEND_END = 71.5;
// The low planet opens a hole under the patch so no hollow ever shows it through the ground. The hole's edge must sit
// under level ground: past the relief (asin(64 / 160), 23.6 degrees) and inside the patch's inscribed circle
// (atan(80 / 160), 26.6 degrees), so the planet reaches in under the rim and no sky shows between the two.
const LOW_PLANET_HOLE = (25 * Math.PI) / 180;

export interface SurfacePoint {
  position: Vector3;
  up: Vector3;
  normal: Vector3;
}

export interface StylePatch {
  mesh: Mesh;
  lowPlanet: Mesh;
  /**
   * The ground on the line from the planet's centre through (x, 0, z), a point on the plane tangent at the pole. So x
   * and z are neither the result's world x and z nor distances along the ground: surfaceAt(48, 0).position.x is about
   * 46. Relief ends 64 m from the pole axis, inside the patch edge, so from there on, and everywhere beyond the patch,
   * this returns the bare 160 m sphere.
   */
  surfaceAt(x: number, z: number): SurfacePoint;
}

function smoothstep(a: number, b: number, t: number): number {
  const x = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return x * x * (3 - 2 * x);
}

/** Height above the sphere for a unit direction; the heart's clearing (6 to 14 m) and the rim stay level. */
function height(dir: Vector3): number {
  const p = dir.clone().multiplyScalar(STYLE_PLANET_RADIUS);
  const broad = (fbm3(p.x * 0.02, p.y * 0.02, p.z * 0.02, 3, 4) - 0.5) * 5.0;
  const detail = (fbm3(p.x * 0.09, p.y * 0.09, p.z * 0.09, 7, 3) - 0.5) * 1.1;
  const fromAxis = Math.hypot(p.x, p.z);
  return (broad + detail) * smoothstep(6, 14, fromAxis) * (1 - smoothstep(RELIEF_FADE_START, RELIEF_FADE_END, fromAxis));
}

function point(x: number, z: number): Vector3 {
  const dir = new Vector3(x, STYLE_PLANET_RADIUS, z).normalize();
  return CENTER.clone().addScaledVector(dir, STYLE_PLANET_RADIUS + height(dir));
}

export function createStylePatch(theme: Theme, paint: PaintUniforms, segments: number): StylePatch {
  const count = segments + 1;
  const positions = new Float32Array(count * count * 3);
  const colors = new Float32Array(count * count * 3);
  const indices: number[] = [];
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const x = -HALF_EXTENT + (2 * HALF_EXTENT * i) / segments;
      const z = -HALF_EXTENT + (2 * HALF_EXTENT * j) / segments;
      point(x, z).toArray(positions, (j * count + i) * 3);
      if (i < segments && j < segments) {
        const a = j * count + i;
        indices.push(a, a + count, a + 1, a + 1, a + count, a + count + 1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const meadow = new Color(theme.ground.meadow);
  const meadowLight = new Color(theme.ground.meadowLight);
  const moss = new Color(theme.ground.moss);
  const stone = new Color(theme.ground.stone);
  const soil = new Color(theme.ground.soil);
  const lowPlanetColor = meadow.clone().multiplyScalar(0.92);
  const normals = geometry.getAttribute('normal');
  const c = new Color();
  const p = new Vector3();
  const n = new Vector3();
  for (let v = 0; v < count * count; v++) {
    p.fromArray(positions, v * 3);
    n.fromBufferAttribute(normals, v);
    const up = p.clone().sub(CENTER).normalize();
    const slope = 1 - n.dot(up);
    const lift = p.clone().sub(CENTER).length() - STYLE_PLANET_RADIUS;
    const patchNoise = fbm3(p.x * 0.05, 0, p.z * 0.05, 11, 3);
    c.copy(meadow).lerp(meadowLight, smoothstep(0.45, 0.7, patchNoise));
    c.lerp(moss, smoothstep(0.2, -1.2, lift) * 0.8);
    const ring = Math.hypot(p.x, p.z);
    c.lerp(soil, (smoothstep(2.6, 3.4, ring) - smoothstep(4.6, 5.6, ring)) * smoothstep(0.3, 0.6, patchNoise + 0.2));
    c.lerp(stone, smoothstep(0.12, 0.3, slope));
    c.lerp(lowPlanetColor, smoothstep(RELIEF_FADE_END, RIM_BLEND_END, ring));
    c.toArray(colors, v * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  const mesh = new Mesh(geometry, createPaintedMaterial(paint, { terrain: true, vertexColors: true, standardBlend: 0 }));
  mesh.name = 'style_patch';
  mesh.receiveShadow = true;

  // Fills the horizon seen from high cameras beyond the patch edge. Its vertices sit 2 cm under the sphere: the 0.6 m
  // step it used to leave at the patch edge drew a faint line of edge ink (a 3.5 percent depth jump against the 3
  // percent threshold), bumped the outline by up to 13 px, and would tear world-space brush strokes along the square
  // once the atlas lands (the pixels either side sampled ground about 3.3 m apart along the ray). Its 128 x 64 facets
  // near the hole sag up to about 5 cm more between vertices, so the step is 2 cm at its vertices and up to about 7 cm
  // along the outline, still well under the edge-ink threshold (about a 0.4 percent depth jump against 3 percent) and
  // the 2.9 m brush tile. The patch's chords sag at most about 2 mm below the sphere at the tiers' 128 to 256 segments,
  // so the planet stays under the rim, and the polygon offset pushes it back in depth, since at a distance a gap of a
  // few centimetres falls below the depth buffer's resolution and would fight.
  const lowPlanetMaterial = createPaintedMaterial(paint, { terrain: true, baseColor: lowPlanetColor.clone(), standardBlend: 0 });
  lowPlanetMaterial.polygonOffset = true;
  lowPlanetMaterial.polygonOffsetFactor = 1;
  lowPlanetMaterial.polygonOffsetUnits = 1;
  const lowPlanet = new Mesh(
    new SphereGeometry(STYLE_PLANET_RADIUS - 0.02, 128, 64, 0, Math.PI * 2, LOW_PLANET_HOLE, Math.PI - LOW_PLANET_HOLE),
    lowPlanetMaterial,
  );
  lowPlanet.name = 'style_low_planet';
  lowPlanet.position.copy(CENTER);
  lowPlanet.receiveShadow = true;

  return {
    mesh,
    lowPlanet,
    surfaceAt(x, z) {
      const position = point(x, z);
      const up = position.clone().sub(CENTER).normalize();
      const e = 0.25;
      const dx = point(x + e, z).sub(point(x - e, z));
      const dz = point(x, z + e).sub(point(x, z - e));
      const normal = dz.cross(dx).normalize();
      if (normal.dot(up) < 0) normal.negate();
      return { position, up, normal };
    },
  };
}
