/**
 * @file index.js
 * @description Yjs binding for Jedison — makes JSON Schema forms multiplayer.
 *
 * Usage mirrors y-codemirror.next: create a shared type on your Y.Doc, build
 * the editor, then bind the two together.
 *
 * ```js
 * import * as Y from 'yjs'
 * import Jedison from 'jedison'
 * import { yJedison } from 'y-jedison'
 *
 * const ydoc = new Y.Doc()
 * const jedison = new Jedison.Create({ schema, container })
 * const binding = yJedison(jedison, ydoc.getMap('form'))
 * ```
 *
 * With a sync provider such as y-reticulum attached to the same Y.Doc, every
 * peer editing the same room sees form edits merge at key and array-element
 * granularity.
 */

export { DEFAULT_INITIATOR, JedisonBinding, yJedison } from "./binding.js";
export {
  applyValue,
  isPlainObject,
  isYArray,
  isYMap,
  jsonEqual,
  pickKeys,
  typeToJson,
} from "./diff.js";
