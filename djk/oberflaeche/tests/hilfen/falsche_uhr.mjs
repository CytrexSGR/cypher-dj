// A fake clock for the take collector (AutoOptionen.uhr): time moves only when the test says so, timers fire in order of their time.
const flush = () => new Promise((ok) => setImmediate(ok));
export function falscheUhr(start = 1_000_000) {
  let t = start, n = 0;
  const timer = new Map();
  return {
    jetzt: () => t,
    setze: (f, ms) => { const id = ++n; timer.set(id, { f, an: t + ms }); return id; },
    loesche: (id) => { timer.delete(id); },
    offen: () => timer.size,
    // move the clock by ms; every timer that falls due runs at its own time, the async work it starts is let finish before the next one
    async vor(ms) {
      const ziel = t + ms;
      for (;;) {
        let erster = null;
        for (const [id, x] of timer) if (x.an <= ziel && (erster === null || x.an < erster[1].an)) erster = [id, x];
        if (erster === null) break;
        timer.delete(erster[0]); t = Math.max(t, erster[1].an); erster[1].f(); await flush();
      }
      t = ziel; await flush();
    },
  };
}
