/**
 * @file mock-jedison.js
 * @description Minimal stand-in for a Jedison editor instance: holds a plain
 * JSON value and emits `change` with the same initiator semantics as Jedison
 * (`setValue(value, notifyParent, initiator)` → `emit('change', initiator)`).
 */

/** Minimal event emitter used by the mock. */
class Emitter {
  constructor() {
    /** @type {Map<string, Set<(...args: any[]) => void>>} */
    this.listeners = new Map();
  }

  /**
   * @param {string} event
   * @param {(...args: any[]) => void} handler
   * @returns {void}
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(handler);
  }

  /**
   * @param {string} event
   * @param {(...args: any[]) => void} handler
   * @returns {void}
   */
  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }

  /**
   * @param {string} event
   * @param {any[]} args
   * @returns {void}
   */
  emit(event, ...args) {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(...args);
    }
  }
}

export class MockJedison extends Emitter {
  /**
   * @param {any} [value] - Initial form data
   */
  constructor(value = undefined) {
    super();
    this.value = value;
  }

  /**
   * @returns {any} Current form data
   */
  getValue() {
    return this.value;
  }

  /**
   * Mirrors Jedison's `setValue(newValue, notifyParent = true, initiator = "api")`. The
   * `notifyParent` argument is accepted but unused — the mock has no parents.
   *
   * @param {any} newValue
   * @param {boolean} [_notifyParent]
   * @param {string} [initiator]
   * @returns {any}
   */
  setValue(newValue, _notifyParent = true, initiator = "api") {
    if (jsonEqual(this.value, newValue)) {
      return this.value;
    }
    this.value = newValue;
    this.emit("change", initiator);
    return this.value;
  }
}

/**
 * Local deep equality for JSON values — imported from the binding's diff
 * module so the mock's short-circuit matches the real semantics.
 *
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function jsonEqual(a, b) {
  if (a === b) {
    return true;
  }
  const isObject = (/** @type {any} */ v) =>
    v !== null && typeof v === "object";
  if (!isObject(a) || !isObject(b)) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a)) {
    return (
      a.length === b.length &&
      a.every((/** @type {any} */ v, /** @type {number} */ i) =>
        jsonEqual(v, b[i]),
      )
    );
  }
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }
  return aKeys.every(
    (/** @type {string} */ key) =>
      Object.hasOwn(b, key) && jsonEqual(a[key], b[key]),
  );
}
