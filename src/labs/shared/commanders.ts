/**
 * The commanders both labs show, and the names they give them, kept in one place so the Style Lab's panel and banner and
 * the Asset World's labels never disagree. Lab code, outside the simulation.
 */

/**
 * Pip (commander), the M1 commander built as `commander_pip`, or Bulwark, the visored knight the M0 look was locked on.
 */
export type CommanderKind = 'bulwark' | 'pip';

/** The commanders in the order the labs offer them, the default first. */
export const COMMANDERS: readonly CommanderKind[] = ['pip', 'bulwark'];

/**
 * The commander a lab shows when nothing names another: Pip, by the owner's decision of 2026-10-04 ("yes make Pip the
 * default, keep Bulwark as alternate"). Bulwark stays one switch away, and is the fallback when Pip is not built.
 */
export const DEFAULT_COMMANDER: CommanderKind = 'pip';

/**
 * Each commander's name as the labs give it. The owner has not named Pip's character yet, so he is "Pip (commander)"
 * wherever the labs name him as a character: the Style Lab's panel, banner and console, and the Asset World's labels.
 */
export const COMMANDER_LABELS: Readonly<Record<CommanderKind, string>> = { pip: 'Pip (commander)', bulwark: 'Bulwark' };
