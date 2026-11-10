import {
  Fragment,
  type MouseEvent,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { CardPreview } from "../../shared/types.ts";
import { Sheet } from "./Sheet.tsx";

interface CardLike {
  image: string | null;
  scryfallUri: string;
}

/** Preview data for the cards on the current page (a report's `cardIndex`). */
export const CardIndex = createContext<Record<string, CardPreview>>({});

/** Last resort so every card name has a preview: Scryfall serves a card image by exact name. */
const fallbackPreview = (name: string): CardPreview => ({
  image: `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`,
  scryfallUri: `https://scryfall.com/search?q=${encodeURIComponent(`!"${name}"`)}`,
});

/** Opens a card in the surrounding `CardGallery`'s sheet; null outside one. */
const Gallery = createContext<((name: string) => void) | null>(null);
export const useGallery = () => useContext(Gallery);

/**
 * Shares one full-size sheet between the cards inside it, in the order given, so the viewer can
 * swipe from card to card. Cards without an image are skipped; a repeated name opens its first spot.
 */
export function CardGallery({
  cards,
  children,
}: {
  cards: { name: string; card?: CardLike | null }[];
  children: ReactNode;
}) {
  const index = useContext(CardIndex);
  const seen = new Set<string>();
  const items = cards.flatMap(({ name, card }) => {
    if (seen.has(name)) return [];
    seen.add(name);
    const data = card?.image ? card : (index[name] ?? fallbackPreview(name));
    if (!data.image) return [];
    const href = data.scryfallUri || fallbackPreview(name).scryfallUri;
    return [{ name, image: data.image, href }];
  });
  const [at, setAt] = useState<number | null>(null);
  const open = (name: string) => {
    const i = items.findIndex((it) => it.name === name);
    if (i >= 0) setAt(i);
  };
  const item = at === null ? null : items[at];
  // Warm the neighbours so a swipe lands on a loaded image.
  const prevImage = at === null ? undefined : items[at - 1]?.image;
  const nextImage = at === null ? undefined : items[at + 1]?.image;
  useEffect(() => {
    for (const src of [prevImage, nextImage]) if (src) new Image().src = src;
  }, [prevImage, nextImage]);
  return (
    <Gallery.Provider value={open}>
      {children}
      {item && at !== null && (
        <Sheet
          src={item.image}
          alt={item.name}
          onClose={() => setAt(null)}
          onPrev={at > 0 ? () => setAt(at - 1) : undefined}
          onNext={at < items.length - 1 ? () => setAt(at + 1) : undefined}
          position={`${at + 1} / ${items.length}`}
          actions={
            <a className="button" href={item.href} target="_blank" rel="noreferrer">
              Scryfall ↗
            </a>
          }
        />
      )}
    </Gallery.Provider>
  );
}

export const canHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** Floating full-size card image that follows the pointer while hovering an element. */
export function useHoverPreview(image: string | null | undefined) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const handlers = {
    onMouseMove: (e: MouseEvent) => image && canHover() && setPos({ x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setPos(null),
  };
  // Portaled to <body> so thumbnail styles and transformed ancestors can't resize or misplace it.
  const preview =
    pos && image
      ? createPortal(
          <img
            className="card-preview"
            src={image}
            alt=""
            style={{
              left: pos.x + 280 > window.innerWidth ? pos.x - 270 : pos.x + 20,
              top: Math.max(8, Math.min(pos.y - 60, window.innerHeight - 350)),
            }}
          />,
          document.body,
        )
      : null;
  return { handlers, preview };
}

/** Card name that previews the card: floating image on hover, full-screen sheet on tap for touch devices. */
export function CardName({
  name,
  card,
  label,
  className,
}: {
  name: string;
  card?: CardLike | null;
  label?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const gallery = useGallery();
  const index = useContext(CardIndex);
  const data = card?.image ? card : (index[name] ?? fallbackPreview(name));
  const img = data.image;
  const { handlers, preview } = useHoverPreview(img);
  const href = data.scryfallUri || fallbackPreview(name).scryfallUri;
  return (
    <span className={`card-name ${className ?? ""}`} {...handlers}>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          if (img && !canHover()) {
            e.preventDefault();
            if (gallery) gallery(name);
            else setOpen(true);
          }
        }}
      >
        {label ?? name}
      </a>
      {preview}
      {open && img && (
        <Sheet
          src={img}
          alt={name}
          onClose={() => setOpen(false)}
          actions={
            <a className="button" href={href} target="_blank" rel="noreferrer">
              Scryfall ↗
            </a>
          }
        />
      )}
    </span>
  );
}

/** Several card names, each with its own preview, joined by a separator. */
export function CardList({ names, separator = " + " }: { names: string[]; separator?: string }) {
  return (
    <>
      {names.map((n, i) => (
        <Fragment key={`${n}-${i}`}>
          {i > 0 && <span className="muted">{separator}</span>}
          <CardName name={n} />
        </Fragment>
      ))}
    </>
  );
}
