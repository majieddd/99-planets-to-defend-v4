import { AUTHORED_CHARACTER_BLEND } from '../materials/painted';

/**
 * The standard blend each manifest family's materials are authored at, which loadAsset passes to every painted material
 * it makes: how much of the smooth standard lighting mixes into the cel bands (blueprint, Art direction: characters blend
 * cel and standard lighting, as Sifu does on its characters only). Bulwark's 0.35 is the blend every other is authored
 * against (AUTHORED_CHARACTER_BLEND); the Husk takes 0.3, the towers, the heart and the nests the 0.1 of a structure,
 * and the environment kit 0, paint alone. The Style Lab and the Asset World both load through this table, so one asset
 * cannot light differently on the two pages.
 */
export const FAMILY_STANDARD_BLEND = {
  commanders: AUTHORED_CHARACTER_BLEND,
  xeno: 0.3,
  towers: 0.1,
  heart: 0.1,
  nests: 0.1,
  env: 0,
} as const;

/**
 * The blend for a manifest family. A family the table does not name throws, naming it, rather than falling back to a
 * prop's blend: a new character family loaded as a prop would lose the actor fill that keeps it readable under a low
 * key, and nothing on screen would say why (tests/unit/labs/world-registry.test.ts holds every manifest family here).
 */
export function standardBlendFor(family: string): number {
  if (!Object.hasOwn(FAMILY_STANDARD_BLEND, family)) {
    throw new Error(`no standard blend for the asset family "${family}"; add it to FAMILY_STANDARD_BLEND in src/render/assets/familyBlend.ts`);
  }
  return FAMILY_STANDARD_BLEND[family as keyof typeof FAMILY_STANDARD_BLEND];
}
