import type { AuditBand } from '../../render/themes';

/** Pixels below this saturation or value are material mass, not colour, and are left out of the hue test. */
const SAT_MIN = 0.18;
const VAL_MIN = 0.12;
/** A frame with less colour than this cannot say anything about its palette. */
const CHROMATIC_MIN = 0.2;

export interface AuditReport {
  pixels: number;
  chromaticShare: number;
  inBandShare: number;
  chance: number;
  concentration: number;
  bandShares: Record<string, number>;
  dominantHue: number;
  verdict: 'pass' | 'fail' | 'inconclusive';
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r, g, b] =
    hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function inBand(hue: number, band: AuditBand): boolean {
  const h = ((hue % 360) + 360) % 360;
  return band.hueMin <= band.hueMax ? h >= band.hueMin && h < band.hueMax : h >= band.hueMin || h < band.hueMax;
}

function coverageBins(bands: readonly AuditBand[]): boolean[] {
  const bins = new Array<boolean>(360).fill(false);
  for (let degree = 0; degree < 360; degree++) bins[degree] = bands.some((band) => inBand(degree + 0.5, band));
  return bins;
}

/** Degrees of the hue circle covered by at least one band. */
export function bandCoverage(bands: readonly AuditBand[]): number {
  return coverageBins(bands).filter(Boolean).length;
}

/** Centre of the longest run of hues no band covers, wrapping through zero. */
export function widestGapCenter(bands: readonly AuditBand[]): number {
  const bins = coverageBins(bands);
  let bestStart = 0;
  let bestLength = 0;
  for (let start = 0; start < 360; start++) {
    if (bins[start] || !bins[(start + 359) % 360]) continue; // runs start right after a covered bin
    let length = 0;
    while (length < 360 && !bins[(start + length) % 360]) length++;
    if (length > bestLength) {
      bestLength = length;
      bestStart = start;
    }
  }
  return (bestStart + Math.floor(bestLength / 2)) % 360;
}

export function auditPixels(rgba: ArrayLike<number>, bands: readonly AuditBand[], gate = 1.5): AuditReport {
  const pixels = Math.floor(rgba.length / 4);
  const histogram = new Array<number>(36).fill(0);
  const bandCounts = new Map<string, number>(bands.map((band) => [band.name, 0]));
  let chromatic = 0;
  let inBands = 0;
  for (let i = 0; i < pixels; i++) {
    const [h, s, v] = rgbToHsv(rgba[i * 4] as number, rgba[i * 4 + 1] as number, rgba[i * 4 + 2] as number);
    if (s < SAT_MIN || v < VAL_MIN) continue;
    chromatic += 1;
    histogram[Math.min(35, Math.floor(h / 10))]! += 1;
    let counted = false;
    for (const band of bands) {
      if (!inBand(h, band)) continue;
      bandCounts.set(band.name, (bandCounts.get(band.name) ?? 0) + 1);
      counted = true;
    }
    if (counted) inBands += 1;
  }
  const chance = bandCoverage(bands) / 360;
  const inBandShare = chromatic ? inBands / chromatic : 0;
  const concentration = chance > 0 ? inBandShare / chance : 0;
  const chromaticShare = pixels ? chromatic / pixels : 0;
  const bandShares: Record<string, number> = {};
  for (const [name, count] of bandCounts) bandShares[name] = chromatic ? count / chromatic : 0;
  const peak = histogram.indexOf(Math.max(...histogram));
  const verdict = chromaticShare < CHROMATIC_MIN ? 'inconclusive' : concentration >= gate ? 'pass' : 'fail';
  return { pixels, chromaticShare, inBandShare, chance, concentration, bandShares, dominantHue: peak * 10 + 5, verdict };
}

export function rotateHue(rgba: ArrayLike<number>, degrees: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const [h, s, v] = rgbToHsv(rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number);
    const [r, g, b] = hsvToRgb(h + degrees, s, v);
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = rgba[i + 3] as number;
  }
  return out;
}

/**
 * Breaks a frame on purpose: its dominant hue is rotated into the widest gap between the bands. An audit
 * that still passes the broken frame is measuring nothing (art-catalogue, mutation proof).
 */
export function mutationProof(rgba: ArrayLike<number>, bands: readonly AuditBand[], gate = 1.5) {
  const original = auditPixels(rgba, bands, gate);
  const rotation = (widestGapCenter(bands) - original.dominantHue + 360) % 360;
  const report = auditPixels(rotateHue(rgba, rotation), bands, gate);
  return { rotation, report, rejected: report.verdict === 'fail' };
}
