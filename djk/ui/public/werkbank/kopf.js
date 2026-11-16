// Workbench region TOP BAR (plan task 3): module name, PLAY, STOP, UNDO, REDO, BPM, LENGTH. Pure helpers first (tested), the binder below.
// F1: the server always starts on the next master bar, and a tempo change before it adds a ramp; the page shows its own waiting state (R3).
import { springtImLauf } from '../production/transport.js';
import { undoStand } from '../production/history.js';
import { nurJuengste } from '../production/load.js';
import { fehlerText } from '../production/production.js';
import { WERKBANK_TEXT } from './werkbank.js';

export const LAENGEN = [1, 2, 4, 8, 16];
const BEATS_PRO_TAKT = 4;

// D6: the module length is the project loop 0..bars*4 beats with bars in LAENGEN; anything else is no module length (null).
export function modulTakte(p) {
  const l = p?.loop;
  if (!l || l.an !== true || l.von_beat !== 0) return null;
  const takte = l.bis_beat / BEATS_PRO_TAKT;
  return LAENGEN.includes(takte) ? takte : null;
}
export const laengeBefehl = (takte) => ({ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: takte * BEATS_PRO_TAKT });
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
<span class="w-etikett">BPM</span><input data-w="bpm" class="w-bpm" inputmode="decimal" autocomplete="off" spellcheck="false" title="Tempo: type a value, Enter sets it" aria-label="Tempo in BPM" disabled>
<span class="w-etikett">Length</span>${LAENGEN.map((n) => `<button data-w="laenge-${n}" class="w-laenge" aria-pressed="false" title="Module length: ${n} bar${n === 1 ? '' : 's'}" disabled>${n}</button>`).join('')}<span class="w-etikett">bars</span>
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
    $(`laenge-${n}`).addEventListener('click', () => { if (st.projekt && modulTakte(st.projekt) !== n) ctx.aendere(`Length ${n} bar${n === 1 ? '' : 's'}`, [laengeBefehl(n)]); });
  }

  // UNDO and REDO follow the history of the project; unknown history leaves both usable (the server refuses an empty one with its text).
  let verlauf = null;
  const zeigeVerlauf = () => {
    const u = Array.isArray(verlauf) ? undoStand(verlauf) : null;
    $('undo').disabled = !st.projekt || (u !== null && !u.undo);
    $('redo').disabled = !st.projekt || (u !== null && !u.redo);
    $('undo').title = u?.undo ? `Undo: ${u.undo.label} (Ctrl+Z)` : u ? 'Nothing to undo' : 'Undo (Ctrl+Z)';
    $('redo').title = u?.redo ? `Redo: ${u.redo.label} (Ctrl+Shift+Z)` : u ? 'Nothing to redo' : 'Redo (Ctrl+Shift+Z)';
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
