// Root-cause fix for the "fetch failed / ECONNRESET on POST" flake of the server and page tests.
// Every test starts its own Oberflaeche on the same fixed port (47300 + K) and stops it afterwards. The global fetch (undici) keeps the
// socket of a finished request in its keep-alive pool. When the next test binds the same port, the pool still holds the socket to the
// stopped server: the server side already sent FIN, the client has not processed it yet, writes the next request (typically a POST)
// onto the dead socket and gets ECONNRESET. Under CPU load the gap between FIN and its processing is long enough to hit it.
// Fix: every request of the test process opens its own connection and closes it (`reset: true` sends "connection: close"), so no
// socket outlives a request and nothing in the pool can belong to an earlier server. Localhost connections cost microseconds.
// Installed once per process, by importing this file (tests/support/instance.mjs does).
// Node creates its global dispatcher lazily, on the first fetch: before that the symbol is unset and there is nothing to wrap
// (found 2026-11-19: without this line the proxy was never installed). A data: fetch creates it without touching the network.
const SYM = Symbol.for('undici.globalDispatcher.1');
if (!globalThis[SYM]) { try { await fetch('data:,'); } catch { /* only for the side effect */ } }
const roh = globalThis[SYM];
if (roh && !roh.__keinKeepAlive) {
  globalThis[SYM] = new Proxy(roh, {
    get(ziel, name) {
      if (name === '__keinKeepAlive') return true;
      if (name === 'dispatch') return (opt, handler) => ziel.dispatch({ ...opt, reset: true }, handler);
      const v = ziel[name];
      return typeof v === 'function' ? v.bind(ziel) : v;
    },
  });
}
