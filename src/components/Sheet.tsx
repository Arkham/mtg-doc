import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

/** Full-screen image viewer used for card previews on touch devices and photo zoom. */
export function Sheet({
  src,
  alt,
  onClose,
  actions,
  wide,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  actions?: ReactNode;
  wide?: boolean;
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
      <img src={src} alt={alt} className={wide ? "wide" : ""} />
      <div className="row" onClick={(e) => e.stopPropagation()}>
        {actions}
        <button onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  );
}
