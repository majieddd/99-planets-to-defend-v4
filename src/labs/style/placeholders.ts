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
 * switches to them without code changes. Where the scene drives or places a node, the stand-in also puts its pivot
 * where M0c's recipe does.
 */
export function placeholderAssets(ctx: MaterialContext) {
  const bulwark = new Group();
  const bulwarkBody = part('bulwark', new CapsuleGeometry(0.35, 1.1, 4, 12), '#566276');
  bulwarkBody.position.y = 0.9;
  bulwark.add(bulwarkBody);
  const husk = new Group();
  const huskBody = part('husk', new IcosahedronGeometry(0.6, 1), '#3a2c52', '#000000');
  huskBody.position.y = 0.8;
  husk.add(huskBody);
  const bolt = new Group();
  for (const level of [1, 2, 3]) {
    const baseHeight = 0.35 + 0.12 * (level - 1);
    const base = part(`bolt_mk${level}`, new CylinderGeometry(0.7, 0.78, baseHeight, 8), '#3d4757');
    // M0c's Bolt Sentinel (blender/recipes/bolt_sentinel.py) puts the base node half the base's height above the
    // asset origin, so the base stands on the ground rather than half buried, and seats the yaw ring on its top.
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
    bolt.add(base);
  }
  const heart = new Group();
  const plinth = part('heart_plinth', new CylinderGeometry(1.05, 1.2, 0.4, 8), '#9c8a74');
  // Every stage's crystal starts 0.4 m up, the plinth's top in M0c's Worldheart (PLINTH_TOP), so the 0.4 m plinth
  // stands on the origin; centred on it, the plinth would be half buried with the crystal hanging 0.2 m above it.
  plinth.position.y = 0.2;
  heart.add(plinth);
  for (let level = 0; level <= 10; level++) {
    const stage = part(`heart_stage_${String(level).padStart(2, '0')}`, new ConeGeometry(0.3 + 0.012 * level, 1.4 + 0.14 * level, 6), '#ffb38a', '#ffc36b', 0.9);
    stage.position.y = 0.4 + (1.4 + 0.14 * level) / 2;
    heart.add(stage);
  }
  const nest = new Group();
  nest.add(part('nest', new IcosahedronGeometry(1.4, 1), '#241a38', '#ff3fa6'));
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
