import { BufferAttribute, SphereGeometry, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { computeInkNormals } from '../../../src/render/ink/inkNormals';

// The hull pushes each vertex out along its ink normal projected to the screen, normalized there, by the ink width in
// pixels (ink/hull.ts). On a sphere head with its own normals the push at the silhouette points straight out of it; with
// a face's proxy-ellipsoid custom normals it tilts, and the ink across the silhouette is the width times the cosine of
// that tilt. This measures the tilt on a synthetic head in orthographic views all around it, where a cosine near 1 is a
// line of full width, a small one a thin line, and a negative one a push into the head, which would open a gap.

const R = 0.12;
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** The proxy-ellipsoid normal of tests/unit/assets/normals.test.ts: an ellipsoid 1 wide, 1.1 tall and 0.6 deep over the face. */
function proxyNormal(p: Vector3): Vector3 {
  const g = p.clone().normalize();
  const e = new Vector3(p.x, p.y / 1.21, p.z / 0.36).normalize();
  return g.lerp(e, smoothstep(-0.2, 0.4, g.z)).normalize();
}

function head(custom: boolean): BufferGeometry {
  const geometry = new SphereGeometry(R, 64, 48);
  if (custom) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal') as BufferAttribute;
    const p = new Vector3();
    for (let i = 0; i < position.count; i++) {
      const n = proxyNormal(p.fromBufferAttribute(position, i));
      normal.setXYZ(i, n.x, n.y, n.z);
    }
  }
  computeInkNormals(geometry);
  return geometry;
}

const key = (geometry: BufferGeometry, i: number) => {
  const position = geometry.getAttribute('position');
  return [position.getX(i), position.getY(i), position.getZ(i)].map((c) => Math.round(c / 1e-5)).join();
};

/** The smallest cosine of the push's tilt, and the smallest screen length of the ink normal, over the silhouette seen along `toCamera`. */
function silhouette(geometry: BufferGeometry, toCamera: Vector3): { coverage: number; length: number; vertices: number } {
  const position = geometry.getAttribute('position');
  const ink = geometry.getAttribute('inkNormal');
  const index = geometry.getIndex()!;
  const edges = new Map<string, { front: boolean; back: boolean; ends: [number, number] }>();
  const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
  for (let t = 0; t < index.count; t += 3) {
    const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)] as [number, number, number];
    a.fromBufferAttribute(position, tri[0]);
    b.fromBufferAttribute(position, tri[1]);
    c.fromBufferAttribute(position, tri[2]);
    const face = b.clone().sub(a).cross(c.clone().sub(a));
    if (face.lengthSq() < 1e-16) continue;
    const front = face.dot(toCamera) > 0;
    for (const [u, v] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as [number, number][]) {
      const edgeKey = [key(geometry, u), key(geometry, v)].sort().join('|');
      const edge = edges.get(edgeKey) ?? { front: false, back: false, ends: [u, v] };
      if (front) edge.front = true;
      else edge.back = true;
      edges.set(edgeKey, edge);
    }
  }
  let coverage = Infinity;
  let length = Infinity;
  const seen = new Set<number>();
  const onScreen = (v: Vector3) => v.clone().addScaledVector(toCamera, -v.dot(toCamera));
  for (const edge of edges.values()) {
    if (!(edge.front && edge.back)) continue;
    for (const i of edge.ends) {
      if (seen.has(i)) continue;
      seen.add(i);
      const outward = onScreen(new Vector3().fromBufferAttribute(position, i)).normalize();
      const push = onScreen(new Vector3().fromBufferAttribute(ink, i));
      length = Math.min(length, push.length());
      coverage = Math.min(coverage, push.normalize().dot(outward));
    }
  }
  return { coverage, length, vertices: seen.size };
}

// Front, three-quarter, profile, back, above and below the face, and the in-between views a camera orbit passes through.
const VIEWS: Record<string, Vector3> = {
  front: new Vector3(0, 0, 1),
  threeQuarter: new Vector3(1, 0, 1).normalize(),
  profile: new Vector3(1, 0, 0),
  back: new Vector3(0, 0, -1),
  aboveFront: new Vector3(0, 0.6, 0.8),
  belowFront: new Vector3(0.3, -0.5, 0.81).normalize(),
  highThreeQuarter: new Vector3(0.6, 0.5, 0.62).normalize(),
};

describe('the hull ink on a head with custom face normals', () => {
  it('stays closed: every vertex at one place pushes along one ink normal', () => {
    const geometry = head(true);
    const ink = geometry.getAttribute('inkNormal');
    const byPlace = new Map<string, Vector3>();
    let worst = 0;
    for (let i = 0; i < ink.count; i++) {
      const n = new Vector3().fromBufferAttribute(ink, i);
      const first = byPlace.get(key(geometry, i));
      if (first) worst = Math.max(worst, first.angleTo(n));
      else byPlace.set(key(geometry, i), n);
    }
    expect(worst).toBe(0);
  });

  it('keeps at least 80 percent of its width and never pushes inward, where the geometric normals keep all of it', () => {
    const results = Object.entries(VIEWS).map(([name, toCamera]) => ({ name, own: silhouette(head(false), toCamera), custom: silhouette(head(true), toCamera) }));
    console.log(`hull width kept across the silhouette with proxy normals, worst per view: ${results.map(({ name, custom }) => `${name} ${custom.coverage.toFixed(3)} (screen length ${custom.length.toFixed(3)})`).join('; ')}`);
    for (const { name, own, custom } of results) {
      expect(own.vertices, name).toBeGreaterThan(60);
      expect(own.coverage, name).toBeGreaterThan(0.999);
      // The width across the silhouette stays over 0.8 of the dial's 3.2 px: it measured 0.841 at worst, in profile down
      // the brow and chin, where the proxy tilts the normals forward, about 0.5 px thinner; 0.92 at three-quarters and 1
      // from the front and behind. The ink normal never nears the view axis, where its screen direction would swing.
      expect(custom.coverage, name).toBeGreaterThan(0.8);
      expect(custom.length, name).toBeGreaterThan(0.5);
    }
  });
});
