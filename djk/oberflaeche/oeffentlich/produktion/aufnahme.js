// 1.8 Slice 1: REC-Knopf und Aufnahmestatus (Oberfläche englisch). Reine Funktionen getestet; bindeAufnahme hängt sie an Transportleiste und Kern-Ereignisse.
export const recText = (z) => (z.status === 2 ? 'Waiting for the start' : z.status === 3 ? `Recording${z.luecken > 0 ? ` · ${z.luecken} gaps` : ''}` : z.status === 4 ? 'Finishing' : '');
// M2: der Kern meldet /zustand/rec mit Status 0, nachdem er 2 bis 4 gemeldet hat: der Take ist zu Ende, auch wenn niemand STOP REC gedrückt hat
export const laufEnde = (vorher, jetzt) => vorher >= 2 && jetzt === 0;
export function recKnopf({ projekt, lauf }) {
  if (lauf) return { disabled: false, an: true, titel: 'Stop and keep the take', text: '■ STOP REC' };
  if (!projekt) return { disabled: true, an: false, titel: 'Open a project first', text: '● REC' };
  const scharf = projekt.spuren.some((s) => s.art === 'audio' && s.aufnahme?.scharf && s.aufnahme.eingang);
  return scharf ? { disabled: false, an: false, titel: 'Record onto the armed tracks', text: '● REC' }
    : { disabled: true, an: false, titel: 'Arm a track and choose its input first', text: '● REC' };
}
export function armZustand(s) {
  const audio = s.art === 'audio';
  return { sichtbar: audio, scharf: !!s.aufnahme?.scharf, eingang: s.aufnahme?.eingang?.name ?? '', armSperre: !audio || !s.aufnahme?.eingang };
}

export function bindeAufnahme(ctx) {
  const { st, $ } = ctx;
  let lauf = null, zuletzt = 0, umschaltet = false, zieht = false;
  const takt = ctx.takt ?? 500, warte = () => new Promise((ok) => setTimeout(ok, takt));
  const zeige = () => {
    const k = recKnopf({ projekt: st.projekt, lauf });
    const b = $('rec');
    b.disabled = k.disabled; b.title = k.titel; b.textContent = k.text; b.classList.toggle('an', k.an); b.setAttribute('aria-pressed', String(k.an));
  };
  async function umschalten() {
    if (umschaltet) return;   // Doppelklick oder gehaltene Taste: ein Wechsel läuft schon, der zweite würde rot abgelehnt oder die frische Aufnahme sofort stoppen
    umschaltet = true;
    try { await umschaltenInnen(); } finally { umschaltet = false; }
  }
  async function umschaltenInnen() {
    const r = lauf ? await ctx.holeJson('/proj/aufnahme', { aktion: 'stopp' }) : await ctx.holeJson('/proj/aufnahme', { aktion: 'start', von_beat: st.start });
    if (r.status !== 200) ctx.melde(ctx.antwortText(r), true);
    else if (lauf) { const t = r.j?.takes ?? []; ctx.melde(t.some((x) => x.fehler) ? `Take saved, but: ${t.filter((x) => x.fehler).map((x) => x.fehler).join(', ')}` : 'Take saved'); await ctx.ladeAktuell(); }
    await holeLauf();
  }
  async function holeLauf() {
    const r = await ctx.holeGet('/proj/aufnahme');
    lauf = r.status === 200 ? r.j.lauf : null;
    zeige();
  }
  // M2: der Take endete ohne STOP REC (Transport-Knopf, Hand-Taste, Ende des Arrangements): das Ergebnis abwarten (der Server wandelt in die WAV und setzt den Clip) und zeigen
  async function nachLaufEnde() {
    for (let i = 0; i < 60; i++) { await holeLauf(); if (!lauf) break; await warte(); }
    const r = await ctx.holeGet('/proj/aufnahme');
    const z = r.status === 200 ? r.j.letzte : null;
    if (z) ctx.melde(z.takes?.some((x) => x.fehler) || z.fehler ? `Recording ended, but: ${z.fehler ?? z.takes.filter((x) => x.fehler).map((x) => x.fehler).join(', ')}` : 'Take saved', !!z.fehler);
    await ctx.ladeAktuell();
  }
  // Eine Aufnahme, die nicht von dieser Seite kam (Cypher über MCP): der Server setzt den Lauf erst nach dem Transport-Start, der Kern meldet aber schon vorher Status 2.
  // Darum so lange nachfragen, bis der Lauf da ist oder der Status wieder 0 ist (ein einzelnes GET an der Flanke käme zu früh und lieferte lauf null).
  async function ziehNach() {
    if (zieht) return;
    zieht = true;
    try {
      for (let i = 0; i < 30 && !lauf && !umschaltet && zuletzt >= 2; i++) { await holeLauf(); if (lauf || umschaltet || zuletzt < 2) break; await warte(); }
    } finally { zieht = false; }
  }
  $('rec').addEventListener('click', umschalten);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'r' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !st.sichtbar) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!$('rec').disabled) umschalten();
  });
  ctx.beimProjekt.push(() => zeige());
  ctx.beimEreignis.push((a, f) => {
    if (a !== '/zustand/rec') return;
    setzeText($('rec-status'), recText(f));
    const vorher = zuletzt;
    zuletzt = f.status;
    if (f.status >= 2 && !lauf) ziehNach();   // ziehNach prüft selbst, ob ein eigener Wechsel läuft
    if (laufEnde(vorher, f.status) && !umschaltet) nachLaufEnde();
  });
  ctx.beimSichtwechsel.push((sichtbar) => { if (sichtbar) holeLauf(); });
  holeLauf();
  function setzeText(el, t) { if (el.textContent !== t) el.textContent = t; }
}
