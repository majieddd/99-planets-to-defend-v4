import { BackSide, Color, MathUtils, Mesh, ShaderMaterial, SphereGeometry, Vector3, type Camera, type Texture } from 'three';
import { LAYERS } from './layers';
import type { Theme } from './themes';

const vertexShader = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clip.xyww; // pinned to the far plane
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uCloudLit;
uniform vec3 uCloudShadow;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uUp;
uniform float uDipCos;
uniform float uDipSin;
uniform float uGroundMix;
uniform sampler2D uBrush;
varying vec3 vDirection;

void main() {
  vec3 d = normalize(vDirection);
  // Heights count from the planet's limb, not the horizontal. On a 160 m planet the limb dips about 10 degrees from
  // 2.4 m up, so a horizon painted at the horizontal floated far above the real one over a band of ground colour, a
  // second, false horizon. Turned down by the dip (cosine and sine 1 and 0 without a planet), h is the sine of the
  // elevation above the limb: 0 exactly on the smooth sphere's limb, positive above it.
  float s = dot(d, uUp);
  float h = s * uDipCos + sqrt(max(1.0 - s * s, 0.0)) * uDipSin;
  // Sky below a planet's limb shows only through dips in the terrain's silhouette, where ground colour would draw a
  // thin false horizon that fog cannot cover (it skips the sky). uGroundMix drops it on a planet and is 1 without one.
  vec3 color = h >= 0.0 ? mix(uHorizon, uZenith, pow(h, 0.45)) : mix(uHorizon, uGround, pow(-h, 0.35) * uGroundMix);
  // Painted cumulus: brush strokes thresholded into hard-edged masses in a band above the horizon.
  // atan jumps a whole turn behind -X, and the mip choice reads that jump as a huge gradient: a hairline down the sky.
  // A copy wrapped at +X has no jump there, so each quad takes whichever copy is smooth (Tarini 2012). The copies
  // differ by whole turns, and both layers repeat a whole number of times per turn (3 and 7), so the strokes match.
  float azimuth = atan(d.z, d.x) / 6.2831853;
  float wrapped = fract(azimuth);
  float turn = fwidth(azimuth) < fwidth(wrapped) - 0.001 ? azimuth : wrapped;
  vec2 uv = vec2(turn * 3.0, h * 2.2);
  float field = texture2D(uBrush, uv).r * 0.6 + texture2D(uBrush, uv * vec2(7.0 / 3.0, 2.3) + vec2(0.37, 0.11)).r * 0.4;
  float band = smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.24, 0.5, h));
  float cloud = smoothstep(0.54, 0.6, field * 0.8 + band * 0.35) * band;
  float sunSide = dot(d, uSunDirection) * 0.5 + 0.5;
  vec3 cloudColor = mix(uCloudShadow, uCloudLit, smoothstep(0.4, 0.62, sunSide + (field - 0.5) * 0.6));
  color = mix(color, cloudColor, cloud);
  float sunward = max(dot(d, uSunDirection), 0.0);
  color += uSunColor * (pow(sunward, 900.0) * 8.0 + pow(sunward, 14.0) * 0.3) * (1.0 - cloud * 0.8);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

export interface PaintedSky {
  mesh: Mesh;
  follow(camera: Camera): void;
}

/** With `planet`, the sphere the camera stands on, the painted horizon sits on its limb; without it, on the horizontal. */
export function createPaintedSky(theme: Theme, brush: Texture, sunDirection: Vector3, planet?: { center: Vector3; radius: number }): PaintedSky {
  const up = new Vector3(0, 1, 0);
  const dipCos = { value: 1 };
  const dipSin = { value: 0 };
  const limb = planet && { center: planet.center.clone(), radius: planet.radius };
  const material = new ShaderMaterial({
    name: 'PaintedSky',
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new Color(theme.sky.zenith) },
      uHorizon: { value: new Color(theme.sky.horizon) },
      uGround: { value: new Color(theme.sky.ground) },
      uCloudLit: { value: new Color(theme.sky.cloudLit) },
      uCloudShadow: { value: new Color(theme.sky.cloudShadow) },
      uSunDirection: { value: sunDirection.clone().normalize() },
      uSunColor: { value: new Color(theme.sun.color) },
      uUp: { value: up },
      uDipCos: dipCos,
      uDipSin: dipSin,
      uGroundMix: { value: limb ? 0 : 1 },
      uBrush: { value: brush },
    },
    vertexShader,
    fragmentShader,
  });
  const mesh = new Mesh(new SphereGeometry(1000, 48, 24), material);
  mesh.name = 'painted_sky';
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.layers.set(LAYERS.sky);
  return {
    mesh,
    follow(camera) {
      // The world position: a camera parented to a rig would otherwise leave the dome, and the limb, behind.
      camera.getWorldPosition(mesh.position);
      if (!limb) return;
      const distance = up.subVectors(mesh.position, limb.center).length();
      up.normalize();
      // The limb's dip below the horizontal is acos(radius / distance); the shader turns heights down by it.
      dipCos.value = MathUtils.clamp(limb.radius / distance, 0, 1);
      dipSin.value = Math.sqrt(1 - dipCos.value * dipCos.value);
    },
  };
}
