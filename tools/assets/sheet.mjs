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

/**
 * Composes one sheet per asset folder and returns the sheets written and a warning for each it could not write. The
 * build calls this after it has published, so a sheet that fails must not fail the build: a sheet too large for sharp
 * (the combo's filmstrips once took Pip's to 9,216 x 34,600 px) threw there, and the build exited 1 with every model
 * already published. Such a sheet is now skipped with a warning that names it and its size.
 */
export async function composeSheets(previewRoot, outDir) {
  if (!existsSync(previewRoot)) return { written: [], warnings: [] };
  mkdirSync(outDir, { recursive: true });
  const written = [];
  const warnings = [];
  for (const asset of readdirSync(previewRoot).sort()) {
    const dir = join(previewRoot, asset);
    const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    if (files.length === 0) continue;
    let width = 0;
    let height = 0;
    try {
      const metas = await Promise.all(files.map((f) => sharp(join(dir, f)).metadata()));
      const tile = Math.max(...metas.map((m) => Math.max(m.width ?? 0, m.height ?? 0)));
      const rows = Math.ceil(files.length / COLUMNS);
      width = tile * Math.min(COLUMNS, files.length);
      height = CAPTION + tile * rows;
      const composites = [{ input: captionSvg(width, `${asset}  (${files.length} renders)`), left: 0, top: 0 }];
      files.forEach((file, i) => {
        composites.push({ input: join(dir, file), left: (i % COLUMNS) * tile, top: CAPTION + Math.floor(i / COLUMNS) * tile });
      });
      const out = join(outDir, `${asset}.png`);
      await sharp({ create: { width, height, channels: 3, background: '#2a2e38' } }).composite(composites).png().toFile(out);
      written.push(out);
    } catch (error) {
      warnings.push(`the ${asset} contact sheet (${files.length} renders, ${width} x ${height} px) was not written: ${error.message ?? error}`);
    }
  }
  return { written, warnings };
}
