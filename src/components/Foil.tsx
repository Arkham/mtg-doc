import type { PointerEvent } from "react";

const reset = (el: HTMLElement) => {
  el.classList.remove("tilting");
  for (const v of ["--rx", "--ry", "--mx", "--my"]) el.style.removeProperty(v);
};

/**
 * Pointer handlers that tilt a `.tilt` element toward the pointer and move its `.foil` highlight.
 * Touch is opt-in: where the page can scroll, a drag has to scroll rather than tilt.
 */
export function tiltHandlers(touch = false) {
  return {
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === "touch" && !touch) return;
      const el = e.currentTarget;
      const box = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
      const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
      el.style.setProperty("--rx", `${(0.5 - y) * 14}deg`);
      el.style.setProperty("--ry", `${(x - 0.5) * 18}deg`);
      el.style.setProperty("--mx", `${x * 100}%`);
      el.style.setProperty("--my", `${y * 100}%`);
      el.classList.add("tilting");
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => reset(e.currentTarget),
    onPointerUp: (e: PointerEvent<HTMLElement>) =>
      e.pointerType === "touch" && reset(e.currentTarget),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => reset(e.currentTarget),
  };
}
