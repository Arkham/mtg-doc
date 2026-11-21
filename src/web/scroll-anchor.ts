/** The report section being read and where it sits, so switching views can keep it in place. */
interface ScrollAnchor {
  /** Sections from the top of the page down to the one being read. */
  ids: string[];
  /** Where the section being read starts, relative to the top of the viewport. */
  top: number;
}

const sections = () => [...document.querySelectorAll<HTMLElement>("main section.panel[id]")];

/**
 * How far below the sticky bars a section can start and still be the one being read: scrolling
 * lands on whole pixels, so a section put back where it was can sit a fraction lower.
 */
const SLACK = 2;

/** The section being read: the last one whose top has passed the sticky bars (as SectionNav). */
export function captureAnchor(): ScrollAnchor | null {
  const passed = sections().filter((el) => {
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    return el.getBoundingClientRect().top <= margin + SLACK;
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
  // Rounded, or the browser rounds it down, and the section creeps down a pixel a switch until it
  // no longer counts as the one being read.
  window.scrollTo({ top: Math.round(rect.top + window.scrollY - top), behavior: "instant" });
}

/**
 * Runs `act` as soon as `ready` holds: now, or right after the change to the page that makes it
 * so, before the browser paints it (a MutationObserver's callback runs once Elm has patched the
 * page, whichever frame that is). Gives up after `timeoutMs`.
 */
export function whenDrawn(ready: () => boolean, act: () => void, timeoutMs = 3000) {
  if (ready()) return act();
  const observer = new MutationObserver(() => {
    if (!ready()) return;
    stop();
    act();
  });
  const timer = setTimeout(() => stop(), timeoutMs);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
  };
  observer.observe(document.getElementById("root") ?? document.body, {
    subtree: true,
    childList: true,
    attributes: true,
  });
}
