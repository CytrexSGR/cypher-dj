// TRACKER view, keyboard and transport (plan 2026-11-18-tracker.md, task 6). The binder hangs one key hook on ctx.beimTaste: the key map is tasten.js (pure),
// the writes are the builders of eingabe.js and auswahl.js (pure), this file only wires them to the grid, the bar and the transport.
//
// Rules: every write goes through ctx.aendereAus((p) => builder(p, ...)), so a builder computes on the newest project at its turn; one key press = one
// request = one undo step. A builder { fehler } is shown in the message line and nothing is sent. EDIT off: note keys only sound and nothing writes.
// Sounding a note: POST /sampler/hoeren { spur_id, ton } (a refusal text comes back in r.j.text). Transport: POST /proj/transport { aktion: 'start', beat }
// / { aktion: 'stopp' }; PATTERN mode sets the project loop to the section with loop_setzen first, only when it differs (D20).
import { taste as tastenAktion } from './tasten.js';
import { noteSchreiben, notenAus, wertSetzen, zelleLeeren, zeileEntfernen, zeileEinfuegen, fxSetzen, knopfWert } from './eingabe.js';
import { erweitere, allesWahl, kopiere, einsetzen, ausschneiden, duplizieren, interpoliere, transponiere } from './auswahl.js';
import { abschnitte, projiziere, trackerEinstellung, FX_CODES } from './grid_model.js';
import { schluesselZuCursor } from './grid_view.js';
import { fehlerText } from '../production/production.js';

export const BEDIENUNG_TEXT = {
  editAus: 'EDIT is off: press Escape or click EDIT to type into the grid',
  keinKlang: 'The pitch is outside C-0..G-8 and is not sounded',
  tempo: 'Tempo: a number from 60 to 200',
  okt: 'OCT: a whole number from 0 to 8',
  schritt: 'STEP: a whole number from 0 to 16',
  zwischenablageLeer: 'The clipboard is empty',
  audio: 'Audio track: it takes no notes or values',
  fxNurSpalte: 'Effect commands stand in the first four effect columns',
  fxErstName: 'Type the effect name first, for example VIB46',
  knopfBereich: 'Knob 01..64 expected',
  knopfBelegt: 'This cell holds an effect command, a curve or another knob: clear it first (Delete)',
  ticks: 'TICKS: a whole number from 1 to 24',
};
export const OKT_MAX = 8, SCHRITT_MAX = 16, TICKS_MAX = 24;
const WERT_SPALTEN = ['vol', 'dly', 'chn', 'rpt', 'ins'];
const ZIFFERN = { vol: (zahlen) => (zahlen === 'dec' ? 3 : 2), chn: () => 2, rpt: () => 1, dly: () => 2, ins: () => 2 };

// does a selection cover a grid cell (c = cursor-like { spur, spalte, zeile, unterspalte, fxspalte? })? One note column covers all its sub-columns.
export function inAuswahl(a, c) {
  if (!a || c.spur < a.spur_von || c.spur > a.spur_bis || c.zeile < a.zeile_von || c.zeile > a.zeile_bis) return false;
  if (a.spalten !== 'eine') return true;
  if (a.unterspalte === 'fx') return c.unterspalte === 'fx' && (c.fxspalte ?? 0) === (a.fxspalte ?? 0);
  return c.unterspalte !== 'fx' && (c.spalte ?? 0) === (a.spalte ?? 0);
}

const ortSchluessel = (c) => `${c.spur}:${c.spalte ?? 0}:${c.zeile}:${c.unterspalte}:${c.fxspalte ?? ''}`;
const zwei = (n) => String(n).padStart(2, '0');

export function bindeBedienung(ctx) {
  const { st, $ } = ctx;
  st.edit = false; st.okt = 3; st.schritt = 1;
  st.modus = ctx.lies('djk-tr-modus', 'pattern') === 'song' ? 'song' : 'pattern';
  let puffer = null;            // the digits typed into the cell under the cursor: { key, u, text, neg }; in an effect cell { key, u: 'fx', befehl, text }
  let auswahl = null;           // the selection (auswahl.js)
  let ablage = null;            // the clipboard of this page
  let unterwegs = false;        // a start is being prepared
  const letzteVol = new Map();  // spur_id -> the last VOL typed on that track in this session (D3)
  const eigeneLoops = new Map();
  const grid = $('raster');

  // --- the bar ---
  for (const n of ['play', 'stopp', 'modus', 'bpm', 'lpb', 'ticks', 'okt', 'schritt', 'edit']) $(n).disabled = false;
  const laeuft = () => st.arr?.status === 1 || st.arr?.status === 2;
  function zeigeKopf() {
    const setze = (t, an) => { const b = $(t); b.setAttribute('aria-pressed', String(an)); b.classList.toggle('an', an); };
    setze('edit', st.edit);
    if (st.edit && st.editHinweis) { st.editHinweis = false; ctx.zeigeStatus?.(); }   // EDIT is on now: the status line drops the reminder
    setze('play', st.arr?.status === 2);
    $('modus').textContent = st.modus === 'song' ? 'SONG' : 'PATTERN';
    $('okt').value = String(st.okt); $('schritt').value = String(st.schritt);
  }
  const abschnittNummer = (a) => (st.zahlen === 'dec' ? zwei(a.nr) : a.nr.toString(16).toUpperCase().padStart(2, '0'));

  // --- selection marks ---
  // only the cells of the selection are visited (and the ones marked before): a 24 000 cell grid is never scanned as a whole
  let markiert = [];
  function markiere() {
    for (const e of markiert) e.classList.remove('gewaehlt');
    markiert = [];
    if (auswahl === null) return;
    for (let z = auswahl.zeile_von; z <= auswahl.zeile_bis; z++) {
      for (const e of ctx.zeilenEl(z)?.querySelectorAll('.t-c') ?? []) {
        const k = e.getAttribute('data-k');
        if (k !== null && inAuswahl(auswahl, schluesselZuCursor(k))) { e.classList.add('gewaehlt'); markiert.push(e); }
      }
    }
  }
  function loeseAuswahl() { if (auswahl) { auswahl = null; markiere(); } }
  ctx.beimZeichnen.push(() => {
    const r = ctx.raster();
    if (auswahl && (!r || auswahl.abschnitt_id !== st.abschnitt_id || auswahl.spur_bis >= r.spuren.length || auswahl.zeile_bis >= r.zeilen)) auswahl = null;
    markiere(); zeigeKopf();
  });
  ctx.beimProjekt.push((p, wechsel) => { if (wechsel) { auswahl = null; puffer = null; } });
  ctx.beimEreignis.push((a) => { if (a === '/zustand/arr') zeigeKopf(); });

  // a moved cursor drops the pending digits and the selection
  const setze0 = ctx.setzeCursor;
  ctx.setzeCursor = (c, o) => {
    const alt = ortSchluessel(st.cursor);
    setze0(c, o);
    if (ortSchluessel(st.cursor) !== alt) { puffer = null; loeseAuswahl(); }
  };

  // --- writing ---
  // rechne(p) -> { label, befehle, ... } | { fehler } | null, computed on the newest project at its turn
  function schreibe(rechne) {
    return ctx.aendereAus((p) => {
      let r;
      try { r = rechne(p); } catch (e) { r = { fehler: e.message }; }
      if (!r) return null;
      if (r.fehler) { ctx.melde(r.fehler, true); return null; }
      if (r.verworfen > 0) ctx.melde(`${r.verworfen} cell${r.verworfen === 1 ? '' : 's'} pushed past the section end ${r.verworfen === 1 ? 'was' : 'were'} dropped`);
      return r;
    });
  }
  const ortVon = (r, c = st.cursor) => ({
    abschnitt_id: st.abschnitt_id, spur_id: r.spuren[c.spur].spur_id, spalte: c.spalte ?? 0, zeile: c.zeile, unterspalte: c.unterspalte,
    ...(c.fxspalte !== undefined ? { fxspalte: c.fxspalte } : {}),
  });
  function zelleNote(p, o) {
    try { return projiziere(p, { abschnitt_id: o.abschnitt_id }).spuren.find((s) => s.spur_id === o.spur_id)?.notenspalten[o.spalte]?.[o.zeile]?.note ?? null; } catch { return null; }
  }
  // a note key with EDIT off: the reminder stays in the status line until EDIT is on, and the EDIT button flashes once
  let blitzUhr = null;
  function editErinnere() {
    st.editHinweis = true; ctx.zeigeStatus?.();
    const b = $('edit'); b.classList.add('blitz');
    clearTimeout(blitzUhr); blitzUhr = setTimeout(() => b.classList.remove('blitz'), 700); blitzUhr?.unref?.();
  }
  function schreibbar() {
    if (st.edit) return true;
    ctx.melde(BEDIENUNG_TEXT.editAus); editErinnere();
    return false;
  }
  const hoere = (spur_id, ton) => ctx.holeJson('/sampler/hoeren', { spur_id, ton }).then((r) => {
    if (r.status !== 200) ctx.melde(r.j?.text ?? ctx.antwortText(r), true);
  });
  const gehe = (r, n) => ctx.setzeCursor({ ...st.cursor, zeile: Math.min(r.zeilen - 1, st.cursor.zeile + n) });
  const wahl = (r) => auswahl ?? erweitere(null, st.cursor, 0, 0, r);

  // --- value digits ---
  function ziffer(a, r, s) {
    const u = st.cursor.unterspalte;
    if (!WERT_SPALTEN.includes(u) || s.art === 'audio') return false;     // effect typing comes with a later task
    if (!schreibbar()) return true;
    const key = ortSchluessel(st.cursor);
    if (!puffer || puffer.key !== key) puffer = { key, u, text: '', neg: false };
    if (a.art === 'vorzeichen') { puffer.neg = !puffer.neg; ctx.melde(`${u.toUpperCase()} ${puffer.neg ? '-' : ''}${puffer.text}_`); return true; }
    puffer.text += a.wert.toString(16).toUpperCase();
    if (puffer.text.length < ZIFFERN[u](st.zahlen)) { ctx.melde(`${u.toUpperCase()} ${puffer.neg ? '-' : ''}${puffer.text}_`); return true; }
    let wert = u === 'vol' && st.zahlen !== 'dec' ? parseInt(puffer.text, 16) : parseInt(puffer.text, 10);
    if (u === 'dly') wert = wert === 0 ? null : (puffer.neg ? -wert : wert);        // 00 clears the delay
    if (u === 'ins' && wert === 0) wert = null;                                       // 00 clears the slot
    puffer = null;
    const o = ortVon(r), spur_id = o.spur_id;
    schreibe((p) => {
      const x = wertSetzen(p, o, u, wert);
      if (x && !x.fehler && u === 'vol' && wert >= 1 && wert <= 127) letzteVol.set(spur_id, wert);
      return x;
    });
    return true;
  }

  // --- effect cells: three letters (the command), then two hex digits (three in DEC) ---
  const fxWort = () => (puffer?.u === 'fx' && puffer.key === ortSchluessel(st.cursor) ? puffer : null);
  function fxEingabe(a, r, s) {
    if (s.art === 'audio' || st.cursor.unterspalte !== 'fx') return false;
    if (!schreibbar()) return true;
    const key = ortSchluessel(st.cursor);
    if (!puffer || puffer.key !== key || puffer.u !== 'fx') puffer = { key, u: 'fx', befehl: '', text: '' };
    if (a.art === 'buchstabe' && a.zeichen === 'K') return knopfStart(key, r, s);
    if (puffer.befehl[0] === 'K') return knopfZiffer(a, key, r);
    if ((st.cursor.fxspalte ?? 0) > 3) { puffer = null; ctx.melde(BEDIENUNG_TEXT.fxNurSpalte, true); return true; }
    if (a.art === 'buchstabe') {
      if (puffer.befehl.length === 3) puffer = { key, u: 'fx', befehl: '', text: '' };    // a new word
      puffer.befehl += a.zeichen;
      if (puffer.befehl.length < 3) { ctx.melde(`${puffer.befehl}_`); return true; }
      if (!FX_CODES.includes(puffer.befehl)) {
        const f = fxSetzen(st.projekt, ortVon(r), puffer.befehl, 0);                      // the builder owns the refusal text
        puffer = null; ctx.melde(f?.fehler ?? '', true);
        return true;
      }
      ctx.melde(`${puffer.befehl} __`);
      return true;
    }
    if (puffer.befehl.length < 3) { puffer = null; ctx.melde(BEDIENUNG_TEXT.fxErstName, true); return true; }
    puffer.text += a.wert.toString(16).toUpperCase();
    const n = st.zahlen === 'dec' ? 3 : 2;
    if (puffer.text.length < n) { ctx.melde(`${puffer.befehl} ${puffer.text}_`); return true; }
    const code = puffer.befehl, wert = parseInt(puffer.text, st.zahlen === 'dec' ? 10 : 16), o = ortVon(r);
    puffer = null;
    schreibe((p) => fxSetzen(p, o, code, wert));
    return true;
  }

  // a knob value: K, two decimal digits (01..64), then the value (two hex digits, three in DEC); the buffer holds 'K', 'K1', 'K12' as its word.
  // The point is written into the knob's envelope and the page shows it in the first free column of the row, so the cell under the cursor must
  // be empty (or hold this very knob); a command, a curve or another knob there is refused.
  function knopfStart(key, r, s) {
    const zelle = s.fxspalten[st.cursor.fxspalte ?? 0]?.[st.cursor.zeile];
    puffer = { key, u: 'fx', befehl: 'K', text: '', zelle: zelle ?? null };
    ctx.melde('K__ __');
    return true;
  }
  function knopfZiffer(a, key, r) {
    if (a.art !== 'ziffer') { puffer = null; return true; }
    const q = puffer;
    if (q.befehl.length < 3) {
      q.befehl += String(a.wert);
      if (q.befehl.length < 3) { ctx.melde(`${q.befehl}_`); return true; }
      const n = Number(q.befehl.slice(1));
      if (n < 1 || n > 64) { puffer = null; ctx.melde(BEDIENUNG_TEXT.knopfBereich, true); return true; }
      if (q.zelle && (q.zelle.kurve || q.zelle.code !== undefined || q.zelle.knopf !== n)) { puffer = null; ctx.melde(BEDIENUNG_TEXT.knopfBelegt, true); return true; }
      ctx.melde(`${q.befehl} __`);
      return true;
    }
    q.text += a.wert.toString(16).toUpperCase();
    const stellen = st.zahlen === 'dec' ? 3 : 2;
    if (q.text.length < stellen) { ctx.melde(`${q.befehl} ${q.text}_`); return true; }
    const knopf = Number(q.befehl.slice(1)), wert = parseInt(q.text, st.zahlen === 'dec' ? 10 : 16), o = ortVon(r);
    puffer = null;
    schreibe((p) => knopfWert(p, o, knopf, wert));
    return true;
  }

  // --- transport ---
  const abschnittAktuell = (p) => abschnitte(p).find((a) => a.id === st.abschnitt_id);
  const loopVon = (a) => ({ von_beat: a.von_beat, bis_beat: a.von_beat + a.laenge_beats });
  const eigenerLoop = () => {
    if (eigeneLoops.has(st.slug)) return eigeneLoops.get(st.slug);
    try { return JSON.parse(ctx.lies(`djk-tr-loop-${st.slug}`, 'null')); } catch { return null; }
  };
  const merkeLoop = (l) => { eigeneLoops.set(st.slug, l); ctx.merke(`djk-tr-loop-${st.slug}`, JSON.stringify(l)); };

  // PATTERN: the project loop is the section (one history step "Loop section NN"), only when it differs
  async function setzeLoop() {
    const p = st.projekt, a = abschnittAktuell(p);
    if (!a) return false;
    const w = loopVon(a), l = p.loop;
    if (l?.an === true && l.von_beat === w.von_beat && l.bis_beat === w.bis_beat) return true;
    const id = a.id;
    const ok = await ctx.aendereAus((q) => {
      const b = abschnitte(q).find((x) => x.id === id);
      return b ? { label: `Loop section ${abschnittNummer(b)}`, befehle: [{ befehl: 'loop_setzen', an: true, ...loopVon(b) }] } : null;
    });
    if (ok) merkeLoop(w);
    return ok;
  }
  // SONG: the loop goes off, but only when it is the section loop the tracker set (a loop of the person stays)
  async function loeseLoop() {
    const l = st.projekt.loop, e = eigenerLoop();
    if (!(l?.an === true && e && l.von_beat === e.von_beat && l.bis_beat === e.bis_beat)) return true;
    const ok = await ctx.aendereAus((q) => (q.loop?.an === true
      ? { label: 'Loop off', befehle: [{ befehl: 'loop_setzen', an: false, von_beat: q.loop.von_beat, bis_beat: q.loop.bis_beat }] } : null));
    if (ok) merkeLoop(null);
    return ok;
  }
  function meldeTransport(r) {
    const q = r.j?.quittung;
    if (r.status !== 200) ctx.melde(ctx.antwortText(r), true);
    else if (q === null) ctx.melde(fehlerText(r), true);
    else if (q && [4, 6, 7, 8].includes(q.status)) ctx.melde(fehlerText({ j: { fehler: q.grund } }), true);
  }
  async function stoppe() {
    if (!st.projekt) return;
    meldeTransport(await ctx.holeJson('/proj/transport', { aktion: 'stopp' }));
  }
  // abZeile: from the cursor row; schleife: the PATTERN loop of the section whatever the mode is
  async function spiele({ abZeile = false, schleife = false } = {}) {
    const r = ctx.raster();
    if (unterwegs || !st.projekt || !r) return;
    unterwegs = true;
    try {
      const a = abschnittAktuell(st.projekt);
      if (!a) return;
      const beat = abZeile ? a.von_beat + st.cursor.zeile / r.lpb : a.von_beat;
      if (!(await (schleife || st.modus === 'pattern' ? setzeLoop() : loeseLoop()))) return;
      meldeTransport(await ctx.holeJson('/proj/transport', { aktion: 'start', beat }));
    } finally { unterwegs = false; }
  }
  $('play').addEventListener('click', () => spiele());
  $('stopp').addEventListener('click', () => stoppe());
  $('modus').addEventListener('click', () => { st.modus = st.modus === 'song' ? 'pattern' : 'song'; ctx.merke('djk-tr-modus', st.modus); zeigeKopf(); });
  $('edit').addEventListener('click', () => { st.edit = !st.edit; zeigeKopf(); });

  // --- bar fields ---
  const ganz = (text, max) => (/^\d{1,2}$/.test(String(text).trim()) && Number(text) <= max ? Number(text) : null);
  $('okt').addEventListener('change', () => {
    const n = ganz($('okt').value, OKT_MAX);
    if (n === null) ctx.melde(BEDIENUNG_TEXT.okt, true); else st.okt = n;
    zeigeKopf();
  });
  $('schritt').addEventListener('change', () => {
    const n = ganz($('schritt').value, SCHRITT_MAX);
    if (n === null) ctx.melde(BEDIENUNG_TEXT.schritt, true); else st.schritt = n;
    zeigeKopf();
  });
  $('ticks').addEventListener('change', async () => {
    const neu = Number($('ticks').value);
    if (!st.projekt || !Number.isInteger(neu) || neu < 1 || neu > TICKS_MAX) { ctx.melde(BEDIENUNG_TEXT.ticks, true); ctx.zeichne(); return; }
    if (neu === trackerEinstellung(st.projekt).ticks) { ctx.zeichne(); return; }
    try { await ctx.aendere(`TICKS ${neu}`, [{ befehl: 'tracker_setzen', ticks: neu }]); } finally { ctx.zeichne(); }
  });
  $('bpm').addEventListener('change', async () => {
    const text = String($('bpm').value).trim().replace(',', '.');
    const bpm = /^\d{2,3}(\.\d{1,2})?$/.test(text) ? Number(text) : NaN;
    if (!(bpm >= 60 && bpm <= 200)) { ctx.melde(BEDIENUNG_TEXT.tempo, true); ctx.zeichne(); return; }
    try { await ctx.aendere(`Tempo ${bpm}`, [{ befehl: 'tempo_setzen', bpm }]); } finally { ctx.zeichne(); }
  });
  $('lpb').addEventListener('change', async () => {
    const neu = Number($('lpb').value), r = ctx.raster();
    if (!st.projekt || !r || !Number.isInteger(neu) || neu === r.lpb) { ctx.zeichne(); return; }
    const alt = r.lpb, zeile = st.cursor.zeile;
    const ok = await ctx.aendere(`LPB ${neu}`, [{ befehl: 'tracker_setzen', lpb: neu }]);
    if (ok) { loeseAuswahl(); ctx.setzeCursor({ ...st.cursor, zeile: Math.round(zeile * neu / alt) }); }
    ctx.zeichne();
  });

  // --- the key hook ---
  function behandle(a, r, s) {
    const c = st.cursor, audio = s.art === 'audio';
    switch (a.art) {
      case 'note': {
        if (audio) return true;
        const ton = 12 * (st.okt + 2) + a.halbton;
        const klingt = ton >= 24 && ton <= 127;
        if (klingt) hoere(s.spur_id, ton);
        if (!st.edit) { if (!klingt) ctx.melde(BEDIENUNG_TEXT.keinKlang, true); else { ctx.melde(BEDIENUNG_TEXT.editAus); editErinnere(); } return true; }   // sounds, writes nothing: say why
        const o = ortVon(r), vel = letzteVol.get(s.spur_id);
        const platz = ctx.platzVon?.(o.spur_id);   // the slot chosen in INSTRUMENTS, for tracks whose device has slots
        schreibe((p) => noteSchreiben(p, o, ton, { akkord: a.akkord, ...(platz ? { platz } : {}),
          ...(vel !== undefined && (a.akkord || !zelleNote(p, o)) ? { vel } : {}) }));
        if (klingt && !a.akkord && st.schritt > 0) gehe(r, st.schritt);
        return true;
      }
      case 'aus': {
        if (audio) return true;
        if (!schreibbar()) return true;
        const o = ortVon(r);
        schreibe((p) => notenAus(p, o));
        if (st.schritt > 0) gehe(r, st.schritt);
        return true;
      }
      case 'buchstabe': return fxEingabe(a, r, s);
      case 'ziffer': case 'vorzeichen': return c.unterspalte === 'fx' ? (a.art === 'ziffer' && fxEingabe(a, r, s)) : ziffer(a, r, s);
      case 'schritt': st.schritt = Math.min(SCHRITT_MAX, Math.max(0, st.schritt + a.d)); zeigeKopf(); return true;
      case 'oktave': st.okt = Math.min(OKT_MAX, Math.max(0, st.okt + a.d)); zeigeKopf(); return true;
      case 'auswahl': auswahl = erweitere(auswahl, c, a.dz, a.ds, r); markiere(); return true;
      case 'alles': auswahl = allesWahl(auswahl, c, r); markiere(); return true;
      case 'escape':
        if (puffer) { puffer = null; return true; }
        if (auswahl) { loeseAuswahl(); return true; }
        st.edit = !st.edit; zeigeKopf();
        return true;
      case 'kopieren': {
        const k = kopiere(st.projekt, wahl(r));
        if (k?.fehler) { ctx.melde(k.fehler, true); return true; }
        ablage = k; ctx.melde(`Copied ${k.zeilen} row${k.zeilen === 1 ? '' : 's'}`);
        return true;
      }
      case 'ausschneiden': {
        if (!schreibbar()) return true;
        const w = wahl(r);
        schreibe((p) => { const x = ausschneiden(p, w); if (x && !x.fehler) ablage = x.ablage; return x; });
        return true;
      }
      case 'einsetzen': {
        if (!schreibbar()) return true;
        if (!ablage) { ctx.melde(BEDIENUNG_TEXT.zwischenablageLeer, true); return true; }
        const o = ortVon(r), z = ablage;
        schreibe((p) => einsetzen(p, o, z));
        return true;
      }
      case 'duplizieren': { if (!schreibbar()) return true; const w = wahl(r); schreibe((p) => duplizieren(p, w)); return true; }
      case 'interpolieren': { if (!schreibbar()) return true; const w = wahl(r); schreibe((p) => interpoliere(p, w)); return true; }
      case 'transponieren': { if (!schreibbar()) return true; const w = auswahl ?? ortVon(r); schreibe((p) => transponiere(p, w, a.d)); return true; }
      case 'leeren': {
        if (!schreibbar()) return true;
        const o = ortVon(r), w = auswahl;
        schreibe((p) => {
          if (!w) return zelleLeeren(p, o);
          const x = ausschneiden(p, w);                       // the clipboard stays as it is
          return x && !x.fehler ? { label: 'Clear selection', befehle: x.befehle } : x;
        });
        return true;
      }
      case 'rueck': { if (!schreibbar()) return true; const o = ortVon(r); schreibe((p) => zeileEntfernen(p, o)); return true; }
      case 'einfuegen': { if (!schreibbar()) return true; const o = ortVon(r); schreibe((p) => zeileEinfuegen(p, o)); return true; }
      case 'spielen': case 'schleife': if (laeuft()) stoppe(); else spiele({ schleife: a.art === 'schleife' }); return true;
      case 'ab_zeile': spiele({ abZeile: true }); return true;
      default: return false;       // cursor keys belong to the grid; undo and redo to the page handler of tracker.js
    }
  }

  ctx.beimTaste.push((e) => {
    const r = ctx.raster();
    const s = st.projekt && r ? r.spuren[st.cursor.spur] : null;
    if (!s) return false;
    const a = tastenAktion(e, { unterspalte: s.art === 'audio' ? 'note' : st.cursor.unterspalte, zahlen: st.zahlen, fxteil: fxWort()?.befehl.length === 3 ? 'wert' : 'befehl' });
    if (!a || !behandle(a, r, s)) return false;
    e.preventDefault?.();
    return true;
  });
  zeigeKopf();
}
