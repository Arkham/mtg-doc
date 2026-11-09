/** Pure helpers for multi-pass card recognition: tiling, vote counting and quantity estimates. */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Splits an image into `cols × rows` tiles with fractional `overlap`, so a card cut by one tile's
 * edge is whole in its neighbour.
 */
export function tileGrid(
  width: number,
  height: number,
  cols: number,
  rows: number,
  overlap = 0.12,
): Rect[] {
  const tw = Math.ceil(width / cols);
  const th = Math.ceil(height / rows);
  const padX = Math.round(tw * overlap);
  const padY = Math.round(th * overlap);
  const rects: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const left = Math.max(0, c * tw - padX);
      const top = Math.max(0, r * th - padY);
      const right = Math.min(width, (c + 1) * tw + padX);
      const bottom = Math.min(height, (r + 1) * th + padY);
      rects.push({ left, top, width: right - left, height: bottom - top });
    }
  }
  return rects;
}

/**
 * Two tilings with different boundaries. Vision APIs downscale large images (to roughly 768px on
 * the short side), which makes card titles unreadable in a full deck photo; tiles keep them sharp.
 */
export function planTilings(width: number, height: number, targetTile = 1400): Rect[][] {
  const cols = Math.max(1, Math.round(width / targetTile));
  const rows = Math.max(1, Math.round(height / targetTile));
  if (cols * rows === 1) return [];
  return [tileGrid(width, height, cols, rows), tileGrid(width, height, cols + 1, rows + 1)];
}

export interface Sighting {
  /** Which independent pass saw it: "full", "tilesA", "tilesB". */
  pass: string;
  /** Tile id, or null for whole-image passes. */
  tile: string | null;
  name: string;
  printed: string;
  lang: string;
  qty: number;
}

export interface Tally {
  key: string;
  sightings: Sighting[];
  passes: Set<string>;
}

/** Groups sightings by the canonical card they resolved to. */
export function tallySightings(
  resolved: { sighting: Sighting; key: string | null }[],
): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const { sighting, key } of resolved) {
    if (!key) continue;
    const t = out.get(key) ?? { key, sightings: [], passes: new Set<string>() };
    t.sightings.push(sighting);
    t.passes.add(sighting.pass);
    out.set(key, t);
  }
  return out;
}

/** Cards seen by at least `minVotes` independent passes are accepted; the rest need verification. */
export function splitByVotes(tallies: Iterable<Tally>, minVotes: number) {
  const accepted: Tally[] = [];
  const contested: Tally[] = [];
  for (const t of tallies) (t.passes.size >= minVotes ? accepted : contested).push(t);
  return { accepted, contested };
}

/**
 * Copies of a card. Whole-image passes count stacks best; tile sums can double count across
 * overlaps, so they're only a fallback (taking the smaller of the two tilings).
 */
export function estimateQuantity(t: Tally): number {
  const full = t.sightings.filter((s) => s.pass === "full").map((s) => s.qty);
  if (full.length) return Math.max(...full);
  const sums = ["tilesA", "tilesB"]
    .map((p) => t.sightings.filter((s) => s.pass === p).reduce((n, s) => n + s.qty, 0))
    .filter((n) => n > 0);
  return sums.length ? Math.min(...sums) : 1;
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
