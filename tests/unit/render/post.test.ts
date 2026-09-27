import { Color, DepthTexture, FloatType, Matrix4, PerspectiveCamera, Texture, Vector2, Vector3, WebGLRenderTarget } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS, type RenderDials } from '../../../src/render/defaults';
import { FinishEffect } from '../../../src/render/post/finishEffect';
import { FogEffect } from '../../../src/render/post/fogEffect';
import { GradeEffect } from '../../../src/render/post/gradeEffect';
import { COVER_TOLERANCE, edgeFadeRange, InkEdgeEffect } from '../../../src/render/post/inkEdgeEffect';
import { VERDANT, type Theme } from '../../../src/render/themes';

type Uniforms = Map<string, { value: unknown }>;

const value = (uniforms: Uniforms, name: string): unknown => uniforms.get(name)?.value;
const hex = (uniforms: Uniforms, name: string): string => (value(uniforms, name) as Color).getHexString();
/** The normal pass's target as the pipeline builds it: normals in colour, the edge set's depth in a depth texture. */
const edgeBuffers = (width = 1920, height = 1080): WebGLRenderTarget =>
  new WebGLRenderTarget(width, height, { depthTexture: new DepthTexture(width, height, FloatType) });
const ink = (dials: RenderDials): InkEdgeEffect => new InkEdgeEffect(new PerspectiveCamera(), edgeBuffers(), new Texture(), dials);

describe('ink edge fade range', () => {
  // The two fade sliders overlap and move independently, and a pasted dials link can carry any pair.
  const cases: Array<{ near: number; far: number; expected: [number, number] }> = [
    { near: 60, far: 180, expected: [60, 180] },
    { near: 300, far: 10, expected: [10, 300] },
    { near: 100, far: 100, expected: [100, 101] },
  ];
  const fade = (effect: InkEdgeEffect): unknown[] => [value(effect.uniforms, 'uFadeNear'), value(effect.uniforms, 'uFadeFar')];

  it('passes an ordered pair through and puts any other pair in strict order', () => {
    for (const { near, far, expected } of cases) {
      expect(edgeFadeRange({ ...DEFAULT_DIALS, edgeFadeNear: near, edgeFadeFar: far })).toEqual(expected);
    }
  });

  it('orders the pair before the shader sees it, at construction and on a live move', () => {
    for (const { near, far, expected } of cases) {
      const dials = { ...DEFAULT_DIALS, edgeFadeNear: near, edgeFadeFar: far };
      expect(fade(ink(dials))).toEqual(expected);
      // Starts from a pair unlike every expected result, so a dropped write in setDials fails.
      const moved = ink({ ...DEFAULT_DIALS, edgeFadeNear: 42, edgeFadeFar: 420 });
      expect(fade(moved)).toEqual([42, 420]);
      moved.setDials(dials);
      expect(fade(moved)).toEqual(expected);
    }
  });
});

describe('post effect dials', () => {
  // Inside their ranges, off their defaults and apart from each other, so a dropped or cross-wired line fails.
  const changed: RenderDials = {
    ...DEFAULT_DIALS,
    inkColor: '#3a1f5c',
    edgeStrength: 0.47,
    edgeLineWidth: 2.35,
    depthThreshold: 0.115,
    normalThreshold: 0.62,
    fogDensity: 0.0185,
    fogStart: 73,
    fogHeightFalloff: 0.215,
    exposure: 1.63,
    contrast: 1.27,
    grain: 0.135,
    vignette: 0.71,
  };
  const theme: Theme = {
    ...VERDANT,
    fog: { color: '#123456', sunColor: '#654321' },
    grade: { shadows: '#abcdef', highlights: '#fedcba' },
  };
  const sun = new Vector3(0, 1, 0);

  function expectChanged(inkEffect: InkEdgeEffect, fog: FogEffect, grade: GradeEffect, finish: FinishEffect): void {
    expect(hex(inkEffect.uniforms, 'uInkColor')).toBe(new Color(changed.inkColor).getHexString());
    expect(value(inkEffect.uniforms, 'uInkStrength')).toBe(changed.edgeStrength);
    expect(value(inkEffect.uniforms, 'uLineWidth')).toBe(changed.edgeLineWidth);
    expect(value(inkEffect.uniforms, 'uDepthThreshold')).toBe(changed.depthThreshold);
    expect(value(inkEffect.uniforms, 'uNormalThreshold')).toBe(changed.normalThreshold);
    expect(value(fog.uniforms, 'uDensity')).toBe(changed.fogDensity);
    expect(value(fog.uniforms, 'uStart')).toBe(changed.fogStart);
    expect(value(fog.uniforms, 'uHeightFalloff')).toBe(changed.fogHeightFalloff);
    expect(hex(fog.uniforms, 'uFogColor')).toBe(new Color(theme.fog.color).getHexString());
    expect(hex(fog.uniforms, 'uFogSunColor')).toBe(new Color(theme.fog.sunColor).getHexString());
    expect(value(grade.uniforms, 'uExposure')).toBe(changed.exposure);
    expect(value(grade.uniforms, 'uContrast')).toBe(changed.contrast);
    expect(hex(grade.uniforms, 'uShadowGrade')).toBe(new Color(theme.grade.shadows).getHexString());
    expect(hex(grade.uniforms, 'uHighlightGrade')).toBe(new Color(theme.grade.highlights).getHexString());
    expect(value(finish.uniforms, 'uGrain')).toBe(changed.grain);
    expect(value(finish.uniforms, 'uVignette')).toBe(changed.vignette);
  }

  it('reach their uniforms at construction', () => {
    expectChanged(ink(changed), new FogEffect(new PerspectiveCamera(), theme, sun, changed), new GradeEffect(theme, changed), new FinishEffect(changed, false));
  });

  it('reach their uniforms on a live move', () => {
    const inkEffect = ink(DEFAULT_DIALS);
    const fog = new FogEffect(new PerspectiveCamera(), VERDANT, sun, DEFAULT_DIALS);
    const grade = new GradeEffect(VERDANT, DEFAULT_DIALS);
    const finish = new FinishEffect(DEFAULT_DIALS, false);
    inkEffect.setDials(changed);
    fog.setDials(changed, theme);
    grade.setDials(changed, theme);
    finish.setDials(changed);
    expectChanged(inkEffect, fog, grade, finish);
  });

  it('freeze the grain under reduced motion', () => {
    const still = new FinishEffect(DEFAULT_DIALS, true);
    const moving = new FinishEffect(DEFAULT_DIALS, false);
    still.tick(0.5);
    moving.tick(0.5);
    expect(value(still.uniforms, 'uSeed')).toBe(0);
    expect(value(moving.uniforms, 'uSeed')).toBe(12);
  });
});

describe('post effect frame state', () => {
  const vector = (uniforms: Uniforms, name: string): number[] => (value(uniforms, name) as Vector2).toArray();
  const matrix = (uniforms: Uniforms, name: string): number[] => (value(uniforms, name) as Matrix4).toArray();

  it('takes the buffer size on resize', () => {
    // Off the 1920x1080 construction value and unequal, so a dropped write or swapped axes fails.
    const inkEffect = ink(DEFAULT_DIALS);
    const finish = new FinishEffect(DEFAULT_DIALS, false);
    inkEffect.setSize(1366, 640);
    finish.setSize(1366, 640);
    expect(vector(inkEffect.uniforms, 'uTexel')).toEqual([1 / 1366, 1 / 640]);
    expect(vector(finish.uniforms, 'uResolution')).toEqual([1366, 640]);
  });

  it('copies the camera matrices on update', () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 2500);
    const inkEffect = new InkEdgeEffect(camera, edgeBuffers(), new Texture(), DEFAULT_DIALS);
    const fog = new FogEffect(camera, VERDANT, new Vector3(0, 1, 0), DEFAULT_DIALS);
    // The uniforms start as identity, so the camera moves first or a dropped copy would still match it.
    camera.position.set(3, 7, -2);
    camera.lookAt(0, 1, -10);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const identity = new Matrix4().toArray();
    expect(camera.matrixWorld.toArray()).not.toEqual(identity);
    expect(camera.projectionMatrixInverse.toArray()).not.toEqual(identity);
    for (const effect of [inkEffect, fog]) {
      effect.update();
      expect(matrix(effect.uniforms, 'uProjectionInverse')).toEqual(camera.projectionMatrixInverse.toArray());
      expect(matrix(effect.uniforms, 'uViewInverse')).toEqual(camera.matrixWorld.toArray());
    }
  });
});

describe('ink edge buffers', () => {
  const vector = (uniforms: Uniforms, name: string): number[] => (value(uniforms, name) as Vector2).toArray();
  // Only the GPU runs the shader, so these hold the lines that carry the behaviour.
  const shader = ink(DEFAULT_DIALS).getFragmentShader();

  it('reads normals and the edge depth from the normal pass target, and refuses a target without depth', () => {
    const edges = edgeBuffers();
    const effect = new InkEdgeEffect(new PerspectiveCamera(), edges, new Texture(), DEFAULT_DIALS);
    expect(value(effect.uniforms, 'uNormalBuffer')).toBe(edges.texture);
    expect(value(effect.uniforms, 'uEdgeDepth')).toBe(edges.depthTexture);
    expect(value(effect.uniforms, 'uCoverTolerance')).toBe(COVER_TOLERANCE);
    expect(() => new InkEdgeEffect(new PerspectiveCamera(), new WebGLRenderTarget(4, 4), new Texture(), DEFAULT_DIALS)).toThrow(/depth texture/);
  });

  it('floors its taps at one texel of the edge buffers, which the medium tier draws at 0.75 scale', () => {
    // 1440 x 810 is the normal pass at 0.75 of 1920 x 1080. Read on update, whichever the composer resizes first.
    const edges = edgeBuffers(1920, 1080);
    const effect = new InkEdgeEffect(new PerspectiveCamera(), edges, new Texture(), DEFAULT_DIALS);
    effect.setSize(1920, 1080);
    edges.setSize(1440, 810);
    effect.update();
    expect(vector(effect.uniforms, 'uEdgeTexel')).toEqual([1 / 1440, 1 / 810]);
    expect(vector(effect.uniforms, 'uTexel')).toEqual([1 / 1920, 1 / 1080]);
    expect(shader).toContain('vec2 offset = max(uTexel * uLineWidth * mix(0.6, 1.4, wobble), uEdgeTexel);');
  });

  it('runs its depth test and distance fade on the edge depth, not on the main depth', () => {
    // On the main depth, which also holds grass, flowers and hulls, it outlined every grass cone.
    expect(shader).toContain('return -getViewZ(texture2D(uEdgeDepth, coord).r);');
    expect(shader).toContain('float edgeDepth = texture2D(uEdgeDepth, uv).r;');
    expect(shader).toContain('float d = -getViewZ(edgeDepth);');
    expect(shader).toContain('float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, d);');
    expect(shader).toContain('smoothstep(uDepthThreshold, uDepthThreshold * 2.0, (farthest - d) / d)');
    // The main depth reaches the shader only as mainImage's depth argument, for the cover test.
    expect(shader).not.toContain('readDepth(');
    expect(shader.match(/getViewZ\(depth\)/g)).toHaveLength(1);
  });

  it('keeps ink off pixels something outside the edge set covers', () => {
    expect(shader).toContain('float nearest = min(d, min(min(right, left), min(up, down)));');
    expect(shader).toContain('float covered = step(-getViewZ(depth), nearest * (1.0 - uCoverTolerance));');
    expect(shader).toContain('mix(inputColor.rgb, uInkColor, edge * uInkStrength * (1.0 - covered))');
    // Alpha is the emissive key on its way to the bloom.
    expect(shader).toContain('inputColor.a);');
  });

  it('declares every uniform it is given, and nothing else', () => {
    const declared = [...shader.matchAll(/^\s*uniform\s+\w+\s+(\w+)\s*;/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...ink(DEFAULT_DIALS).uniforms.keys()].sort());
  });
});

describe('fog alpha', () => {
  it('passes the emissive key in alpha through on every write', () => {
    // Fog sits between the scene and the bloom, so an opaque write here would hand every pixel the full key and bloom
    // the whole frame. Only the GPU runs the shader, so this holds each of its writes, the sky's early return included.
    const shader = new FogEffect(new PerspectiveCamera(), VERDANT, new Vector3(0, 1, 0), DEFAULT_DIALS).getFragmentShader();
    expect(shader.match(/outputColor = [^;]+;/g)).toEqual([
      'outputColor = inputColor;',
      'outputColor = vec4(mix(inputColor.rgb, mix(uFogColor, uFogSunColor, sun), amount), inputColor.a);',
    ]);
  });
});

describe('height fog', () => {
  const planet = { center: new Vector3(0, -160, 0), radius: 160 };
  const fog = (withPlanet: boolean, dials: RenderDials = DEFAULT_DIALS): FogEffect =>
    new FogEffect(new PerspectiveCamera(), VERDANT, new Vector3(0, 1, 0), dials, withPlanet ? planet : undefined);
  // Only the GPU runs the shader, so these hold the lines that carry the behaviour.
  const shader = fog(true).getFragmentShader();

  it('turns on only for a planet, which it measures altitude from', () => {
    const on = fog(true);
    expect(on.defines.get('FOG_PLANET')).toBe('1');
    expect((value(on.uniforms, 'uPlanetCenter') as Vector3).toArray()).toEqual([0, -160, 0]);
    expect(value(on.uniforms, 'uPlanetRadius')).toBe(160);
    // A clone: moving the caller's vector afterwards must not move the fog's planet.
    planet.center.y = -1;
    expect((value(on.uniforms, 'uPlanetCenter') as Vector3).y).toBe(-160);
    planet.center.y = -160;
    const off = fog(false);
    expect(off.defines.has('FOG_PLANET')).toBe(false);
    // GLSL loop bounds and the float() of the step count need an integer literal.
    expect(off.defines.get('FOG_STEPS')).toMatch(/^\d+$/);
  });

  it('is the distance fog without a planet or at a falloff of 0, so the default look is unchanged', () => {
    expect(DEFAULT_DIALS.fogHeightFalloff).toBe(0);
    expect(shader).toContain('#ifdef FOG_PLANET\n    float travelled = fogLength(uViewInverse[3].xyz, direction, length(view.xyz));\n  #else\n    float travelled = max(length(view.xyz) - uStart, 0.0);\n  #endif');
    expect(shader).toContain('float near = min(uStart, far);');
    expect(shader).toContain('if (uHeightFalloff <= 0.0) return far - near;');
    expect(shader).toContain('float amount = 1.0 - exp(-pow(travelled * uDensity, 1.5));');
  });

  it('weights each metre by altitude above the sphere, integrating each segment exactly for a linear altitude', () => {
    expect(shader).toContain('return max(length(p - uPlanetCenter) - uPlanetRadius, 0.0);');
    expect(shader).toContain('float segment = (far - near) / float(FOG_STEPS);');
    // Each exponential is of a non-positive number, so neither can overflow; fog-length.test.ts runs these lines in fp32.
    expect(shader).toContain('float e0 = exp(-uHeightFalloff * h0);');
    expect(shader).toContain('float e1 = exp(-uHeightFalloff * h1);');
    expect(shader).toContain('float x = uHeightFalloff * (h1 - h0);');
    expect(shader).toContain('total += segment * (abs(x) > 1e-3 ? (e0 - e1) / x : e0 * (1.0 - 0.5 * x));');
    expect(shader).toContain('h0 = h1;\n    e0 = e1;');
    // e^-x of a long descending segment passed fp32's limit and made the fog NaN (the form this replaced).
    expect(shader).not.toMatch(/exp\(-x\)/);
  });

  it('keeps its sunward warming on the sun it is given, at construction and when the sun moves', () => {
    const effect = new FogEffect(new PerspectiveCamera(), VERDANT, new Vector3(0, 2, 0), DEFAULT_DIALS, planet);
    expect((value(effect.uniforms, 'uSunDirection') as Vector3).toArray()).toEqual([0, 1, 0]);
    effect.setSunDirection(new Vector3(0, 3, -4));
    expect((value(effect.uniforms, 'uSunDirection') as Vector3).distanceTo(new Vector3(0, 0.6, -0.8))).toBeLessThan(1e-12);
    expect(shader).toContain('float sun = pow(max(dot(direction, uSunDirection), 0.0), 6.0);');
  });

  it('declares every uniform it is given, and nothing else', () => {
    const declared = [...shader.matchAll(/^\s*uniform\s+\w+\s+(\w+)\s*;/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...fog(true).uniforms.keys()].sort());
  });
});
