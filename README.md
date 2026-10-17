# y-jedison

> [Jedison](https://github.com/germanbisurgi/jedison) binding for [Yjs](https://github.com/yjs/yjs) — makes JSON Schema forms multiplayer.

Binds a [Jedison](https://github.com/germanbisurgi/jedison) ([playground](https://germanbisurgi.github.io/jedison/), [docs](https://germanbisurgi.github.io/jedison-docs/)) JSON Schema editor to a Yjs shared type, in the same spirit as [`y-codemirror.next`](https://github.com/yjs/y-codemirror.next) does for CodeMirror 6. Multiple users editing the same form merge their changes at key and array-element granularity.

## Features

* Two-way sync between a Jedison editor and a `Y.Map` (object roots) or `Y.Array` (array roots)
* Granular merging: concurrent edits to different fields — or to different array items — merge without clobbering each other
* Echo-loop protection via Jedison's `setValue` initiator tagging
* Key scoping for shared maps that also carry keys owned by other writers

## Install

```sh
npm i y-jedison
```

Peer dependencies: `jedison` ^1.13.0 and `yjs` ^13.6.31.

## Usage

```js
import * as Y from 'yjs'
import Jedison from 'jedison'
import { yJedison } from 'y-jedison'
import { WebrtcProvider } from 'y-webrtc' // or any Yjs provider

const ydoc = new Y.Doc()
const provider = new WebrtcProvider('my-form-room', ydoc)

const jedison = new Jedison.Create({
  container: document.querySelector('#form'),
  schema,
})

// The shared type wins when it carries content; an empty shared type is
// seeded from the editor's current value
const binding = yJedison(jedison, ydoc.getMap('form'))

// ...later
binding.destroy()
```

With a provider attached to the same `Y.Doc`, every peer sees form edits merge per field. Works with any Yjs provider — `y-websocket`, `y-webrtc`, or for example [`y-reticulum`](https://github.com/bergie/y-reticulum) for mesh networks.

### Scoped bindings

JSON documents often live in shared maps that also carry keys a form shouldn't touch. In [noflo-ui](https://github.com/noflo/noflo-ui), a graph node's `metadata` map holds both free-form metadata (which a Jedison form edits) and the canvas position (`x`, `y`) managed by the application. Scope the binding to the form's keys:

```js
const binding = yJedison(jedison, nodeMap.get('metadata'), {
  keys: ['description', 'icon'],
})
```

Out-of-scope keys are left alone in both directions: local form edits never delete them, and remote changes to them never re-render the form while the user is typing.

## How it works

* **Local → Yjs**: Jedison `change` events trigger a minimal diff against the shared type's JSON mirror — unchanged keys keep their Yjs identities, array edits splice the smallest possible range.
* **Yjs → local**: `observeDeep` on the shared type pushes the JSON mirror into the editor via `setValue(value, true, initiator)`. Jedison echoes the change back with that same initiator (default `"yjs"`), which the binding ignores — preventing loops. Concurrency is per-key last-writer-wins for objects, per-element for arrays.
* **Initial state**: a non-empty shared type wins over the editor's current value; an empty shared type is seeded from the editor. For collaborative surfaces, make the CRDT the source of truth: populate the editor (Jedison 1.13.0 has no constructor starting-value option — use `setValue()` or the wrapper's data setter) and then bind.

## API

### `yJedison(jedison, yType, [options])`

Returns a `JedisonBinding`.

* `jedison` — a Jedison editor instance (or anything exposing `getValue`, `setValue(value, notifyParent, initiator)`, `on`, `off`)
* `yType` — a `Y.Map` (object root) or `Y.Array` (array root), integrated into a `Y.Doc`. Scalar roots are not supported.
* `options.initiator` — initiator tag used for remote-driven writes (default `"yjs"`)
* `options.keys` — for `Y.Map` roots: the top-level keys this binding manages; see "Scoped bindings" above
* `options.origin` — transaction origin stamped on the binding's own writes, so hosts sharing a `Y.Doc` with several writers can tell the binding's transactions apart in `doc.on("update")` events

`binding.destroy()` detaches editor and shared type; both keep their current values.

Lower-level primitives (`typeToJson`, `applyValue`, `jsonEqual`, `isPlainObject`, `pickKeys`) are exported for custom integrations.

## License

[EUPL-1.2](https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12)
