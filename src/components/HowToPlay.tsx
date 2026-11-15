import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { PlayGuide, Report } from "../../shared/types.ts";
import { BracketBadge } from "./BracketPanel.tsx";
import { CardList, CardName, Prose } from "./CardName.tsx";
import { ManaCost } from "./Mana.tsx";

const NAMES: Record<number, string> = {
  1: "Exhibition",
  2: "Core",
  3: "Upgraded",
  4: "Optimized",
  5: "cEDH",
};

/** A dialog over the page: full screen on phones, a centered panel on larger screens. */
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // A card preview's sheet closes first.
      if (e.key === "Escape" && !document.querySelector(".card-sheet")) onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button ref={close} className="modal-close" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const Bullets = ({ items }: { items: string[] }) => (
  <ul className="play-bullets">
    {items.map((x) => (
      <li key={x}>
        <Prose text={x} />
      </li>
    ))}
  </ul>
);

function Guide({ g }: { g: PlayGuide }) {
  const phases = (
    [
      ["Early game", "Turns 1-3", g.early],
      ["Mid game", "Building up", g.mid],
      ["Late game", "Closing it out", g.late],
    ] as const
  ).filter(([, , items]) => items.length);
  return (
    <>
      <p className="play-summary">
        <Prose text={g.summary} />
      </p>
      {phases.length > 0 && (
        <ol className="play-phases">
          {phases.map(([title, sub, items]) => (
            <li key={title}>
              <h3>
                {title} <span>{sub}</span>
              </h3>
              <Bullets items={[...items]} />
            </li>
          ))}
        </ol>
      )}
      {g.winConditions.length > 0 && (
        <section>
          <h3>How it wins</h3>
          <Bullets items={g.winConditions} />
        </section>
      )}
      {g.keyCards.length > 0 && (
        <section>
          <h3>Key cards</h3>
          <ul className="play-cards">
            {g.keyCards.map((k) => (
              <li key={k.name}>
                <CardName name={k.name} />
                <span>
                  <Prose text={k.why} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {g.mulligan && (
        <p className="play-mulligan">
          <strong>Keep or mulligan?</strong> <Prose text={g.mulligan} />
        </p>
      )}
      {g.watchOut.length > 0 && (
        <section>
          <h3>Watch out for</h3>
          <Bullets items={g.watchOut} />
        </section>
      )}
    </>
  );
}

/** What the table should know before the game: bracket, game length, Game Changers, combos. */
function AtTheTable({ r }: { r: Report }) {
  const b = r.bracket!;
  const a = b.after;
  const combos = a.combos.filter((c) => c.twoCard);
  return (
    <section className="play-table">
      <h3>At the table</h3>
      <div className="rule0-facts">
        <div>
          <span>Game length</span>
          <strong>{b.minTurns}+ turns</strong>
        </div>
        <div>
          <span>Power</span>
          <strong>
            {a.position === "high" ? "High" : a.position === "mid" ? "Mid" : "Low"}{" "}
            {NAMES[a.bracket]}
          </strong>
        </div>
        <div>
          <span>Game Changers</span>
          <strong>{a.gameChangers.length}</strong>
        </div>
        <div>
          <span>Two-card combos</span>
          <strong>{combos.length}</strong>
        </div>
      </div>
      {a.gameChangers.length > 0 && (
        <p className="rule0-list">
          <span className="muted">Game Changers: </span>
          <CardList names={a.gameChangers} separator=" · " />
        </p>
      )}
      {combos.length > 0 && (
        <ul className="rule0-combos">
          {combos.map((c) => (
            <li key={c.cards.join("+")}>
              <strong>
                <CardList names={c.cards} />
              </strong>
              <span>{c.produces.slice(0, 2).join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
      {(a.massLandDenial.length > 0 || a.extraTurns.length > 0) && (
        <p className="rule0-list">
          <span className="muted">Heads up: </span>
          <CardList names={[...a.massLandDenial, ...a.extraTurns]} separator=" · " />
        </p>
      )}
      {a.gameChangers.length === 0 && combos.length === 0 && (
        <p className="rule0-clean">No Game Changers, no two-card combos, no land destruction.</p>
      )}
    </section>
  );
}

/**
 * How to play the deck on screen, and what to tell the table in the pre-game (Rule 0) talk. `r` is
 * the report as it applies to that deck; `guide` is that deck's guide, when there is one.
 */
export function HowToPlay({
  r,
  guide,
  onClose,
}: {
  r: Report;
  guide: PlayGuide | undefined;
  onClose: () => void;
}) {
  const cmdr = r.commanderCards[0];
  const a = r.bracket?.after;
  return (
    <Modal title="How to play" onClose={onClose}>
      <div className="play">
        {cmdr?.imageArt && (
          <div className="rule0-art" style={{ backgroundImage: `url(${cmdr.imageArt})` }} />
        )}
        <div className="play-content">
          <div className="play-top">
            {a && <BracketBadge n={a.bracket} size="lg" />}
            <div>
              {a && (
                <div className="rule0-kicker">
                  Bracket {a.bracket} · {NAMES[a.bracket]}
                </div>
              )}
              <h1>
                {r.commanders.join(" + ")}{" "}
                {r.commanderCards.map((c) => (
                  <ManaCost key={c.name} cost={c.manaCost} size={22} />
                ))}
              </h1>
            </div>
          </div>
          {guide ? (
            <Guide g={guide} />
          ) : (
            <p className="muted">There's no playing guide for this deck yet.</p>
          )}
          {r.bracket && <AtTheTable r={r} />}
        </div>
      </div>
    </Modal>
  );
}
