import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { partialStringField } from "../../server/analysis/partial-json.ts";

describe("partialStringField", () => {
  const json = JSON.stringify({
    changes: [{ reply: "a nested key", reason: 'says "reply": no' }],
    reply: 'Cut [[Sol Ring]] for "Mind Stone"\n\u00e9 \\ done.',
    rerun: null,
  });

  test("reads a top-level field as it arrives, growing with every piece", () => {
    const final = 'Cut [[Sol Ring]] for "Mind Stone"\n\u00e9 \\ done.';
    let last = "";
    let seen = 0;
    for (let end = 0; end <= json.length; end++) {
      const value = partialStringField(json.slice(0, end), "reply");
      if (value === null) {
        assert.equal(last, "", "it only disappears before it starts");
        continue;
      }
      assert.ok(
        value.startsWith(last),
        `grows: ${JSON.stringify(last)} → ${JSON.stringify(value)}`,
      );
      assert.ok(final.startsWith(value));
      if (value !== last) seen++;
      last = value;
    }
    assert.equal(last, final);
    assert.ok(seen > 10, "many steps, not one");
  });

  test("ignores the same key nested in another value or written inside a string", () => {
    const nested = '{"changes": [{"reply": "no"}], "note": "\\"reply\\": nope", "reply": "yes';
    assert.equal(partialStringField(nested, "reply"), "yes");
    assert.equal(partialStringField('{"changes": [{"reply": "no"', "reply"), null);
  });

  test("a field that isn't a string, or isn't there, is null", () => {
    assert.equal(partialStringField('{"reply": null}', "reply"), null);
    assert.equal(partialStringField('{"other": "x"}', "reply"), null);
    assert.equal(partialStringField("", "reply"), null);
  });
});
