import { describe, expect, it } from 'vitest';
import { auditPixels, bandCoverage, hsvToRgb, inBand, mutationProof, rgbToHsv, widestGapCenter } from '../../../src/labs/style/audit';
import { VERDANT } from '../../../src/render/themes';

function solid(h: number, s: number, v: number, count = 400): Uint8ClampedArray {
  const [r, g, b] = hsvToRgb(h, s, v);
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) out.set([r, g, b, 255], i * 4);
  return out;
}

function joined(...parts: Uint8ClampedArray[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe('colour conversions', () => {
  it('round-trips hue, saturation and value', () => {
    for (const [h, s, v] of [[0, 1, 1], [150, 0.6, 0.7], [210, 0.4, 0.9], [330, 0.8, 0.5]] as const) {
      const [r, g, b] = hsvToRgb(h, s, v);
      const [h2, s2, v2] = rgbToHsv(r, g, b);
      expect(Math.abs(((h2 - h + 540) % 360) - 180)).toBeLessThan(2);
      expect(s2).toBeCloseTo(s, 1);
      expect(v2).toBeCloseTo(v, 1);
    }
  });
});

describe('bands', () => {
  it('measures coverage without double counting', () => {
    expect(bandCoverage(VERDANT.bands)).toBe(180);
    expect(bandCoverage([{ name: 'a', hueMin: 10, hueMax: 50 }, { name: 'b', hueMin: 30, hueMax: 70 }])).toBe(60);
  });

  it('handles a band that wraps through zero', () => {
    const band = { name: 'wrap', hueMin: 340, hueMax: 20 };
    expect(inBand(350, band)).toBe(true);
    expect(inBand(10, band)).toBe(true);
    expect(inBand(30, band)).toBe(false);
  });

  it('finds the widest gap', () => {
    expect(widestGapCenter(VERDANT.bands)).toBe(305);
  });
});

describe('auditPixels', () => {
  it('passes a frame inside the theme bands', () => {
    const report = auditPixels(solid(150, 0.6, 0.7), VERDANT.bands);
    expect(report.inBandShare).toBe(1);
    expect(report.chance).toBeCloseTo(0.5, 9);
    expect(report.concentration).toBeCloseTo(2, 9);
    expect(report.verdict).toBe('pass');
  });

  it('fails a frame outside them and calls a grey frame inconclusive', () => {
    expect(auditPixels(solid(300, 0.6, 0.7), VERDANT.bands).verdict).toBe('fail');
    expect(auditPixels(solid(0, 0.02, 0.6), VERDANT.bands).verdict).toBe('inconclusive');
  });

  it('leaves grey and dark pixels out of the hue test', () => {
    // Grey mass and a dark magenta (value 0.08) must not count as colour, so the jade is all of it.
    const report = auditPixels(joined(solid(150, 0.6, 0.7, 300), solid(0, 0.02, 0.6, 60), solid(300, 0.6, 0.08, 40)), VERDANT.bands);
    expect(report.chromaticShare).toBeCloseTo(0.75, 9);
    expect(report.inBandShare).toBe(1);
    expect(report.bandShares['jade meadow']).toBe(1);
    expect(report.bandShares['teal shadow and sky']).toBe(0);
  });

  it('needs a fifth of the frame in colour before it judges', () => {
    const grey = (count: number) => solid(0, 0.02, 0.6, count);
    expect(auditPixels(joined(solid(150, 0.6, 0.7, 81), grey(319)), VERDANT.bands).verdict).toBe('pass');
    expect(auditPixels(joined(solid(150, 0.6, 0.7, 79), grey(321)), VERDANT.bands).verdict).toBe('inconclusive');
  });

  it('counts a pixel in two overlapping bands once', () => {
    const report = auditPixels(solid(40, 0.6, 0.7), [{ name: 'a', hueMin: 10, hueMax: 50 }, { name: 'b', hueMin: 30, hueMax: 70 }]);
    expect(report.inBandShare).toBe(1);
    expect(report.concentration).toBeCloseTo(6, 9);
  });
});

describe('mutationProof', () => {
  it('rotates a passing frame into the widest gap and requires the audit to reject it', () => {
    // Hue 150 lands in the 150 to 160 histogram bin, so the dominant hue is 155 and the widest gap's centre
    // (305) is 150 degrees away.
    const proof = mutationProof(solid(150, 0.6, 0.7), VERDANT.bands);
    expect(proof.rotation).toBe(150);
    expect(proof.report.verdict).toBe('fail');
    expect(proof.rejected).toBe(true);
  });

  it('never calls an inconclusive frame rejected', () => {
    expect(mutationProof(solid(0, 0.02, 0.6), VERDANT.bands).rejected).toBe(false);
  });
});
