import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { DeckChatMessage, Report } from "../../shared/types.ts";
import { api } from "../api.ts";
import { navigate } from "../nav.ts";
import { CardName } from "./CardName.tsx";
import { ManaCost } from "./Mana.tsx";

const SUGGESTIONS = [
  "Cut the weakest card for more removal",
  "Re-optimize this for bracket 2",
  "Make this deck cheaper",
  "Swap a tapped land for an untapped dual",
  "What are this deck's weaknesses?",
];

function Changes({
  message,
  busy,
  onApply,
}: {
  message: DeckChatMessage;
  busy: boolean;
  onApply: () => void;
}) {
  const changes = message.changes ?? [];
  const valid = changes.filter((c) => c.ok);
  return (
    <div className="chat-changes">
      <ul>
        {changes.map((c, i) => (
          <li key={i} className={`${c.action} ${c.ok ? "" : "rejected"}`}>
            <span className="chat-change-sign" aria-label={c.action}>
              {c.action === "add" ? "+" : "−"}
            </span>
            <div>
              <div className="chat-change-name">
                {c.qty > 1 && <span className="muted">{c.qty}× </span>}
                {c.card ? <CardName name={c.name} card={c.card} /> : c.name}
                {c.card && <ManaCost cost={c.card.manaCost} size={13} />}
                {c.card?.priceUsd != null && c.action === "add" && (
                  <span className="muted small">${c.card.priceUsd.toFixed(2)}</span>
                )}
              </div>
              <div className="small muted">{c.ok ? c.reason : `Can't: ${c.problem}`}</div>
            </div>
          </li>
        ))}
      </ul>
      {message.applied ? (
        <div className="chat-applied small">✓ Applied</div>
      ) : (
        valid.length > 0 && (
          <button className="primary" disabled={busy} onClick={onApply}>
            {busy ? <span className="spinner" aria-hidden /> : null}
            Apply {valid.length} change{valid.length > 1 ? "s" : ""}
          </button>
        )
      )}
    </div>
  );
}

function Rerun({
  slug,
  message,
  busy,
  onConfirm,
}: {
  slug: string;
  message: DeckChatMessage;
  busy: boolean;
  onConfirm: () => void;
}) {
  const r = message.rerun!;
  return (
    <div className="chat-changes chat-rerun">
      <div className="chat-rerun-title">
        <span aria-hidden>↻</span> Re-run the optimizer
      </div>
      <p className="small">
        With {r.summary}. This replaces the current suggestions and any chat edits.
      </p>
      {r.jobId ? (
        <a className="small" href={`#/job/${slug}/${r.jobId}`}>
          ✓ Started · see progress
        </a>
      ) : (
        <button className="primary" disabled={busy} onClick={onConfirm}>
          {busy ? <span className="spinner" aria-hidden /> : null}
          Re-run
        </button>
      )}
    </div>
  );
}

/** Sidebar for asking questions about a deck and making edits through conversation. */
export function ChatPanel({
  slug,
  commander,
  onApplied,
}: {
  slug: string;
  commander: string;
  onApplied: (report: Report) => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<DeckChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && messages === null) api.chat(slug).then(setMessages, () => setMessages([]));
    if (open) inputRef.current?.focus();
  }, [open, messages, slug]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, sending]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = async (message: string) => {
    const content = message.trim();
    if (!content || sending) return;
    setError(null);
    setSending(true);
    setText("");
    const pending: DeckChatMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content,
      at: new Date().toISOString(),
    };
    setMessages((m) => [...(m ?? []), pending]);
    try {
      const reply = await api.sendChat(slug, content);
      setMessages((m) => [...(m ?? []), reply]);
      // A "yes" to a proposed re-run starts it right away.
      if (reply.rerun?.jobId) navigate(`#/job/${slug}/${reply.rerun.jobId}`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setText(content);
      setMessages((m) => (m ?? []).filter((x) => x.id !== pending.id));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const apply = async (id: string) => {
    setApplying(id);
    setError(null);
    try {
      const { report, message } = await api.applyChat(slug, id);
      setMessages((m) => (m ?? []).map((x) => (x.id === id ? message : x)));
      onApplied(report);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setApplying(null);
    }
  };

  const rerun = async (id: string) => {
    setApplying(id);
    setError(null);
    try {
      const { jobId } = await api.rerunFromChat(slug, id);
      navigate(`#/job/${slug}/${jobId}`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setApplying(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(text);
    }
  };

  return (
    <>
      {!open && (
        <button
          className="chat-fab primary"
          onClick={() => setOpen(true)}
          aria-label="Ask the doc about this deck"
        >
          <img className="doc-avatar" src="./icon-96.png" alt="" width={30} height={30} /> Ask
          <span className="chat-fab-long"> the doc</span>
        </button>
      )}
      {open && (
        <aside className="chat-panel" aria-label="Deck chat">
          <header className="chat-head">
            <img className="doc-avatar lg" src="./icon-96.png" alt="" width={40} height={40} />
            <div className="grow">
              <strong>The mtg doc</strong>
              <div className="muted small">{commander}</div>
            </div>
            <button className="icon" aria-label="Close chat" onClick={() => setOpen(false)}>
              ✕
            </button>
          </header>
          <div className="chat-messages" ref={listRef}>
            {messages?.length === 0 && (
              <div className="chat-empty">
                <p>
                  Ask about the deck or tell me what to change. I&apos;ll propose additions and cuts
                  that fit your bracket and budget; nothing changes until you apply it.
                </p>
                <div className="chat-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="chip-button" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages?.map((m) => (
              <div key={m.id} className={`chat-msg ${m.role}`}>
                <div className="chat-bubble">{m.content}</div>
                {m.role === "assistant" && m.changes?.length ? (
                  <Changes message={m} busy={applying === m.id} onApply={() => apply(m.id)} />
                ) : null}
                {m.role === "assistant" && m.rerun ? (
                  <Rerun
                    slug={slug}
                    message={m}
                    busy={applying === m.id}
                    onConfirm={() => rerun(m.id)}
                  />
                ) : null}
              </div>
            ))}
            {sending && (
              <div className="chat-msg assistant">
                <div className="chat-bubble typing" aria-label="Thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>
          {error && <p className="error small chat-error">{error}</p>}
          <form className="chat-input" onSubmit={onSubmit}>
            <textarea
              ref={inputRef}
              rows={2}
              placeholder="e.g. swap Sol Ring for Mind Stone, or add more card draw"
              aria-label="Message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              type="submit"
              className="primary"
              disabled={!text.trim() || sending}
              aria-label="Send"
            >
              ↑
            </button>
          </form>
        </aside>
      )}
    </>
  );
}
