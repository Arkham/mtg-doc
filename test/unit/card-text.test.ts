import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardIndex, CardText } from "../../src/components/CardName.tsx";

const preview = (slug: string) => ({
  image: `https://img.test/${slug}.jpg`,
  scryfallUri: `https://scryfall.test/${slug}`,
});
const INDEX = {
  "Sol Ring": preview("sol"),
  "Mind Stone": preview("mind"),
  "Kefka, Court Mage // Kefka, Ruler of Ruin": preview("kefka"),
};
const render = (text: string, index: Record<string, ReturnType<typeof preview>> = INDEX) =>
  renderToStaticMarkup(
    createElement(CardIndex.Provider, { value: index }, createElement(CardText, { text })),
  );

describe("CardText", () => {
  test("card names in prose become previews, the rest stays text", () => {
    const html = render("Cut Sol Ring for Mind Stone, then check the curve.");
    assert.match(
      html,
      /^Cut <span class="card-name[^"]*"><a href="https:\/\/scryfall.test\/sol"[^>]*>Sol Ring<\/a><\/span> for <span/,
    );
    assert.match(html, /scryfall.test\/mind[^>]*>Mind Stone<\/a><\/span>, then check the curve\.$/);
  });

  test("whole names only, case-insensitive, and the model's capitalisation is kept", () => {
    const html = render("SOL RING and Sol Rings and Sol Ring's costs");
    assert.equal(html.match(/class="card-name/g)?.length, 2, "the plural and possessive stay text");
    assert.match(html, />SOL RING<\/a>/, "label keeps the original case");
    assert.match(html, />Sol Ring<\/a><\/span>&#x27;s costs/);
  });

  test("a card that contains another name wins, and double-faced cards match their front", () => {
    const index = { Stone: preview("stone"), "Mind Stone": preview("mind") };
    assert.match(render("Mind Stone", index), /scryfall.test\/mind/);
    assert.match(
      render("Kefka, Court Mage combos."),
      /scryfall.test\/kefka[^>]*>Kefka, Court Mage</,
    );
  });

  test("newlines survive and nothing is raw HTML", () => {
    const html = render("Sol Ring\nMind Stone\n<b>no</b>");
    assert.match(html, />Sol Ring<\/a><\/span>\n<span/);
    assert.match(html, /&lt;b&gt;no&lt;\/b&gt;$/);
  });

  test("without an index (a page with no cards) text renders as-is", () => {
    assert.equal(render("Cut Sol Ring.", {}), "Cut Sol Ring.");
  });
});
