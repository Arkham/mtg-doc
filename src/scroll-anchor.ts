/** The report section being read and where it sits, so switching views can keep it in place. */
export interface ScrollAnchor {
  /** Sections from the top of the page down to the one being read. */
  ids: string[];
  /** Where the section being read starts, relative to the top of the viewport. */
  top: number;
}

const sections = () => [...document.querySelectorAll<HTMLElement>("main section.panel[id]")];

/** The section being read: the last one whose top has passed the sticky bars (as SectionNav). */
export function captureAnchor(): ScrollAnchor | null {
  const passed = sections().filter((el) => {
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    return el.getBoundingClientRect().top <= margin + 1;
  });
  const current = passed.at(-1);
  return current
    ? { ids: passed.map((el) => el.id), top: current.getBoundingClientRect().top }
    : null;
}

/**
 * Puts the same section back where it was. Without it (the other view may not have it), the
 * nearest one above it; the same offset into it, as long as some of it stays on screen.
 */
export function restoreAnchor(anchor: ScrollAnchor) {
  const el = [...anchor.ids]
    .reverse()
    .map((id) => document.getElementById(id))
    .find(Boolean);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const top = Math.max(anchor.top, -(rect.height - window.innerHeight / 3));
  window.scrollTo({ top: rect.top + window.scrollY - top, behavior: "instant" });
}
