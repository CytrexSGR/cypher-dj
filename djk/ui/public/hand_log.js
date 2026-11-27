// Agent log panel: the button AGENT LOG in #cypher opens a popover with the last 50 lines of GET /hand/log (newest first). While open it refreshes every
// 2 s; closed, nothing is fetched. A 404 (route not there yet) shows one quiet line instead of an error.
const pad = (n) => String(n).padStart(2, '0');

/** One log line {t, id, name, werkzeug, aktion, ok, fehler?} -> { zeit: 'HH:MM:SS', schluessel, werkzeug, urteil, abgelehnt }. */
export function logZeile(z) {
  const d = new Date(Number(z?.t));
  const zeit = Number.isFinite(d.getTime()) ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '--:--:--';
  const abgelehnt = z?.ok === false;
  return {
    zeit,
    schluessel: z?.name ? String(z.name) : '-',
    werkzeug: [z?.werkzeug, z?.aktion].filter(Boolean).join(' ') || '-',
    urteil: abgelehnt ? `refused: ${z?.fehler ?? 'unknown'}` : 'allowed',
    abgelehnt,
  };
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Binds the button and the popover. holen(n) -> {code, j}; defaults to fetch. Returns { oeffne, schliesse }. */
export function bindeHandLog({ knopf, fenster, holen, takt = setInterval, stopp = clearInterval }) {
  const lade = holen ?? (async (n) => {
    const r = await fetch(`/hand/log?n=${n}`);
    return { code: r.status, j: await r.json().catch(() => ({})) };
  });
  let uhr = null;
  const zeichne = (html) => { fenster.innerHTML = html; };
  const aktualisiere = async () => {
    let a;
    try { a = await lade(50); } catch { zeichne('<p class="hand-log-leer">Log not reachable.</p>'); return; }
    if (uhr === null) return;   // closed while the answer was on its way
    if (a.code === 404) { zeichne('<p class="hand-log-leer">No agent log on this server.</p>'); return; }
    if (a.code !== 200) { zeichne('<p class="hand-log-leer">Log not available.</p>'); return; }
    const zeilen = (Array.isArray(a.j?.zeilen) ? a.j.zeilen : []).slice().reverse().map(logZeile);
    zeichne(zeilen.length
      ? `<table class="hand-log-tab">${zeilen.map((z) => `<tr${z.abgelehnt ? ' class="refused"' : ''}><td>${z.zeit}</td><td>${esc(z.schluessel)}</td>`
        + `<td>${esc(z.werkzeug)}</td><td>${esc(z.urteil)}</td></tr>`).join('')}</table>`
      : '<p class="hand-log-leer">No agent calls yet.</p>');
  };
  const oeffne = () => {
    if (uhr !== null) return;
    fenster.hidden = false; knopf.setAttribute('aria-expanded', 'true');
    uhr = takt(aktualisiere, 2000);
    aktualisiere();
  };
  const schliesse = () => {
    if (uhr === null) return;
    stopp(uhr); uhr = null;
    fenster.hidden = true; knopf.setAttribute('aria-expanded', 'false');
  };
  knopf.addEventListener('click', () => (uhr === null ? oeffne() : schliesse()));
  return { oeffne, schliesse };
}
