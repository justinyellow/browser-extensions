// Injected at document_start into the MAIN world of configured app hosts.
// Keeps a small ring buffer of console errors, uncaught exceptions and failed requests,
// which the popup reads when the user captures a bug.
(() => {
  if (window.__bugCapture) return;
  const MAX = 80;
  const log = [];
  const push = (entry) => {
    log.push({ at: Date.now(), ...entry });
    if (log.length > MAX) log.shift();
  };
  const fmt = (args) =>
    args
      .map((a) => {
        try {
          if (typeof a === "string") return a;
          if (a instanceof Error) return a.stack || a.message;
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ")
      .slice(0, 1000);

  for (const level of ["error", "warn"]) {
    const original = console[level];
    console[level] = (...args) => {
      push({ kind: "console", level, message: fmt(args) });
      return original.apply(console, args);
    };
  }
  window.addEventListener("error", (e) =>
    push({ kind: "exception", message: `${e.message} (${e.filename || "?"}:${e.lineno || 0})` })
  );
  window.addEventListener("unhandledrejection", (e) =>
    push({ kind: "exception", message: `Unhandled rejection: ${fmt([e.reason])}` })
  );

  const urlOf = (input) => (typeof input === "string" ? input : input?.url || String(input));
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const method = (init?.method || input?.method || "GET").toUpperCase();
    try {
      const res = await originalFetch.call(this, input, init);
      if (!res.ok) push({ kind: "network", message: `${method} ${urlOf(input)} → ${res.status}` });
      return res;
    } catch (err) {
      push({ kind: "network", message: `${method} ${urlOf(input)} failed: ${err.message}` });
      throw err;
    }
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.addEventListener("loadend", () => {
      if (this.status === 0) push({ kind: "network", message: `${method} ${url} failed (no response)` });
      else if (this.status >= 400) push({ kind: "network", message: `${method} ${url} → ${this.status}` });
    });
    return open.call(this, method, url, ...rest);
  };

  window.__bugCapture = { entries: () => log.slice() };
})();
