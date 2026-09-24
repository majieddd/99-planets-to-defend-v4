/** A hue band the colour audit expects a theme's frames to concentrate in. */
export interface AuditBand {
  name: string;
  /** Degrees. hueMin greater than hueMax means the band wraps through 0. */
  hueMin: number;
  hueMax: number;
}

/**
 * A planet theme owns a named palette and a named light (blueprint, Art direction): a palette plus a light
 * direction is what buys the anime read, not the name of a style.
 */
export interface Theme {
  id: string;
  name: string;
  sun: { color: string; intensity: number; elevationDeg: number; azimuthDeg: number };
  shadowTint: string;
  ambient: { sky: string; ground: string };
  sky: { zenith: string; horizon: string; ground: string; cloudLit: string; cloudShadow: string };
  fog: { color: string; sunColor: string };
  grade: { shadows: string; highlights: string };
  ground: { meadow: string; meadowLight: string; moss: string; stone: string; soil: string };
  bands: AuditBand[];
}

export const VERDANT: Theme = {
  id: 'verdant',
  name: 'Verdant Highlands',
  sun: { color: '#ffd29a', intensity: 3.2, elevationDeg: 35, azimuthDeg: 250 },
  shadowTint: '#2f8f8c',
  ambient: { sky: '#9cc7e0', ground: '#6b8f5a' },
  sky: { zenith: '#4f8fcf', horizon: '#f4d9a8', ground: '#8aa383', cloudLit: '#fff1d6', cloudShadow: '#9fb6cf' },
  fog: { color: '#cfe0d6', sunColor: '#ffe0b0' },
  grade: { shadows: '#d4ecf0', highlights: '#fff0dc' },
  ground: { meadow: '#4ec98a', meadowLight: '#7fdd9e', moss: '#2e8f6a', stone: '#8a8378', soil: '#8a6a4a' },
  bands: [
    { name: 'amber light', hueMin: 25, hueMax: 60 },
    { name: 'jade meadow', hueMin: 80, hueMax: 170 },
    { name: 'teal shadow and sky', hueMin: 170, hueMax: 225 },
  ],
};

/** Unit vector pointing from the ground toward the sun, with +Y up. */
export function sunDirection(theme: Theme): [number, number, number] {
  const elevation = (theme.sun.elevationDeg * Math.PI) / 180;
  const azimuth = (theme.sun.azimuthDeg * Math.PI) / 180;
  return [Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)];
}
