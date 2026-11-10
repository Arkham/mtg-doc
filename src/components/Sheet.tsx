import { type CSSProperties, type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { tiltHandlers } from "./Foil.tsx";

/** Full-screen image viewer used for card previews on touch devices and photo zoom. */
export function Sheet({
  src,
  alt,
  onClose,
  actions,
  wide,
  foil,
  style,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  actions?: ReactNode;
  wide?: boolean;
  /** Foil card that tilts under the pointer or finger, with an aura (set via `style`). */
  foil?: boolean;
  style?: CSSProperties;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="card-sheet" onClick={onClose} role="dialog" aria-label={alt}>
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
        <img src={src} alt={alt} className={wide ? "wide" : ""} />
      )}
      <div className="row" onClick={(e) => e.stopPropagation()}>
        {actions}
        <button onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  );
}
