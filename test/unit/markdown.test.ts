import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../../src/components/Markdown.tsx";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

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
