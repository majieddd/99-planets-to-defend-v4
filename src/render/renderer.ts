import { NoToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';
import type { Tier } from './quality';

export function createRenderer(container: HTMLElement, tier: Tier): WebGLRenderer {
  const renderer = new WebGLRenderer({
    antialias: false, // the composer multisamples
    // The composer draws the scene into its own targets, which have their own depth, and only full-screen passes reach
    // the canvas, so a canvas depth buffer would never be read (about 59 MB at 2560 x 1440 with pixel ratio 2).
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true, // the lab reads frames back for the colour audit and screenshots
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.pixelRatioMax));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping; // tone mapping happens once, in the post pipeline
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap; // PCFSoftShadowMap was removed in r186; softness is shadow.radius
  container.appendChild(renderer.domElement);
  return renderer;
}
