/**
 * Custom elements for what Elm can't do from its view: browser APIs, imperative focus and scroll,
 * and per-frame pointer effects. Most are invisible controllers placed inside the element they act
 * on (`this.parentElement`), so the page's markup and its CSS selectors stay as they are.
 */

import { RunMap } from "./run-map.ts";

/** Invisible element whose behaviour applies to its parent. */
class Controller extends HTMLElement {
  connectedCallback() {
    this.style.display = "none";
  }
  get host() {
    return this.parentElement;
  }
}

/**
 * Tilts the parent `.tilt` element toward the pointer and moves its `.foil` highlight. Touch is
 * opt-in (`touch` attribute): where the page can scroll, a drag has to scroll rather than tilt.
 */
class Tilt extends Controller {
  #off = () => {};
  connectedCallback() {
    super.connectedCallback();
    const el = this.host;
    if (!el) return;
    const touch = this.hasAttribute("touch");
    const reset = () => {
      el.classList.remove("tilting");
      for (const v of ["--rx", "--ry", "--mx", "--my"]) el.style.removeProperty(v);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch" && !touch) return;
      const box = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
      const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
      el.style.setProperty("--rx", `${(0.5 - y) * 14}deg`);
      el.style.setProperty("--ry", `${(x - 0.5) * 18}deg`);
      el.style.setProperty("--mx", `${x * 100}%`);
      el.style.setProperty("--my", `${y * 100}%`);
      el.classList.add("tilting");
    };
    const up = (e: PointerEvent) => e.pointerType === "touch" && reset();
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", reset);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", reset);
    this.#off = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", reset);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", reset);
    };
  }
  disconnectedCallback() {
    this.#off();
  }
}

/** Keeps the page from scrolling behind an overlay while this element is on the page. */
class ScrollLock extends Controller {
  #previous = "";
  connectedCallback() {
    super.connectedCallback();
    this.#previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  disconnectedCallback() {
    document.body.style.overflow = this.#previous;
  }
}

/**
 * Focuses its parent, or the parent's element matching `target`, when it appears (unless `lazy`)
 * and whenever `token` changes. With `restore`, focus goes back where it was when it leaves the
 * page.
 */
class Focus extends Controller {
  static observedAttributes = ["token"];
  #opener: HTMLElement | null = null;
  connectedCallback() {
    super.connectedCallback();
    this.#opener = document.activeElement as HTMLElement | null;
    if (!this.hasAttribute("lazy")) this.focusTarget();
  }
  attributeChangedCallback() {
    if (this.isConnected) queueMicrotask(() => this.focusTarget());
  }
  focusTarget() {
    const selector = this.getAttribute("target");
    const el = selector ? this.host?.querySelector<HTMLElement>(selector) : this.host;
    el?.focus();
  }
  disconnectedCallback() {
    if (this.hasAttribute("restore")) this.#opener?.focus?.();
  }
}

/** Scrolls its parent to the bottom whenever the parent's content changes. */
class StickBottom extends Controller {
  #observer: MutationObserver | null = null;
  connectedCallback() {
    super.connectedCallback();
    const el = this.host;
    if (!el) return;
    const stick = () => el.scrollTo({ top: el.scrollHeight });
    this.#observer = new MutationObserver(stick);
    this.#observer.observe(el, { childList: true, subtree: true, characterData: true });
    stick();
  }
  disconnectedCallback() {
    this.#observer?.disconnect();
  }
}

/** Blurs the text field in its parent when Enter is pressed in it. */
class BlurOnEnter extends Controller {
  #off = () => {};
  connectedCallback() {
    super.connectedCallback();
    const el = this.host;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.target.blur();
    };
    el.addEventListener("keydown", onKey);
    this.#off = () => el.removeEventListener("keydown", onKey);
  }
  disconnectedCallback() {
    this.#off();
  }
}

/** Scrolls its parent into view when it appears. */
class ScrollIntoView extends Controller {
  connectedCallback() {
    super.connectedCallback();
    this.host?.scrollIntoView({ block: "nearest" });
  }
}

/**
 * Copies `text` (a property) to the clipboard when its parent is clicked, then fires `copied`.
 * In the click itself: iOS Safari only allows clipboard writes made synchronously in a tap.
 */
class Copy extends Controller {
  text = "";
  #off = () => {};
  connectedCallback() {
    super.connectedCallback();
    const el = this.host;
    if (!el) return;
    const click = () => {
      if (!this.text) return;
      navigator.clipboard.writeText(this.text).then(
        () => this.dispatchEvent(new CustomEvent("copied")),
        () => {},
      );
    };
    el.addEventListener("click", click);
    this.#off = () => el.removeEventListener("click", click);
  }
  disconnectedCallback() {
    this.#off();
  }
}

/**
 * Closes the parent `<details>` on a pointer press outside it, and whenever `close` changes (a
 * counter the app bumps to close it).
 */
class OutsideClose extends Controller {
  static observedAttributes = ["close"];
  #off = () => {};
  connectedCallback() {
    super.connectedCallback();
    const close = (e: PointerEvent) => {
      const details = this.host as HTMLDetailsElement | null;
      if (details?.open && !details.contains(e.target as Node)) details.open = false;
    };
    document.addEventListener("pointerdown", close);
    this.#off = () => document.removeEventListener("pointerdown", close);
  }
  attributeChangedCallback(_name: string, old: string | null) {
    const details = this.host as HTMLDetailsElement | null;
    if (old !== null && details) details.open = false;
  }
  disconnectedCallback() {
    this.#off();
  }
}

/** Loads images ahead of time (space-separated `srcs`), so the next card in a gallery is ready. */
class Preload extends Controller {
  static observedAttributes = ["srcs"];
  attributeChangedCallback(_name: string, _old: string | null, value: string | null) {
    for (const src of (value ?? "").split(" ")) if (src) new Image().src = src;
  }
}

/**
 * Keeps the parent `.section-nav`'s active tab on the section being read, and scrolls to a
 * section when its tab is clicked. Fires `activechange` with the section's id; the app marks it.
 */
class SectionNav extends Controller {
  #off = () => {};
  connectedCallback() {
    super.connectedCallback();
    const nav = this.host;
    if (!nav) return;
    const ids = () => [...nav.querySelectorAll<HTMLElement>("[data-id]")].map((b) => b.dataset.id!);
    // While scrolling to a clicked tab, keep that tab active; side-by-side sections share a top, so
    // position alone can't tell them apart. Any user-driven scroll hands control back.
    let clicked: string | null = null;
    let raf = 0;
    let last: string | undefined;
    const report = (id: string | undefined) => {
      if (id === undefined || id === last) return;
      last = id;
      this.dispatchEvent(new CustomEvent("activechange", { detail: id }));
    };
    // Otherwise the active section is the last one whose top has passed the tab bar (ties go to
    // the first), computed from scroll position each frame so it's deterministic in every browser.
    const update = () => {
      raf = 0;
      if (clicked) return report(clicked);
      const line = nav.getBoundingClientRect().bottom + 24;
      const sections = ids();
      let current = sections[0];
      let bestTop = -Infinity;
      for (const id of sections) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line && top > bestTop + 1) {
          current = id;
          bestTop = top;
        }
      }
      report(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const release = () => {
      clicked = null;
    };
    const onClick = (e: MouseEvent) => {
      const button = (e.target as Element).closest<HTMLElement>("[data-id]");
      if (!button || !nav.contains(button)) return;
      clicked = button.dataset.id!;
      last = clicked;
      const el = document.getElementById(clicked);
      if (!el) return;
      const offset = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - offset,
        behavior: "smooth",
      });
    };
    // Scroll only the tab strip, and instantly: WebKit runs one smooth scroll at a time, so
    // animating the strip would cancel the page's in-progress smooth scroll.
    const center = () => {
      const btn = nav.querySelector<HTMLElement>("button.active");
      if (btn) nav.scrollLeft = btn.offsetLeft - (nav.clientWidth - btn.clientWidth) / 2;
    };
    const observer = new MutationObserver(center);
    observer.observe(nav, { attributes: true, attributeFilter: ["class"], subtree: true });
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    for (const ev of ["wheel", "touchstart", "keydown"])
      window.addEventListener(ev, release, { passive: true });
    nav.addEventListener("click", onClick);
    this.#off = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      for (const ev of ["wheel", "touchstart", "keydown"]) window.removeEventListener(ev, release);
      nav.removeEventListener("click", onClick);
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }
  disconnectedCallback() {
    this.#off();
  }
}

/** Fires `images` with the image files pasted anywhere on the page. */
class Paste extends Controller {
  #off = () => {};
  connectedCallback() {
    super.connectedCallback();
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) this.dispatchEvent(new CustomEvent("images", { detail: files }));
    };
    window.addEventListener("paste", onPaste);
    this.#off = () => window.removeEventListener("paste", onPaste);
  }
  disconnectedCallback() {
    this.#off();
  }
}

/**
 * Fires `hotkey` for "/" (outside text fields) and ⌘K / Ctrl+K, and stops the browser's own
 * action for them.
 */
class Hotkey extends Controller {
  #off = () => {};
  connectedCallback() {
    super.connectedCallback();
    const typing = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
    const onKey = (e: KeyboardEvent) => {
      const shortcut =
        (e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing(e.target));
      if (!shortcut) return;
      e.preventDefault();
      this.dispatchEvent(new CustomEvent("hotkey"));
    };
    window.addEventListener("keydown", onKey);
    this.#off = () => window.removeEventListener("keydown", onKey);
  }
  disconnectedCallback() {
    this.#off();
  }
}

/**
 * Sends a chat message (`url`, and the request's JSON as the `body` property) when it appears,
 * and streams the doc's answer back: `reply` events as it's written (`{ delta }` to add, or
 * `{ text }` when it starts over), then `message` with the saved message, or `failure`. Leaving
 * the page cancels the stream; the server still saves the answer to the chat.
 */
class ChatStream extends Controller {
  body: unknown = null;
  #abort = new AbortController();
  connectedCallback() {
    super.connectedCallback();
    void this.#send();
  }
  disconnectedCallback() {
    this.#abort.abort();
  }
  #emit(type: string, detail: unknown) {
    if (!this.#abort.signal.aborted) this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  async #send() {
    try {
      const res = await fetch(this.getAttribute("url")!, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(this.body),
        signal: this.#abort.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        return this.#emit("failure", body.error ?? `Request failed (${res.status})`);
      }
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "null");
          if (event === "reply") this.#emit("reply", data);
          else if (event === "message") return this.#emit("message", data);
          else if (event === "error") return this.#emit("failure", data.error);
        }
      }
      this.#emit("failure", "The reply was cut off. Try again.");
    } catch (err) {
      this.#emit("failure", err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Listens to a server-sent event stream (`url`) for as long as it's on the page, and fires each
 * event named `event` as a `data` event with the event's JSON. The browser reconnects by itself.
 */
class EventStream extends Controller {
  #source: EventSource | null = null;
  connectedCallback() {
    super.connectedCallback();
    this.#source = new EventSource(this.getAttribute("url")!);
    this.#source.addEventListener(this.getAttribute("event") ?? "message", (e) =>
      this.dispatchEvent(new CustomEvent("data", { detail: JSON.parse((e as MessageEvent).data) })),
    );
  }
  disconnectedCallback() {
    this.#source?.close();
  }
}

/** Text that the browser formats for the reader's locale: a date (`date`) or a number (`number`). */
class LocalText extends HTMLElement {
  static observedAttributes = ["date", "number"];
  connectedCallback() {
    this.render();
  }
  attributeChangedCallback() {
    this.render();
  }
  render() {
    const date = this.getAttribute("date");
    const number = this.getAttribute("number");
    this.textContent =
      date !== null
        ? new Date(date).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : number !== null
          ? Number(number).toLocaleString()
          : "";
  }
}

export function defineElements() {
  const elements: [string, CustomElementConstructor][] = [
    ["mtg-tilt", Tilt],
    ["mtg-scroll-lock", ScrollLock],
    ["mtg-focus", Focus],
    ["mtg-stick-bottom", StickBottom],
    ["mtg-scroll-into-view", ScrollIntoView],
    ["mtg-blur-on-enter", BlurOnEnter],
    ["mtg-copy", Copy],
    ["mtg-outside-close", OutsideClose],
    ["mtg-preload", Preload],
    ["mtg-section-nav", SectionNav],
    ["mtg-paste", Paste],
    ["mtg-hotkey", Hotkey],
    ["mtg-local-text", LocalText],
    ["mtg-chat-stream", ChatStream],
    ["mtg-event-stream", EventStream],
    ["mtg-run-map", RunMap],
  ];
  for (const [name, element] of elements)
    if (!customElements.get(name)) customElements.define(name, element);
}
