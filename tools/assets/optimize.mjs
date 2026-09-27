// Raw Blender GLB in, web GLB out: deduplicated, pruned (keeping empties such as muzzle points and the
// custom _INK attribute), animations resampled, textures as WebP, geometry meshopt-compressed.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

let ioPromise;

export function assetIO() {
  ioPromise ??= (async () => {
    await MeshoptDecoder.ready;
    await MeshoptEncoder.ready;
    return new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  })();
  return ioPromise;
}

export async function optimizeGlb(input, output) {
  const io = await assetIO();
  const doc = await io.read(input);
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true, keepLeaves: true, keepExtras: true }),
    resample(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  mkdirSync(dirname(output), { recursive: true });
  await io.write(output, doc);
}
