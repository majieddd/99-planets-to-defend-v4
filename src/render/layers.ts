/**
 * Render layers. The normal pass renders the world layer only, so hulls, the sky and noEdge never enter the edge test.
 *
 * noEdge is drawn by the main camera, and cast into the sun's shadow map, but kept out of the edge pass: grass and
 * flowers. On the world layer the edge pass outlined every grass cone, silhouette and base line alike (395 marks over
 * the strategic frame's meadow), so the open meadow read as scribble; the blueprint's ink rules keep open sunlit ground
 * free of ink. Anything on noEdge that still wants an outline carries a hull.
 */
export const LAYERS = { world: 0, hull: 1, sky: 2, noEdge: 3 } as const;
