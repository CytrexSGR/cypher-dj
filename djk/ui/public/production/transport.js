// PRODUCTION (D1 V1): Transport (A5-Bedienung). PLAY/STOP über POST /proj/transport (Startposition = Startmarke),
// TEMPO (tempo_setzen, 60..200), LOOP und METRO (loop_setzen, metronom_setzen), Startmarke per Klick (Lineal unten
// oder Spurfläche), Loop-Klammer ziehen (Lineal oben), Abspielkopf aus /zustand/arr (Spec 3.1) zwischen den Meldungen
// hochgerechnet (wave.js Kopf) und in die Klammer gefaltet, FOLLOW blättert um, Position Takt.Schlag.Sechzehntel.
// Die Startmarke ist Bequemlichkeit je Browser und Projekt (localStorage); Spec 3.3 kennt kein Feld dafür.
// Gefaltet wird nur, wenn das letzte gemeldete projekt_beat unter bis lag (Spec 2.2: der Kern springt „beim Erreichen von
// bis“; wer dahinter startet, läuft ungefaltet weiter). Antwortet der Kern nicht (quittung null), ist das ein Fehler.
import { xZuBeat, rasten, rasterBeats, beatsProTakt, positionText, kopfImLoop, folgeSeite } from './timeline.js';
import { linealZone, zugGriff, linealAbsicht, zieheKlammer, zugVerfolgen, setzeText, loopTakte, loopBefehl } from './layout.js';
import { Kopf } from '../wave.js';

const STATUS_TEXT = ['stopped', 'waiting', 'playing', 'freeze'];
// Anzeige des Kern-Standes: Feld nr (Wiedergabe-Nummer) aus /zustand/arr, Spec 3.1 und K1 (osc_addresses.ts)
// Höchstalter der letzten /zustand/arr-Meldung, bis zu dem der Kopf hochgerechnet wird (Spec 3.1: 50 Hz beim Spielen, 2 Hz sonst).
// Danach ist der Zustand unbekannt: der Kopf bleibt weg, statt mit einem Tempo weiterzulaufen, das der kernlose Strom nicht mehr belegt.
export const ARR_ALTER_MS = 1000;
// → { kopfBeat, unbekannt }; hochrechne(t) liefert den hochgerechneten Beat, loop ist die Klammer des Projekts
export function kopfStand({ arr, arrZeit, t, hochrechne, loop }) {
  if (!arr) return { kopfBeat: null, unbekannt: false };
  if (arrZeit === null || t - arrZeit > ARR_ALTER_MS) return { kopfBeat: null, unbekannt: true };
  return { kopfBeat: arr.status === 2 ? kopfImLoop(hochrechne(t), loop, Number(arr.projekt_beat)) : null, unbekannt: false };
}
// 1.12 S3 task 5 (AK11): the button RE-ENABLE AUTOMATION gives every overridden lane back; it is active only while the server lists an override
export const RE_ENABLE_TEXT = 'RE-ENABLE AUTOMATION';
export const reEnableAn = (liste) => Array.isArray(liste) && liste.length > 0;
export const kernText = (f) => `core rev ${f.nr} · ${STATUS_TEXT[f.status] ?? f.status}`;
export const KERN_UNBEKANNT = 'core state unknown';
// 1.10 Slice 2 (AK19): Lampe SET LIMITER. limiter_db ist die größte Absenkung des Set-Limiters (≤ 0, hält 0,5 s im Kern); unter −0,1 dB leuchtet sie.
// Kein Feld (älterer Kern), 0, Rauschen, Text und NaN ergeben false: nie eine Lampe aus einem Wert, den es nicht gibt.
export const limiterAn = (arr) => Number(arr?.limiter_db) < -0.1;
// Andreas 2026-10-30: ein Klick auf Lineal oder leere Spurfläche springt, wenn der Transport läuft (status 1 wartet, 2 spielt); gestoppt setzt er
// nur den Startmarker. Unbekannter Zustand: nie blind starten.
export const springtImLauf = (arr, unbekannt) => !unbekannt && (arr?.status === 1 || arr?.status === 2);

export function bindeTransport(ctx) {
  const { st, $ } = ctx;
  const kopf = new Kopf();
  // exakt: a marker click keeps its own beat (a marker may sit off the grid); the ruler click snaps to the grid
  const setzeStart = (beat, exakt = false) => { st.start = Math.max(0, exakt ? beat : rasten(beat, rasterBeats(st.raster, beatsProTakt(st.projekt?.taktart)))); if (st.slug) ctx.merke(`djk-prod-start-${st.slug}`, String(st.start)); };
  async function transport(aktion) {
    const r = await ctx.holeJson('/proj/transport', aktion === 'start' ? { aktion, beat: st.start } : { aktion });
    const q = r.j?.quittung;
    if (r.status !== 200) ctx.melde(ctx.antwortText(r), true);   // V2 Fix-Runde 2 H5 (Klasse F3): 5xx ohne Grund heißt „Server antwortet nicht“
    else if (q === null) ctx.melde(ctx.fehlerText(r), true);   // der Kern hat nicht geantwortet (warteQuittung abgelaufen): nie stiller Erfolg
    else if (q && [4, 6, 7, 8].includes(q.status)) ctx.melde(ctx.fehlerText({ j: { fehler: q.grund } }), true);
  }
  $('play').addEventListener('click', () => transport('start'));
  $('stopp').addEventListener('click', () => transport('stopp'));
  $('re-enable').addEventListener('click', async () => {
    const r = await ctx.holeJson('/proj/auto/re_enable', { alle: true });
    if (r.status !== 200) ctx.melde(ctx.antwortText(r), true);   // the state comes back through /e/auto: the page does not clear anything itself
  });
  $('tempo').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const v = Number($('tempo').value.replace(',', '.'));
    if (!(v >= 60 && v <= 200)) { ctx.melde(ctx.fehlerText({ j: { fehler: 'tempo_bereich' } }), true); return; }
    $('tempo').blur();
    ctx.aendere(`Tempo ${v}`, [{ befehl: 'tempo_setzen', bpm: v }]);
  });
  // V2 Fix-Runde 2 H1 (Spec 6.34): Umschalter und Klammerzug rechnen aus dem Stand beim Senden (ctx.aendereAus). Vorher trug LOOP die Klammer
  // des alten Stands mit und überschrieb einen Klammerzug, der noch unterwegs war; zwei schnelle Klicks schickten zweimal dasselbe.
  $('loop').addEventListener('click', () => ctx.aendereAus((p) => {
    const l = p.loop;
    return { label: l.an ? 'Loop off' : 'Loop on', befehle: [{ befehl: 'loop_setzen', an: !l.an, von_beat: l.von_beat, bis_beat: l.bis_beat }] };
  }));
  // BAR / TO: a field being typed in keeps its text until the change is sent; nonsense or a refused range ends with the stored range shown again
  const zeigeLoopFelder = () => {
    const l = st.projekt?.loop, frei = (n) => typeof document === 'undefined' || document.activeElement !== $(n);
    const t = l ? loopTakte(l, beatsProTakt(st.projekt?.taktart)) : null;
    if (frei('loop-von')) $('loop-von').value = t ? String(t.vonTakt) : '';
    if (frei('loop-bis')) $('loop-bis').value = t ? String(t.bisTakt) : '';
    for (const n of ['loop-von', 'loop-bis']) $(n).disabled = !st.projekt;
  };
  async function sendeLoopFelder() {
    const k = loopBefehl($('loop-von').value, $('loop-bis').value, beatsProTakt(st.projekt?.taktart));
    if (!k) { ctx.melde(ctx.fehlerText({ j: { fehler: 'argument_ungueltig' } }), true); zeigeLoopFelder(); return; }
    try { await ctx.aendereAus(() => ({ label: 'Loop range', befehle: [k] })); } finally { zeigeLoopFelder(); }
  }
  $('loop-von').addEventListener('change', sendeLoopFelder);
  $('loop-bis').addEventListener('change', sendeLoopFelder);
  $('metronom').addEventListener('click', () => ctx.aendereAus((p) => ({ label: p.metronom.an ? 'Metronome off' : 'Metronome on', befehle: [{ befehl: 'metronom_setzen', an: !p.metronom.an }] })));
  // The one way to put the start marker somewhere by a click: the ruler (x -> beat) and the marker strip (beat) both end here
  ctx.springeZu = (beat, optionen = {}) => { setzeStart(beat, optionen.exakt === true); if (springtImLauf(st.arr, st.arrUnbekannt)) transport('start'); };
  const klickStart = (x) => ctx.springeZu(xZuBeat(st.ansicht, x));
  $('ueber').addEventListener('pointerdown', (e) => { if (e.button === 0 && st.projekt && !e.defaultPrevented) klickStart(e.offsetX); });
  const lineal = $('lineal');
  lineal.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !st.projekt) return;
    lineal.setPointerCapture(e.pointerId);
    // One loop drag: grip from zugGriff ('neu' makes a new range, also inside a bracket that is OFF), b0 = beat where the press began
    const loopZug = (griff, b0) => {
      const alt = st.projekt.loop;
      let b1 = b0;
      const klammer = (l) => ({ an: griff === 'neu' ? true : l.an, ...zieheKlammer(l, griff, b0, b1, rasterBeats(st.raster, beatsProTakt(st.projekt?.taktart))) });
      const bewege = (m) => { b1 = xZuBeat(st.ansicht, m.offsetX); st.loopEntwurf = klammer(alt); };
      const ende = () => {
        const n = st.loopEntwurf; st.loopEntwurf = null;
        if (!n) return;
        // H1: dieselbe Bewegung der Maus auf die Klammer im Stand beim Senden (ein LOOP-Klick davor, der noch unterwegs ist, bleibt erhalten)
        ctx.aendereAus((p) => {
          const l = p.loop, k = klammer(l);
          return k.an !== l.an || k.von_beat !== l.von_beat || k.bis_beat !== l.bis_beat ? { label: 'Loop', befehle: [{ befehl: 'loop_setzen', ...k }] } : null;
        });
      };
      return { bewege, ende };
    };
    if (linealZone(e.offsetY) === 'loop') {
      const z = loopZug(zugGriff(st.ansicht, st.projekt.loop, e.offsetX), xZuBeat(st.ansicht, e.offsetX));
      z.bewege(e);
      zugVerfolgen(lineal, z.bewege, z.ende);
      return;
    }
    // Position zone: a click sets the start marker when the button comes up; a press that moves LINEAL_ZUG_PX becomes a new loop range
    const x0 = e.offsetX;
    let z = null;
    zugVerfolgen(lineal, (m) => {
      if (!z && linealAbsicht('position', Math.abs(m.offsetX - x0)) === 'loop') z = loopZug('neu', xZuBeat(st.ansicht, x0));
      if (z) z.bewege(m);
    }, () => { if (z) z.ende(); else klickStart(x0); });
  });
  ctx.beimProjekt.push((p, wechsel) => {
    if (wechsel) st.start = Number(ctx.lies(`djk-prod-start-${st.slug}`, 0)) || 0;
    if (document.activeElement !== $('tempo')) $('tempo').value = p ? String(p.tempo_bpm) : '';
    for (const [n, an] of [['loop', !!p?.loop?.an], ['metronom', !!p?.metronom?.an]]) { $(n).classList.toggle('an', an); $(n).setAttribute('aria-pressed', String(an)); }
    for (const n of ['play', 'stopp', 'loop', 'metronom', 'tempo']) $(n).disabled = !p;
    zeigeLoopFelder();
    const ueber = reEnableAn(st.autoUeber);   // orange and active only from the server list (D5, D8)
    $('re-enable').disabled = !ueber; $('re-enable').classList.toggle('ueber', ueber);
  });
  let arrZeit = null, unbekannt = false;
  // the text is cut to 16 characters in a narrow window (production.css): the title keeps all of it
  const kernAnzeige = (t) => { setzeText($('kern'), t); $('kern').title = t; };   // title equals the text (layout audit)
  ctx.beimEreignis.push((a, f) => {
    if (a !== '/zustand/arr') return;
    st.arr = f; arrZeit = performance.now();
    kopf.melde(Number(f.projekt_beat), ctx.bpm(), arrZeit, f.status === 2);
    kernAnzeige(kernText(f));
    $('limiter').hidden = !limiterAn(f);
    $('play').classList.toggle('an', f.status === 1 || f.status === 2);
  });
  ctx.vorBild.push((t0) => {
    const s = kopfStand({ arr: st.arr, arrZeit, t: t0, hochrechne: (t) => kopf.beat(t), loop: st.projekt?.loop });
    st.kopfBeat = s.kopfBeat; st.arrUnbekannt = s.unbekannt;
    if (s.unbekannt !== unbekannt) {          // beim Wechsel: Anzeige „unbekannt“ setzen, bei der nächsten Meldung schreibt der Ereignis-Haken wieder
      unbekannt = s.unbekannt;
      if (unbekannt) { kernAnzeige(KERN_UNBEKANNT); $('play').classList.remove('an'); $('limiter').hidden = true; }
      else if (st.arr) kernAnzeige(kernText(st.arr));
    }
    if (st.kopfBeat !== null && st.follow) { const b0 = folgeSeite(st.ansicht, st.kopfBeat, ctx.breite()); if (b0 !== null) st.ansicht = { ...st.ansicht, beat0: b0 }; }
    setzeText($('position'), positionText(st.kopfBeat ?? st.start, beatsProTakt(st.projekt?.taktart)));
  });
}
