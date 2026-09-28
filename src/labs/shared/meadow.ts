/**
 * Meadow pieces drawn on LAYERS.noEdge alone, out of the screen-space edge pass: on the world layer it outlined every
 * grass cone, silhouette and base line alike, and the open meadow read as scribble. The flowers keep their own hull.
 * The Style Lab's scatter and the Asset World's members both read it, so a piece looks the same on either page.
 */
export const NO_EDGE_PIECES: readonly string[] = ['grass_tuft', 'flowers'];
