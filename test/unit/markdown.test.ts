import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardIndex } from "../../src/components/CardName.tsx";
import { Markdown } from "../../src/components/Markdown.tsx";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));
const preview = (slug: string) => ({
  image: `https://img.test/${slug}.jpg`,
  scryfallUri: `https://scryfall.test/${slug}`,
});
const INDEX = {
  Windfall: preview("windfall"),
  "Hermit Druid": preview("hermit"),
  "Thassa's Oracle": preview("oracle"),
  "Kefka, Court Mage // Kefka, Ruler of Ruin": preview("kefka"),
};
const renderWithIndex = (text: string) =>
  renderToStaticMarkup(
    createElement(CardIndex.Provider, { value: INDEX }, createElement(Markdown, { text })),
  );

describe("Markdown", () => {
  test("renders tables with a header row, inline formatting and missing cells", () => {
    const html = render(
      [
        "## Key cards",
        "",
        "| Role | Cards |",
        "|---|:--|",
        "| **Wheels** | **Windfall**, [Wheel of Fortune](https://example.test) |",
        "| Draw punishment |",
        "",
        "After the table.",
      ].join("\n"),
    );
    assert.match(
      html,
      /<table class="data md-table"><thead><tr><th>Role<\/th><th>Cards<\/th><\/tr><\/thead>/,
    );
    assert.match(
      html,
      /<td><strong>Wheels<\/strong><\/td><td><strong>Windfall<\/strong>, <a href="https:\/\/example.test"/,
    );
    assert.match(html, /<tr><td>Draw punishment<\/td><td><\/td><\/tr>/);
    assert.match(html, /<\/table><\/div><p>After the table.<\/p>/);
    assert.doesNotMatch(html, /\|/, "no stray pipes");
  });

  test("pipe lines that aren't a table stay as text, and nothing is raw HTML", () => {
    const html = render("| just a line with a pipe\n\n<b>hi</b>");
    assert.match(html, /<p>\| just a line with a pipe<\/p>/);
    assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/);
  });
});

describe("Markdown card previews", () => {
  test("card references become previews, bold text stays bold even when it's a card's name", () => {
    const html = renderWithIndex(
      "[[Windfall]] refills. **Windfall** is just bold. **[[Hermit Druid]] + [[Thassa’s Oracle]]** wins. [[Kefka, Court Mage]] combos. **Fixing:** matters.",
    );
    assert.match(
      html,
      /^<div class="markdown"><p><span class="card-name[^"]*"><a href="https:\/\/scryfall.test\/windfall"[^>]*>Windfall<\/a><\/span> refills\. <strong>Windfall<\/strong> is just bold\./,
    );
    assert.match(
      html,
      /<strong><span class="card-name[^"]*"><a href="https:\/\/scryfall.test\/hermit"[^]*> \+ <[^]*scryfall.test\/oracle[^]*<\/strong> wins/,
      "a combo in bold links both cards",
    );
    assert.match(
      html,
      /scryfall.test\/kefka[^>]*>Kefka, Court Mage<\/a>/,
      "front face of a double-faced card",
    );
    assert.match(html, /<strong>Fixing:<\/strong>/);
  });

  test("table cells link card references too", () => {
    const html = renderWithIndex("| Role | Cards |\n|---|---|\n| Wheels | [[Windfall]] |");
    assert.match(
      html,
      /<td><span class="card-name[^"]*"><a href="https:\/\/scryfall.test\/windfall"/,
    );
  });
});
