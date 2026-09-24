export type TierName = 'high' | 'medium' | 'low';

export interface Tier {
  name: TierName;
  pixelRatioMax: number;
  msaa: number;
  shadowMapSize: number;
  normalScale: number;
  edgeInk: boolean;
  bloomLevels: number;
  terrainSegments: number;
  scatterScale: number;
}

/** Targets from the blueprint: 60 fps at 1440p on the RTX 4080 laptop, 60 at 1080p on Iris Xe, 30+ on a phone. */
export const TIERS: Record<TierName, Tier> = {
  high: { name: 'high', pixelRatioMax: 2, msaa: 4, shadowMapSize: 2048, normalScale: 1, edgeInk: true, bloomLevels: 8, terrainSegments: 256, scatterScale: 1 },
  medium: { name: 'medium', pixelRatioMax: 1.25, msaa: 2, shadowMapSize: 1024, normalScale: 0.75, edgeInk: true, bloomLevels: 6, terrainSegments: 192, scatterScale: 0.7 },
  low: { name: 'low', pixelRatioMax: 1, msaa: 0, shadowMapSize: 512, normalScale: 0.5, edgeInk: false, bloomLevels: 4, terrainSegments: 128, scatterScale: 0.4 },
};

export function tierForGpu(gpu: string, mobile: boolean): TierName {
  const g = gpu.toLowerCase();
  // WARP, Windows' software rasterizer, reports itself as "Microsoft Basic Render Driver".
  if (/swiftshader|llvmpipe|software|basic render/.test(g)) return 'low';
  if (mobile) return 'low';
  if (/nvidia|geforce|rtx|gtx|radeon rx|radeon pro|arc\(tm\) a|arc a/.test(g)) return 'high';
  return 'medium';
}

export function detectTier(gl: WebGLRenderingContext | WebGL2RenderingContext, userAgent: string): TierName {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return tierForGpu(gpu, /Android|iPhone|iPad|Mobile/i.test(userAgent));
}

export function parseTier(value: string | null): TierName | null {
  return value === 'high' || value === 'medium' || value === 'low' ? value : null;
}
