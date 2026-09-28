import { Color, Group, PerspectiveCamera, Texture, Vector3, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createPaintedSky } from '../../../src/render/sky';
import { sunDirection, VERDANT } from '../../../src/render/themes';

const sun = new Vector3(...sunDirection(VERDANT));
const uniformsOf = (mesh: { material: unknown }) => (mesh.material as ShaderMaterial).uniforms;

describe('createPaintedSky', () => {
  it('keeps the flat horizon without a planet', () => {
    const sky = createPaintedSky(VERDANT, new Texture(), sun);
    const camera = new PerspectiveCamera();
    camera.position.set(0, 38, 30);
    camera.updateMatrixWorld();
    sky.follow(camera);
    const u = uniformsOf(sky.mesh);
    expect((u['uUp']!.value as Vector3).toArray()).toEqual([0, 1, 0]);
    expect(u['uDipCos']!.value).toBe(1);
    expect(u['uDipSin']!.value).toBe(0);
    expect(u['uGroundMix']!.value).toBe(1);
    expect(sky.mesh.position.toArray()).toEqual([0, 38, 30]);
  });

  it('turns the horizon down to the limb of the planet under the camera', () => {
    const sky = createPaintedSky(VERDANT, new Texture(), sun, { center: new Vector3(0, -160, 0), radius: 160 });
    const camera = new PerspectiveCamera();
    camera.position.set(0, 38, 30);
    camera.updateMatrixWorld();
    sky.follow(camera);
    const u = uniformsOf(sky.mesh);
    const up = u['uUp']!.value as Vector3;
    const expected = new Vector3(0, 198, 30).normalize();
    expect(up.distanceTo(expected)).toBeLessThan(1e-12);
    const dipCos = u['uDipCos']!.value as number;
    expect(dipCos).toBeCloseTo(160 / Math.hypot(198, 30), 12);
    expect(u['uDipSin']!.value).toBeCloseTo(Math.sqrt(1 - dipCos * dipCos), 12);
    // Below the limb, sky shows only through dips in the terrain's silhouette: ground colour there is a false horizon.
    expect(u['uGroundMix']!.value).toBe(0);
    expect(sky.mesh.position.toArray()).toEqual(camera.position.toArray());
  });

  it('follows the camera in the world when the camera rides a rig', () => {
    // The camera's local position would put the dome 30 m low and tilt the horizon toward the wrong point.
    const sky = createPaintedSky(VERDANT, new Texture(), sun, { center: new Vector3(0, -160, 0), radius: 160 });
    const rig = new Group();
    rig.position.set(0, 30, 0);
    const camera = new PerspectiveCamera();
    camera.position.set(0, 8, 30);
    rig.add(camera);
    sky.follow(camera);
    expect(sky.mesh.position.toArray()).toEqual([0, 38, 30]);
    expect((uniformsOf(sky.mesh)['uUp']!.value as Vector3).distanceTo(new Vector3(0, 198, 30).normalize())).toBeLessThan(1e-12);
  });

  it('declares every uniform it is given, and nothing else', () => {
    // A uniform the GLSL declares but the material lacks silently reads 0, and one the material holds but the GLSL lacks
    // is silently dropped: no error anywhere, only a wrong sky.
    const material = createPaintedSky(VERDANT, new Texture(), sun).mesh.material as ShaderMaterial;
    const declared = [...`${material.vertexShader}\n${material.fragmentShader}`.matchAll(/^\s*uniform\s+\w+\s+(\w+)\s*;/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual(Object.keys(material.uniforms).sort());
    expect(declared).toContain('uDipCos');
    expect(declared).toContain('uDipSin');
    expect(declared).toContain('uGroundMix');
  });

  it('measures heights from the limb, and keeps the ground colour off a planet sky', () => {
    // The uniforms can all hold the right values while the shader stops reading them; these are the lines that do.
    const { fragmentShader } = createPaintedSky(VERDANT, new Texture(), sun).mesh.material as ShaderMaterial;
    expect(fragmentShader).toContain('float h = s * uDipCos + sqrt(max(1.0 - s * s, 0.0)) * uDipSin;');
    expect(fragmentShader).toContain('mix(uHorizon, uGround, pow(-h, 0.35) * uGroundMix)');
  });

  it('follows the sun dials: direction and colour at creation and when they move', () => {
    const sky = createPaintedSky(VERDANT, new Texture(), new Vector3(0, 2, 0));
    const u = uniformsOf(sky.mesh);
    expect((u['uSunDirection']!.value as Vector3).toArray()).toEqual([0, 1, 0]);
    expect((u['uSunColor']!.value as Color).getHexString()).toBe(new Color(VERDANT.sun.color).getHexString());
    sky.setSun(new Vector3(3, 0, 4), '#ff9a55');
    expect((u['uSunDirection']!.value as Vector3).distanceTo(new Vector3(0.6, 0, 0.8))).toBeLessThan(1e-12);
    expect((u['uSunColor']!.value as Color).getHexString()).toBe(new Color('#ff9a55').getHexString());
    // The disc, its glow and the clouds' lit side are the lines that read them.
    const { fragmentShader } = sky.mesh.material as ShaderMaterial;
    expect(fragmentShader).toContain('float sunSide = dot(d, uSunDirection) * 0.5 + 0.5;');
    expect(fragmentShader).toContain('color += uSunColor * (pow(sunward, 900.0) * 8.0 + pow(sunward, 14.0) * 0.3) * (1.0 - cloud * 0.8);');
  });

  it('writes an emissive key of 0, so the bloom never reads the sky, sun disc included, as energy', () => {
    const material = createPaintedSky(VERDANT, new Texture(), sun).mesh.material as ShaderMaterial;
    expect(material.fragmentShader).toContain('gl_FragColor = vec4(color, 0.0);');
    expect(material.fragmentShader).not.toContain('vec4(color, 1.0)');
    expect(material.transparent).toBe(false);
  });
});
