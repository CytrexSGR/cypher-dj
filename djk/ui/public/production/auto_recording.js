// 1.12 Automation slice 3 task 9 (D11, D12, D13): the page arms tracks for automation recording and sends the gestures of the mouse and the keyboard to the
// server. The server holds the take (arm state, time base, simplify, write); the page sends only what the hand does:
//   POST /proj/auto/arm   {spur_id, an, modus} | {alle: true, an: false} | {modus}
//   POST /proj/auto/geste {spur_id, ziel, wert?, ende?, quelle: 'maus' | 'tasten'}
// The ends of a gesture (D13): mouse pointerup, pointercancel, lostpointercapture or window blur; keyboard GESTE_RUHE_MS without a key. The server closes
// a mouse gesture without any end after 60 s and every open gesture at a transport stop.
export const MODI = ['touch', 'latch', 'write'];
export const MODUS_TEXT = { touch: 'TOUCH', latch: 'LATCH', write: 'WRITE' };
export const MODUS_TITEL = {
  touch: 'Touch: only the span of the gesture is written, the lane stays elsewhere',
  latch: 'Latch: after the release the last value holds until stop',
  write: 'Write: from start to stop every lane field of an armed track is overwritten',
};
export const GESTE_RUHE_MS = 500;   // a key counts as a grip until this long without a key; the server's GESTE_RUHE_MS (areas/proj/times.ts) is the same, pinned by a test

// The arm state as the server sends it ({modus, spuren: [ids]}); anything else is "nothing armed, touch"
export function armStand(x) {
  const modus = MODI.includes(x?.modus) ? x.modus : 'touch';
  return { modus, spuren: Array.isArray(x?.spuren) ? x.spuren.filter((i) => typeof i === 'string') : [] };
}
export const istArmiert = (stand, id) => Array.isArray(stand?.spuren) && stand.spuren.includes(id);
export const armKoerper = (spurId, an, modus) => ({ spur_id: spurId, an, modus });

// The refusal of a take (SSE {auto_aufnahme: {fehler, text}}) as a notice of the page. Success and another project's events show nothing.
export function aufnahmeMeldung(f, slug) {
  if (!f?.fehler || f.slug !== slug) return null;
  return { text: f.text ?? `Recording refused: ${f.fehler}`, fehler: true };
}

// The gestures: one entry per (track, field). Requests of one entry go one at a time and in order; while one is in flight a newer value replaces the waiting
// one (only the last value of a burst matters), the end event always stays behind the last value and behind `warteSchreiben()` (the page's own writes).
// `senden(body)` returns a promise; `armiert(id)` says whether the track is armed (an unarmed track sends nothing); `vorhanden(id)` whether it still exists;
// `uhr` is injected so the keyboard rest is testable.
// Cleanup: verwirf() drops everything (another project), verwerfeSpur(id) a deleted track, abgleich() every entry whose track is no longer armed or gone
// (the server closed it), beendeSpur(id) ends the gestures of a track that the user disarms (the end goes first, then the arm request). Dropping stops the
// key timer and discards the queued requests; a request that waits for the writer is not sent afterwards.
export function neueGesten({ senden, armiert, vorhanden = () => true, warteSchreiben = async () => {}, ruheMs = GESTE_RUHE_MS,
  uhr = { setze: (f, ms) => setTimeout(f, ms), loesche: (h) => clearTimeout(h) } }) {
  const m = new Map();
  const schub = async (e) => {
    if (e.laeuft) return;
    e.laeuft = true;
    while (e.q.length && !e.tot) {
      const b = e.q.shift();
      // the end makes the server write the take (a new revision): it goes out only after the page's own writes are answered, else the last write of
      // the gesture meets rev_veraltet and the last value is lost
      if (b.ende) { try { await warteSchreiben(); } catch { /* the writer shows its own failure */ } }
      if (e.tot) break;                       // dropped while it waited: another project, a deleted track
      try { await senden(b); } catch { /* the sender shows its own failure */ }
    }
    e.laeuft = false;
    const w = e.leerWartende; e.leerWartende = [];
    for (const f of w) f();
  };
  const eintrag = (k) => { let e = m.get(k); if (!e) { e = { q: [], laeuft: false, offen: false, quelle: 'maus', timer: null, tot: false, leerWartende: [] }; m.set(k, e); } return e; };
  const stelle = (e, b) => { if (b.wert !== undefined && !b.ende && e.q.length && e.q.at(-1).wert !== undefined && !e.q.at(-1).ende && e.laeuft) e.q[e.q.length - 1] = b; else e.q.push(b); schub(e); };
  const schliesse = (e, spur, ziel) => {
    if (e.timer) { uhr.loesche(e.timer); e.timer = null; }
    e.offen = false;
    stelle(e, { spur_id: spur, ziel, ende: true, quelle: e.quelle });
  };
  const vergiss = (k, e) => {
    if (e.timer) { uhr.loesche(e.timer); e.timer = null; }
    e.tot = true; e.offen = false; e.q.length = 0; m.delete(k);
    const w = e.leerWartende; e.leerWartende = []; for (const f of w) f();
  };
  const gilt = (spur) => armiert(spur) && vorhanden(spur);
  const api = {
    wert(spur, ziel, wert, quelle) {
      if (!gilt(spur)) return false;
      const e = eintrag(`${spur}|${ziel}`);
      e.offen = true; e.quelle = quelle;
      if (e.timer) { uhr.loesche(e.timer); e.timer = null; }
      if (quelle === 'tasten') e.timer = uhr.setze(() => { e.timer = null; if (gilt(spur)) schliesse(e, spur, ziel); else vergiss(`${spur}|${ziel}`, e); }, ruheMs);
      stelle(e, { spur_id: spur, ziel, wert, quelle });
      return true;
    },
    // nurQuelle: a pointer event closes only a mouse gesture, never a keyboard one. A track that is no longer armed or gone sends nothing: the entry is dropped.
    ende(spur, ziel, nurQuelle) {
      const k = `${spur}|${ziel}`, e = m.get(k);
      if (!e || !e.offen || (nurQuelle && e.quelle !== nurQuelle)) return false;
      if (!gilt(spur)) { vergiss(k, e); return false; }
      schliesse(e, spur, ziel);
      return true;
    },
    alleEnden() { for (const [k, e] of [...m]) if (e.offen) { const [spur, ziel] = k.split('|'); if (gilt(spur)) schliesse(e, spur, ziel); else vergiss(k, e); } },
    // a click on M or S: one value, closed at once
    einmal(spur, ziel, wert) {
      if (!gilt(spur)) return false;
      const e = eintrag(`${spur}|${ziel}`);
      e.quelle = 'maus';
      if (e.timer) { uhr.loesche(e.timer); e.timer = null; }
      e.offen = false;
      stelle(e, { spur_id: spur, ziel, wert, quelle: 'maus' });   // the value at the moment of the click, the end behind the page's write
      stelle(e, { spur_id: spur, ziel, ende: true, quelle: 'maus' });
      return true;
    },
    // the user disarms a track: its open gestures end now (forced, the arm request follows); resolves when the requests of the track are out
    beendeSpur(spur) {
      const warten = [];
      for (const [k, e] of m) {
        if (!k.startsWith(`${spur}|`)) continue;
        if (e.offen) schliesse(e, spur, k.slice(spur.length + 1));
        if (e.laeuft || e.q.length) warten.push(new Promise((ok) => { e.leerWartende.push(ok); }));
      }
      return Promise.all(warten).then(() => undefined);
    },
    // the server closed the arm (a new core, another client): drop what is no longer armed or gone, nothing is sent
    abgleich() { for (const [k, e] of [...m]) if (!gilt(k.split('|')[0])) vergiss(k, e); },
    verwerfeSpur(spur) { for (const [k, e] of [...m]) if (k.startsWith(`${spur}|`)) vergiss(k, e); },
    verwirf() { for (const [k, e] of [...m]) vergiss(k, e); },
  };
  return api;
}

// The binder: transport bar mode buttons and the per-track AUTO buttons. koepfe.zeigeArm(stand) paints the heads; st.autoArm is the server state.
// The arm state comes from the server only (/proj/aktuell auto_arm, SSE {auto_arm}); the buttons write nothing themselves.
export function bindeAutoAufnahme(ctx, koepfe, gesten) {
  const { st, $ } = ctx;
  st.autoArm = armStand(null);
  st.autoModus = 'touch';
  const zeige = () => {
    koepfe.zeigeArm(st.autoArm);
    for (const modus of MODI) { const b = $(`auto-${modus}`); b.classList.toggle('an', st.autoModus === modus); b.setAttribute('aria-pressed', String(st.autoModus === modus)); }
  };
  const uebernimm = (x) => { st.autoArm = armStand(x); if (x?.modus) st.autoModus = st.autoArm.modus; gesten.abgleich(); zeige(); };
  const sende = async (weg, body) => {
    const r = await ctx.holeJson(weg, body);
    if (r.status !== 200) ctx.melde(ctx.antwortText(r), true);
    return r;
  };
  for (const modus of MODI) {
    const b = $(`auto-${modus}`);
    b.textContent = MODUS_TEXT[modus]; b.title = MODUS_TITEL[modus];
    b.addEventListener('click', async () => {
      const r = await sende('/proj/auto/arm', { modus });
      if (r.status === 200) { st.autoModus = modus; if (r.j?.auto_arm) uebernimm(r.j.auto_arm); else zeige(); }
    });
  }
  ctx.beimProjekt.push(() => { gesten.abgleich(); zeige(); });
  ctx.beimEreignis.push((a, f) => {
    if (a !== 'proj') return;
    if (f?.auto_arm) uebernimm(f.auto_arm);
    const m = aufnahmeMeldung(f?.auto_aufnahme, st.slug);
    if (m) ctx.melde(m.text, true);
  });
  return {
    uebernimm,
    // the arm button of a track head
    // disarm: the open gestures of the track end first (one end each), then the arm request; the answer carries the new state like the mode buttons
    armiere: async (id, an) => {
      if (!an) await gesten.beendeSpur(id);
      const r = await sende('/proj/auto/arm', armKoerper(id, an, st.autoModus));
      if (r.status === 200 && r.j?.auto_arm) uebernimm(r.j.auto_arm);
    },
  };
}
