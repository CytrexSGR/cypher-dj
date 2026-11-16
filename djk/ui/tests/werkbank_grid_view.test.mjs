// Workbench task 7: the NOTES region (grid_view.js) through bindeWerkbank against the DOM stand-in. The pure model is tested in werkbank_grid.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');

// The D3 template tracks (40 drum notes, 48 bass notes), pattern 16 beats in a clip of 64 beats.
function spuren(muster = 16) {
  let n = 0;
  const id = () => `n${++n}`;
  const dn = [], bn = [];
  for (let b = 0; b < 16; b++) dn.push({ id: id(), beat: b, laenge: 0.125, ton: 36, vel: 120 });
  for (let t = 0; t < 4; t++) for (const b of [1, 3]) dn.push({ id: id(), beat: t * 4 + b, laenge: 0.125, ton: 39, vel: 105 });
  for (let b = 0; b < 16; b++) dn.push({ id: id(), beat: b + 0.5, laenge: 0.125, ton: 42, vel: 90 });
  for (let b = 0; b < 16; b++) for (const [o, vel] of [[0.25, 96], [0.5, 112], [0.75, 96]]) bn.push({ id: id(), beat: b + o, laenge: 0.25, ton: b < 8 ? 40 : b < 12 ? 43 : 38, vel });
  const clip = (nm, noten) => ({ id: `c_${nm}`, art: 'midi', name: nm, start_beat: 0, laenge_beats: 64, loop_beats: muster, noten: noten.filter((x) => x.beat < muster) });
  const spur = (nr, name, graph, noten) => ({ id: `s${nr}`, nr, name, farbe: '#2fd6c3', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph, parameter: {} }, clips: [clip(name, noten)] });
  return { drums: spur(1, 'Drums', 'drums-909', dn), bass: spur(2, 'Bass', 'bass-banddrive', bn) };
}
const projektMit = (liste, { rev = 1, takte = 4 } = {}) => ({ name: 'M', rev, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: takte * 4 }, spuren: liste });
const KLAENGE = [{ ton: 36, name: 'Kick' }, { ton: 38, name: 'Snare' }, { ton: 39, name: 'Clap' }, { ton: 42, name: 'Closed Hat' }];
const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
let wurzel, w, projekt;
const $w = (n) => wurzel.querySelector(`[data-w="${n}"]`);
const alle = (n) => wurzel.querySelectorAll(`[data-w="${n}"]`);
function aufbau(p, { klaenge = [], art = 'bk', frage = () => true, wahl, schnitt } = {}) {
  projekt = p;
  installiere({
    speicher: wahl ? { 'djk-wb-wahl-m1': wahl } : {},
    antworten: {
      'GET /proj/aktuell': { j: { slug: 'm1', projekt: p } }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } },
      'GET /seq/geraet': { j: { art, regler: [], klaenge, ...(schnitt ? { schnitt } : {}) } }, 'GET /geraete/panel': { j: {} },
      'POST /proj/aendern': (k) => ({ j: { rev: k.rev + 1, projekt: { ...p, rev: k.rev + 1 } } }),
    },
  });
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage });
}
const schreibt = () => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === '/proj/aendern');
const zelle = (ton, schritt) => alle('zelle').find((z) => Number(z.dataset.ton) === ton && Number(z.dataset.schritt) === schritt);
const wertZelle = (schritt) => alle('wert').find((z) => Number(z.dataset.schritt) === schritt);
const knopf = (a, n) => alle(`r-${a}`).find((b) => n === undefined || Number(b.dataset.n) === n);
const zeigen = async () => { w.zeige(); await ruhe(); };

test('drum grid of the 909: rows from the info, a click toggles through the writer', async () => {
  aufbau(projektMit([spuren().drums]), { klaenge: KLAENGE });
  await zeigen();
  assert.ok($w('r-art').textContent.includes('DRUM GRID · one row per sound'));
  assert.deepEqual(alle('zeilenname').map((z) => z.textContent), ['Kick', 'Snare', 'Clap', 'Closed Hat']);
  assert.equal(alle('zelle').filter((z) => Number(z.dataset.ton) === 36).length, 64, 'VIEW 4 with LENGTH 4: 64 cells per row');
  assert.ok(zelle(36, 0).classList.contains('an'));
  assert.ok(!zelle(36, 1).classList.contains('an'));
  zelle(36, 1).dispatch('click'); await ruhe();
  assert.equal(schreibt().length, 1);
  const s = schreibt()[0].koerper;
  assert.equal(s.label, 'Drums: notes');
  assert.equal(s.befehle[0].befehl, 'noten_neu');
  assert.deepEqual(s.befehle[0].noten.map((n) => [n.beat, n.ton]), [[0.25, 36]]);
  zelle(36, 0).dispatch('click'); await ruhe();
  assert.equal(schreibt().at(-1).koerper.befehle[0].befehl, 'noten_loeschen');
});

test('a shorter pattern repeats pale; a click on a repeat edits the cell it repeats', async () => {
  aufbau(projektMit([spuren(4).drums]), { klaenge: KLAENGE });
  await zeigen();
  assert.ok(!zelle(36, 15).classList.contains('wiederholung'));
  assert.ok(zelle(36, 16).classList.contains('wiederholung'));
  assert.ok(zelle(36, 16).classList.contains('an'), 'the repeat of the kick on step 1');
  zelle(36, 17).dispatch('click'); await ruhe();   // repeats pattern step 1
  const b = schreibt().at(-1).koerper.befehle[0];
  assert.equal(b.befehl, 'noten_neu');
  assert.equal(b.noten[0].beat, 0.25);
});

test('counting rows: BAR and STEP rows, steps 1 5 9 13 emphasised in every row, the bar strip', async () => {
  aufbau(projektMit([spuren().drums], { takte: 16 }), { klaenge: KLAENGE });
  await zeigen();
  assert.deepEqual(alle('r-bar').map((b) => b.textContent), ['BAR 1', 'BAR 2', 'BAR 3', 'BAR 4']);
  assert.deepEqual(alle('r-schritt').slice(0, 16).filter((s) => s.classList.contains('betont')).map((s) => s.textContent), ['1', '5', '9', '13']);
  assert.deepEqual(alle('zelle').filter((z) => Number(z.dataset.ton) === 38 && z.classList.contains('betont')).map((z) => Number(z.dataset.schritt) % 16 + 1).slice(0, 4), [1, 5, 9, 13]);
  assert.equal(alle('r-takt').length, 16, 'the strip holds every bar of the module');
  assert.deepEqual(alle('r-takt').filter((t) => t.classList.contains('betont')).map((t) => t.textContent), ['1', '5', '9', '13']);
  assert.deepEqual(alle('r-takt').filter((t) => t.classList.contains('sichtbar')).map((t) => t.textContent), ['1', '2', '3', '4']);
  alle('r-takt')[9].dispatch('click');
  assert.deepEqual(alle('r-takt').filter((t) => t.classList.contains('sichtbar')).map((t) => t.textContent), ['9', '10', '11', '12']);
});

test('note grid of the bass: wheel moves the window, octave click jumps, FOLD shows three rows', async () => {
  aufbau(projektMit([spuren().bass]), { klaenge: [] });
  await zeigen();
  assert.ok($w('r-art').textContent.includes('NOTE GRID · one row per pitch'));
  const toene = () => alle('zeilenname').map((z) => Number(z.dataset.ton));
  assert.equal(toene().length, 24);
  assert.equal(toene()[0], 59); assert.equal(toene().at(-1), 36);
  assert.equal(alle('zeilenname')[0].textContent, 'B2');
  assert.equal(alle('oktave').length, 8);
  $w('r-ton').dispatch('wheel', { deltaY: -100 });
  assert.equal(toene()[0], 61, 'wheel up raises the window by 2 semitones');
  $w('r-ton').dispatch('wheel', { deltaY: 100 });
  assert.equal(toene()[0], 59);
  alle('oktave').find((o) => o.textContent === '3').dispatch('click');
  assert.equal(toene()[0], 83, 'octave 3 shows C3..B4');
  knopf('fold').dispatch('click');
  assert.deepEqual(toene(), [43, 40, 38]);
  assert.deepEqual(alle('zeilenname').map((z) => z.textContent), ['G1', 'E1', 'D1']);
  assert.equal(alle('oktave').length, 0, 'no octave bar while folded');
  $w('r-ton').dispatch('wheel', { deltaY: -100 });
  assert.deepEqual(toene(), [43, 40, 38], 'the wheel does nothing while folded');
});

test('the wheel does nothing over the drum grid', async () => {
  aufbau(projektMit([spuren().drums]), { klaenge: KLAENGE });
  await zeigen();
  assert.equal($w('r-ton'), null);
  assert.equal(knopf('fold'), undefined, 'FOLD only in the note grid');
});

test('VIEW 1 pages with the arrows and the bar strip (review focus 3)', async () => {
  aufbau(projektMit([spuren().bass], { takte: 4 }), { klaenge: [] });
  await zeigen();
  assert.equal($w('r-fenster').textContent, 'BAR 1 – 4');
  knopf('sicht', 1).dispatch('click');
  assert.equal($w('r-fenster').textContent, 'BAR 1');
  assert.equal(alle('zelle').filter((z) => Number(z.dataset.ton) === 40).length, 16);
  knopf('vor').dispatch('click');
  assert.equal($w('r-fenster').textContent, 'BAR 2');
  alle('r-takt')[3].dispatch('click');
  assert.equal($w('r-fenster').textContent, 'BAR 4');
  knopf('vor').dispatch('click');
  assert.equal($w('r-fenster').textContent, 'BAR 4', 'the arrow does not page past the last bar');
  knopf('zurueck').dispatch('click');
  assert.equal($w('r-fenster').textContent, 'BAR 3');
  assert.equal(globalThis.localStorage.getItem('djk-wb-sicht'), '1', 'VIEW is remembered per browser');
});

test('a module of one bar with VIEW 4 shows one bar and the arrows never page (review focus 3)', async () => {
  aufbau(projektMit([spuren().bass], { takte: 1 }), { klaenge: [] });
  await zeigen();
  assert.equal($w('r-fenster').textContent, 'BAR 1');
  assert.equal(alle('zelle').filter((z) => Number(z.dataset.ton) === 40).length, 16, 'no cell beyond the module');
  assert.equal(alle('r-takt').length, 1);
  knopf('vor').dispatch('click');
  assert.equal($w('r-fenster').textContent, 'BAR 1');
  assert.ok(knopf('muster', 4).classList.contains('zulang'), 'the pattern of 4 bars is longer than the module: amber');
});

test('velocity lane: press at mid height writes about 64 for that step only; a drag sets each cell it enters', async () => {
  const sp = spuren();
  aufbau(projektMit([sp.bass]), { klaenge: [] });
  await zeigen();
  const id = (beat) => sp.bass.clips[0].noten.find((n) => n.beat === beat).id;
  wertZelle(1).dispatch('pointerdown', { clientY: 10 }); await ruhe();
  assert.equal(schreibt().length, 1);
  assert.deepEqual(schreibt()[0].koerper.befehle, [{ befehl: 'noten_aendern', clip_id: 'c_Bass', noten: [{ id: id(0.25), vel: 64 }] }]);
  assert.equal(schreibt()[0].koerper.label, 'Bass: velocity');
  wertZelle(2).dispatch('pointermove', { clientY: 0 }); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'noten_aendern', clip_id: 'c_Bass', noten: [{ id: id(0.5), vel: 127 }] }]);
  wertZelle(3).dispatch('pointerup'); await ruhe();
  const n = schreibt().length;
  wertZelle(0).dispatch('pointermove', { clientY: 5 }); await ruhe();
  assert.equal(schreibt().length, n, 'after the release a move writes nothing');
  assert.ok(wertZelle(1).classList.contains('anders'), 'a value differing from the default is amber');
  // a step without a note: pressing writes nothing and says why
  const m = schreibt().length;
  wertZelle(0).dispatch('pointerdown', { clientY: 10 }); await ruhe();
  assert.equal(schreibt().length, m);
  assert.ok($w('meldung').textContent.includes('no note starts'));
});

test('LENGTH lane (note grid): tabs, writes whole steps; the drum grid has no LENGTH tab', async () => {
  const sp = spuren();
  aufbau(projektMit([sp.bass]), { klaenge: [] });
  await zeigen();
  assert.ok($w('r-hinweis').textContent.includes('of the notes'));
  alle('r-feld').find((b) => b.dataset.feld === 'laenge').dispatch('click');
  wertZelle(1).dispatch('pointerdown', { clientY: 10 }); await ruhe();
  const s = schreibt().at(-1).koerper;
  assert.equal(s.label, 'Bass: length');
  assert.deepEqual(s.befehle[0].noten.map((n) => n.laenge), [2], 'mid height = 8 steps = 2 beats');
  aufbau(projektMit([spuren().drums]), { klaenge: KLAENGE });
  await zeigen();
  assert.deepEqual(alle('r-feld').map((b) => b.dataset.feld), ['vel']);
});

test('velocity lane of the drum grid follows the selected row', async () => {
  const sp = spuren();
  aufbau(projektMit([sp.drums]), { klaenge: KLAENGE });
  await zeigen();
  const id = (ton, beat) => sp.drums.clips[0].noten.find((n) => n.ton === ton && n.beat === beat).id;
  assert.ok($w('r-hinweis').textContent.includes('of the selected row'));
  wertZelle(0).dispatch('pointerdown', { clientY: 10 }); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle[0].noten, [{ id: id(36, 0), vel: 64 }], 'the first row with notes: Kick');
  alle('zeilenname').find((z) => z.textContent === 'Closed Hat').dispatch('click');
  assert.ok(alle('zeilenname').find((z) => z.textContent === 'Closed Hat').classList.contains('gewaehlt'));
  wertZelle(2).dispatch('pointerdown', { clientY: 10 }); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle[0].noten, [{ id: id(42, 0.5), vel: 64 }]);
});

test('shortening the pattern asks with the number of notes; "no" sends nothing (review focus 4)', async () => {
  const fragen = [];
  let antwort = false;
  aufbau(projektMit([spuren().bass]), { klaenge: [], frage: (t) => { fragen.push(t); return antwort; } });
  await zeigen();
  assert.ok(knopf('muster', 4).classList.contains('an'), 'the pattern of 16 beats is 4 bars');
  knopf('muster', 2).dispatch('click'); await ruhe();
  assert.equal(fragen.length, 1);
  assert.ok(fragen[0].includes('24 notes'), fragen[0]);
  assert.ok(fragen[0].includes('behind bar 2'), fragen[0]);
  assert.equal(schreibt().length, 0, '"no" sends nothing');
  antwort = true;
  knopf('muster', 2).dispatch('click'); await ruhe();
  assert.equal(fragen.length, 2);
  assert.equal(schreibt().length, 1);
  const befehle = schreibt()[0].koerper.befehle;
  assert.equal(befehle[0].befehl, 'noten_loeschen');
  assert.equal(befehle[0].ids.length, 24);
  assert.deepEqual(befehle.at(-1), { befehl: 'clip_aendern', clip_id: 'c_Bass', loop_beats: 8 });
});

test('lengthening the pattern asks nothing', async () => {
  const fragen = [];
  aufbau(projektMit([spuren(8).bass]), { klaenge: [], frage: (t) => { fragen.push(t); return true; } });
  await zeigen();
  knopf('muster', 4).dispatch('click'); await ruhe();
  assert.equal(fragen.length, 0);
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'clip_aendern', clip_id: 'c_Bass', loop_beats: 16 }]);
});

test('a locked track draws its notes but a click sends nothing (review focus 5)', async () => {
  const sp = spuren().drums;
  sp.clips.push({ id: 'c_zwei', art: 'midi', name: 'x', start_beat: 64, laenge_beats: 16, loop_beats: 16, noten: [] });
  aufbau(projektMit([sp]), { klaenge: KLAENGE });
  await zeigen();
  assert.ok($w('r-text').textContent.includes("This track's clips are arranged in PRODUCTION; the grid edits a pattern clip from beat 0 over 64 beats."));
  assert.ok(zelle(36, 0).classList.contains('an'), 'the notes are drawn');
  zelle(36, 1).dispatch('click');
  wertZelle(0).dispatch('pointerdown', { clientY: 10 });
  knopf('muster', 2).dispatch('click');
  await ruhe();
  assert.equal(schreibt().length, 0);
});

test('a track without a pattern clip shows a text and no rows', async () => {
  const sp = spuren().bass; sp.clips = [];
  aufbau(projektMit([sp]), { klaenge: [] });
  await zeigen();
  assert.ok($w('r-text').textContent.includes('This track has no pattern clip.'));
  assert.equal(alle('zelle').length, 0);
  assert.equal(schreibt().length, 0);
});

test('the playhead marks the step of kopfBeat', async () => {
  aufbau(projektMit([spuren().drums]), { klaenge: KLAENGE });
  await zeigen();
  const bild = (t = 0) => w.ctx.vorBild.forEach((h) => h(t));
  w.ctx.kopfBeat = () => null; bild();
  assert.equal(alle('zelle').filter((z) => z.classList.contains('kopf')).length, 0, 'nothing without a position');
  w.ctx.kopfBeat = () => 5.0; bild();
  assert.ok(zelle(36, 20).classList.contains('kopf'));
  assert.ok(!zelle(36, 19).classList.contains('kopf'));
  assert.ok(wertZelle(20).classList.contains('kopf'));
  w.ctx.kopfBeat = () => 5.25; bild();
  assert.ok(!zelle(36, 20).classList.contains('kopf'));
  assert.ok(zelle(36, 21).classList.contains('kopf'));
  w.ctx.kopfBeat = () => 21.0; bild();   // beyond the module: wraps (4 bars = 16 beats): beat 5 again
  assert.ok(zelle(36, 20).classList.contains('kopf'));
});

test('the view is redrawn after a project change and shows the new notes', async () => {
  const sp = spuren();
  aufbau(projektMit([sp.drums]), { klaenge: KLAENGE });
  await zeigen();
  assert.ok(!zelle(38, 4).classList.contains('an'));
  const neu = spuren().drums;
  neu.clips[0].noten.push({ id: 'x1', beat: 1, laenge: 0.125, ton: 38, vel: 100 });
  w.ctx.uebernimm('m1', projektMit([neu], { rev: 2 })); await ruhe();
  assert.ok(zelle(38, 4).classList.contains('an'));
});

// ---- SLICE grid (sampler A1 task 6): a cut of 4 slices (0.5, 0.5, 1, 2 beats), pattern 4 beats ----
const SLICE_KLAENGE = [0, 1, 2, 3].map((ton) => ({ ton, name: String(ton + 1) }));
const SCHNITT = { id: 'x', scheiben: 4, laengen_beats: [0.5, 0.5, 1, 2] };
function sliceSpur(noten) {
  return { id: 's1', nr: 1, name: 'Slices', farbe: '#2fd6c3', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'smp-x', parameter: {} },
    clips: [{ id: 'c_s', art: 'midi', name: 's', start_beat: 0, laenge_beats: 64, loop_beats: 4, noten }] };
}
const sliceAufbau = (noten) => aufbau(projektMit([sliceSpur(noten)], { takte: 1 }), { klaenge: SLICE_KLAENGE, schnitt: SCHNITT });

test('the view offers VELOCITY, LENGTH, REVERSE, PITCH for a slice track and marks reversed cells', async () => {
  sliceAufbau([{ id: 'n1', beat: 0, laenge: 0.5, ton: 0, vel: 100 }, { id: 'n2', beat: 0.5, laenge: 0.5, ton: 64 + 1, vel: 100 }]);
  await zeigen();
  assert.ok($w('r-art').textContent.includes('SLICE GRID · one row per slice'));
  assert.deepEqual(alle('zeilenname').map((z) => z.textContent), ['1', '2', '3', '4']);
  assert.deepEqual(alle('r-feld').map((b) => b.textContent), ['VELOCITY', 'LENGTH', 'REVERSE', 'PITCH']);
  assert.ok(zelle(0, 0).classList.contains('an') && !zelle(0, 0).classList.contains('w-rueck'));
  assert.ok(zelle(1, 2).classList.contains('an') && zelle(1, 2).classList.contains('w-rueck'), 'the reversed hit is on row 2 with its mark');
  assert.ok(!zelle(1, 0).classList.contains('an'));
  assert.ok($w('r-hinweis').textContent.includes('on all rows'), 'the value lanes of a slice grid are not one row');
  // the track list chip
  assert.equal(alle('spur-art')[0].textContent, 'SLICE');
});

test('slice grid: a click on an empty cell adds the slice length, on a hit removes it; a reversed hit is removed and nothing is added', async () => {
  sliceAufbau([{ id: 'n2', beat: 0.5, laenge: 0.5, ton: 64 + 1, vel: 100 }]);
  await zeigen();
  zelle(3, 4).dispatch('click'); await ruhe();   // slice 4 is 2 beats = 8 steps
  assert.equal(schreibt().length, 1);
  assert.equal(schreibt()[0].koerper.label, 'Slices: notes');
  assert.deepEqual(schreibt()[0].koerper.befehle, [{ befehl: 'noten_neu', clip_id: 'c_s', noten: [{ beat: 1, laenge: 2, ton: 3, vel: 100 }] }]);
  zelle(1, 2).dispatch('click'); await ruhe();   // the reversed hit
  assert.equal(schreibt().length, 2);
  assert.deepEqual(schreibt()[1].koerper.befehle, [{ befehl: 'noten_loeschen', clip_id: 'c_s', ids: ['n2'] }]);
});

test('slice grid: a REVERSE click on a hit sends noten_aendern, on a step without a hit nothing and says why', async () => {
  sliceAufbau([{ id: 'n1', beat: 0, laenge: 0.5, ton: 0, vel: 100 }, { id: 'n2', beat: 0.5, laenge: 0.5, ton: 64 + 1, vel: 100 }]);
  await zeigen();
  alle('r-feld').find((b) => b.dataset.feld === 'rueck').dispatch('click');
  assert.ok($w('r-hinweis').textContent.includes('on all rows'));
  assert.equal(alle('wert').length, 16, 'one value cell per step of the bar');
  wertZelle(0).dispatch('pointerdown', { clientY: 10 }); await ruhe();   // slice 1 starts in step 1
  assert.equal(schreibt().length, 1);
  assert.equal(schreibt()[0].koerper.label, 'Slices: reverse');
  assert.deepEqual(schreibt()[0].koerper.befehle, [{ befehl: 'noten_aendern', clip_id: 'c_s', noten: [{ id: 'n1', ton: 64 }] }]);
  wertZelle(0).dispatch('pointermove', { clientY: 10 }); await ruhe();
  assert.equal(schreibt().length, 1, 'a move does not toggle again');
  const n = schreibt().length;
  wertZelle(5).dispatch('pointerdown', { clientY: 10 }); await ruhe();   // no hit in step 6
  assert.equal(schreibt().length, n);
  assert.ok($w('meldung').textContent.includes('no note starts'));
  // step 3 holds the reversed hit of row 2: the lane shows it while row 1 stays selected, REVERSE goes back to forward
  assert.ok(wertZelle(2).classList.contains('anders'), 'a reversed hit on another row is amber in the lane');
  wertZelle(2).dispatch('pointerdown', { clientY: 10 }); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'noten_aendern', clip_id: 'c_s', noten: [{ id: 'n2', ton: 1 }] }]);
});

test('slice grid: the value lanes VELOCITY and LENGTH act on all rows and see reversed hits', async () => {
  sliceAufbau([{ id: 'n2', beat: 0.5, laenge: 0.5, ton: 64 + 1, vel: 100 }]);
  await zeigen();
  wertZelle(2).dispatch('pointerdown', { clientY: 10 }); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'noten_aendern', clip_id: 'c_s', noten: [{ id: 'n2', vel: 64 }] }]);
  alle('r-feld').find((b) => b.dataset.feld === 'laenge').dispatch('click');
  wertZelle(2).dispatch('pointerdown', { clientY: 10 }); await ruhe();
  assert.equal(schreibt().at(-1).koerper.label, 'Slices: length');
  assert.deepEqual(schreibt().at(-1).koerper.befehle[0].noten, [{ id: 'n2', laenge: 2 }], 'mid height = 8 steps = 2 beats');
});

test('the other grids keep their tabs next to the slice grid', async () => {
  const sp = spuren();
  aufbau(projektMit([sp.drums]), { klaenge: KLAENGE });
  await zeigen();
  assert.deepEqual(alle('r-feld').map((b) => b.dataset.feld), ['vel']);
  aufbau(projektMit([spuren().bass]), { klaenge: [] });
  await zeigen();
  assert.deepEqual(alle('r-feld').map((b) => b.dataset.feld), ['vel', 'laenge']);
});

// ---- PITCH lane of the slice grid (sampler A2 task 7) ----
const pitchTab = () => alle('r-feld').find((b) => b.dataset.feld === 'pitch');
test('the slice view offers PITCH and a click on a value posts the envelope', async () => {
  sliceAufbau([{ id: 'n1', beat: 0, laenge: 0.5, ton: 0, vel: 100 }]);
  await zeigen();
  assert.deepEqual(alle('r-feld').map((b) => b.textContent), ['VELOCITY', 'LENGTH', 'REVERSE', 'PITCH']);
  pitchTab().dispatch('click');
  assert.ok(pitchTab().classList.contains('an'));
  assert.equal(alle('wert').length, 16, 'one value cell per step of the bar, over all rows');
  assert.ok($w('r-hinweis').textContent.includes('all rows'), 'the lane is not one row');
  assert.ok(alle('wert').every((z) => z.dataset.halb === '0' && !z.classList.contains('eigen')), 'no lane: the track knob, 0 semitones');
  wertZelle(4).dispatch('pointerdown', { clientY: 0 }); await ruhe();   // the top of the cell: +12
  assert.equal(schreibt().length, 1);
  assert.equal(schreibt()[0].koerper.label, 'Slices: pitch');
  assert.deepEqual(schreibt()[0].koerper.befehle, [{ befehl: 'huellkurve_setzen', clip_id: 'c_s', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }, { beat: 0.875, wert: 0.5, form: 'sprung' }, { beat: 1.125, wert: 0, form: 'sprung' }] }]);
  // the same step with no hit in it: PITCH is a lane of its own, it does not need a hit
  assert.ok(!zelle(0, 4).classList.contains('an'));
});
test('PITCH: the lane shows what the project holds, marks a step with its own point; shift-click removes it; a drag writes each step it enters', async () => {
  const sp = sliceSpur([{ id: 'n1', beat: 0, laenge: 0.5, ton: 0, vel: 100 }]);
  sp.clips[0].huellkurven = [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }, { beat: 0.875, wert: 0.25, form: 'sprung' }, { beat: 1.125, wert: 0, form: 'sprung' }] }];   // +6 on step 5 only, knob at 0.5
  aufbau(projektMit([sp], { takte: 1 }), { klaenge: SLICE_KLAENGE, schnitt: SCHNITT });
  await zeigen();
  pitchTab().dispatch('click');
  assert.deepEqual([3, 4, 5].map((i) => wertZelle(i).dataset.halb), ['0', '6', '0']);
  assert.deepEqual([3, 4, 5].map((i) => wertZelle(i).classList.contains('eigen')), [false, true, false]);
  wertZelle(5).dispatch('pointerdown', { clientY: 0, shiftKey: true }); await ruhe();
  assert.equal(schreibt().length, 0, 'shift-click on a step without a point of its own sends nothing');
  wertZelle(4).dispatch('pointerdown', { clientY: 0, shiftKey: true }); await ruhe();
  assert.equal(schreibt().length, 1);
  assert.deepEqual(schreibt()[0].koerper.befehle, [{ befehl: 'huellkurve_loeschen', clip_id: 'c_s', ziel: 'geraet.k3' }], 'the only value of the lane: the envelope is removed');
  wertZelle(7).dispatch('pointerdown', { clientY: 0 }); await ruhe();
  const n = schreibt().length;
  wertZelle(8).dispatch('pointermove', { clientY: 0 }); await ruhe();
  assert.equal(schreibt().length, n + 1, 'a drag over an empty step writes it');
  assert.equal(schreibt().at(-1).koerper.label, 'Slices: pitch');
});
test('the PITCH tab exists in the slice grid only', async () => {
  aufbau(projektMit([spuren().drums]), { klaenge: KLAENGE });
  await zeigen();
  assert.ok(!alle('r-feld').some((b) => b.dataset.feld === 'pitch'));
  aufbau(projektMit([spuren().bass]), { klaenge: [] });
  await zeigen();
  assert.ok(!alle('r-feld').some((b) => b.dataset.feld === 'pitch'));
});

test('the slice view puts a hit just before its step into that step and the bar strip marks the bar of the step', async () => {
  const sp = sliceSpur([{ id: 'n1', beat: 0.994, laenge: 0.25, ton: 3, vel: 100 }, { id: 'n2', beat: 3.99, laenge: 0.25, ton: 0, vel: 100 }]);
  aufbau(projektMit([{ ...sp, clips: [{ ...sp.clips[0], loop_beats: 4 }] }], { takte: 2 }), { klaenge: SLICE_KLAENGE, schnitt: SCHNITT });
  await zeigen();
  assert.ok(zelle(3, 4).classList.contains('an') && !zelle(3, 3).classList.contains('an'));
  assert.ok(zelle(0, 0).classList.contains('an') && !zelle(0, 15).classList.contains('an'), 'the upbeat of the pattern is on step 1');
  zelle(3, 4).dispatch('click'); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'noten_loeschen', clip_id: 'c_s', ids: ['n1'] }]);
});
test('the bar strip of a slice grid marks the bar of the step a hit belongs to', async () => {
  // pattern of 8 beats (2 bars) in a module of 2 bars: a hit at beat 7.99 is the upbeat of the next pass, so it marks bar 1, not bar 2
  const sp = sliceSpur([{ id: 'n1', beat: 7.99, laenge: 0.25, ton: 0, vel: 100 }]);
  aufbau(projektMit([{ ...sp, clips: [{ ...sp.clips[0], loop_beats: 8 }] }], { takte: 2 }), { klaenge: SLICE_KLAENGE, schnitt: SCHNITT });
  await zeigen();
  const markiert = alle('r-takt').map((t) => t.children.some((c) => typeof c !== 'string' && c.tagName === 'I'));
  assert.deepEqual(markiert, [true, false], 'beat 7.99 is step 1 of the next pass: bar 1 is marked, not bar 2');
});

// 2026-11-16: a click on a row name plays it through the track (POST /sampler/hoeren with `ton`; a slice row sends `scheibe`)
test('a click on a drum row or a piano key sends the note to hear; a refusal is told', async () => {
  const hoert = () => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === '/sampler/hoeren');
  const sp = spuren();
  aufbau(projektMit([sp.drums, sp.bass]), { klaenge: KLAENGE });
  attrappe.antworten['POST /sampler/hoeren'] = { j: { ok: true, dauer_ms: 400 } };
  await zeigen();
  alle('zeilenname').find((z) => z.textContent === 'Snare').dispatch('click'); await ruhe();
  assert.deepEqual(hoert().at(-1).koerper, { spur_id: 's1', ton: 38 });
  assert.ok(alle('zeilenname').find((z) => z.textContent === 'Snare').classList.contains('gewaehlt'), 'the row is selected as before');
  assert.equal(schreibt().length, 0, 'hearing writes nothing');
  // the piano of a note track
  aufbau(projektMit([sp.bass]), { klaenge: [] });
  attrappe.antworten['POST /sampler/hoeren'] = { code: 409, j: { fehler: 'kein_kern', text: 'the core did not answer' } };
  await zeigen();
  const taste = alle('zeilenname')[0];
  taste.dispatch('click'); await ruhe();
  assert.deepEqual(hoert().at(-1).koerper, { spur_id: 's2', ton: Number(taste.dataset.ton) });
  assert.equal($w('meldung').textContent, 'The core did not answer');
});

// 2026-11-16: "+ lane" adds a step lane for a knob of a Baukasten instrument
test('+ lane adds a knob lane; a press writes the step value, shift removes it, × removes the lane', async () => {
  const REGLER = [{ nr: 1, name: 'Cutoff', vorgabe: 0.5 }, { nr: 2, name: 'Reso', vorgabe: 0.25 }];
  const sp = spuren();
  const mit = (p) => { aufbau(p, { klaenge: [] }); attrappe.antworten['GET /seq/geraet'] = { j: { art: 'bk', regler: REGLER, klaenge: [] } }; };
  mit(projektMit([sp.bass]));
  await zeigen();
  const wahl = $w('r-lane-neu');
  assert.deepEqual(wahl.querySelectorAll('option').map((o) => o.textContent), ['+ lane ▾', 'Cutoff', 'Reso']);
  wahl.value = '2'; wahl.dispatch('change'); await ruhe();
  assert.deepEqual(alle('r-feld').map((b) => b.textContent), ['VELOCITY', 'LENGTH', 'RESO']);
  assert.ok(alle('r-feld').find((b) => b.textContent === 'RESO').classList.contains('an'));
  assert.deepEqual($w('r-lane-neu').querySelectorAll('option').map((o) => o.textContent), ['+ lane ▾', 'Cutoff']);
  assert.equal(schreibt().length, 0, 'adding a lane writes nothing');
  assert.equal(wertZelle(0).dataset.wert, '0.25', 'every step shows the knob');
  // a press at the top of step 4 (the stand-in has no layout: the middle) writes an offset from the knob at the beat of the step
  wertZelle(4).dispatch('pointerdown', {}); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'huellkurve_setzen', clip_id: 'c_Bass', ziel: 'geraet.k2',
    punkte: [{ beat: 0, wert: 0 }, { beat: 1, wert: 0.25, form: 'sprung' }, { beat: 1.25, wert: 0, form: 'sprung' }] }]);
  // a project that holds the lane shows it without "+ lane"; shift removes the only value and with it the envelope
  const mitHk = structuredClone(sp.bass);
  mitHk.clips[0].huellkurven = [{ ziel: 'geraet.k2', punkte: [{ beat: 0, wert: 0 }, { beat: 1, wert: 0.25, form: 'sprung' }, { beat: 1.25, wert: 0, form: 'sprung' }] }];
  mit(projektMit([mitHk]));
  await zeigen();
  alle('r-feld').find((b) => b.textContent === 'RESO').dispatch('click'); await ruhe();
  assert.deepEqual([wertZelle(3).dataset.wert, wertZelle(4).dataset.wert, wertZelle(5).dataset.wert], ['0.25', '0.5', '0.25']);
  assert.ok(wertZelle(4).classList.contains('eigen') && !wertZelle(3).classList.contains('eigen'));
  wertZelle(4).dispatch('pointerdown', { shiftKey: true }); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'huellkurve_loeschen', clip_id: 'c_Bass', ziel: 'geraet.k2' }]);
  // × deletes the lane's envelope and goes back to VELOCITY
  mit(projektMit([mitHk]));
  await zeigen();
  alle('r-feld').find((b) => b.textContent === 'RESO').dispatch('click'); await ruhe();
  $w('r-lane-weg').dispatch('click'); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'huellkurve_loeschen', clip_id: 'c_Bass', ziel: 'geraet.k2' }]);
  assert.ok(alle('r-feld').find((b) => b.textContent === 'VELOCITY').classList.contains('an'));
});
