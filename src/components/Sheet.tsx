import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { tiltHandlers } from "./Foil.tsx";

/** Horizontal travel, in px, that turns a drag into a swipe to the neighbouring card. */
const SWIPE_PX = 60;

/** Full-screen image viewer used for card previews on touch devices and photo zoom. */
export function Sheet({
  src,
  alt,
  onClose,
  actions,
  wide,
  foil,
  style,
  onPrev,
  onNext,
  position,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  actions?: ReactNode;
  wide?: boolean;
  /** Foil card that tilts under the pointer or finger, with an aura (set via `style`). */
  foil?: boolean;
  style?: CSSProperties;
  /** Neighbours in a gallery: swipe, arrow keys or the side buttons move between them. */
  onPrev?: () => void;
  onNext?: () => void;
  /** Where this image sits in its gallery, e.g. "3 / 99". */
  position?: string;
}) {
  const [dx, setDx] = useState(0);
  const [enter, setEnter] = useState<"next" | "prev" | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; horizontal: boolean | null } | null>(
    null,
  );
  // A drag ends with a click on the backdrop, which would otherwise close the sheet.
  const swallowClick = useRef(false);
  const go = (dir: "next" | "prev") => {
    const step = dir === "next" ? onNext : onPrev;
    if (!step) return;
    setEnter(dir);
    step();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go("next");
      else if (e.key === "ArrowLeft") go("prev");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const gallery = Boolean(onPrev || onNext);
  const swipe = gallery
    ? {
        onPointerDown: (e: PointerEvent) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, horizontal: null };
        },
        onPointerMove: (e: PointerEvent<HTMLElement>) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const mx = e.clientX - d.x;
          const my = e.clientY - d.y;
          if (d.horizontal === null && Math.hypot(mx, my) > 8) {
            d.horizontal = Math.abs(mx) > Math.abs(my);
            if (d.horizontal) e.currentTarget.setPointerCapture(e.pointerId);
          }
          if (!d.horizontal) return;
          // Resist past the ends so there's feedback without implying another card.
          const blocked = (mx < 0 && !onNext) || (mx > 0 && !onPrev);
          setDx(blocked ? mx / 4 : mx);
        },
        onPointerUp: (e: PointerEvent) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          drag.current = null;
          if (!d.horizontal) return;
          swallowClick.current = true;
          const mx = e.clientX - d.x;
          setDx(0);
          if (mx <= -SWIPE_PX) go("next");
          else if (mx >= SWIPE_PX) go("prev");
        },
        onPointerCancel: () => {
          drag.current = null;
          setDx(0);
        },
      }
    : {};

  const dragging = dx !== 0;
  const imgStyle: CSSProperties | undefined = dragging
    ? {
        transform: `translateX(${dx}px) rotate(${dx / 40}deg)`,
        opacity: Math.max(0.4, 1 - Math.abs(dx) / 600),
      }
    : undefined;

  return createPortal(
    <div
      className={`card-sheet ${gallery ? "gallery" : ""}`}
      onClick={() => {
        if (swallowClick.current) swallowClick.current = false;
        else onClose();
      }}
      role="dialog"
      aria-label={alt}
      {...swipe}
    >
      {foil ? (
        // Taps on the card tilt it instead of closing; the backdrop and Close button still close.
        <div
          className="sheet-card tilt"
          style={style}
          onClick={(e) => e.stopPropagation()}
          {...tiltHandlers(true)}
        >
          <img src={src} alt={alt} />
          <span className="foil" aria-hidden />
        </div>
      ) : (
        // Keyed by image so each card replays its entrance animation.
        <img
          key={src}
          src={src}
          alt={alt}
          draggable={false}
          className={[wide && "wide", enter && `enter-${enter}`, dragging && "dragging"]
            .filter(Boolean)
            .join(" ")}
          style={imgStyle}
        />
      )}
      {gallery && (
        <>
          <button
            className="sheet-nav prev"
            aria-label="Previous card"
            disabled={!onPrev}
            onClick={(e) => {
              e.stopPropagation();
              go("prev");
            }}
          >
            ‹
          </button>
          <button
            className="sheet-nav next"
            aria-label="Next card"
            disabled={!onNext}
            onClick={(e) => {
              e.stopPropagation();
              go("next");
            }}
          >
            ›
          </button>
        </>
      )}
      <div className="row" onClick={(e) => e.stopPropagation()}>
        {position && <span className="sheet-position">{position}</span>}
        {actions}
        <button onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  );
}
