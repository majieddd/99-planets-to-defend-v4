/** Render layers. The normal pass renders the world layer only, so hulls and the sky never enter the edge test. */
export const LAYERS = { world: 0, hull: 1, sky: 2 } as const;
