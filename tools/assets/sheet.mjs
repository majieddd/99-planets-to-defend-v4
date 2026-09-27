// One contact sheet per asset: its preview renders in a grid under a caption, for review and evidence.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const CAPTION = 40;
const COLUMNS = 4;

function captionSvg(width, text) {
  const safe = text.replace(/[<>&]/g, '');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CAPTION}"><rect width="100%" height="100%" fill="#14161d"/>` +
      `<text x="12" y="27" font-family="Segoe UI, Arial, sans-serif" font-size="20" fill="#efe6d2">${safe}</text></svg>`,
  );
}

export async function composeSheets(previewRoot, outDir) {
  if (!existsSync(previewRoot)) return [];
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const asset of readdirSync(previewRoot).sort()) {
    const dir = join(previewRoot, asset);
    const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    if (files.length === 0) continue;
    const metas = await Promise.all(files.map((f) => sharp(join(dir, f)).metadata()));
    const tile = Math.max(...metas.map((m) => Math.max(m.width ?? 0, m.height ?? 0)));
    const rows = Math.ceil(files.length / COLUMNS);
    const width = tile * Math.min(COLUMNS, files.length);
    const height = CAPTION + tile * rows;
    const composites = [{ input: captionSvg(width, `${asset}  (${files.length} renders)`), left: 0, top: 0 }];
    files.forEach((file, i) => {
      composites.push({ input: join(dir, file), left: (i % COLUMNS) * tile, top: CAPTION + Math.floor(i / COLUMNS) * tile });
    });
    const out = join(outDir, `${asset}.png`);
    await sharp({ create: { width, height, channels: 3, background: '#2a2e38' } }).composite(composites).png().toFile(out);
    written.push(out);
  }
  return written;
}
