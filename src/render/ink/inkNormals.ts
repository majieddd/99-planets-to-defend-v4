import { BufferAttribute, type BufferGeometry, Vector3 } from 'three';

/**
 * Averages the normals of vertices that share a position. A hull pushed out along split (hard-edge)
 * normals tears open at every crease; pushed along these it stays closed.
 */
export function computeInkNormals(geometry: BufferGeometry, precision = 1e-4): BufferAttribute {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const sums = new Map<string, Vector3>();
  const keys = new Array<string>(position.count);
  const v = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const key = `${Math.round(v.x / precision)},${Math.round(v.y / precision)},${Math.round(v.z / precision)}`;
    keys[i] = key;
    n.fromBufferAttribute(normal, i);
    const sum = sums.get(key);
    if (sum) sum.add(n);
    else sums.set(key, n.clone());
  }
  const out = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const sum = sums.get(keys[i] as string) as Vector3;
    const length = sum.length() || 1;
    out[i * 3] = sum.x / length;
    out[i * 3 + 1] = sum.y / length;
    out[i * 3 + 2] = sum.z / length;
  }
  const attribute = new BufferAttribute(out, 3);
  geometry.setAttribute('inkNormal', attribute);
  return attribute;
}
