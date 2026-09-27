import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import { paintAndInk, type LoadedAsset, type MaterialContext } from '../../render/assets/loadAsset';

function inked(geometry: BufferGeometry, width = 1): BufferGeometry {
  geometry.setAttribute('_ink', new Float32BufferAttribute(new Array(geometry.getAttribute('position').count).fill(width / 2), 1));
  return geometry;
}

function part(name: string, geometry: BufferGeometry, color: string, emissive = '#000000', ink = 1): Mesh {
  const material = new MeshStandardMaterial({ color: new Color(color), emissive: new Color(emissive), emissiveIntensity: 3 });
  const mesh = new Mesh(inked(geometry, ink), material);
  mesh.name = name;
  return mesh;
}

function asset(root: Group, ctx: MaterialContext, blend: number): LoadedAsset {
  paintAndInk(root, ctx, blend);
  return { root, animations: [] };
}

/**
 * Stand-ins that carry the node names the style scene looks up, so the lab runs before M0c's assets exist and
 * switches to them without code changes. Where the scene drives or places a node, the stand-in keeps M0c's node tree,
 * the same names under the same parents, so the scene places and aims both the same way. The heights are the
 * stand-in's own: mark I's yaw and pitch pivots stand 0.45 and 0.80 m up here, and 0.37 and 0.62 m on M0c's Bolt
 * Sentinel.
 */
export function placeholderAssets(ctx: MaterialContext) {
  const bulwark = new Group();
  const bulwarkBody = part('bulwark', new CapsuleGeometry(0.35, 1.1, 4, 12), '#566276');
  bulwarkBody.position.y = 0.9;
  bulwark.add(bulwarkBody);
  const husk = new Group();
  const huskBody = part('husk', new IcosahedronGeometry(0.6, 1), '#3a2c52', '#000000');
  // The ball rests on the ground, its lowest point on the root, as M0c's ground rule stands the Husk: at its ground
  // contact point, with no sink. Centred 0.8 m up, it floated 0.2 m over the grass, its shadow apart from it in the
  // strategic frame. The turrets still aim 0.8 m up the Husk, which is inside the ball.
  huskBody.position.y = 0.6;
  husk.add(huskBody);
  const bolt = new Group();
  for (const level of [1, 2, 3]) {
    const baseHeight = 0.35 + 0.12 * (level - 1);
    // M0c's Bolt Sentinel (blender/recipes/bolt_sentinel.py) roots each mark at its ground contact point: bolt_mkN is an
    // empty at the asset origin, and the plinth under it, bolt_mkN_base, has its node half the base's height up, so the
    // scene places the mark on the ground as it does any other asset and the base stands there. The yaw ring sits on
    // the base's top. The stand-in keeps the asset's tree (mark, base, yaw, pitch), so the scene places and aims both
    // the same way.
    const mark = new Group();
    mark.name = `bolt_mk${level}`;
    const base = part(`bolt_mk${level}_base`, new CylinderGeometry(0.7, 0.78, baseHeight, 8), '#3d4757');
    base.position.y = baseHeight / 2;
    const yaw = part(`bolt_mk${level}_yaw`, new CylinderGeometry(0.5, 0.5, 0.2, 12), '#566276');
    yaw.position.y = baseHeight / 2 + 0.1;
    const pitch = part(`bolt_mk${level}_pitch`, new BoxGeometry(0.7, 0.42, 0.9), '#3d4757');
    pitch.position.y = 0.35;
    const rail = part(`bolt_mk${level}_rail`, new BoxGeometry(0.1, 0.1, 1 + 0.2 * level), '#cdd8e6', '#59f2ff');
    rail.position.z = 0.8;
    pitch.add(rail);
    yaw.add(pitch);
    base.add(yaw);
    mark.add(base);
    bolt.add(mark);
  }
  const heart = new Group();
  const plinth = part('heart_plinth', new CylinderGeometry(1.05, 1.2, 0.4, 8), '#9c8a74');
  // Every stage's crystal starts 0.4 m up, the plinth's top in M0c's Worldheart (PLINTH_TOP), so the 0.4 m plinth
  // stands on the origin; centred on it, the plinth would be half buried with the crystal hanging 0.2 m above it.
  plinth.position.y = 0.2;
  heart.add(plinth);
  // The crystal glows amber-gold at full chroma (#ffaf1a, near-zero blue) over the same gold at 0.55 in linear light,
  // M0c's albedo strength for the heart's glowing regions. With the palette's pale core (#ffc36b) over the facet peach
  // (#ffb38a) the heart left AgX near white, (238, 216, 184) at saturation 0.23, and still at 0.32 under the emissive
  // cap: the blue in a pale glow turns to white under AgX before its gold does. This gold measures 0.47 at hue 36.
  for (let level = 0; level <= 10; level++) {
    const stage = part(`heart_stage_${String(level).padStart(2, '0')}`, new ConeGeometry(0.3 + 0.012 * level, 1.4 + 0.14 * level, 6), '#c48511', '#ffaf1a', 0.9);
    stage.position.y = 0.4 + (1.4 + 0.14 * level) / 2;
    heart.add(stage);
  }
  const nest = new Group();
  // The mound is a dome standing on the ground. It was a whole ball centred on the root, which looked the same above
  // the grass but put its lowest point 1.4 m underground, where M0c's nest beds its spikes about 0.12 m deep. The
  // sphere's own normals light it as one broad dome, as the ball did (IcosahedronGeometry at detail 1 takes the
  // sphere's normals) and as M0c's mound does under a faceted silhouette. Unindexed with its normals recomputed, the
  // dome lit as 40 flat facets instead.
  const dome = new SphereGeometry(1.4, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  nest.add(part('nest', dome, '#241a38', '#ff3fa6'));
  const kit = new Group();
  const pieces: [string, BufferGeometry, string, number][] = [
    ['rock_a', new IcosahedronGeometry(0.8, 0), '#8a8378', 1.1],
    ['rock_b', new IcosahedronGeometry(1.0, 0), '#8a8378', 1.1],
    ['rock_c', new IcosahedronGeometry(0.6, 0), '#8a8378', 1.1],
    ['tree_broad', new IcosahedronGeometry(1.4, 1).translate(0, 3, 0), '#3e9f6e', 1.25],
    ['tree_conifer', new ConeGeometry(1, 3.5, 8).translate(0, 1.8, 0), '#3e9f6e', 1.2],
    ['bush', new IcosahedronGeometry(0.6, 1).translate(0, 0.45, 0), '#3e9f6e', 1.1],
    ['grass_tuft', new ConeGeometry(0.15, 0.6, 4).translate(0, 0.3, 0), '#4ec98a', 0],
    ['flowers', new IcosahedronGeometry(0.12, 0).translate(0, 0.35, 0), '#ffc857', 0.6],
  ];
  for (const [name, geometry, color, ink] of pieces) kit.add(part(name, geometry, color, '#000000', ink));
  return {
    bulwark: asset(bulwark, ctx, 0.35),
    husk: asset(husk, ctx, 0.3),
    bolt: asset(bolt, ctx, 0.1),
    heart: asset(heart, ctx, 0.1),
    nest: asset(nest, ctx, 0.1),
    kit: asset(kit, ctx, 0.0),
  };
}
