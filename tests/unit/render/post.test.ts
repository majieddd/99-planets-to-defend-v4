import { Color, Matrix4, PerspectiveCamera, Texture, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS, type RenderDials } from '../../../src/render/defaults';
import { FinishEffect } from '../../../src/render/post/finishEffect';
import { FogEffect } from '../../../src/render/post/fogEffect';
import { GradeEffect } from '../../../src/render/post/gradeEffect';
import { edgeFadeRange, InkEdgeEffect } from '../../../src/render/post/inkEdgeEffect';
import { VERDANT, type Theme } from '../../../src/render/themes';

type Uniforms = Map<string, { value: unknown }>;

const value = (uniforms: Uniforms, name: string): unknown => uniforms.get(name)?.value;
const hex = (uniforms: Uniforms, name: string): string => (value(uniforms, name) as Color).getHexString();
const ink = (dials: RenderDials): InkEdgeEffect => new InkEdgeEffect(new PerspectiveCamera(), new Texture(), new Texture(), dials);

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
    const inkEffect = new InkEdgeEffect(camera, new Texture(), new Texture(), DEFAULT_DIALS);
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
