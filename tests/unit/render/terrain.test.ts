import { Texture, Vector3, type Color, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { createPaintUniforms } from '../../../src/render/materials/painted';
import { fbm3, valueNoise3 } from '../../../src/render/terrain/noise';
import { createStylePatch, STYLE_PLANET_RADIUS } from '../../../src/render/terrain/stylePatch';
import { VERDANT } from '../../../src/render/themes';

describe('noise', () => {
  it('is deterministic and stays in [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const v = valueNoise3(i * 0.37, i * 0.11, -i * 0.23, 5);
      expect(v).toBe(valueNoise3(i * 0.37, i * 0.11, -i * 0.23, 5));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const f = fbm3(i * 0.1, 0.5, i * 0.2, 3, 4);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('keeps its golden values', () => {
    // The terrain's shape and colours, and so every prop's footing, come from these; comparing the noise with itself
    // (above) cannot see a changed hash constant or octave weight. Values computed from this code.
    expect(valueNoise3(1.3, 2.7, -0.4, 5)).toBe(0.5223898587380909);
    expect(valueNoise3(-7.25, 0.5, 3.75, 0)).toBe(0.46212008414158845);
    expect(fbm3(0.8, 3.2, -1.6, 3, 4)).toBe(0.4441802849374154);
  });
});

describe('createStylePatch', () => {
  const patch = createStylePatch(VERDANT, createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture()), 32);

  it('keeps the heart clearing level at the origin', () => {
    const origin = patch.surfaceAt(0, 0);
    expect(origin.position.length()).toBeLessThan(1e-6);
    expect(origin.up.y).toBeCloseTo(1, 9);
    expect(Math.abs(patch.surfaceAt(3, 2).position.y - patch.surfaceAt(-3, -2).position.y)).toBeLessThan(0.2);
  });

  it('curves away with the planet', () => {
    const far = patch.surfaceAt(60, 0);
    // The point above (60, 0) sits about 0.36 rad around the sphere, about 10 m below the tangent plane;
    // terrain relief adds less than 3.5 m.
    const drop = STYLE_PLANET_RADIUS * (1 - Math.cos(Math.atan(60 / STYLE_PLANET_RADIUS)));
    expect(far.position.y).toBeLessThan(-drop + 3.5);
    expect(far.up.x).toBeGreaterThan(0.3);
  });

  it('builds a vertex-coloured mesh', () => {
    expect(patch.mesh.geometry.getAttribute('color')).toBeDefined();
    expect(patch.mesh.geometry.getAttribute('position').count).toBe(33 * 33);
  });

  it('raises hills and sinks hollows between the clearing and the rim', () => {
    // A patch with no relief at all passed every other test here. On this 2 m grid over the ring from 14 to 50 m
    // (tangent-plane radius) the terrain lifts from -0.88 m to +1.45 m.
    const center = new Vector3(0, -STYLE_PLANET_RADIUS, 0);
    let highest = -Infinity;
    let lowest = Infinity;
    for (let x = -50; x <= 50; x += 2) {
      for (let z = -50; z <= 50; z += 2) {
        const r = Math.hypot(x, z);
        if (r < 14 || r > 50) continue;
        const lift = patch.surfaceAt(x, z).position.distanceTo(center) - STYLE_PLANET_RADIUS;
        highest = Math.max(highest, lift);
        lowest = Math.min(lowest, lift);
      }
    }
    expect(highest).toBeGreaterThan(0.75);
    expect(lowest).toBeLessThan(-0.4);
  });

  it('keeps the heart clearing exactly level, with the ground normal straight up', () => {
    // The heart and the turrets stand here and props lean with surfaceAt's normal. Relief starts 6 m from the pole
    // axis, and the normal differences points 0.25 m either side, so it is exactly up only where those stay inside 6 m
    // too: on this grid the farthest point is 5.66 m out (finer grids reach 5.9 m, where it tilts up to 0.07 degrees).
    const center = new Vector3(0, -STYLE_PLANET_RADIUS, 0);
    let worstLift = 0;
    let leastUp = 1;
    for (let x = -6; x <= 6; x += 2) {
      for (let z = -6; z <= 6; z += 2) {
        if (Math.hypot(x, z) >= 5.9) continue;
        const surface = patch.surfaceAt(x, z);
        worstLift = Math.max(worstLift, Math.abs(surface.position.distanceTo(center) - STYLE_PLANET_RADIUS));
        leastUp = Math.min(leastUp, surface.normal.dot(surface.up));
      }
    }
    expect(worstLift).toBeLessThan(1e-9);
    expect(leastUp).toBeGreaterThan(1 - 1e-9);
  });

  // 80 m from the centre to each edge on the plane tangent at the pole (about 74 m of ground).
  const HALF_EXTENT = 80;

  it('lays its rim level on the sphere in the low planet colour, so the edge does not show', () => {
    const center = patch.lowPlanet.position;
    const positions = patch.mesh.geometry.getAttribute('position');
    const colors = patch.mesh.geometry.getAttribute('color');
    const planetColor = (patch.lowPlanet.material as ShaderMaterial).uniforms['uBaseColor']!.value as Color;
    const p = new Vector3();
    let worstLift = 0;
    let worstColor = 0;
    for (let k = 0; k < positions.count; k++) {
      const i = k % 33;
      const j = Math.floor(k / 33);
      if (i !== 0 && j !== 0 && i !== 32 && j !== 32) continue;
      worstLift = Math.max(worstLift, Math.abs(p.fromBufferAttribute(positions, k).distanceTo(center) - STYLE_PLANET_RADIUS));
      worstColor = Math.max(worstColor, Math.abs(colors.getX(k) - planetColor.r), Math.abs(colors.getY(k) - planetColor.g), Math.abs(colors.getZ(k) - planetColor.b));
    }
    expect(worstLift).toBeLessThan(1e-3);
    expect(worstColor).toBeLessThan(1e-5);
  });

  it('keeps the low planet below every hollow and reaching in under the patch edge', () => {
    const center = patch.lowPlanet.position;
    const positions = patch.lowPlanet.geometry.getAttribute('position');
    const v = new Vector3();
    const dir = new Vector3();
    let checked = 0;
    let clearance = Infinity;
    let nearestPole = Math.PI;
    for (let k = 0; k < positions.count; k++) {
      v.fromBufferAttribute(positions, k);
      dir.copy(v).normalize();
      nearestPole = Math.min(nearestPole, Math.acos(dir.y));
      if (dir.y <= 0) continue;
      const x = (dir.x / dir.y) * STYLE_PLANET_RADIUS;
      const z = (dir.z / dir.y) * STYLE_PLANET_RADIUS;
      if (Math.abs(x) > HALF_EXTENT || Math.abs(z) > HALF_EXTENT) continue;
      checked += 1;
      clearance = Math.min(clearance, patch.surfaceAt(x, z).position.distanceTo(center) - v.length());
    }
    expect(checked).toBeGreaterThan(0);
    // The clearance bounds the planet's vertices only, which sit 2 cm under the true surface. At the tiers' 128 to 256
    // segments the patch's chords sag at most about 2 mm below it, so more than 1 cm rules out poke-through, since the
    // planet's flat facets only sink further between its vertices. Near the hole they sink up to about 5 cm more, so
    // the step along the patch outline reaches about 7 cm: still well under the edge-ink threshold (about a 0.4
    // percent depth jump against 3 percent) and the 2.9 m brush tile, unlike the old 0.6 m. The polygon offset, not
    // the gap, keeps the depth test from fighting at a distance.
    expect(clearance).toBeGreaterThan(0.01);
    expect(clearance).toBeLessThan(0.05);
    const planetMaterial = patch.lowPlanet.material as ShaderMaterial;
    expect([planetMaterial.polygonOffset, planetMaterial.polygonOffsetFactor, planetMaterial.polygonOffsetUnits]).toEqual([true, 1, 1]);
    // Some of the planet lies inside the patch's inscribed circle, so no sky shows between the two at the edge.
    expect(nearestPole).toBeLessThan(Math.atan(HALF_EXTENT / STYLE_PLANET_RADIUS));
  });
});
