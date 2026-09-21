// What a page owns while it is on screen. The site changes pages without unloading (see shell.js), so a
// timer or a window listener a page starts must be ended when the visitor moves on, or it would keep
// running against a page that is gone. A page captures its scope once, at the start of its mount, so
// work that finishes after the visitor has left cannot attach itself to the page they went to.
let controller = new AbortController();

function scopeOf(own) {
  const { signal } = own;
  return {
    signal,
    get left() { return signal.aborted; },
    onLeave(fn) {
      if (signal.aborted) fn();
      else signal.addEventListener("abort", fn, { once: true });
    },
    // A listener on the window, the document or anything else that outlives the page's own elements.
    on(target, type, listener, options = {}) {
      if (!signal.aborted) target.addEventListener(type, listener, { ...options, signal });
    },
    every(fn, ms) {
      if (signal.aborted) return 0;
      const id = setInterval(fn, ms);
      signal.addEventListener("abort", () => clearInterval(id), { once: true });
      return id;
    },
    later(fn, ms) {
      if (signal.aborted) return 0;
      const id = setTimeout(fn, ms);
      signal.addEventListener("abort", () => clearTimeout(id), { once: true });
      return id;
    },
  };
}

export const currentScope = () => scopeOf(controller);
// The shell calls this as the visitor leaves a page; everything the page registered ends.
export function endPage() {
  controller.abort();
  controller = new AbortController();
}
