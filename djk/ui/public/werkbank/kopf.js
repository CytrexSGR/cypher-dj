// Workbench region TOP BAR (plan task 3): module name, PLAY, STOP, UNDO, REDO, BPM, LENGTH. Pure helpers first (tested), the binder below.
// F1: the server always starts on the next master bar, and a tempo change before it adds a ramp; the page shows its own waiting state (R3).
import { springtImLauf } from '../production/transport.js';
import { undoStand, labelText } from '../production/history.js';
import { nurJuengste } from '../production/load.js';
import { fehlerText } from '../production/production.js';
import { WERKBANK_TEXT } from './werkbank.js';

export const LAENGEN = [1, 2, 4, 8, 16, 32, 64, 128];
const MAX_NOTEN = 65536;   // MAX_NOTEN of project/model.ts, notes of the whole project
const BEATS_PRO_TAKT = 4;

// D6: the module length is the project loop 0..bars*4 beats with bars in LAENGEN; anything else is no module length (null).
// While a loop range is set (werkbank.laenge_beats is present) the project loop is the range and the module length is the remembered one.
export const bereichGesetzt = (p) => Number.isFinite(p?.werkbank?.laenge_beats);
export function modulTakte(p) {
  if (bereichGesetzt(p)) { const t = p.werkbank.laenge_beats / BEATS_PRO_TAKT; return LAENGEN.includes(t) ? t : null; }
  const l = p?.loop;
  if (!l || l.an !== true || l.von_beat !== 0) return null;
  const takte = l.bis_beat / BEATS_PRO_TAKT;
  return LAENGEN.includes(takte) ? takte : null;
}
export const laengeBefehl = (takte) => ({ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: takte * BEATS_PRO_TAKT });
// A module always loops. When the project loop is off (switched in PRODUCTION), PLAY would run straight past the end of the
// patterns into silence (found 2026-11-16: "no sound on the bass any more", loop switched off in PRODUCTION). The length PLAY restores: the shortest
// module length that holds the longest pattern (4 bars without a pattern).
export function laengeOhneSchleife(p) {
  let beats = 0;
  for (const s of p?.spuren ?? []) for (const c of s.clips ?? []) if (c.art === 'midi') beats = Math.max(beats, c.loop_beats ?? c.laenge_beats ?? 0);
  if (!(beats > 0)) return 4;
  return LAENGEN.find((n) => n * BEATS_PRO_TAKT >= beats) ?? LAENGEN[LAENGEN.length - 1];
}
// LENGTH n: the module AND the pattern of every track are n bars long. ONE history step: the loop range cleared (when set), the project loop 0..n*4 beats and
// for every MIDI clip of every instrument track `laenge_beats` at least n*4 (never shortened) and `loop_beats` n*4. A pattern that grows keeps sounding as it did:
// its notes before the old end are written as real notes into the copies behind it, so every bar can be edited on its own. Not copied: a clip that already holds
// notes in the new part (an earlier longer state) and the notes of rows with a length of their own (they repeat by their own rule). Shortening only sets
// loop_beats; notes behind it stay in the project and are silent. Copies that would break the note limit of the project are left out (`zuViele`).
// The linked envelopes of a growing clip (PITCH and knob step locks, drawn envelopes) are copied too: a linked envelope repeats with the clip loop and holds its
// last value behind its last point, so without the copies the new bars would play the value of the last point. They go in one `huellkurve_setzen` per envelope
// after the clip_aendern, only when the envelope has no point behind its closing point at the old loop end yet and the copy fits the point limit of an envelope. Unlinked ones repeat by
// their own length and stay. -> { befehle, zuViele }
const NOTEN_FELDER = ['beat', 'laenge', 'ton', 'vel', 'chance', 'wdh', 'versatz'];
const MAX_HK_PUNKTE = 8192;   // MAX_LANE_PUNKTE of project/model.ts, points of one envelope
// The points of a linked envelope over [0, B) when its clip loop grows from P to B: the points before P repeated at every k * P. Each copy starts with a
// `sprung` point (the value that holds before the first point of the original is set explicitly when the first point sits behind beat 0), so a linear segment
// never runs from the end of one copy into the next. A closing point at the old loop end P (SEQ shapes, drawn envelopes) is part of the source: every copy ends with its own, so
// the original closing point and the sprung start of the next copy share the beat k * P (two points). null when the envelope has points in the new part already or the copy
// would not fit (also when the closing point and the start of a copy would be three points on one beat).
function huellkurveKopie(hk, P, B, EPS) {
  const punkte = hk.punkte ?? [];
  if (hk.verknuepft === false || !punkte.length || punkte.some((q) => q.beat > P + EPS && q.beat < B - EPS)) return null;
  const quelle = punkte.filter((q) => q.beat < P - EPS);
  const schluss = punkte.filter((q) => Math.abs(q.beat - P) <= EPS);   // the closing point(s) at the old loop end (SEQ shapes, drawn envelopes)
  if (!quelle.length) return null;
  const aus = [...quelle, ...schluss].map((q) => ({ ...q }));
  const vorn0 = quelle[0].beat > EPS ? 1 : quelle.filter((q) => q.beat <= EPS).length;
  if (schluss.length && vorn0 + schluss.length > 2) return null;   // closing point(s) and the start of the next copy would be three points on one beat
  for (let k = 1; k * P < B - EPS; k++) {
    const vorn = quelle[0].beat > EPS ? [{ beat: 0, wert: quelle[0].wert, form: 'sprung' }] : [];
    const kopie = [...vorn, ...quelle.map((q, i) => (i === 0 && vorn.length === 0 ? { ...q, form: 'sprung' } : { ...q }))];
    for (const q of kopie) {
      const beat = Math.round((q.beat + k * P) * 1e9) / 1e9;
      if (beat < B - EPS) aus.push({ ...q, beat });
    }
    for (const q of schluss) {
      const beat = Math.round((q.beat + k * P) * 1e9) / 1e9;
      if (beat <= B + EPS) aus.push({ ...q, beat: Math.min(beat, B) });
    }
  }
  return aus.length <= MAX_HK_PUNKTE ? aus : null;
}
export function laengeKlickBefehle(p, takte) {
  const B = takte * BEATS_PRO_TAKT, EPS = 1e-9;
  const befehle = [];
  if (bereichGesetzt(p)) befehle.push({ befehl: 'werkbank_bereich', aus: true });
  if (modulTakte(p) !== takte) befehle.push(laengeBefehl(takte));
  const clips = [];
  for (const s of p?.spuren ?? []) if (s.art === 'instrument') for (const c of s.clips ?? []) if (c.art === 'midi') clips.push(c);
  const vorhanden = clips.reduce((n, c) => n + (c.noten?.length ?? 0), 0);
  const kopien = new Map(), huellkopien = new Map();
  let neuZahl = 0;
  for (const c of clips) {
    const P = c.loop_beats ?? c.laenge_beats, liste = [];
    if (P < B - EPS && !(c.noten ?? []).some((n) => n.beat >= P - EPS && n.beat < B - EPS)) {
      const quelle = (c.noten ?? []).filter((n) => n.beat < P - EPS && c.zeilen?.[n.ton]?.schritte == null);
      for (let k = 1; k * P < B - EPS; k++) {
        for (const n of quelle) {
          const beat = Math.round((n.beat + k * P) * 1e9) / 1e9;
          if (beat >= B - EPS) continue;
          const neu = {};
          for (const f of NOTEN_FELDER) if (n[f] !== undefined) neu[f] = f === 'beat' ? beat : n[f];
          liste.push(neu);
        }
      }
    }
    if (liste.length) { kopien.set(c, liste); neuZahl += liste.length; }
  }
  const zuViele = vorhanden + neuZahl > MAX_NOTEN;
  for (const c of clips) {
    const P = c.loop_beats ?? c.laenge_beats;
    if (!(P < B - EPS)) continue;
    const hks = [];
    for (const h of c.huellkurven ?? []) { const punkte = huellkurveKopie(h, P, B, EPS); if (punkte) hks.push({ ziel: h.ziel, punkte }); }
    if (hks.length) huellkopien.set(c, hks);
  }
  for (const c of clips) {
    const aend = {};
    if (c.laenge_beats < B - EPS) aend.laenge_beats = B;
    if (c.loop_beats == null || Math.abs(c.loop_beats - B) > EPS) aend.loop_beats = B;
    if (Object.keys(aend).length) befehle.push({ befehl: 'clip_aendern', clip_id: c.id, ...aend });
    if (!zuViele && kopien.has(c)) befehle.push({ befehl: 'noten_neu', clip_id: c.id, noten: kopien.get(c) });
    for (const h of huellkopien.get(c) ?? []) befehle.push({ befehl: 'huellkurve_setzen', clip_id: c.id, ziel: h.ziel, punkte: h.punkte });
  }
  return { befehle, zuViele };
}
export const schleifeText = (n) => `The loop was off: the module loops over ${n} bar${n === 1 ? '' : 's'} again`;
// A number 60..200 with up to two decimals (comma or point), else null.
export function tempoBefehl(text) {
  const t = String(text ?? '').trim();
  if (!/^\d{2,3}([.,]\d{1,2})?$/.test(t)) return null;
  const bpm = Number(t.replace(',', '.'));
  return bpm >= 60 && bpm <= 200 ? { befehl: 'tempo_setzen', bpm } : null;
}

const KOPF = `
<span class="w-name" data-w="name"></span>
<button data-w="play" class="w-play" title="Play from the start (starts on the next bar)" disabled>▶ PLAY</button>
<button data-w="stopp" title="Stop" disabled>■ STOP</button>
<button data-w="undo" title="Undo (Ctrl+Z)" disabled>UNDO</button>
<button data-w="redo" title="Redo (Ctrl+Shift+Z)" disabled>REDO</button>
<span class="w-etikett">BPM</span><input data-w="bpm" class="w-bpm" inputmode="decimal" autocomplete="off" spellcheck="false" title="Tempo: type a value, Enter sets it" placeholder="–" aria-label="Tempo in BPM" disabled>
<span class="w-etikett">Length</span>${LAENGEN.map((n) => `<button data-w="laenge-${n}" class="w-laenge" aria-pressed="false" title="Length of the module and of every pattern: ${n} bar${n === 1 ? '' : 's'}" disabled>${n}</button>`).join('')}<span class="w-etikett">bars</span>
`;

export function bindeKopf(ctx) {
  const { st, $ } = ctx;
  $('kopf').innerHTML = KOPF;
  const play = $('play'), bpm = $('bpm');

  // The wait is the tempo ramp plus up to one bar and /zustand/arr reports playing only after the start: `wartet` is local. It turns true at the click and
  // ends when the stream reports playing, the request fails, STOP is pressed or another module is shown.
  let wartet = false;
  const zeigePlay = () => {
    const s = st.arr?.status;
    play.classList.toggle('wartet', wartet || s === 1);
    play.classList.toggle('an', s === 2);
    play.setAttribute('aria-pressed', String(s === 2));
  };
  const setzeWartet = (an) => { wartet = an; zeigePlay(); };
  function scheitert(text) { setzeWartet(false); ctx.melde(text, true); }
  async function start() {
    if (!st.projekt || wartet || springtImLauf(st.arr, st.arrUnbekannt)) return;
    setzeWartet(true);
    if (st.projekt.loop?.an !== true) {
      const n = laengeOhneSchleife(st.projekt);
      if (!(await ctx.aendere(`Length ${n} bar${n === 1 ? '' : 's'}`, [laengeBefehl(n)]))) { setzeWartet(false); return; }
      ctx.melde(schleifeText(n));
    }
    const r = await ctx.holeJson('/proj/transport', { aktion: 'start', beat: 0 });
    const q = r.j?.quittung;
    if (r.status !== 200) scheitert(ctx.antwortText(r));
    else if (q === null) scheitert(fehlerText(r));
    else if (q && [4, 6, 7, 8].includes(q.status)) scheitert(fehlerText({ j: { fehler: q.grund } }));
  }
  async function stopp() {
    if (!st.projekt) return;
    setzeWartet(false);
    const r = await ctx.holeJson('/proj/transport', { aktion: 'stopp' });
    if (r.status !== 200) ctx.melde(ctx.antwortText(r), true);
  }
  play.addEventListener('click', start);
  $('stopp').addEventListener('click', stopp);
  $('undo').addEventListener('click', () => ctx.undo());
  $('redo').addEventListener('click', () => ctx.redo());

  const zeigeTempo = () => { bpm.value = st.projekt ? String(st.projekt.tempo_bpm) : ''; };
  bpm.addEventListener('keydown', async (e) => {
    e.stopPropagation();   // the library keys of the page stay out of the field
    if (e.key !== 'Enter') return;
    const b = tempoBefehl(bpm.value);
    if (!b) { zeigeTempo(); ctx.melde(WERKBANK_TEXT.tempoBereich, true); return; }
    bpm.blur();
    try { await ctx.aendere(`Tempo ${b.bpm}`, [b]); } finally { zeigeTempo(); }
  });
  for (const n of LAENGEN) {
    $(`laenge-${n}`).addEventListener('click', () => {
      if (!st.projekt) return;
      // one history step: range off, loop, and the pattern of every track (laengeKlickBefehle)
      const { befehle, zuViele } = laengeKlickBefehle(st.projekt, n);
      if (zuViele) ctx.melde(`The notes would pass the limit of ${MAX_NOTEN} notes: the pattern was not copied into the new bars`, true);
      if (befehle.length) ctx.aendere(`Length ${n} bar${n === 1 ? '' : 's'}`, befehle);
    });
  }

  // UNDO and REDO follow the history of the project; unknown history leaves both usable (the server refuses an empty one with its text).
  let verlauf = null;
  const zeigeVerlauf = () => {
    const u = Array.isArray(verlauf) ? undoStand(verlauf) : null;
    $('undo').disabled = !st.projekt || (u !== null && !u.undo);
    $('redo').disabled = !st.projekt || (u !== null && !u.redo);
    $('undo').title = u?.undo ? `Undo: ${labelText(u.undo.label)} (Ctrl+Z)` : u ? 'Nothing to undo' : 'Undo (Ctrl+Z)';
    $('redo').title = u?.redo ? `Redo: ${labelText(u.redo.label)} (Ctrl+Shift+Z)` : u ? 'Nothing to redo' : 'Redo (Ctrl+Shift+Z)';
  };
  const holeVerlauf = nurJuengste(() => ctx.holeGet('/proj/verlauf'));
  async function ladeVerlauf() {
    const { gilt, r } = await holeVerlauf();
    if (gilt && r.status === 200 && Array.isArray(r.j)) { verlauf = r.j; zeigeVerlauf(); }
  }

  ctx.beimProjekt.push((p, wechsel) => {
    if (wechsel) { wartet = false; verlauf = null; }
    $('name').textContent = p ? p.name : '';
    if (document.activeElement !== bpm) zeigeTempo();
    const takte = modulTakte(p);
    for (const n of LAENGEN) { const b = $(`laenge-${n}`); b.classList.toggle('an', takte === n); b.setAttribute('aria-pressed', String(takte === n)); b.disabled = !p; }
    for (const n of ['play', 'stopp', 'bpm']) $(n).disabled = !p;
    zeigePlay(); zeigeVerlauf();
    if (p) ladeVerlauf();
  });
  ctx.beimEreignis.push((a, f) => {
    if (a !== '/zustand/arr') return;
    if (f.status === 2) wartet = false;   // playing: the wait is over
    zeigePlay();
  });
}
