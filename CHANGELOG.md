# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `yJedison(jedison, yType, options)` binding (and the underlying `JedisonBinding` class) for two-way sync between a Jedison JSON Schema form editor and a Yjs shared type (`Y.Map` for object roots, `Y.Array` for array roots)
- Initial-state reconciliation: a non-empty shared type wins over the editor's start value, an empty shared type is seeded from the editor
- Granular merging: edits apply per-key for objects and per-element for arrays, so concurrent edits to different fields merge without clobbering
- `keys` binding option for shared `Y.Map`s with co-located foreign keys: the binding manages only the listed top-level keys (e.g. a form's schema subset), leaving intent-managed keys like a node's `x`/`y` canvas position to their other writers — form edits never delete them, and remote changes to them never re-render the form
- Echo-loop protection via Jedison's `setValue(value, notifyParent, initiator)` initiator tagging (default `"yjs"`, configurable)
- `destroy()` teardown, and pure `typeToJson` / `applyValue` / `jsonEqual` / `isPlainObject` / `pickKeys` primitives for custom integrations
- Smoketests against real Jedison 1.13.0 under happy-dom, validating the initiator echo, user-input propagation, and echo-loop protection assumptions
- GitHub Actions CI (lint, type check, tests) and tag-triggered npm publish via OIDC
