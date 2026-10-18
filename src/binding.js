/**
 * @file binding.js
 * @description Two-way binding between a Jedison editor instance and a Yjs
 * shared type, so JSON Schema forms become multiplayer.
 *
 * The binding mirrors Jedison's data into a Y.Map or Y.Array root type and
 * applies remote changes back into the editor. Updates are applied at
 * key/element granularity (see diff.js), so concurrent edits to different
 * fields merge cleanly.
 *
 * Echo loops are prevented twice over:
 *
 * 1. Local Jedison changes are applied to the Y type inside a guarded
 *    transaction, during which the Y observer is suppressed.
 * 2. Remote Y changes are pushed into Jedison via `setValue(value, true,
 *    initiator)`, and Jedison echoes the change event back with that same
 *    initiator — which the local change listener ignores.
 */

import * as Y from "yjs";
import {
  applyValue,
  isYArray,
  isYMap,
  jsonEqual,
  pickKeys,
  typeToJson,
} from "./diff.js";

/**
 * The initiator string this binding uses when pushing remote Yjs state into
 * Jedison. Jedison passes it back on the resulting `change` events, letting
 * the binding (and any other listener) tell remote sync apart from user edits.
 */
export const DEFAULT_INITIATOR = "yjs";

/**
 * @typedef {Object} JedisonBindingOptions
 * @property {string} [initiator] - Initiator tag used for remote-driven
 *   `setValue` calls (defaults to "yjs")
 * @property {string[]} [keys] - For Y.Map roots: the top-level keys of the
 *   shared map this binding manages (the form's schema subset). Keys outside
 *   this scope — for example a node's `x`/`y` canvas position living in the
 *   same metadata map, managed by move intents — are neither overwritten by
 *   form edits nor re-rendered into the editor by remote changes. Ignored for
 *   Y.Array roots.
 * @property {string} [origin] - Transaction origin stamped on the binding's
 *   own writes. Hosts sharing a Y.Doc with several writers (collaborative
 *   buffers, other bindings) relay `doc.on("update")` events onward and need
 *   to tell the binding's transactions apart from everything else: the
 *   document's update events carry this origin, and anything else on that
 *   document is somebody else's write. Defaults to `null` (the Yjs default).
 */

/**
 * Minimal structural contract Jedison instances satisfy. Lets the binding be
 * tested and used against any editor exposing the same API surface.
 *
 * @typedef {Object} JedisonLike
 * @property {() => any} getValue - Current form data as plain JSON
 * @property {(value: any, notifyParent?: boolean, initiator?: string) => any} setValue - Replace form data
 * @property {(event: string, handler: (...args: any[]) => void) => void} on - Subscribe to an editor event
 * @property {(event: string, handler: (...args: any[]) => void) => void} off - Unsubscribe from an editor event
 */

/**
 * Binds a Jedison editor to a Yjs shared type.
 */
export class JedisonBinding {
  /**
   * @param {JedisonLike} jedison - A Jedison editor instance
   * @param {Y.Map<any>|Y.Array<any>} yType - Root shared type holding the form
   *   data. Must be a Y.Map (object root) or Y.Array (array root); scalar
   *   roots are not supported.
   * @param {JedisonBindingOptions} [options]
   */
  constructor(jedison, yType, options = {}) {
    if (!isYMap(yType) && !isYArray(yType)) {
      throw new TypeError(
        "y-jedison: the shared type must be a Y.Map or Y.Array",
      );
    }
    if (!yType.doc) {
      throw new TypeError(
        "y-jedison: the shared type must be integrated into a Y.Doc before binding",
      );
    }
    /** @type {JedisonLike} */
    this.jedison = jedison;
    /** @type {Y.Map<any>|Y.Array<any>} */
    this.yType = yType;
    /** @type {string} */
    this.initiator = options.initiator ?? DEFAULT_INITIATOR;
    /** @type {string[]|null} */
    this.keys =
      Array.isArray(options.keys) && options.keys.length > 0
        ? options.keys.slice()
        : null;
    /** @type {string|null} */
    this.origin = options.origin ?? null;
    /** @type {Y.Doc|null} */
    this.doc = yType.doc;
    /** @type {boolean} */
    this._destroyed = false;
    /** @type {boolean} */
    this._applyingRemote = false;
    /** @type {boolean} */
    this._applyingLocal = false;

    this._onChange = (/** @type {any} */ initiator) => {
      if (this._destroyed || initiator === this.initiator) {
        return;
      }
      const value = this.jedison.getValue();
      this._applyingLocal = true;
      try {
        this._transact(() => {
          applyValue(this.yType, value, { keys: this.keys ?? undefined });
        });
      } finally {
        this._applyingLocal = false;
      }
    };

    this._onObserve = () => {
      if (this._destroyed || this._applyingLocal) {
        return;
      }
      const remote = this._scopedRemote();
      // Remote changes outside the key scope leave the managed subset
      // untouched: skip the editor update entirely instead of re-rendering
      // over whatever the user is typing
      if (jsonEqual(remote, this.jedison.getValue())) {
        return;
      }
      this._applyingRemote = true;
      try {
        this.jedison.setValue(remote, true, this.initiator);
      } finally {
        this._applyingRemote = false;
      }
    };

    this._reconcileInitial();
    this.jedison.on("change", this._onChange);
    this.yType.observeDeep(this._onObserve);
  }

  /**
   * Reconciles the initial state of editor and shared type. The shared type
   * wins when it already carries content; otherwise the editor's current
   * value seeds it.
   *
   * @returns {void}
   */
  _reconcileInitial() {
    const remote = this._scopedRemote();
    const hasRemote = this.keys
      ? Object.keys(remote).length > 0
      : typeHasContent(this.yType, remote);
    if (hasRemote) {
      this._applyingRemote = true;
      try {
        this.jedison.setValue(remote, true, this.initiator);
      } finally {
        this._applyingRemote = false;
      }
      return;
    }
    const local = this.jedison.getValue();
    if (local === undefined || local === null) {
      return;
    }
    this._applyingLocal = true;
    try {
      this._transact(() => {
        applyValue(this.yType, local, { keys: this.keys ?? undefined });
      });
    } finally {
      this._applyingLocal = false;
    }
  }

  /**
   * The remote state this binding manages: the shared type's JSON mirror,
   * restricted to the key scope when one is set.
   *
   * @returns {any}
   */
  _scopedRemote() {
    const remote = typeToJson(this.yType);
    return this.keys ? pickKeys(remote, this.keys) : remote;
  }

  /**
   * Runs mutations inside a document transaction when the shared type is
   * attached to a Y.Doc, batching the resulting updates.
   *
   * @param {() => void} fn
   * @returns {void}
   */
  _transact(fn) {
    if (this.doc) {
      this.doc.transact(fn, this.origin);
      return;
    }
    fn();
  }

  /**
   * Detaches the binding. The editor and the shared type keep their current
   * values, but no longer propagate changes to each other.
   *
   * @returns {void}
   */
  destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this.jedison.off("change", this._onChange);
    this.yType.unobserveDeep(this._onObserve);
  }
}

/**
 * @param {Y.Map<any>|Y.Array<any>} yType
 * @param {any} json - Plain JSON mirror of the type
 * @returns {boolean} True when the shared type carries any content
 */
function typeHasContent(yType, json) {
  if (isYMap(yType)) {
    return yType.size > 0;
  }
  if (isYArray(yType)) {
    return yType.length > 0;
  }
  return json !== undefined;
}

/**
 * Binds a Jedison editor to a Yjs shared type, in the spirit of
 * `yCollab` from y-codemirror.next.
 *
 * @example
 * import * as Y from 'yjs'
 * import Jedison from 'jedison'
 * import { yJedison } from 'y-jedison'
 *
 * const ydoc = new Y.Doc()
 * const jedison = new Jedison.Create({ schema, container })
 * const binding = yJedison(jedison, ydoc.getMap('form'))
 *
 * // For shared maps with co-located foreign keys — e.g. a noflo-ui node's
 * // metadata map also holding intent-managed `x`/`y` — scope the binding to
 * // the form's keys:
 * const metadataBinding = yJedison(jedison, node.get('metadata'), {
 *   keys: ['description', 'icon'],
 * })
 *
 * @param {JedisonLike} jedison - A Jedison editor instance
 * @param {Y.Map<any>|Y.Array<any>} yType - Root shared type (Y.Map or Y.Array)
 * @param {JedisonBindingOptions} [options]
 * @returns {JedisonBinding}
 */
export const yJedison = (jedison, yType, options = {}) =>
  new JedisonBinding(jedison, yType, options);
