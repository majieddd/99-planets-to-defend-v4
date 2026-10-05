import {
  Bone,
  BoxGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderChunk,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { attachHull, createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';
import { createPaintedMaterial, createPaintUniforms } from '../../../src/render/materials/painted';
import { VERDANT } from '../../../src/render/themes';
import { createMockRenderer } from './mockWebGl';

const LID_DROP = 0.05;
const paint = createPaintUniforms(VERDANT, DEFAULT_DIALS, null);

// A skinned head, a box 0.24 m tall on one bone, whose blink_L target drops its top face 5 cm, and which carries ink.
function morphedHead(morph = true): { root: Group; body: SkinnedMesh; top: number } {
  const geometry = new BoxGeometry(0.2, 0.24, 0.2);
  const position = geometry.getAttribute('position');
  const count = position.count;
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0, 0]).flat(), 4));
  geometry.setAttribute('inkWidth', new Float32BufferAttribute(new Array(count).fill(0.5), 1));
  let top = -1;
  if (morph) {
    const drop = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      if (position.getY(i) > 0.1) {
        drop[i * 3 + 1] = -LID_DROP;
        top = i;
      }
    }
    const target = new Float32BufferAttribute(drop, 3);
    target.name = 'blink_L';
    geometry.morphAttributes['position'] = [target];
    geometry.morphTargetsRelative = true;
  }
  const bone = new Bone();
  const body = new SkinnedMesh(geometry, createPaintedMaterial(paint, { standardBlend: 0.35 }));
  body.name = 'commander_body';
  body.add(bone);
  body.bind(new Skeleton([bone]));
  const root = new Group();
  root.add(body);
  return { root, body, top };
}

function sceneWith(root: Group): { scene: Scene; camera: PerspectiveCamera } {
  const scene = new Scene();
  scene.add(root, new DirectionalLight(0xffffff, 1));
  const camera = new PerspectiveCamera(50, 1, 0.1, 10);
  camera.position.set(0, 0, 2);
  camera.layers.enable(1);
  return { scene, camera };
}

const at = (source: string, line: string): number => {
  const index = source.indexOf(line);
  expect(index, line).toBeGreaterThan(-1);
  return index;
};

describe('morph targets in the painted and hull materials', () => {
  const hullMaterial = createHullMaterial(createInkUniforms(DEFAULT_DIALS));

  it("get three's morph defines, and morph the position after begin_vertex and before skinning, in three's real programs", () => {
    const { root, body } = morphedHead();
    attachHull(body, hullMaterial, 1);
    const { scene, camera } = sceneWith(root);
    const gl = createMockRenderer();
    gl.renderer.compile(scene, camera);
    const vertex = gl.vertexSources();
    const painted = vertex.find((source) => source.includes('varying vec3 vBrushPos;')) as string;
    const hull = vertex.find((source) => source.includes('attribute vec3 inkNormal;')) as string;
    for (const source of [painted, hull]) {
      // three writes these for any non-raw ShaderMaterial on a geometry with morph positions (WebGLPrograms.getParameters).
      expect(source).toContain('#define USE_MORPHTARGETS');
      expect(source).toContain('#define MORPHTARGETS_COUNT 1');
      expect(source).toContain('#define MORPHTARGETS_TEXTURE_STRIDE 1');
      expect(source).toContain('#define USE_SKINNING');
      // Morph normals are exported off, so there are none to read.
      expect(source).not.toContain('#define USE_MORPHNORMALS');
      // The chunks as three resolves them, in r186's order: the base position, then the morph, then the skin, then the
      // projection. Morphed after skinning, a blink would close the lid along the bone's axes instead of the head's.
      const begin = at(source, 'vec3 transformed = vec3( position );');
      const morph = at(source, 'transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];');
      expect(begin).toBeLessThan(at(source, 'transformed *= morphTargetBaseInfluence;'));
      expect(begin).toBeLessThan(morph);
      expect(morph).toBeLessThan(at(source, 'vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );'));
      expect(morph).toBeLessThan(at(source, 'vec4 mvPosition = vec4( transformed, 1.0 );'));
      expect(at(source, 'uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];')).toBeLessThan(morph);
    }
    // The painted surface bends its normal with any morph normals before the skin does; the hull keeps its averaged ink
    // normal, so a morph can never tear it open at a crease.
    const normal = at(painted, 'objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];');
    expect(at(painted, 'vec3 objectNormal = vec3( normal );')).toBeLessThan(normal);
    expect(normal).toBeLessThan(at(painted, 'mat4 skinMatrix = mat4( 0.0 );'));
    expect(hull).not.toContain('getMorph( gl_VertexID, i, 1 )');
    expect(at(hull, 'objectNormal = inkNormal;')).toBeLessThan(at(hull, 'mat4 skinMatrix = mat4( 0.0 );'));
  });

  it('compile to what they always did on a mesh without morphs: every added chunk sits wholly inside a morph define three leaves unset', () => {
    const { root, body } = morphedHead(false);
    attachHull(body, hullMaterial, 1);
    const { scene, camera } = sceneWith(root);
    const gl = createMockRenderer();
    gl.renderer.compile(scene, camera);
    for (const source of gl.sources) {
      expect(source).not.toMatch(/#define (USE_MORPHTARGETS|USE_MORPHNORMALS|USE_INSTANCING_MORPH|MORPHTARGETS_COUNT)\b/);
    }
    const guards: Record<string, string> = {
      morphtarget_pars_vertex: 'USE_MORPHTARGETS',
      morphinstance_vertex: 'USE_INSTANCING_MORPH',
      morphnormal_vertex: 'USE_MORPHNORMALS',
      morphtarget_vertex: 'USE_MORPHTARGETS',
    };
    for (const [chunk, define] of Object.entries(guards)) {
      const lines = (ShaderChunk as unknown as Record<string, string>)[chunk]!.trim().split('\n').map((line) => line.trim());
      expect(lines[0], chunk).toBe(`#ifdef ${define}`);
      // The opening guard closes only at the chunk's last line, so nothing in it compiles without the define.
      let depth = 0;
      lines.forEach((line, i) => {
        if (/^#if/.test(line)) depth += 1;
        if (/^#endif/.test(line)) depth -= 1;
        if (i < lines.length - 1) expect(depth, `${chunk} line ${i}`).toBeGreaterThan(0);
      });
      expect(depth, chunk).toBe(0);
    }
  });

  it('move the painted surface and its hull together as the influence rises, as three draws a skinned morph', () => {
    const { body, top } = morphedHead();
    const hull = attachHull(body, hullMaterial, 1) as SkinnedMesh;
    // three's CPU mirror of morphtarget_vertex and skinning_vertex (Mesh.getVertexPosition, then the bone transform).
    const where = (mesh: Mesh) => mesh.getVertexPosition(top, new Vector3());
    const rest = where(body).clone();
    body.morphTargetInfluences![0] = 1;
    expect(where(body).y).toBeCloseTo(rest.y - LID_DROP, 6);
    expect(where(hull).distanceTo(where(body))).toBe(0);
    body.morphTargetInfluences![0] = 0.5;
    expect(where(body).y).toBeCloseTo(rest.y - LID_DROP / 2, 6);
    expect(hull.morphTargetInfluences).toBe(body.morphTargetInfluences);
    expect(hull.morphTargetDictionary).toBe(body.morphTargetDictionary);
  });

  it('never leave the ink behind a blink: a cloned rig, whose hull gets a copy of the influences, is re-shared on its first draw', () => {
    const { root, body } = morphedHead();
    attachHull(body, hullMaterial, 1);
    // The Asset World places a second and third character by SkeletonUtils clone, and Mesh.copy slices the influences.
    const copy = cloneRig(root) as Group;
    const clonedBody = copy.getObjectByName('commander_body') as SkinnedMesh;
    const clonedHull = copy.getObjectByName('commander_body_hull') as SkinnedMesh;
    expect(clonedHull.morphTargetInfluences).not.toBe(clonedBody.morphTargetInfluences);
    clonedBody.morphTargetInfluences![0] = 1;
    // Undrawn, the clone's ink would stay on the open lid.
    expect(clonedHull.morphTargetInfluences![0]).toBe(0);
    const { scene, camera } = sceneWith(copy);
    createMockRenderer().renderer.render(scene, camera);
    // The hull material re-points it before three uploads the influences (WebGLRenderer.renderObject, then setProgram).
    expect(clonedHull.morphTargetInfluences).toBe(clonedBody.morphTargetInfluences);
    expect(clonedHull.morphTargetDictionary).toBe(clonedBody.morphTargetDictionary);
    expect(clonedHull.morphTargetInfluences![0]).toBe(1);
  });
});
