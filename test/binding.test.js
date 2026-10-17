/**
 * @file binding.test.js
 * @description Tests for the Jedison ↔ Yjs binding: seeding, local → Yjs
 * propagation, Yjs → editor propagation, echo-loop protection, granular
 * merging, and teardown. Uses MockJedison plus real Y.Doc instances, with a
 * two-peer update relay to simulate multiplayer.
 */

import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import { DEFAULT_INITIATOR, JedisonBinding, yJedison } from "../src/binding.js";
import { typeToJson } from "../src/diff.js";
import { MockJedison } from "./mock-jedison.js";

/**
 * Relays updates between two docs, simulating mesh-synced peers.
 *
 * @returns {{doc1: Y.Doc, doc2: Y.Doc, cleanup: () => void}}
 */
function createPeerDocs() {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  const relay1 = (/** @type {Uint8Array} */ update) => {
    Y.applyUpdate(doc2, update);
  };
  const relay2 = (/** @type {Uint8Array} */ update) => {
    Y.applyUpdate(doc1, update);
  };
  doc1.on("update", relay1);
  doc2.on("update", relay2);
  return {
    doc1,
    doc2,
    cleanup: () => {
      doc1.off("update", relay1);
      doc2.off("update", relay2);
      doc1.destroy();
      doc2.destroy();
    },
  };
}

test("seeds the shared type from the editor when the type is empty", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("form");
  const jedison = new MockJedison({ name: "Bergie", age: 45 });

  yJedison(jedison, ymap);

  assert.deepEqual(typeToJson(ymap), { name: "Bergie", age: 45 });
  ydoc.destroy();
});

test("seeds the editor from the shared type when the type has content", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("form");
  ymap.set("name", "Remote");

  const jedison = new MockJedison({ name: "Local" });
  yJedison(jedison, ymap);

  assert.deepEqual(jedison.getValue(), { name: "Remote" });
  ydoc.destroy();
});

test("propagates local editor edits into the shared type", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("form");
  const jedison = new MockJedison({ name: "Bergie" });
  yJedison(jedison, ymap);

  jedison.setValue({ name: "Bergie", role: "admin" }, true, "user");

  assert.deepEqual(typeToJson(ymap), { name: "Bergie", role: "admin" });
  ydoc.destroy();
});

test("propagates remote shared type changes into the editor with the yjs initiator", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("form");
  const jedison = new MockJedison({ name: "Bergie" });
  yJedison(jedison, ymap);

  ydoc.transact(() => {
    ymap.set("name", "Remote peer");
  });

  assert.deepEqual(jedison.getValue(), { name: "Remote peer" });
  ydoc.destroy();
});

test("local edits do not bounce back into the editor (echo-loop protection)", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("form");
  const jedison = new MockJedison({ count: 1 });
  yJedison(jedison, ymap);

  /** @type {string[]} */
  const initiators = [];
  jedison.on("change", (/** @type {string} */ initiator) => {
    initiators.push(initiator);
  });

  jedison.setValue({ count: 2 }, true, "user");
  assert.equal(ymap.get("count"), 2);
  assert.deepEqual(initiators, ["user"]);
  ydoc.destroy();
});

test("remote changes do not get re-applied to the shared type (echo-loop protection)", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("form");
  const jedison = new MockJedison({ count: 1 });
  yJedison(jedison, ymap);

  /** @type {number} */
  let mutations = 0;
  ymap.observe(() => {
    mutations++;
  });

  ydoc.transact(() => {
    ymap.set("count", 5);
  });

  assert.equal(jedison.getValue().count, 5);
  assert.equal(mutations, 1);
  ydoc.destroy();
});

test("two peers converge on form edits", () => {
  const { doc1, doc2, cleanup } = createPeerDocs();
  const jedison1 = new MockJedison({ title: "Untitled" });
  const jedison2 = new MockJedison();
  const binding1 = yJedison(jedison1, doc1.getMap("form"));
  const binding2 = yJedison(jedison2, doc2.getMap("form"));

  // Peer 1 seeds, both editors should converge
  assert.deepEqual(jedison2.getValue(), { title: "Untitled" });

  // Peer 2 edits a different key (building on the synced remote state);
  // peer 1 keeps its own key
  jedison2.setValue({ ...jedison2.getValue(), status: "draft" }, true, "user");

  assert.deepEqual(jedison1.getValue(), { title: "Untitled", status: "draft" });

  // Peer 1 edits the same key; last writer wins everywhere
  jedison1.setValue({ title: "Renamed", status: "draft" }, true, "user");

  assert.deepEqual(jedison2.getValue(), { title: "Renamed", status: "draft" });

  binding1.destroy();
  binding2.destroy();
  cleanup();
});

test("edits inside different array items merge across peers", () => {
  const { doc1, doc2, cleanup } = createPeerDocs();
  const initial = {
    ports: [
      { name: "in", type: "any" },
      { name: "out", type: "any" },
    ],
  };
  const jedison1 = new MockJedison(initial);
  const binding1 = yJedison(jedison1, doc1.getMap("form"));
  const jedison2 = new MockJedison(initial);
  const binding2 = yJedison(jedison2, doc2.getMap("form"));

  assert.deepEqual(jedison2.getValue(), initial);

  // Peer 1 edits element 0's type; it arrives on peer 2
  jedison1.setValue(
    {
      ports: [
        { name: "in", type: "string" },
        { name: "out", type: "any" },
      ],
    },
    true,
    "user",
  );
  // Peer 2 edits element 1's type on top of the synced state
  const synced = /** @type {any} */ (jedison2.getValue());
  jedison2.setValue(
    {
      ports: [synced.ports[0], { name: "out", type: "boolean" }],
    },
    true,
    "user",
  );

  const merged1 = jedison1.getValue();
  const merged2 = jedison2.getValue();
  assert.deepEqual(merged1, merged2);
  assert.deepEqual(merged1, {
    ports: [
      { name: "in", type: "string" },
      { name: "out", type: "boolean" },
    ],
  });

  binding1.destroy();
  binding2.destroy();
  cleanup();
});

test("array items appended by one peer appear on the other", () => {
  const { doc1, doc2, cleanup } = createPeerDocs();
  const jedison1 = new MockJedison({ tags: ["a"] });
  const jedison2 = new MockJedison({ tags: ["a"] });
  const binding1 = yJedison(jedison1, doc1.getMap("form"));
  const binding2 = yJedison(jedison2, doc2.getMap("form"));

  jedison1.setValue({ tags: ["a", "b", "c"] }, true, "user");

  assert.deepEqual(jedison2.getValue(), { tags: ["a", "b", "c"] });

  jedison2.setValue({ tags: ["a", "c"] }, true, "user");

  assert.deepEqual(jedison1.getValue(), { tags: ["a", "c"] });

  binding1.destroy();
  binding2.destroy();
  cleanup();
});

test("destroy detaches editor and shared type", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("form");
  const jedison = new MockJedison({ name: "Bergie" });
  const binding = yJedison(jedison, ymap);

  binding.destroy();
  binding.destroy(); // idempotent

  jedison.setValue({ name: "Local-only" }, true, "user");
  ydoc.transact(() => {
    ymap.set("name", "Remote-only");
  });

  assert.deepEqual(jedison.getValue(), { name: "Local-only" });
  assert.deepEqual(typeToJson(ymap), { name: "Remote-only" });
  ydoc.destroy();
});

test("custom initiator option is honored", () => {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("form");
  ymap.set("name", "Remote");

  const jedison = new MockJedison();
  new JedisonBinding(jedison, ymap, { initiator: "mesh" });

  /** @type {any[]} */
  const seen = [];
  jedison.on("change", (/** @type {any} */ initiator) => {
    seen.push(initiator);
  });
  ydoc.transact(() => {
    ymap.set("name", "Remote 2");
  });

  assert.deepEqual(seen, ["mesh"]);
  assert.equal(DEFAULT_INITIATOR, "yjs");
  ydoc.destroy();
});

test("requires an integrated shared type", () => {
  const ymap = new Y.Map();
  const jedison = new MockJedison({ name: "Bergie" });
  assert.throws(
    () => yJedison(jedison, /** @type {any} */ (ymap)),
    /integrated into a Y.Doc/,
  );
  assert.throws(
    () => yJedison(jedison, /** @type {any} */ ("not a type")),
    /Y\.Map or Y\.Array/,
  );
});
