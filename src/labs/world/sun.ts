import { DirectionalLight, Vector3 } from 'three';
import type { RenderDials } from '../../render/defaults';
import { LAYERS } from '../../render/layers';
import type { Tier } from '../../render/quality';
import { sunDirection, type Theme } from '../../render/themes';
import { WORLD_REACH } from './registry';

/**
 * The Asset World's sun, which the page moves with the sun dials as the Style Lab moves its own: the elevation, colour
 * and intensity come from the dials, whose locked defaults override the theme's light, and the theme keeps the azimuth,
 * so both pages draw the same key from the same dials. It keeps the Style Lab's distance, depth range, biases and
 * single-tap filter (labs/style/main.ts, Render constants), whose reasons hold here too: at 90 m out every member, all
 * within 24.2 m of the centre, lies well past the 1 m near plane, and the patch's farthest corner, 96.9 m from the centre,
 * inside the 220 m far plane. Only the box's width follows this page's layout.
 */
export const WORLD_SUN_DISTANCE = 90;
export const WORLD_SHADOW_NEAR = 1;
export const WORLD_SHADOW_FAR = 220;
export const WORLD_SHADOW_BIAS = -0.0004;
export const WORLD_SHADOW_NORMAL_BIAS = 0.03;
/**
 * How far past its root any member can reach in the light's view, in metres. A point of a member is at most its root's
 * distance from the centre, plus its footprint's half-width, plus its height from the centre (the triangle inequality),
 * and the largest footprint and the tallest member in the manifest are the broad tree's 1.71 m and the stage 10
 * heart's 5.19 m, measured from their GLBs: 6.9 m, rounded up.
 */
export const WORLD_CASTER_MARGIN = 7;
/**
 * Half the side of the sun's square shadow box: the furthest root, Pip-A's face member 17.2 m out (the kit arc stands at
 * 17 m), plus the caster margin, so 24.2 m, and every member casts at every elevation the dial allows. Narrower than the
 * Style Lab's 50 m, which holds a scatter ring 48 m out, so the high tier's 2048 map has 2.4 cm texels here against
 * 4.9 cm there.
 */
export const WORLD_SHADOW_HALF_WIDTH = WORLD_REACH + WORLD_CASTER_MARGIN;

export interface WorldSun {
  light: DirectionalLight;
  direction: Vector3;
  /** Moves the light to the sun dials; the theme keeps the azimuth. */
  sync(dials: RenderDials): void;
  setTier(tier: Tier): void;
}

export function createWorldSun(theme: Theme, dials: RenderDials, tier: Tier): WorldSun {
  const directionAt = (elevationDeg: number): Vector3 => new Vector3(...sunDirection({ ...theme, sun: { ...theme.sun, elevationDeg } }));
  const direction = directionAt(dials.sunElevation);
  const light = new DirectionalLight(dials.sunColor, dials.sunIntensity);
  light.castShadow = true;
  light.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
  Object.assign(light.shadow.camera, {
    left: -WORLD_SHADOW_HALF_WIDTH,
    right: WORLD_SHADOW_HALF_WIDTH,
    top: WORLD_SHADOW_HALF_WIDTH,
    bottom: -WORLD_SHADOW_HALF_WIDTH,
    near: WORLD_SHADOW_NEAR,
    far: WORLD_SHADOW_FAR,
  });
  light.shadow.camera.updateProjectionMatrix();
  // The grass and flowers draw on the noEdge layer, and cast (r186 tests the main camera's layers; this keeps them
  // casting if a later three tests the shadow camera's), as in the Style Lab.
  light.shadow.camera.layers.enable(LAYERS.noEdge);
  light.shadow.bias = WORLD_SHADOW_BIAS;
  light.shadow.normalBias = WORLD_SHADOW_NORMAL_BIAS;
  // r186's PCF rotates five taps per pixel with screen-anchored noise, which the painted bands turned into speckle that
  // crawled with the camera (Shadow PCF radius, Render constants); at 0 the taps coincide in one filtered lookup.
  light.shadow.radius = 0;
  return {
    light,
    direction,
    sync(next) {
      direction.copy(directionAt(next.sunElevation));
      light.position.copy(direction).multiplyScalar(WORLD_SUN_DISTANCE);
      light.color.set(next.sunColor);
      light.intensity = next.sunIntensity;
    },
    setTier(next) {
      light.shadow.mapSize.set(next.shadowMapSize, next.shadowMapSize);
      light.shadow.map?.dispose();
      light.shadow.map = null;
    },
  };
}
