// Worktrees and other projects on this machine share port 4173, so the preview port can move without
// editing files. vite.config.ts and playwright.config.ts both read it here, so they cannot disagree.
export const DEFAULT_PREVIEW_PORT = 4173;

export function previewPort(raw: string | undefined = process.env.P99_PREVIEW_PORT): number {
  if (raw === undefined || raw === '') return DEFAULT_PREVIEW_PORT;
  const port = /^[0-9]+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`P99_PREVIEW_PORT must be a whole number from 1 to 65535, got "${raw}"`);
  }
  return port;
}
