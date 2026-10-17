/**
 * @file diff.test.js
 * @description Tests for the pure JSON ↔ Yjs reconciliation primitives.
 */

import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import { applyValue, jsonEqual, typeToJson } from "../src/diff.js";

test("typeToJson converts nested shared types", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("root");
  ydoc.transact(() => {
    ymap.set("name", "Bergie");
    ymap.set("tags", new Y.Array());
    const tags = /** @type {Y.Array<string>} */ (ymap.get("tags"));
    tags.insert(0, ["a", "b"]);
    ymap.set("address", new Y.Map(Object.entries({ city: "Helsinki" })));
  });

  assert.deepEqual(typeToJson(ymap), {
    name: "Bergie",
    tags: ["a", "b"],
    address: { city: "Helsinki" },
  });
  ydoc.destroy();
});

test("applyValue creates shared types for new container subtrees", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("root");

  ydoc.transact(() => {
    applyValue(ymap, { a: 1, b: ["x"], c: { d: true }, e: null });
  });

  assert.ok(ymap.get("b") instanceof Y.Array);
  assert.ok(ymap.get("c") instanceof Y.Map);
  assert.ok(
    /** @type {Y.Array<any>} */ (ymap.get("b")).get(0) instanceof Y.Map ===
      false,
  );
  assert.deepEqual(typeToJson(ymap), {
    a: 1,
    b: ["x"],
    c: { d: true },
    e: null,
  });
  ydoc.destroy();
});

test("applyValue maps diffs: adds, updates, and removes keys", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("root");
  ydoc.transact(() => {
    ymap.set("keep", "same");
    ymap.set("change", "old");
    ymap.set("remove", "gone");
  });

  ydoc.transact(() => {
    applyValue(ymap, { keep: "same", change: "new", added: 1 });
  });

  assert.deepEqual(typeToJson(ymap), { keep: "same", change: "new", added: 1 });
  ydoc.destroy();
});

test("applyValue recurses into nested objects without replacing them", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("root");
  ydoc.transact(() => {
    ymap.set("nested", new Y.Map(Object.entries({ a: 1, b: 2 })));
  });
  const nested = /** @type {Y.Map<any>} */ (ymap.get("nested"));

  ydoc.transact(() => {
    applyValue(ymap, { nested: { a: 1, b: 3 } });
  });

  assert.equal(
    ymap.get("nested"),
    nested,
    "nested Y.Map identity is preserved",
  );
  assert.deepEqual(typeToJson(ymap), { nested: { a: 1, b: 3 } });
  ydoc.destroy();
});

test("applyValue splices arrays for insertion and removal", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("root");
  ydoc.transact(() => {
    ymap.set("items", new Y.Array());
    /** @type {Y.Array<any>} */ (ymap.get("items")).insert(0, ["a", "b", "c"]);
  });
  const items = /** @type {Y.Array<any>} */ (ymap.get("items"));

  ydoc.transact(() => {
    applyValue(ymap, { items: ["a", "x", "b", "c"] });
  });
  assert.deepEqual(typeToJson(items), ["a", "x", "b", "c"]);

  ydoc.transact(() => {
    applyValue(ymap, { items: ["x", "c"] });
  });
  assert.deepEqual(typeToJson(items), ["x", "c"]);

  ydoc.transact(() => {
    applyValue(ymap, { items: [] });
  });
  assert.deepEqual(typeToJson(items), []);
  ydoc.destroy();
});

test("applyValue handles scalar element replacement and array growth", () => {
  const ydoc = new Y.Doc();
  const yarray = ydoc.getArray("list");
  yarray.insert(0, [1, 2, 3]);

  ydoc.transact(() => {
    applyValue(yarray, [1, 9, 3, 4, 5]);
  });

  assert.deepEqual(typeToJson(yarray), [1, 9, 3, 4, 5]);
  ydoc.destroy();
});

test("applyValue clears on kind mismatch", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("root");
  ydoc.transact(() => {
    ymap.set("a", 1);
  });

  ydoc.transact(() => {
    applyValue(ymap, /** @type {any} */ ([1, 2]));
  });

  assert.equal(ymap.size, 0);
  ydoc.destroy();
});

test("jsonEqual compares deeply and rejects differing shapes", () => {
  assert.equal(jsonEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(jsonEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(jsonEqual([1, 2], [2, 1]), false);
  assert.equal(jsonEqual({ a: 1 }, [1]), false);
  assert.equal(jsonEqual(null, {}), false);
  assert.equal(jsonEqual("x", "x"), true);
});
