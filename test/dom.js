/**
 * @file dom.js
 * @description Boots a happy-dom environment so real Jedison can run in Node
 * tests. Jedison only needs the DOM APIs it touches at construction and for
 * rendering; Node 26 provides a native `navigator` getter, so globals that
 * can't be assigned directly are redefined instead.
 *
 * @returns {Promise<import('happy-dom').Window>} The created Window, for
 *   event construction (`new win.Event(...)`).
 */
export async function setupDom() {
  const { Window } = await import("happy-dom");
  const win = new Window({ url: "http://localhost/" });
  const define = (/** @type {string} */ name, /** @type {any} */ value) => {
    try {
      Object.defineProperty(globalThis, name, {
        value,
        configurable: true,
        writable: true,
      });
    } catch {
      // Some globals (e.g. `navigator` in newer Node) are getter-only —
      // nothing to do if redefinition is refused
    }
  };
  define("window", win);
  define("document", win.document);
  define("navigator", win.navigator);
  define("customElements", win.customElements);
  define("HTMLElement", win.HTMLElement);
  define("Element", win.Element);
  define("Node", win.Node);
  define("MutationObserver", win.MutationObserver);
  define("getComputedStyle", win.getComputedStyle.bind(win));
  define("requestAnimationFrame", (/** @type {() => void} */ callback) =>
    setTimeout(callback, 0),
  );
  return win;
}
