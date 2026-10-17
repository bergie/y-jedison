# AGENTS.md

This repository is for building a Yjs CRDT integration for [Jedison](https://github.com/germanbisurgi/jedison), the JSON Schema based object editor. The goal is to make Jedison editors multiplayer, in the same spirit as `y-codemirror.next` does for CodeMirror 6.

The primary consumer is [`noflo-ui`](https://github.com/noflo/noflo-ui) (`../noflo-ui` locally), which mounts Jedison editors as web components. Keep the public API surface small and binding-shaped: `yJedison(jedison, yType, options)` plus `destroy()`.

## Version targets

Match what noflo-ui runs:

- `jedison` ^1.13.0 — peer dependency. The binding relies on its `setValue(value, notifyParent, initiator)` / `getValue()` / `on('change', (initiator) => ...)` / `off` surface. The `initiator` tag is the echo-loop protection mechanism: remote-driven writes always pass this package's initiator (default `"yjs"`), and change events carrying it are ignored.
- `yjs` ^13.6.31 — peer dependency, consistent with `y-reticulum` and the rest of the Yjs stack in noflo-ui.

Root shared types must be `Y.Map` (object schema roots) or `Y.Array` (array schema roots); scalar roots are not supported, and the bound type must be integrated into a `Y.Doc` before binding.

## Data model (noflo-ui SPEC Appendix B)

A noflo-ui project is one `Y.Doc` with root maps `metadata`, `graphs`, `components`, `registry`, `specs`, `workdocs`, `schemas`. Jedison editors bind to subtrees of it:

- **Registry signatures** (`doc.getMap('registry').get(componentName)`, what the component signature form edits): a `Y.Map` with `inports`/`outports` as `Y.Array` of `Y.Map` port entries (`name`, `type`, `addressable`, `schema`) plus `description` and `icon`. This maps directly onto the binding's granular merge semantics — peers editing different ports merge cleanly.
- **Node metadata** (`graphs/<graphId>/nodes/<nodeId>/metadata`): a `Y.Map` where intent-managed keys (`x`, `y` canvas positions) share space with free-form metadata. Bindings to such maps **must** pass a `keys` option listing the form's top-level keys — out-of-scope keys are owned by other writers: local edits never delete them, remote changes to them never re-render the form.

The Yjs module instance must be shared with the rest of the CRDT layer (ProjectDoc, y-reticulum, y-codemirror.next). In noflo-ui that means the package is bundled from source with `yjs` kept external to `./yjs.js` (`utils/build-vendors.js` sibling-external contract) — which holds as long as this package imports bare `yjs` and ships unbundled ESM in `src/`.

## Code style

- Standard JavaScript (ESM), Biome default formatting style, `.editorconfig` respected
- TypeScript declarations in JsDoc format; `npm run types` must stay clean
- Test with `node --test` against `MockJedison` and real `Y.Doc` instances; at least smoketests for any new functionality

## Boundaries

- ✅ **Always**: write at least smoketests for any new functionality
- ✅ **Always**: ensure type safety. Always check with `npm run types` after changes and fix as needed
- ✅ **Always**: fix formatting with `npm run format` after any changes to source files or tests
- ✅ **Always**: use `git mv` instead of `mv` for renaming files
- ⚠️ **Ask first**: adding dependencies
- ⚠️ **Ask first**: modify CI config
- 🚫 **Never**: AI agents may not make commits on their own, instead notify user that there are uncommitted changes to review
- 🚫 **Never**: AI agents may not make releases; no version bumps, tags, or publish actions
