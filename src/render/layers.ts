/**
 * Render layers. The normal pass renders the world layer only, so hulls, the sky and noEdge never enter the edge test.
 *
 * noEdge is drawn by the main camera, and cast into the sun's shadow map, but kept out of the edge pass: grass and
 * flowers. On the world layer the edge pass outlined every grass cone, silhouette and base line alike (395 marks over
 * the strategic frame's meadow), so the open meadow read as scribble; the blueprint's ink rules keep open sunlit ground
 * free of ink. Anything on noEdge that still wants an outline carries a hull.
 *
 * energy is player energy drawn as light on its own (the sword trail and the hit sparks), which the pipeline draws in a
 * pass of its own after the ink and the fog and before the bloom (post/energyPass.ts), so no ink line or fog lands on
 * it. The main camera never enables it: energy belongs in the energy scene the pipeline is given, and a piece left in
 * the main scene by mistake draws nowhere rather than under the ink.
 */
export const LAYERS = { world: 0, hull: 1, sky: 2, noEdge: 3, energy: 4 } as const;
