const BASIC_NAMES = new Set(["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"]);

/** Basic lands, including the snow-covered ones, which a deck may play any number of. */
export const isBasicLand = (name: string) =>
  BASIC_NAMES.has(name) || name.startsWith("Snow-Covered ");
