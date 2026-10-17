/**
 * @file real-jedison.test.js
 * @description Smoke test against real Jedison 1.13.0 running under
 * happy-dom — validates the assumptions the binding rests on:
 *
 * 1. Jedison has no constructor option for initial data in this version;
 *    initial state goes through `setValue()`.
 * 2. `setValue(value, true, initiator)` echoes back a `change` event carrying
 *    exactly that initiator — the echo-loop protection mechanism.
 * 3. Real user input (typing into a rendered input) emits `change` with the
 *    "user" initiator, and the binding propagates it into the shared type.
 * 4. Remote shared-type changes arrive in the editor without re-writing the
 *    shared type.
 */

import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import { yJedison } from "../src/binding.js";
import { typeToJson } from "../src/diff.js";
import { setupDom } from "./dom.js";

const SCHEMA = {
  title: "Component signature",
  type: "object",
  properties: {
    description: { title: "Description", type: "string" },
    inports: {
      title: "Inports",
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { title: "Name", type: "string" },
          type: { title: "Type", type: "string" },
        },
      },
    },
  },
};

/**
 * Creates a real Jedison editor over the given schema inside a fresh
 * happy-dom document.
 *
 * @param {any} win - The happy-dom Window
 * @param {any} startingData - Initial data applied via setValue (jedison
 *   1.13.0 has no constructor option for it)
 * @returns {any} The Jedison instance
 */
async function createEditor(win, startingData) {
  const { default: Jedison } = await import("jedison");
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const jedison = new Jedison.Create({
    container,
    theme: new Jedison.ThemeBootstrap3(),
    schema: SCHEMA,
  });
  if (startingData !== undefined) {
    jedison.setValue(startingData, true, "api");
  }
  return jedison;
}

test("real jedison: editor seeds the shared type, remote changes stream back", async () => {
  const win = await setupDom();
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("signature");

  // Jedison 1.13.0 has no constructor starting-value option: initial data
  // rides setValue, exactly what noflo-ui's noflo-json-form data setter does
  const jedison = await createEditor(win, undefined);
  jedison.setValue(
    {
      description: "Says hello",
      inports: [{ name: "in", type: "string" }],
    },
    true,
    "api",
  );

  yJedison(jedison, ymap);

  assert.deepEqual(typeToJson(ymap), {
    description: "Says hello",
    inports: [{ name: "in", type: "string" }],
  });

  // A remote peer edits the description; the editor follows
  ydoc.transact(() => {
    ymap.set("description", "Says hello loudly");
  });
  assert.equal(jedison.getValue().description, "Says hello loudly");

  ydoc.destroy();
});

test("real jedison: typing into an input propagates into the shared type", async () => {
  const win = await setupDom();
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("signature");

  const jedison = await createEditor(win, undefined);
  jedison.setValue(
    { description: "Says hello", inports: [{ name: "in", type: "string" }] },
    true,
    "api",
  );
  yJedison(jedison, ymap);

  // The user types into the rendered description input
  const input = jedison.container.querySelector(
    'input[name="root-description"]',
  );
  assert.ok(input, "the description input is rendered");
  input.value = "Typed by hand";
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  input.dispatchEvent(new win.Event("change", { bubbles: true }));

  assert.equal(ymap.get("description"), "Typed by hand");
  ydoc.destroy();
});

test("real jedison: remote changes do not re-write the shared type", async () => {
  const win = await setupDom();
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("signature");
  ymap.set("description", "Remote value");

  const jedison = await createEditor(win, undefined);
  let changeInitiator;
  jedison.on("change", (/** @type {any} */ initiator) => {
    changeInitiator = initiator;
  });

  /** @type {number} */
  let yMutations = 0;
  ymap.observe(() => {
    yMutations++;
  });

  yJedison(jedison, ymap);

  // Binding seeds the editor from the shared type — with the yjs initiator
  assert.equal(changeInitiator, "yjs");
  assert.equal(jedison.getValue().description, "Remote value");

  // And that seed does not bounce back into the shared type
  assert.equal(yMutations, 0);

  // A subsequent remote edit updates the editor and stays a single mutation
  ydoc.transact(() => {
    ymap.set("description", "Remote value 2");
  });
  assert.equal(jedison.getValue().description, "Remote value 2");
  assert.equal(yMutations, 1);

  ydoc.destroy();
});

test("real jedison: destroy detaches editor and shared type", async () => {
  const win = await setupDom();
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap("signature");
  ymap.set("description", "Remote");

  const jedison = await createEditor(win, undefined);
  const binding = yJedison(jedison, ymap);
  assert.equal(jedison.getValue().description, "Remote");

  binding.destroy();

  // Shared type changes no longer reach the editor...
  const before = jedison.getValue();
  ydoc.transact(() => {
    ymap.set("description", "Remote 2");
  });
  assert.deepEqual(jedison.getValue(), before);

  // ...and editor changes no longer reach the shared type
  jedison.setValue({ description: "Local", inports: [] }, true, "user");
  assert.equal(ymap.get("description"), "Remote 2");

  // Jedison's own destroy tears down the instance; nothing may throw
  jedison.destroy();

  ydoc.destroy();
});
