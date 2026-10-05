import { Pass } from 'postprocessing';
import {
  NoBlending,
  ShaderMaterial,
  Uniform,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { LAYERS } from '../layers';

/**
 * Copies a frame exactly, texel for texel: texelFetch at the pixel's own coordinate, so no filtering can blend a
 * neighbour in, with blending and depth off. Alpha comes across too, since it still carries the emissive key the bloom
 * reads after this pass.
 */
export class EnergyCopyMaterial extends ShaderMaterial {
  constructor() {
    super({
      name: 'EnergyPass.Copy',
      uniforms: { inputBuffer: new Uniform<Texture | null>(null) },
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D inputBuffer;
        void main() {
          gl_FragColor = texelFetch(inputBuffer, ivec2(gl_FragCoord.xy), 0);
        }
      `,
    });
  }
}

/**
 * Whether anything under `root` would draw on the energy layer: a visible mesh, line, point set or sprite with the
 * layer enabled, under visible parents. The pass skips the frame when nothing would, so a frame with no energy on
 * screen is the frame the pipeline drew before this pass existed, bit for bit.
 */
export function drawsEnergy(root: Object3D): boolean {
  for (const child of root.children) {
    if (!child.visible) continue;
    const drawable = child as Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
    if ((drawable.isMesh || drawable.isLine || drawable.isPoints || drawable.isSprite) && child.layers.isEnabled(LAYERS.energy)) return true;
    if (drawsEnergy(child)) return true;
  }
  return false;
}

/**
 * Player energy drawn over the finished painted frame (the sword trail and the hit sparks): after the ink and the fog,
 * before the bloom, so the edge ink and the fog never land on it and its key reaches the bloom's mask and shield.
 *
 * Drawn in the scene pass as it was, energy wrote no depth, so the ink and fog passes, which read the depth and normals
 * behind it, drew the Husk's silhouette line straight across the ribbon and fogged it by the ground's distance; the
 * reviewer found the trail cut by the outline in the contact frame (docs/evidence/m1/combat-trail.png at 743074b).
 *
 * The energy lives in a scene of its own, on LAYERS.energy, drawn through a copy of the main camera that sees that layer
 * alone. A scene of its own carries no lights, so three's light state for the main scene is never rebuilt between the
 * passes (a camera that saw only the energy layer of the main scene would have collected none of its lights, and every
 * lit material would have re-resolved its program each frame), and nothing on the main scene's layers can draw here.
 * The main camera never enables the layer, so energy left in the main scene by mistake draws nowhere rather than twice.
 *
 * The pass draws into the buffer the scene pass drew into, which still holds the scene's depth (its multisampled depth
 * on the MSAA tiers, its depth texture on the low tier): the post-ink frame is copied over that buffer's colour first,
 * then the energy is drawn with its depth test on and its depth writes off, so nearer bodies still cover it exactly as
 * they did, multisampled at its edges on the tiers that multisample. Energy keeps its own blending and alpha contract
 * (labs/shared/energy.ts useEnergyBlending): light added one plus one, its key into alpha by the larger.
 *
 * With nothing on the layer to draw, the pass draws nothing and does not swap, so the frame goes on exactly as it was.
 */
export class EnergyPass extends Pass {
  private readonly energy: Scene;
  private readonly view: PerspectiveCamera;
  private readonly energyCamera: PerspectiveCamera;
  /** Frames the pass has drawn energy in, since it was made: what a reading can check the skip against. */
  drawnFrames = 0;
  /** Whether the last frame drew energy. */
  drewLast = false;

  constructor(energy: Scene, camera: PerspectiveCamera) {
    super('EnergyPass');
    this.energy = energy;
    this.view = camera;
    this.energyCamera = camera.clone();
    this.energyCamera.layers.set(LAYERS.energy);
    // Held by the pass as its full-screen material only: Pass.dispose disposes that and every material among the
    // pass's own fields, so kept in a field too it would be disposed twice (KeyedBloomEffect's key had that fault).
    this.fullscreenMaterial = new EnergyCopyMaterial();
    this.needsSwap = true;
  }

  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, outputBuffer: WebGLRenderTarget): void {
    this.drewLast = drawsEnergy(this.energy);
    this.needsSwap = this.drewLast;
    if (!this.drewLast) return;
    this.drawnFrames += 1;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      ((this.fullscreenMaterial as EnergyCopyMaterial).uniforms['inputBuffer'] as Uniform<Texture | null>).value = inputBuffer.texture;
      renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
      renderer.render(this.scene, this.camera);
      // The main camera as the frame was drawn, the shake included, seeing the energy layer alone.
      this.energyCamera.copy(this.view, false);
      this.energyCamera.layers.set(LAYERS.energy);
      renderer.render(this.energy, this.energyCamera);
    } finally {
      renderer.autoClear = autoClear;
    }
  }
}
