import { BoxGeometry, Color, DirectionalLight, Mesh, MeshToonMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

const stage = document.getElementById('stage');
if (!stage) throw new Error('Style Lab: #stage is missing');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
stage.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color('#2a3a4a');
const camera = new PerspectiveCamera(50, stage.clientWidth / stage.clientHeight, 0.1, 100);
camera.position.set(2.2, 1.6, 3.2);
camera.lookAt(0, 0, 0);

const sun = new DirectionalLight('#ffe2b0', 2.2);
sun.position.set(3, 4, 2);
scene.add(sun);

const cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshToonMaterial({ color: '#4ec98a' }));
scene.add(cube);

window.addEventListener('resize', () => {
  camera.aspect = stage.clientWidth / stage.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(stage.clientWidth, stage.clientHeight);
});

let frames = 0;
renderer.setAnimationLoop((time) => {
  cube.rotation.y = time * 0.0006;
  renderer.render(scene, camera);
  frames += 1;
  if (frames === 2) window.__P99__ = { ready: true, page: 'style' };
});
