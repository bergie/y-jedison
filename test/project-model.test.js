/**
 * @file project-model.test.js
 * @description Integration tests against the noflo-ui project data model
 * (noflo-ui SPEC Appendix B): registry signatures and node metadata maps.
 * The structures here mirror how `src/crdt/ProjectDoc.js` encodes them.
 */

import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import { yJedison } from "../src/binding.js";
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

/**
 * Copies a port signature list into a fresh Y.Array of Y.Maps — the encoding
 * of ProjectDoc's `signatureArray`.
 *
 * @param {Array<Record<string, any>>} [ports]
 * @returns {Y.Array<any>}
 */
function signatureArray(ports = []) {
  const array = new Y.Array();
  for (const port of ports) {
    const entry = new Y.Map();
    for (const [key, value] of Object.entries(port)) {
      entry.set(key, value);
    }
    array.push([entry]);
  }
  return array;
}

test("registry signature subtree: seeds the editor from the CRDT shape", () => {
  const doc = new Y.Doc();
  const entry = new Y.Map();
  doc.transact(() => {
    entry.set("inports", signatureArray([{ name: "in", type: "any" }]));
    entry.set("outports", signatureArray([{ name: "out", type: "any" }]));
    entry.set("description", "Says hello");
    entry.set("icon", "smile");
    doc.getMap("registry").set("my/Component", entry);
  });

  const jedison = new MockJedison();
  yJedison(jedison, entry);

  assert.deepEqual(jedison.getValue(), {
    inports: [{ name: "in", type: "any" }],
    outports: [{ name: "out", type: "any" }],
    description: "Says hello",
    icon: "smile",
  });
  doc.destroy();
});

test("registry signature subtree: concurrent port edits merge across peers", () => {
  const { doc1, doc2, cleanup } = createPeerDocs();
  const seed = () => {
    const entry = new Y.Map();
    entry.set("inports", signatureArray([{ name: "in", type: "any" }]));
    entry.set("outports", signatureArray([{ name: "out", type: "any" }]));
    return entry;
  };
  doc1.transact(() => {
    doc1.getMap("registry").set("my/Component", seed());
  });
  // Each peer binds its own editor to the component's signature entry
  const jedison1 = new MockJedison();
  const binding1 = yJedison(
    jedison1,
    doc1.getMap("registry").get("my/Component"),
  );
  const jedison2 = new MockJedison();
  const binding2 = yJedison(
    jedison2,
    doc2.getMap("registry").get("my/Component"),
  );

  assert.deepEqual(jedison1.getValue(), {
    inports: [{ name: "in", type: "any" }],
    outports: [{ name: "out", type: "any" }],
  });

  // Peer 1 edits the port's type; it arrives on peer 2
  jedison1.setValue(
    {
      inports: [{ name: "in", type: "string" }],
      outports: [{ name: "out", type: "any" }],
    },
    true,
    "user",
  );
  // Peer 2 edits the description on top of the synced state
  jedison2.setValue(
    {
      .../** @type {any} */ (jedison2.getValue()),
      description: "Says hello loudly",
    },
    true,
    "user",
  );

  assert.deepEqual(jedison1.getValue(), jedison2.getValue());
  assert.deepEqual(jedison1.getValue(), {
    inports: [{ name: "in", type: "string" }],
    outports: [{ name: "out", type: "any" }],
    description: "Says hello loudly",
  });

  binding1.destroy();
  binding2.destroy();
  cleanup();
});

test("registry signature subtree: a peer adding a port shows up in the other form", () => {
  const { doc1, doc2, cleanup } = createPeerDocs();
  const entry1 = new Y.Map();
  entry1.set("inports", signatureArray([{ name: "in", type: "any" }]));
  entry1.set("outports", signatureArray([]));
  doc1.transact(() => {
    doc1.getMap("registry").set("my/Component", entry1);
  });
  const jedison1 = new MockJedison();
  const binding1 = yJedison(jedison1, entry1);
  const jedison2 = new MockJedison();
  const binding2 = yJedison(
    jedison2,
    doc2.getMap("registry").get("my/Component"),
  );

  assert.deepEqual(jedison2.getValue(), {
    inports: [{ name: "in", type: "any" }],
    outports: [],
  });

  jedison2.setValue(
    {
      inports: [{ name: "in", type: "any" }],
      outports: [{ name: "out", type: "boolean" }],
    },
    true,
    "user",
  );

  assert.deepEqual(jedison1.getValue(), {
    inports: [{ name: "in", type: "any" }],
    outports: [{ name: "out", type: "boolean" }],
  });

  binding1.destroy();
  binding2.destroy();
  cleanup();
});

test("node metadata: form edits scoped to their keys preserve canvas position", () => {
  const doc = new Y.Doc();
  const metadata = new Y.Map();
  doc.transact(() => {
    doc.getMap("nodes").set("metadata", metadata);
    // As ProjectDoc.addNode encodes it: position rides the same map as
    // free-form metadata
    metadata.set("x", 120);
    metadata.set("y", 200);
    metadata.set("label", "Repeat");
  });

  const jedison = new MockJedison({ label: "Repeat" });
  yJedison(jedison, metadata, { keys: ["label"] });

  // A form edit must not delete the intent-managed keys
  jedison.setValue({ label: "Greeting node" }, true, "user");

  assert.deepEqual(typeToJson(metadata), {
    x: 120,
    y: 200,
    label: "Greeting node",
  });
  doc.destroy();
});

test("node metadata: remote canvas moves do not re-render the form", () => {
  const doc = new Y.Doc();
  const metadata = new Y.Map();
  doc.transact(() => {
    doc.getMap("nodes").set("metadata", metadata);
    metadata.set("x", 120);
    metadata.set("y", 200);
    metadata.set("label", "Repeat");
  });

  const jedison = new MockJedison({ label: "Repeat" });
  yJedison(jedison, metadata, { keys: ["label"] });

  /** @type {number} */
  let writes = 0;
  const originalSetValue = jedison.setValue.bind(jedison);
  jedison.setValue = (/** @type {any} */ value, ...rest) => {
    writes++;
    return originalSetValue(value, ...rest);
  };

  // What a moveNode intent does to the same map
  doc.transact(() => {
    metadata.set("x", 400);
    metadata.set("y", 300);
  });

  assert.equal(writes, 0, "the editor is not touched by out-of-scope keys");
  assert.deepEqual(jedison.getValue(), { label: "Repeat" });

  // In-scope remote changes still arrive
  doc.transact(() => {
    metadata.set("label", "Renamed remotely");
  });
  assert.equal(writes, 1);
  assert.deepEqual(jedison.getValue(), { label: "Renamed remotely" });
  doc.destroy();
});

test("node metadata: seeding only claims the scoped keys", () => {
  const doc = new Y.Doc();
  const metadata = new Y.Map();
  doc.transact(() => {
    doc.getMap("nodes").set("metadata", metadata);
    metadata.set("x", 120);
    metadata.set("y", 200);
  });

  const jedison = new MockJedison({ label: "Repeat" });
  yJedison(jedison, metadata, { keys: ["label"] });

  // The empty scoped subset loses to the editor's start value, which seeds
  // only its own keys — positions are untouched
  assert.deepEqual(typeToJson(metadata), {
    x: 120,
    y: 200,
    label: "Repeat",
  });
  doc.destroy();
});

test("node metadata: clearing a scoped key deletes only that key", () => {
  const doc = new Y.Doc();
  const metadata = new Y.Map();
  doc.transact(() => {
    doc.getMap("nodes").set("metadata", metadata);
    metadata.set("x", 120);
    metadata.set("y", 200);
    metadata.set("label", "Repeat");
  });

  const jedison = new MockJedison({ label: "Repeat" });
  yJedison(jedison, metadata, { keys: ["label"] });

  jedison.setValue({}, true, "user");

  assert.deepEqual(typeToJson(metadata), { x: 120, y: 200 });
  doc.destroy();
});
