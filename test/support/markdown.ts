/** The body of the first section with this heading, up to the next heading at its level or above. */
export function mdSection(md: string, heading: RegExp): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^#{1,6} /.test(l) && heading.test(l.replace(/^#+ /, "")));
  if (start < 0) throw new Error(`No section matching ${heading}`);
  const level = lines[start].match(/^#+/)![0].length;
  const end = lines.findIndex(
    (l, i) => i > start && /^#{1,6} /.test(l) && l.match(/^#+/)![0].length <= level,
  );
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** Card names in a decklist section's "- <qty> <name> <cost>" lines. */
export const listedCards = (section: string) =>
  [...section.matchAll(/^- \d+ (.+?)(?: \{.*)?(?: _\(new\)_)?$/gm)].map((m) => m[1]);
