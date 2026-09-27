// Counts what the budget check needs from a GLB.
import { statSync } from 'node:fs';
import { assetIO } from './optimize.mjs';

const TRIANGLES = 4;

export async function inspectGlb(path) {
  const io = await assetIO();
  const root = (await io.read(path)).getRoot();
  let tris = 0;
  let hasInk = false;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getAttribute('_INK')) hasInk = true;
      if (prim.getMode() !== TRIANGLES) continue;
      const indices = prim.getIndices();
      tris += (indices ? indices.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  const bones = root.listSkins().reduce((most, skin) => Math.max(most, skin.listJoints().length), 0);
  const animations = root.listAnimations().map((animation) => ({
    name: animation.getName(),
    duration: Math.max(0, ...animation.listSamplers().map((sampler) => sampler.getInput()?.getMax([])[0] ?? 0)),
  }));
  const textures = root.listTextures().map((texture) => {
    const size = texture.getSize();
    return { width: size?.[0] ?? 0, height: size?.[1] ?? 0, mime: texture.getMimeType() };
  });
  const nodes = root.listNodes().map((node) => node.getName());
  const doubleSided = root.listMaterials().some((material) => material.getDoubleSided());
  return { tris: Math.round(tris), bones, animations, textures, nodes, hasInk, doubleSided, bytes: statSync(path).size };
}
