// R7: sends uncaught page errors and unhandled rejections to the page server (POST /seite/fehler). Classic script, loaded before app.js.
// Never throws, at most 50 reports per rolling minute (then drops silently), ignores every failure of its own.
(() => {
  const MAX = 50;
  const zeiten = [];
  const kurz = (v, n) => { try { return String(v ?? '').slice(0, n); } catch { return ''; } };
  const ansicht = () => {
    try { return document.querySelector('#kopf [data-ansicht].an')?.dataset?.ansicht ?? ''; } catch { return ''; }
  };
  function melde(meldung, datei, zeile, spalte) {
    try {
      const jetzt = Date.now();
      while (zeiten.length && jetzt - zeiten[0] >= 60000) zeiten.shift();
      if (zeiten.length >= MAX) return;
      zeiten.push(jetzt);
      const koerper = JSON.stringify({
        meldung: kurz(meldung, 500), datei: kurz(datei, 300),
        zeile: Number.isInteger(zeile) ? zeile : null, spalte: Number.isInteger(spalte) ? spalte : null,
        ansicht: kurz(ansicht(), 60), zeit: new Date(jetzt).toISOString(),
      });
      const p = fetch('/seite/fehler', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: koerper });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* ignore */ }
  }
  const grund = (r) => {
    if (r instanceof Error) return r.stack ? `${r.message}\n${r.stack}` : r.message;
    return r === undefined ? 'undefined rejection' : kurz(r, 500);
  };
  try {
    addEventListener('error', (e) => melde(e?.message || (e?.error !== undefined ? grund(e.error) : 'error'), e?.filename, e?.lineno, e?.colno));
    addEventListener('unhandledrejection', (e) => melde(grund(e?.reason), '', null, null));
  } catch { /* ignore */ }
})();
