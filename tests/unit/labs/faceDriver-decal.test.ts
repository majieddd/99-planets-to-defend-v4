import { BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, Texture, Vector2, type ShaderMaterial } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommanderFace } from '../../../src/labs/shared/commanderFace';
import {
  BLINK_CLOSE_SECONDS,
  BLINK_OPEN_SECONDS,
  DECAL_CLOSED_CLOSURE,
  DECAL_HALF_CLOSURE,
  DOUBLE_BLINK_CHANCE,
  FaceDriver,
  TALK_FLAP_SECONDS,
  type EyeState,
  type MouthState,
} from '../../../src/labs/shared/faceDriver';
import { paintAndInk } from '../../../src/render/assets/loadAsset';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';
import { LAYERS } from '../../../src/render/layers';
import { createPaintUniforms, decalCellOffset, type DecalAtlas } from '../../../src/render/materials/painted';
import { VERDANT } from '../../../src/render/themes';

const ctx = { paint: createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture()), hullMaterial: createHullMaterial(createInkUniforms(DEFAULT_DIALS)), hullLayer: LAYERS.hull };
const EYES = ['open', 'half', 'closed', 'happy'];
const MOUTH = ['neutral', 'smile', 'talk', 'o'];
const FRAME = 1 / 60;

afterEach(() => vi.restoreAllMocks());

// A decal head as the loader paints it: face_eyes and face_mouth under p99_atlas extras, optionally beside a body that
// carries the morph face, so one rig can hold both kinds.
function decalHead(options: { eyes?: string[]; mouth?: string[]; morphs?: boolean } = {}): { root: Group; eyes: Mesh; mouth: Mesh; body: Mesh | null } {
  const root = new Group();
  const decal = (name: string, states: string[]) => {
    const mesh = new Mesh(new SphereGeometry(0.1, 6, 4), new MeshStandardMaterial({ map: new Texture() }));
    mesh.name = name;
    mesh.userData['p99_atlas'] = { cols: 4, rows: 1, states };
    root.add(mesh);
    return mesh;
  };
  const eyes = decal('face_eyes', options.eyes ?? EYES);
  const mouth = decal('face_mouth', options.mouth ?? MOUTH);
  let body: Mesh | null = null;
  if (options.morphs) {
    const geometry = new BoxGeometry(0.2, 0.24, 0.2);
    const count = geometry.getAttribute('position').count;
    geometry.morphAttributes['position'] = ['blink_L', 'blink_R'].map((name) => {
      const attribute = new Float32BufferAttribute(new Float32Array(count * 3), 3);
      attribute.name = name;
      return attribute;
    });
    geometry.morphTargetsRelative = true;
    body = new Mesh(geometry, new MeshBasicMaterial());
    body.name = 'commander_body';
    root.add(body);
  }
  paintAndInk(root, ctx, 0.35);
  return { root, eyes, mouth, body };
}

// Draws that come back in the order given, then 0.5 forever: the first is the first wait (0 is 2.5 s), the second the
// double-blink draw (0.9 is none).
function draws(...values: number[]): () => number {
  return () => values.shift() ?? 0.5;
}

const offsetOf = (mesh: Mesh): Vector2 => (mesh.material as ShaderMaterial).uniforms['uCellOffset']?.value as Vector2;
const atlasOf = (mesh: Mesh): DecalAtlas => (mesh.material as ShaderMaterial).userData['decalAtlas'] as DecalAtlas;
const cellOf = (mesh: Mesh, state: string): Vector2 => decalCellOffset(atlasOf(mesh), atlasOf(mesh).states.indexOf(state), new Vector2());

/** Steps the driver and records the eye state and its cell offset at every step's end. */
function trace(driver: FaceDriver, eyes: Mesh, seconds: number, step: number): { state: string; offset: Vector2 }[] {
  const out: { state: string; offset: Vector2 }[] = [];
  for (let t = 0; t < seconds - 1e-9; t += step) {
    driver.update(step);
    out.push({ state: driver.eyes, offset: offsetOf(eyes).clone() });
  }
  return out;
}

/** Consecutive repeats collapsed, with each run's length in steps. */
function runs(states: string[]): { state: string; length: number }[] {
  const out: { state: string; length: number }[] = [];
  for (const state of states) {
    const last = out.at(-1);
    if (last?.state === state) last.length += 1;
    else out.push({ state, length: 1 });
  }
  return out;
}

describe('the face driver on a decal face', () => {
  it('finds the decals and blinks them open, half, closed, half, open on the morph lids\' timing', () => {
    const { root, eyes } = decalHead();
    const driver = new FaceDriver(root, { random: draws(0, 0.9) });
    expect(driver.faceKind).toBe('decal');
    expect(driver.decals.map((decal) => decal.mesh.name)).toEqual(['face_eyes', 'face_mouth']);
    const step = 1e-4;
    const samples = trace(driver, eyes, 2.5 + BLINK_CLOSE_SECONDS + BLINK_OPEN_SECONDS + 0.05, step);
    // The cell each step shows is the state's own.
    for (const { state, offset } of samples) expect(offset).toEqual(cellOf(eyes, state));
    const blink = runs(samples.map((s) => s.state));
    expect(blink.map((r) => r.state)).toEqual(['open', 'half', 'closed', 'half', 'open']);
    // The morph lids' smoothstep crosses DECAL_HALF_CLOSURE and DECAL_CLOSED_CLOSURE at 0.326 and 0.674 of each phase.
    expect([DECAL_HALF_CLOSURE, DECAL_CLOSED_CLOSURE]).toEqual([0.25, 0.75]);
    const ms = (r: { length: number }) => r.length * step * 1000;
    expect(ms(blink[0]!)).toBeCloseTo(2500 + 0.3264 * 60, 0);
    expect(ms(blink[1]!)).toBeCloseTo(0.3473 * 60, 0);
    expect(ms(blink[2]!)).toBeCloseTo(0.3264 * 60 + 0.3264 * 90, 0);
    expect(ms(blink[3]!)).toBeCloseTo(0.3473 * 90, 0);
  });

  it('shows the half cell on the way down and up in every blink drawn at 60 fps, whatever the frame phase', () => {
    for (let phase = 0; phase < FRAME; phase += 0.001) {
      const { root, eyes } = decalHead();
      const driver = new FaceDriver(root, { random: draws(0, 0.9) });
      driver.update(2.45 + phase);
      const blink = runs(trace(driver, eyes, 0.3, FRAME).map((s) => s.state)).map((r) => r.state);
      expect(blink, `phase ${phase.toFixed(3)} s`).toEqual(['open', 'half', 'closed', 'half', 'open']);
    }
  });

  it('blinks the cells twice for a double blink', () => {
    const { root, eyes } = decalHead();
    const driver = new FaceDriver(root, { random: draws(0, DOUBLE_BLINK_CHANCE / 2, 0.99) });
    const states = runs(trace(driver, eyes, 3.2, 1e-3).map((s) => s.state)).map((r) => r.state);
    expect(states).toEqual(['open', 'half', 'closed', 'half', 'open', 'half', 'closed', 'half', 'open']);
  });

  it('holds a set eye state through the blinks, hands open eyes back to them, and closes them for a blink hold', () => {
    const { root, eyes } = decalHead();
    const driver = new FaceDriver(root, { random: draws(0, 0.9) });
    expect(driver.setEyes('happy')).toBe(true);
    expect(offsetOf(eyes)).toEqual(cellOf(eyes, 'happy'));
    // Through the whole first blink the happy eyes hold, while the lids' closure runs on underneath.
    const held = trace(driver, eyes, 2.5 + BLINK_CLOSE_SECONDS, 1e-3);
    expect(driver.blink).toBeGreaterThan(0.9);
    expect(new Set(held.map((s) => s.state))).toEqual(new Set(['happy']));
    // Set open mid-blink, the eyes join the blink where it is.
    expect(driver.setEyes('open')).toBe(true);
    expect(driver.eyes).toBe('closed');
    driver.update(BLINK_OPEN_SECONDS);
    expect(driver.eyes).toBe('open');
    // Half holds too: a blink from half would read as a flicker.
    driver.setEyes('half');
    expect(new Set(trace(driver, eyes, 6, 1e-2).map((s) => s.state))).toEqual(new Set(['half']));
    driver.setEyes('open');
    driver.setBlinkHold(1);
    expect([driver.eyes, offsetOf(eyes).x]).toEqual(['closed', 0.5]);
    driver.setBlinkHold(0.5);
    expect(driver.eyes).toBe('half');
    driver.setBlinkHold(null);
  });

  it('holds a mouth state, flaps talk and neutral every 125 ms while talking, and returns to the held mouth', () => {
    const { root, eyes, mouth } = decalHead();
    const driver = new FaceDriver(root, { random: draws(0, 0.9) });
    expect(offsetOf(mouth)).toEqual(cellOf(mouth, 'neutral'));
    expect(driver.setMouth('smile')).toBe(true);
    expect(offsetOf(mouth)).toEqual(cellOf(mouth, 'smile'));
    driver.setTalking(true);
    expect(TALK_FLAP_SECONDS).toBe(0.125);
    const flap: string[] = [];
    for (let i = 0; i < 100; i++) {
      driver.update(0.01);
      flap.push(driver.mouth);
      expect(offsetOf(mouth)).toEqual(cellOf(mouth, driver.mouth));
    }
    // Talk first, then neutral, each 12 or 13 steps of 10 ms: 125 ms.
    const flaps = runs(flap);
    expect(flaps.map((r) => r.state)).toEqual(['talk', 'neutral', 'talk', 'neutral', 'talk', 'neutral', 'talk', 'neutral', 'talk']);
    for (const r of flaps.slice(1, -1)) expect([12, 13]).toContain(r.length);
    // Frozen, the mouth holds mid-cycle, and so do the eyes.
    driver.setFrozen(true);
    const [mouthNow, eyesNow] = [driver.mouth, offsetOf(eyes).clone()];
    for (let i = 0; i < 50; i++) driver.update(FRAME);
    expect([driver.mouth, offsetOf(eyes)]).toEqual([mouthNow, eyesNow]);
    driver.setFrozen(false);
    driver.setTalking(false);
    expect([driver.mouth, offsetOf(mouth)]).toEqual(['smile', cellOf(mouth, 'smile')]);
  });

  it('refuses an unknown state, or one no atlas names, with a warning, and keeps the face as it was', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { root, eyes, mouth } = decalHead({ eyes: ['open', 'half', 'closed'], mouth: ['neutral', 'smile', 'o'] });
    const driver = new FaceDriver(root, { random: draws(0, 0.9) });
    driver.setEyes('closed');
    expect(driver.setEyes('wink' as EyeState)).toBe(false);
    expect(warn.mock.calls.at(-1)?.[0]).toBe('face: "wink" is not an eye state (open, half, closed, happy), so the eyes stay as they were');
    expect(driver.setMouth('open' as MouthState)).toBe(false);
    expect(warn.mock.calls.at(-1)?.[0]).toBe('face: "open" is not a mouth state (neutral, smile, talk, o), so the mouth stays as it was');
    expect(driver.setEyes('happy')).toBe(false);
    expect(warn.mock.calls.at(-1)?.[0]).toBe('face: no eye decal has a cell named "happy", so the eyes stay as they were');
    expect([driver.eyes, offsetOf(eyes)]).toEqual(['closed', cellOf(eyes, 'closed')]);
    expect(offsetOf(mouth)).toEqual(cellOf(mouth, 'neutral'));
    driver.setTalking(true);
    expect(warn.mock.calls.at(-1)?.[0]).toBe('face: no mouth decal has a cell named "talk", so talking shows nothing');
    // Talking without a talk cell shows the held mouth, whatever the flap.
    for (let i = 0; i < 30; i++) {
      driver.update(0.01);
      expect(offsetOf(mouth)).toEqual(cellOf(mouth, 'neutral'));
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('blinks an atlas without a half cell open, closed, open', () => {
    const { root, eyes } = decalHead({ eyes: ['open', 'closed'] });
    const driver = new FaceDriver(root, { random: draws(0, 0.9) });
    const cells = runs(trace(driver, eyes, 2.7, 1e-3).map((s) => String(s.offset.x))).map((r) => r.state);
    expect(cells).toEqual(['0', '0.25', '0']);
  });

  it('drives the lids and the eye cells together on a face with both, and refuses decal states on a morph face', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { root, eyes, body } = decalHead({ morphs: true });
    const driver = createCommanderFace(root, 1) as FaceDriver;
    expect(driver.faceKind).toBe('both');
    driver.setBlinkHold(0.9);
    const lid = (body!.morphTargetInfluences as number[])[body!.morphTargetDictionary!['blink_L']!];
    expect([lid, driver.eyes, offsetOf(eyes)]).toEqual([0.9, 'closed', cellOf(eyes, 'closed')]);
    // A morph face alone has no decal to set, and says so.
    const morphOnly = new Group();
    morphOnly.add(body!);
    const pip = new FaceDriver(morphOnly, { random: draws(0, 0.9) });
    expect([pip.faceKind, pip.decals.length]).toEqual(['morph', 0]);
    expect(pip.setEyes('closed')).toBe(false);
    expect(warn.mock.calls.at(-1)?.[0]).toBe('face: no eye decal has a cell named "closed", so the eyes stay as they were');
    // Bulwark's visored rig has neither, and the labs leave it alone.
    expect(createCommanderFace(new Group().add(new Mesh(new BoxGeometry(), new MeshBasicMaterial())), 1)).toBeNull();
  });
});
