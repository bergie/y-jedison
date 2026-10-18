/**
 * @file diff.js
 * @description Pure primitives for reconciling a plain-JSON value with a Yjs
 * shared type tree.
 *
 * A Jedison editor works on plain JSON shaped by a JSON Schema, while Yjs
 * collaboration wants granular shared types. This module converts between the
 * two and applies *minimal* diffs, so concurrent edits to different keys (or
 * different array elements) merge without clobbering each other. Concurrency
 * semantics are per-key last-writer-wins for objects and per-element for
 * arrays — the right granularity for form data.
 *
 * All functions expect the shared types to be integrated into a Y.Doc: Yjs
 * forbids reading or mutating the content of detached types. New subtrees are
 * created empty, attached to their (integrated) parent, and only then filled —
 * the order Yjs requires.
 */

import * as Y from "yjs";

/**
 * Whether a value is structurally a Y.Map. Structural checks rather than
 * `instanceof`: a host may run a different Yjs copy than the binding's
 * own (peer-dependency installs vendor or pin independently), and Yjs
 * class identities do not cross copies.
 *
 * @param {any} value
 * @returns {value is Y.Map<any>}
 */
export function isYMap(value) {
  return (
    typeof value?.get === "function" &&
    typeof value?.set === "function" &&
    typeof value?.delete === "function" &&
    typeof value?.keys === "function" &&
    typeof value?.size === "number" &&
    typeof value?.observeDeep === "function" &&
    typeof value?.toJSON === "function"
  );
}

/**
 * Whether a value is structurally a Y.Array.
 *
 * @param {any} value
 * @returns {value is Y.Array<any>}
 */
export function isYArray(value) {
  return (
    typeof value?.insert === "function" &&
    typeof value?.delete === "function" &&
    typeof value?.get === "function" &&
    typeof value?.length === "number" &&
    typeof value?.observeDeep === "function" &&
    typeof value?.toArray === "function"
  );
}

/**
 * Converts a Yjs type tree (or scalar) to its plain JSON representation.
 * Scalars pass through untouched.
 *
 * @param {any} value - A Y.Map, Y.Array, or JSON-compatible scalar
 * @returns {any} Plain JSON representation of the value
 */
export function typeToJson(value) {
  if (isYMap(value)) {
    /** @type {Record<string, any>} */
    const result = {};
    for (const [key, child] of value.entries()) {
      result[key] = typeToJson(child);
    }
    return result;
  }
  if (isYArray(value)) {
    return value.toArray().map((child) => typeToJson(child));
  }
  return value;
}

/**
 * @typedef {Object} ApplyValueOptions
 * @property {string[]} [keys] - For Y.Map roots: only reconcile these
 *   top-level keys. Keys of the shared map outside this list are owned by
 *   other writers (for example a node's `x`/`y` canvas position managed by
 *   move intents) and are neither overwritten nor deleted. Ignored for
 *   Y.Array roots and for nested subtrees.
 */

/**
 * Mutates a Yjs type in place so its tree equals the given plain JSON value.
 * Only differing subtrees are touched: unchanged keys keep their existing
 * Y types (and identities), array edits splice the smallest possible range.
 * Wrap calls in `doc.transact()` to batch the resulting updates.
 *
 * @param {Y.Map<any>|Y.Array<any>} yType - Root shared type to reconcile
 * @param {any} value - Target plain JSON value
 * @param {ApplyValueOptions} [options]
 * @returns {void}
 */
export function applyValue(yType, value, options = {}) {
  const keys = normalizeKeys(options.keys);
  if (isYMap(yType)) {
    if (!isPlainObject(value)) {
      // Kind mismatch (e.g. schema changed the root shape): clear the type.
      // Scalar roots are not supported — root Y types must be Y.Map or Y.Array.
      for (const key of Array.from(yType.keys())) {
        yType.delete(key);
      }
      return;
    }
    const current = typeToJson(yType);
    if (keys) {
      applyMapDiff(yType, pickKeys(current, keys), pickKeys(value, keys));
      return;
    }
    applyMapDiff(yType, current, value);
    return;
  }
  if (isYArray(yType)) {
    if (!Array.isArray(value)) {
      if (yType.length > 0) {
        yType.delete(0, yType.length);
      }
      return;
    }
    applyArrayDiff(yType, typeToJson(yType), value);
  }
}

/**
 * Reconciles a Y.Map with a target plain object, recursing into children
 * that are shared types of matching kind.
 *
 * @param {Y.Map<any>} yMap - Shared map to reconcile
 * @param {Record<string, any>} current - Plain JSON mirror of the map
 * @param {Record<string, any>} next - Target plain object
 * @returns {void}
 */
function applyMapDiff(yMap, current, next) {
  // Deletions are driven by the (possibly key-scoped) mirror, never by the
  // live map's key set: keys outside the binding's scope are owned by other
  // writers and must never be touched
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(next, key) && yMap.has(key)) {
      yMap.delete(key);
    }
  }
  for (const key of Object.keys(next)) {
    const before = current[key];
    const after = next[key];
    if (after === undefined) {
      // Yjs cannot store undefined: an undefined form value means the key
      // goes away
      if (yMap.has(key)) {
        yMap.delete(key);
      }
      continue;
    }
    if (jsonEqual(before, after)) {
      continue;
    }
    const child = yMap.get(key);
    const merged = mergeChild(child, before, after);
    if (merged) {
      continue;
    }
    setMapValue(yMap, key, after);
  }
}

/**
 * Reconciles a Y.Array with a target plain array. Matching positions whose
 * elements are both objects of the same kind are reconciled in place (which
 * preserves per-key concurrency for edits inside array items); length changes
 * and scalar element changes are spliced.
 *
 * @param {Y.Array<any>} yArray - Shared array to reconcile
 * @param {any[]} current - Plain JSON mirror of the array
 * @param {any[]} next - Target plain array
 * @returns {void}
 */
function applyArrayDiff(yArray, current, next) {
  const shared = Math.min(current.length, next.length);
  for (let index = 0; index < shared; index++) {
    const before = current[index];
    const after = next[index];
    if (jsonEqual(before, after)) {
      continue;
    }
    const child = yArray.get(index);
    const merged = mergeChild(child, before, after);
    if (merged) {
      continue;
    }
    yArray.delete(index, 1);
    insertArrayValue(yArray, index, after);
  }
  if (next.length > current.length) {
    insertArrayItems(yArray, current.length, next.slice(current.length));
  } else if (next.length < current.length) {
    yArray.delete(next.length, current.length - next.length);
  }
}

/**
 * Attempts to reconcile a shared-type child in place with a new value.
 *
 * @param {any} child - The existing child value of the parent type (may be a Y type)
 * @param {any} before - Plain JSON mirror of the child
 * @param {any} after - Target plain JSON value for the child
 * @returns {boolean} True when the child was reconciled in place
 */
function mergeChild(child, before, after) {
  if (
    !isContainer(before) ||
    !isContainer(after) ||
    Array.isArray(before) !== Array.isArray(after)
  ) {
    return false;
  }
  if (Array.isArray(after) && isYArray(child)) {
    applyArrayDiff(child, /** @type {any[]} */ (before), after);
    return true;
  }
  if (isPlainObject(after) && isYMap(child)) {
    applyMapDiff(child, /** @type {Record<string, any>} */ (before), after);
    return true;
  }
  return false;
}

/**
 * Writes a value into a Y.Map under the given key. Containers are created as
 * shared types, attached to the (integrated) map, and then filled with
 * content — the order Yjs requires for nested types.
 *
 * @param {Y.Map<any>} yMap - Integrated parent map
 * @param {string} key
 * @param {any} value
 * @returns {void}
 */
function setMapValue(yMap, key, value) {
  if (isPlainObject(value)) {
    const child = new Y.Map();
    yMap.set(key, child);
    fillMap(child, value);
    return;
  }
  if (Array.isArray(value)) {
    const child = new Y.Array();
    yMap.set(key, child);
    fillArray(child, value);
    return;
  }
  yMap.set(key, value);
}

/**
 * Writes a single value at a position of a Y.Array, following the same
 * attach-before-fill rules as {@link setMapValue}.
 *
 * @param {Y.Array<any>} yArray - Integrated parent array
 * @param {number} index
 * @param {any} value
 * @returns {void}
 */
function insertArrayValue(yArray, index, value) {
  insertArrayItems(yArray, index, [value]);
}

/**
 * Inserts a list of plain JSON values at a position of a Y.Array. Container
 * elements are inserted as empty shared types in one operation and filled
 * afterwards.
 *
 * @param {Y.Array<any>} yArray - Integrated parent array
 * @param {number} index
 * @param {any[]} values
 * @returns {void}
 */
function insertArrayItems(yArray, index, values) {
  /** @type {Array<[Y.Map<any>|Y.Array<any>, any]>} */
  const pending = [];
  const items = values.map((item) => {
    if (isPlainObject(item)) {
      const child = new Y.Map();
      pending.push([child, item]);
      return child;
    }
    if (Array.isArray(item)) {
      const child = new Y.Array();
      pending.push([child, item]);
      return child;
    }
    return item;
  });
  yArray.insert(index, items);
  for (const [child, item] of pending) {
    if (isYMap(child)) {
      fillMap(child, item);
    } else {
      fillArray(child, item);
    }
  }
}

/**
 * Fills an attached, empty Y.Map with a plain object's content.
 *
 * @param {Y.Map<any>} yMap
 * @param {Record<string, any>} value
 * @returns {void}
 */
function fillMap(yMap, value) {
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      // Yjs cannot store undefined: skip undefined entries
      continue;
    }
    setMapValue(yMap, key, item);
  }
}

/**
 * Fills an attached, empty Y.Array with a plain array's content.
 *
 * @param {Y.Array<any>} yArray
 * @param {any[]} value
 * @returns {void}
 */
function fillArray(yArray, value) {
  insertArrayItems(yArray, 0, value);
}

/**
 * Normalizes an optional key-scope list: null when absent or empty.
 *
 * @param {string[]|undefined} keys
 * @returns {string[]|null}
 */
function normalizeKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return null;
  }
  return keys;
}

/**
 * Projects a plain object onto a key scope: only the listed keys are kept.
 * Entries whose value is undefined are dropped — Yjs cannot store undefined.
 *
 * @param {Record<string, any>} value
 * @param {string[]} keys
 * @returns {Record<string, any>}
 */
export function pickKeys(value, keys) {
  /** @type {Record<string, any>} */
  const result = {};
  if (!isPlainObject(value)) {
    return result;
  }
  for (const key of keys) {
    if (Object.hasOwn(value, key) && value[key] !== undefined) {
      result[key] = value[key];
    }
  }
  return result;
}

/**
 * @param {any} value
 * @returns {boolean} True when the value is a plain object or an array
 */
function isContainer(value) {
  return value !== null && typeof value === "object";
}

/**
 * @param {any} value
 * @returns {boolean} True when the value is a plain (non-array) object
 */
export function isPlainObject(value) {
  return isContainer(value) && !Array.isArray(value);
}

/**
 * Deep equality for JSON-compatible values.
 *
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
export function jsonEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (!isContainer(a) || !isContainer(b)) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a)) {
    const bArray = /** @type {any[]} */ (b);
    if (a.length !== bArray.length) {
      return false;
    }
    return a.every((item, index) => jsonEqual(item, bArray[index]));
  }
  const aObject = /** @type {Record<string, any>} */ (a);
  const bObject = /** @type {Record<string, any>} */ (b);
  const aKeys = Object.keys(aObject);
  if (aKeys.length !== Object.keys(bObject).length) {
    return false;
  }
  return aKeys.every(
    (key) =>
      Object.hasOwn(bObject, key) && jsonEqual(aObject[key], bObject[key]),
  );
}
