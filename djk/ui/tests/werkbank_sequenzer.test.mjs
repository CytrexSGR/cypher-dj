// Workbench strand C: the step sequencer. The pure gesture logic (grid_seq.js, no DOM) and the view (grid_view.js) through bindeWerkbank against the DOM stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { modulTakte, bereichGesetzt } = await import('../public/werkbank/kopf.js');
const L = await import('../public/werkbank/grid_seq.js');
const { zellen, fenster } = await import('../public/werkbank/grid.js');
const { SeqFehler: SeqFehlerKlasse } = await import('../public/seq_logic.js');

const KLAENGE = [{ ton: 36, name: 'Kick' }, { ton: 38, name: 'Snare' }, { ton: 39, name: 'Clap' }, { ton: 42, name: 'Closed Hat' }];
// a drum track: pattern of 16 steps (4 beats) in a clip of 64 beats, kicks on the beats (steps 0 4 8 12), ids k0..k3
function drums({ loop = 4, extra = [], zeilen } = {}) {
  const noten = [0, 1, 2, 3].map((b) => ({ id: `k${b}`, beat: b, laenge: 0.125, ton: 36, vel: 100 })).concat(extra);
  const clip = { id: 'c_D', art: 'midi', name: 'D', start_beat: 0, laenge_beats: 64, loop_beats: loop, noten, ...(zeilen ? { zeilen } : {}) };
  return { id: 's1', nr: 1, name: 'Drums', farbe: '#2fd6c3', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} }, clips: [clip] };
}
const projektMit = (spur, { takte = 2, werkbank = { schema: 1 }, loop } = {}) => ({ name: 'M', rev: 1, werkbank, tempo_bpm: 130, taktart: [4, 4], loop: loop ?? { an: true, von_beat: 0, bis_beat: takte * 4 }, spuren: [spur] });
const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
let wurzel, w;
const $w = (n) => wurzel.querySelector(`[data-w="${n}"]`);
const alle = (n) => wurzel.querySelectorAll(`[data-w="${n}"]`);
function aufbau(p, { frage = () => true } = {}) {
  installiere({
    antworten: {
      'GET /proj/aktuell': { j: { slug: 'm1', projekt: p } }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } },
      'GET /seq/geraet': { j: { art: 'bk', regler: [], klaenge: KLAENGE } }, 'GET /geraete/panel': { j: {} },
      'POST /proj/aendern': (k) => ({ j: { rev: k.rev + 1, projekt: { ...p, rev: k.rev + 1 } } }),
    },
  });
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage });
}
const zeigen = async () => { w.zeige(); await ruhe(); };
const schreibt = () => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === '/proj/aendern');
const zelle = (ton, schritt) => alle('zelle').find((z) => Number(z.dataset.ton) === ton && Number(z.dataset.schritt) === schritt);
const werkzeug = (n) => alle('seq-werkzeug').find((b) => b.dataset.n === n);
const tab = (feld) => alle('seq-wert-tab').find((b) => b.dataset.feld === feld);
const MAUS = { buttons: 1 };
// one gesture: press on the first cell, move over the others, release on the last
async function geste(zellenListe, { press = {}, bewegung = [] } = {}) {
  const [erste, ...rest] = zellenListe;
  erste.dispatch('pointerdown', { ...MAUS, ...press });
  rest.forEach((z, i) => z.dispatch('pointermove', { ...MAUS, ...press, ...(bewegung[i] ?? {}) }));
  (rest.at(-1) ?? erste).dispatch('pointerup', {});
  await ruhe();
}

// ---------- pure logic ----------
const spurPur = drums();
const clipPur = spurPur.clips[0];

test('row settings: LENGTH, SWING and direction become zeile_setzen; empty removes; out of range and no change', () => {
  assert.deepEqual(L.zeileBefehle(clipPur, 38, 'schritte', '6'), [{ befehl: 'zeile_setzen', clip_id: 'c_D', ton: 38, schritte: 6 }]);
  assert.deepEqual(L.zeileBefehle(clipPur, 38, 'swing', 55), [{ befehl: 'zeile_setzen', clip_id: 'c_D', ton: 38, swing: 55 }]);
  assert.deepEqual(L.zeileBefehle(clipPur, 38, 'richtung', 'pendel'), [{ befehl: 'zeile_setzen', clip_id: 'c_D', ton: 38, richtung: 'pendel' }]);
  const mit = { ...clipPur, zeilen: { 38: { schritte: 6 } } };
  assert.deepEqual(L.zeileBefehle(mit, 38, 'schritte', ''), [{ befehl: 'zeile_setzen', clip_id: 'c_D', ton: 38, schritte: null }]);
  assert.deepEqual(L.zeileBefehle(mit, 38, 'schritte', 6), [], 'no change, no command');
  assert.throws(() => L.zeileBefehle(clipPur, 38, 'schritte', 129));
  assert.throws(() => L.zeileBefehle(clipPur, 38, 'swing', 0));
  assert.throws(() => L.zeileBefehle(clipPur, 38, 'richtung', 'rueck'));
});

test('paint, erase, line, fill: one command list per gesture, deterministic targets', () => {
  const ziele = [{ ton: 38, quelle: 2 }, { ton: 38, quelle: 3 }, { ton: 38, quelle: 3 }];
  assert.deepEqual(L.setzeBefehle(clipPur, 'drum', null, ziele, true), [{ befehl: 'noten_neu', clip_id: 'c_D', noten: [
    { beat: 0.5, laenge: 0.125, ton: 38, vel: 100 }, { beat: 0.75, laenge: 0.125, ton: 38, vel: 100 }] }]);
  assert.deepEqual(L.setzeBefehle(clipPur, 'drum', null, [{ ton: 36, quelle: 0 }, { ton: 36, quelle: 1 }], false), [{ befehl: 'noten_loeschen', clip_id: 'c_D', ids: ['k0'] }]);
  assert.deepEqual(L.setzeBefehle(clipPur, 'drum', null, [{ ton: 36, quelle: 99 }], true), [], 'a step past the row is skipped');
  assert.deepEqual(L.linieZiele(clipPur, 38, 6, 2).map((z) => z.quelle), [2, 3, 4, 5, 6]);
  assert.deepEqual(L.fuellZiele(clipPur, 38, 0, 12, 4).map((z) => z.quelle), [0, 4, 8, 12]);
  assert.deepEqual(L.fuellZiele(clipPur, 38, 3, 9, 2).map((z) => z.quelle), [3, 5, 7, 9]);
  assert.throws(() => L.fuellZiele(clipPur, 38, 0, 8, 3));
  // a row with its own length: steps past its end repeat
  const sechs = { ...clipPur, zeilen: { 38: { schritte: 6 } } };
  assert.deepEqual(L.linieZiele(sechs, 38, 4, 8).map((z) => z.quelle), [4, 5, 0, 1, 2]);
});

test('selection: toggle, rectangle, duplicate behind the selection with all note fields', () => {
  assert.deepEqual(L.auswahlUmschalten([{ ton: 36, quelle: 1 }], { ton: 36, quelle: 1 }), []);
  assert.deepEqual(L.auswahlUmschalten([], { ton: 36, quelle: 1 }), [{ ton: 36, quelle: 1 }]);
  assert.equal(L.rechteckZiele(clipPur, [36, 38, 39], 39, 3, 36, 5).length, 9);
  const c = drums({ extra: [{ id: 'x', beat: 0.25, laenge: 0.125, ton: 38, vel: 80, chance: 50, wdh: 3, versatz: -20 }] }).clips[0];
  const r = L.dupliziereBefehle(c, 'drum', [{ ton: 36, quelle: 0 }, { ton: 38, quelle: 1 }, { ton: 36, quelle: 4 }]);   // width 5 steps
  assert.deepEqual(r.befehle[0].noten.map((n) => [n.ton, n.beat]), [[36, 1.25], [38, 1.5], [36, 2.25]]);
  const kopie = r.befehle[0].noten.find((n) => n.ton === 38);
  assert.deepEqual(kopie, { beat: 1.5, laenge: 0.125, ton: 38, vel: 80, chance: 50, wdh: 3, versatz: -20 }, 'a copy keeps chance, repeat and offset and has no id');
  assert.deepEqual(r.auswahl, [{ ton: 36, quelle: 5 }, { ton: 38, quelle: 6 }, { ton: 36, quelle: 9 }]);
  assert.deepEqual(L.dupliziereBefehle(c, 'drum', [{ ton: 36, quelle: 14 }, { ton: 36, quelle: 15 }]).befehle, [], 'nothing lands past the end of the row');
});

test('value drag: vertical movement moves every target by the same amount; defaults are stored as no field', () => {
  const c = drums({ extra: [{ id: 'x', beat: 0.25, laenge: 0.125, ton: 38, vel: 50, chance: 50 }] }).clips[0];
  const ziele = [{ ton: 36, quelle: 0 }, { ton: 38, quelle: 1 }];
  assert.deepEqual(L.ziehBefehle(c, 'drum', 'vel', ziele, -12)[0].noten, [{ id: 'k0', vel: 113 }, { id: 'x', vel: 63 }]);
  assert.deepEqual(L.ziehBefehle(c, 'drum', 'vel', ziele, -1200)[0].noten, [{ id: 'k0', vel: 127 }, { id: 'x', vel: 127 }], 'clamped');
  assert.deepEqual(L.ziehBefehle(c, 'drum', 'chance', ziele, 12)[0].noten, [{ id: 'k0', chance: 90 }, { id: 'x', chance: 40 }], 'a note without chance starts at 100');
  assert.deepEqual(L.ziehBefehle(c, 'drum', 'chance', [{ ton: 36, quelle: 0 }], -12), [], 'already 100: nothing to write');
  assert.deepEqual(L.ziehBefehle(c, 'drum', 'chance', [{ ton: 38, quelle: 1 }], -120)[0].noten, [{ id: 'x', chance: null }], '100 removes the field');
  assert.deepEqual(L.ziehBefehle(c, 'drum', 'versatz', [{ ton: 36, quelle: 0 }], -60)[0].noten, [{ id: 'k0', versatz: 95 }]);
  assert.deepEqual(L.ziehBefehle(c, 'drum', 'wdh', [{ ton: 36, quelle: 0 }], -60)[0].noten, [{ id: 'k0', wdh: 5 }]);
  assert.deepEqual(L.ziehBefehle(c, 'drum', 'laenge', [{ ton: 36, quelle: 0 }], -24)[0].noten, [{ id: 'k0', laenge: 1 }], '3 more steps: 4 steps = 1 beat');
});

test('ramp: from the value of the first step to the value of the last, along the notes in between', () => {
  const befehl = L.rampeBefehle(clipPur, 'drum', 36, 'vel', 0, 12, -24)[0];   // 100 -> 100 + 25
  assert.deepEqual(befehl.noten, [{ id: 'k1', vel: 108 }, { id: 'k2', vel: 117 }, { id: 'k3', vel: 125 }], 'the first step keeps its value and is left out');
  assert.deepEqual(L.rampeBefehle(clipPur, 'drum', 36, 'vel', 4, 4, -24), [], 'one step is no ramp');
  assert.deepEqual(L.rampeBefehle(clipPur, 'drum', 36, 'vel', 0, 12, 0), [], 'both ends 100: nothing changes');
});

test('cursor, loop range commands, row lengths in cells of the view', () => {
  assert.deepEqual(L.cursorBewegung({ ton: 38, schritt: 0 }, 'ArrowLeft', [36, 38], 32), { ton: 38, schritt: 0 });
  assert.deepEqual(L.cursorBewegung({ ton: 38, schritt: 31 }, 'ArrowRight', [36, 38], 32), { ton: 38, schritt: 31 });
  assert.deepEqual(L.cursorBewegung({ ton: 38, schritt: 3 }, 'ArrowUp', [36, 38], 32), { ton: 36, schritt: 3 });
  assert.deepEqual(L.cursorBewegung({ ton: 38, schritt: 3 }, 'ArrowDown', [36, 38], 32), { ton: 38, schritt: 3 });
  assert.deepEqual(L.STEPS_WAHL, [4, 8, 16]);
  assert.equal(L.zeilenLaengeAusZellen(3, 8), 6, '3 cells of an eighth are 6 sixteenths');
  assert.equal(L.zeilenLaengeAusZellen(3, 4), 12);
  assert.equal(L.zeilenLaengeAusZellen(5, 16), 5);
  assert.throws(() => L.zeilenLaengeAusZellen(1.5, 8), SeqFehlerKlasse);
  assert.equal(L.zeilenLaengeInZellen(12, 4), 3);
  assert.equal(L.zeilenSchritte(clipPur, 36, 'drum', 4), 4, 'the pattern of 4 beats is 4 cells at 4 steps per bar');
  assert.equal(L.quelleVon(clipPur, 36, 5, 'drum', 4), 1);
  assert.deepEqual(L.bereichBefehl(2, 5, 8, false, 4), { befehl: 'werkbank_bereich', von_beat: 2, bis_beat: 6 }, 'at 4 steps per bar a cell is a beat');
  assert.deepEqual(L.bereichBefehl(4, 11, 8), { befehl: 'werkbank_bereich', von_beat: 1, bis_beat: 3 }, 'snaps to whole beats, the end step included');
  assert.deepEqual(L.bereichBefehl(11, 4, 8), { befehl: 'werkbank_bereich', von_beat: 1, bis_beat: 3 });
  assert.equal(L.bereichBefehl(4, 4, 8).bis_beat - 1, 1, 'at least one beat');
  assert.equal(L.bereichBefehl(0, 31, 8, false), null, 'the whole module is no range');
  assert.deepEqual(L.bereichBefehl(0, 31, 8, true), { befehl: 'werkbank_bereich', aus: true });
  assert.deepEqual(L.bereichDaten({ werkbank: { schema: 1, laenge_beats: 16 }, loop: { an: true, von_beat: 4, bis_beat: 8 } }), { gesetzt: true, modul: 16, von: 4, bis: 8 });
  assert.deepEqual(L.bereichDaten(projektMit(spurPur)), { gesetzt: false, modul: 8, von: 0, bis: 8 });
});

test('cells of a row with its own length: pale repeats, the end marker, note fields', () => {
  const c = drums({ extra: [{ id: 's', beat: 0.25, laenge: 0.125, ton: 38, vel: 90, chance: 40, wdh: 2 }], zeilen: { 38: { schritte: 6 } } }).clips[0];
  const z = zellen(c, 38, fenster({ sicht: 2, start: 0 }, 2));
  assert.deepEqual([z[1].an, z[7].an, z[13].an, z[3].an], [true, true, true, false]);
  assert.deepEqual([z[5].wiederholung, z[6].wiederholung, z[7].quelle], [false, true, 1]);
  assert.deepEqual(z.filter((x) => x.ende).map((x) => x.schritt), [5, 11, 17, 23, 29]);
  assert.equal(z[1].chance, 40); assert.equal(z[1].wdh, 2); assert.ok(!('versatz' in z[1]));
  const ohne = zellen(c, 36, fenster({ sicht: 2, start: 0 }, 2));
  assert.ok(ohne.every((x) => !('ende' in x)), 'a row without its own length has no end marker');
});

test('module length follows the loop range', () => {
  const p = projektMit(drums(), { takte: 4 });
  assert.equal(modulTakte(p), 4);
  const mit = { ...p, werkbank: { schema: 1, laenge_beats: 16 }, loop: { an: true, von_beat: 4, bis_beat: 8 } };
  assert.ok(bereichGesetzt(mit) && !bereichGesetzt(p));
  assert.equal(modulTakte(mit), 4, 'the remembered module length, not the range');
  assert.equal(modulTakte({ ...mit, werkbank: { schema: 1, laenge_beats: 12 } }), null);
});

// ---------- view ----------
test('the header offers STEPS 4, 8, 16, the tools and the page buttons', async () => {
  aufbau(projektMit(drums()));
  await zeigen();
  assert.deepEqual(alle('seq-schritte').map((b) => b.textContent), ['4', '8', '16']);
  assert.ok(alle('seq-schritte')[2].classList.contains('an'), '16 steps per bar is the default');
  assert.deepEqual(alle('r-sicht').map((b) => b.textContent), ['1', '2', '4']);
  assert.deepEqual(alle('seq-werkzeug').map((b) => b.dataset.n), ['draw', 'erase', 'fill']);
  assert.equal(alle('seq-fuell').length, 0, 'the fill step shows with the FILL tool');
  werkzeug('fill').dispatch('click');
  assert.deepEqual(alle('seq-fuell').map((b) => b.dataset.n), ['1', '2', '4']);
  assert.equal(alle('seq-seite').length, 2);
  assert.equal(alle('zelle').filter((z) => Number(z.dataset.ton) === 36).length, 32, 'the default page shows 2 bars; the grid is the module');
});
test('STEPS is the resolution of the view: 4 and 8 cells per bar, a click writes at the cell start, nothing is sent by STEPS itself', async () => {
  aufbau(projektMit(drums({ extra: [{ id: 'm', beat: 1.75, laenge: 0.125, ton: 38, vel: 90 }] })));
  await zeigen();
  const reihe = (ton) => alle('zelle').filter((z) => Number(z.dataset.ton) === ton);
  const aufl = (n) => alle('seq-schritte').find((b) => Number(b.dataset.n) === n);
  aufl(4).dispatch('click'); await ruhe();
  assert.equal(schreibt().length, 0, 'a view state, no command');
  assert.equal(reihe(36).length, 8, '2 bars of 4 cells');
  assert.ok(aufl(4).classList.contains('an') && !aufl(16).classList.contains('an'));
  assert.ok(zelle(38, 1).classList.contains('an'), 'a note on the last sixteenth of the beat is inside the cell');
  assert.equal(globalThis.localStorage.getItem('djk-wb-aufl-s1'), '4', 'remembered per track');
  zelle(38, 2).dispatch('click'); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'noten_neu', clip_id: 'c_D', noten: [{ beat: 2, laenge: 0.125, ton: 38, vel: 100 }] }]);
  zelle(38, 1).dispatch('click'); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'noten_loeschen', clip_id: 'c_D', ids: ['m'] }]);
  aufl(8).dispatch('click'); await ruhe();
  assert.equal(reihe(36).length, 16);
  assert.ok(zelle(38, 3).classList.contains('an'));
  assert.equal(alle('r-schritt').length, 16);
  assert.deepEqual(alle('r-bar').map((b) => b.textContent), ['BAR 1', 'BAR 2']);
  zelle(36, 5).dispatch('click'); await ruhe();
  assert.equal(schreibt().at(-1).koerper.befehle[0].noten[0].beat, 2.5);
});
test('at 4 steps per bar the row LENGTH field counts cells and writes sixteenths', async () => {
  aufbau(projektMit(drums()));
  await zeigen();
  alle('seq-schritte').find((b) => Number(b.dataset.n) === 8).dispatch('click'); await ruhe();
  const feld = () => alle('zeile-laenge').find((e) => Number(e.dataset.ton) === 38);
  assert.equal(feld().getAttribute('placeholder'), '8', 'the pattern of 4 beats is 8 cells');
  feld().value = '3'; feld().dispatch('change'); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'zeile_setzen', clip_id: 'c_D', ton: 38, schritte: 6 }]);
  feld().value = '1.5'; feld().dispatch('change'); await ruhe();
  assert.equal(schreibt().length, 1, 'a length that is no whole number of cells is refused');
});
test('VIEW and PAGE over a module of 64 bars: 1, 2 or 4 bars a page, the bar strip lists every bar', async () => {
  aufbau(projektMit(drums(), { takte: 64 }));
  await zeigen();
  assert.equal(alle('r-takt').length, 64);
  assert.equal($w('r-fenster').textContent, 'BAR 1 – 2');
  alle('r-sicht').find((b) => Number(b.dataset.n) === 4).dispatch('click');
  assert.equal($w('r-fenster').textContent, 'BAR 1 – 4');
  assert.equal(alle('zelle').filter((z) => Number(z.dataset.ton) === 36).length, 64);
  for (let i = 0; i < 20; i++) alle('seq-seite').find((b) => Number(b.dataset.richtung) === 1).dispatch('click');
  assert.equal($w('r-fenster').textContent, 'BAR 61 – 64', 'the arrows stop at the last page');
  alle('r-takt').find((b) => Number(b.dataset.n) === 40).dispatch('click');
  assert.equal($w('r-fenster').textContent, 'BAR 41 – 44');
  assert.ok(zelle(36, 40 * 16), 'absolute cell numbers run on');
  const k = alle('r-takt').find((b) => Number(b.dataset.n) === 127);
  assert.ok(!k, 'no bar beyond the module');
  aufbau(projektMit(drums(), { takte: 128 }));
  await zeigen();
  assert.equal(alle('r-takt').length, 128);
});

test('DRAW: dragging paints every step it crosses, as one project change', async () => {
  aufbau(projektMit(drums()));
  await zeigen();
  await geste([zelle(38, 2), zelle(38, 3), zelle(38, 6)]);
  assert.equal(schreibt().length, 1, 'one gesture, one history step');
  const s = schreibt()[0].koerper;
  assert.equal(s.befehle.length, 1);
  assert.deepEqual(s.befehle[0].noten.map((n) => n.beat), [0.5, 0.75, 1, 1.25, 1.5], 'the gap the pointer skipped is filled');
});

test('DRAW: a press on a set step without movement toggles it; a drag starting on a set step clears', async () => {
  aufbau(projektMit(drums()));
  await zeigen();
  zelle(36, 4).dispatch('pointerdown', MAUS); zelle(36, 4).dispatch('pointerup', {});
  zelle(36, 4).dispatch('click');   // the click that follows the pointerup is ignored
  await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'noten_loeschen', clip_id: 'c_D', ids: ['k1'] }]);
  assert.equal(schreibt().length, 1);
});

test('Shift and drag draws a straight line along the row', async () => {
  aufbau(projektMit(drums()));
  await zeigen();
  await geste([zelle(39, 1), zelle(39, 5)], { press: { shiftKey: true } });
  assert.equal(schreibt().length, 1);
  assert.deepEqual(schreibt()[0].koerper.befehle[0].noten.map((n) => n.beat), [0.25, 0.5, 0.75, 1, 1.25]);
});

test('ERASE clears what the drag crosses; FILL sets every 4th step over the range', async () => {
  aufbau(projektMit(drums()));
  await zeigen();
  werkzeug('erase').dispatch('click');
  await geste([zelle(36, 0), zelle(36, 5)]);
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'noten_loeschen', clip_id: 'c_D', ids: ['k0', 'k1'] }]);
  werkzeug('fill').dispatch('click');
  alle('seq-fuell').find((b) => b.dataset.n === '4').dispatch('click');
  await geste([zelle(42, 0), zelle(42, 13)]);
  assert.deepEqual(schreibt().at(-1).koerper.befehle[0].noten.map((n) => [n.ton, n.beat]), [[42, 0], [42, 1], [42, 2], [42, 3]]);
});

test('Ctrl and drag selects a rectangle, Ctrl-click adds a step; the value drag then moves all selected steps', async () => {
  aufbau(projektMit(drums()));
  await zeigen();
  await geste([zelle(36, 0), zelle(36, 8)], { press: { ctrlKey: true } });
  assert.equal(schreibt().length, 0, 'selecting writes nothing');
  assert.equal(alle('zelle').filter((z) => z.classList.contains('gewaehlt') && Number(z.dataset.ton) === 36).length, 18, 'steps 0..8 and their pale repeats in the second bar');
  // drag the kick on step 4 up by 12 px: the kicks on steps 0, 4, 8 move together, the one on step 12 stays
  await geste([zelle(36, 4), zelle(36, 4)], { press: { clientY: 100 }, bewegung: [{ clientY: 88 }] });
  assert.equal(schreibt().length, 1);
  assert.deepEqual(schreibt()[0].koerper.befehle[0].noten, [{ id: 'k0', vel: 113 }, { id: 'k1', vel: 113 }, { id: 'k2', vel: 113 }]);
  zelle(36, 12).dispatch('click', { ctrlKey: true });
  assert.ok(zelle(36, 12).classList.contains('gewaehlt'), 'Ctrl-click adds a step');
  assert.equal(schreibt().length, 1);
});

test('value tabs: CHANCE shows the number in the step and dragging writes it; Shift-drag draws a ramp', async () => {
  const extra = [{ id: 'c1', beat: 0.25, laenge: 0.125, ton: 38, vel: 100, chance: 50 }, { id: 'o1', beat: 0.5, laenge: 0.125, ton: 38, vel: 100, versatz: -20 }, { id: 'r1', beat: 0.75, laenge: 0.125, ton: 38, vel: 100, wdh: 3 }];
  aufbau(projektMit(drums({ extra })));
  await zeigen();
  assert.deepEqual(alle('seq-wert-tab').map((b) => b.textContent), ['VELOCITY', 'CHANCE', 'OFFSET', 'ROLL']);
  tab('chance').dispatch('click');
  assert.ok(zelle(38, 1).textContent.includes('50'), 'the value shows inside the step');
  assert.equal(zelle(36, 0).textContent.includes('100'), false, 'a note without chance shows no number');
  await geste([zelle(36, 0), zelle(36, 0)], { press: { clientY: 100 }, bewegung: [{ clientY: 160 }] });
  assert.deepEqual(schreibt().at(-1).koerper.befehle[0].noten, [{ id: 'k0', chance: 51 }]);
  tab('versatz').dispatch('click');
  assert.ok(zelle(38, 2).textContent.includes('-20'));
  tab('wdh').dispatch('click');
  assert.ok(zelle(38, 3).textContent.includes('3'));
  tab('vel').dispatch('click');
  await geste([zelle(36, 0), zelle(36, 12)], { press: { shiftKey: true, clientY: 100 }, bewegung: [{ clientY: 76 }] });
  assert.deepEqual(schreibt().at(-1).koerper.befehle[0].noten, [{ id: 'k1', vel: 108 }, { id: 'k2', vel: 117 }, { id: 'k3', vel: 125 }]);
  assert.equal(schreibt().length, 2, 'each gesture is one change');
});

test('keyboard: arrows move the cursor, Enter toggles, Delete clears the selection, Ctrl+D duplicates, Escape clears; never in an input', async () => {
  aufbau(projektMit(drums()));
  await zeigen();
  const taste = (key, extra = {}) => zelle(36, 0).dispatch('keydown', { key, ...extra });
  taste('ArrowRight');
  assert.ok(zelle(36, 1).classList.contains('cursor'));
  taste('Enter'); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle[0].noten, [{ beat: 0.25, laenge: 0.125, ton: 36, vel: 100 }]);
  taste('ArrowDown');
  assert.ok(zelle(38, 1).classList.contains('cursor'));
  taste('ArrowRight', { shiftKey: true }); taste('ArrowUp', { shiftKey: true });
  assert.deepEqual(alle('zelle').filter((z) => z.classList.contains('gewaehlt') && Number(z.dataset.schritt) < 16).map((z) => `${z.dataset.ton}:${z.dataset.schritt}`).sort(), ['36:1', '36:2', '38:1', '38:2']);
  taste('Escape');
  assert.equal(alle('zelle').filter((z) => z.classList.contains('gewaehlt')).length, 0);
  zelle(36, 0).dispatch('click', { ctrlKey: true }); zelle(36, 4).dispatch('click', { ctrlKey: true });
  const n = schreibt().length;
  taste('d', { ctrlKey: true }); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle[0].noten.map((x) => x.beat), [1.25, 2.25]);
  taste('Escape');
  zelle(36, 0).dispatch('click', { ctrlKey: true }); zelle(36, 4).dispatch('click', { ctrlKey: true });
  taste('Delete'); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'noten_loeschen', clip_id: 'c_D', ids: ['k0', 'k1'] }]);
  const vorher = schreibt().length;
  assert.equal(vorher, n + 2);
  $w('zeile-laenge').dispatch('keydown', { key: 'Delete' }); await ruhe();
  assert.equal(schreibt().length, vorher, 'keys in an input never reach the grid');
});

test('row head: LENGTH, SWING and direction write zeile_setzen; a bad value is refused', async () => {
  aufbau(projektMit(drums()));
  await zeigen();
  const kopf = (n, ton) => alle(n).find((e) => Number(e.dataset.ton) === ton);
  kopf('zeile-laenge', 38).value = '6'; kopf('zeile-laenge', 38).dispatch('change'); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'zeile_setzen', clip_id: 'c_D', ton: 38, schritte: 6 }]);
  kopf('zeile-swing', 38).value = '40'; kopf('zeile-swing', 38).dispatch('change'); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'zeile_setzen', clip_id: 'c_D', ton: 38, swing: 40 }]);
  kopf('zeile-richtung', 38).dispatch('click'); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'zeile_setzen', clip_id: 'c_D', ton: 38, richtung: 'pendel' }]);
  const n = schreibt().length;
  kopf('zeile-laenge', 38).value = '500'; kopf('zeile-laenge', 38).dispatch('change'); await ruhe();
  assert.equal(schreibt().length, n);
  assert.ok($w('meldung').textContent.includes('row length'));
});

test('a row with its own length draws pale repeats and the end marker; a click on a repeat edits the step it repeats', async () => {
  const extra = [{ id: 's', beat: 0.25, laenge: 0.125, ton: 38, vel: 90 }];
  aufbau(projektMit(drums({ extra, zeilen: { 38: { schritte: 6, swing: 30 } } })));
  await zeigen();
  assert.deepEqual(alle('zelle').filter((z) => Number(z.dataset.ton) === 38 && z.classList.contains('ende')).map((z) => z.dataset.schritt), ['5', '11', '17', '23', '29'], 'end markers over the whole module');
  assert.ok(zelle(38, 7).classList.contains('an') && zelle(38, 7).classList.contains('wiederholung'));
  assert.ok(!zelle(38, 1).classList.contains('wiederholung'));
  assert.equal(alle('zelle').filter((z) => Number(z.dataset.ton) === 36 && z.classList.contains('ende')).length, 0);
  assert.equal(alle('zeile-laenge').find((e) => Number(e.dataset.ton) === 38).value, '6');
  zelle(38, 13).dispatch('click'); await ruhe();   // 13 % 6 = 1
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'noten_loeschen', clip_id: 'c_D', ids: ['s'] }]);
  zelle(38, 12).dispatch('click'); await ruhe();   // 12 % 6 = 0: a new note on step 0, not on step 12
  assert.equal(schreibt().at(-1).koerper.befehle[0].noten[0].beat, 0);
});

test('a pattern of 8 steps in a module of 2 bars shows the module, the repeats pale', async () => {
  const p = drums({ loop: 2 });
  p.clips[0].noten = p.clips[0].noten.filter((n) => n.beat < 2);
  aufbau(projektMit(p, { takte: 2 }));
  await zeigen();
  for (const ton of [36, 38, 39, 42]) assert.equal(alle('zelle').filter((z) => Number(z.dataset.ton) === ton).length, 32);
  assert.equal(alle('zelle').filter((z) => z.classList.contains('wiederholung')).length, 4 * 24);
  assert.equal(alle('bereich-schritt').length, 32);
});

test('a plain press beside a selection only clears it, a press outside the grid clears it too; neither writes', async () => {
  // the DOM stand-in drops document listeners: collect them while the view binds
  const dokument = [], echt = document.addEventListener;
  document.addEventListener = (art, f) => { if (art === 'pointerdown') dokument.push(f); };
  try { aufbau(projektMit(drums())); } finally { document.addEventListener = echt; }
  await zeigen();
  const gewaehlt = () => alle('zelle').filter((z) => z.classList.contains('gewaehlt')).length;
  await geste([zelle(36, 0), zelle(36, 8)], { press: { ctrlKey: true } });
  assert.ok(gewaehlt() > 0);
  await geste([zelle(38, 3), zelle(38, 3)]);   // beside the selection, no modifier
  assert.equal(gewaehlt(), 0, 'the selection is gone');
  assert.equal(schreibt().length, 0, 'and no note changed');
  assert.ok(!zelle(38, 3).classList.contains('an'));
  await geste([zelle(36, 0), zelle(36, 8)], { press: { ctrlKey: true } });
  assert.ok(gewaehlt() > 0);
  dokument.forEach((f) => f({ target: document.createElement('div') })); await ruhe();   // a press on an element outside the grid
  assert.equal(gewaehlt(), 0, 'a press outside the grid clears the selection');
  assert.equal(schreibt().length, 0);
});

test('loop brace: dragging over the steps sets the range in whole beats, a double click removes it, LENGTH clears it first', async () => {
  aufbau(projektMit(drums({ loop: 8 })));   // pattern of 8 beats: 32 steps, a 2-bar grid
  await zeigen();
  const br = (s) => alle('bereich-schritt').find((e) => Number(e.dataset.schritt) === s);
  assert.equal(alle('bereich').length, 1);
  assert.equal(alle('bereich-schritt').length, 32);
  assert.equal(alle('bereich-schritt').filter((e) => e.classList.contains('im')).length, 32, 'without a range the brace shows the module');
  br(4).dispatch('pointerdown', MAUS); br(11).dispatch('pointermove', MAUS); br(11).dispatch('pointerup', {}); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'werkbank_bereich', von_beat: 1, bis_beat: 3 }]);
  br(4).dispatch('pointerdown', MAUS); br(4).dispatch('pointerup', {}); await ruhe();
  assert.equal(schreibt().length, 1, 'a press without a drag sets nothing');

  const gesetzt = projektMit(drums({ loop: 8 }), { takte: 2, werkbank: { schema: 1, laenge_beats: 8 }, loop: { an: true, von_beat: 1, bis_beat: 3 } });
  aufbau(gesetzt);
  await zeigen();
  assert.deepEqual(alle('bereich-schritt').filter((e) => e.classList.contains('im')).map((e) => Number(e.dataset.schritt)), [4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(alle('r-fenster')[0].textContent, 'BAR 1 – 2', 'the module length stays 2 bars while a range is set');
  $w('bereich').dispatch('dblclick'); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'werkbank_bereich', aus: true }]);
  $w('laenge-4').dispatch('click'); await ruhe();
  const b4 = schreibt().at(-1).koerper.befehle;
  assert.deepEqual(b4.slice(0, 3), [{ befehl: 'werkbank_bereich', aus: true }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 }, { befehl: 'clip_aendern', clip_id: 'c_D', loop_beats: 16 }]);
  assert.equal(b4[3].befehl, 'noten_neu', 'the pattern is written into the new bars');
  $w('laenge-2').dispatch('click'); await ruhe();
  assert.deepEqual(schreibt().at(-1).koerper.befehle, [{ befehl: 'werkbank_bereich', aus: true }], 'the same length only clears the range');
});

test('SHIFT of a row moves its hits by one step and wraps inside the row length', () => {
  const clip = { id: 'c1', loop_beats: 4, laenge_beats: 4, zeilen: { 39: { schritte: 6 } },
    noten: [{ id: 'a', ton: 39, beat: 0, laenge: 0.25, vel: 100 }, { id: 'b', ton: 39, beat: 1.25, laenge: 0.25, vel: 100 }, { id: 'k', ton: 36, beat: 3.75, laenge: 0.25, vel: 100 }] };
  // the clap row is 6 steps long (1.5 beats): step 5 wraps to step 0, step 0 back to step 5
  assert.deepEqual(L.schiebeBefehle(clip, 39, 1), [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'a', beat: 0.25 }, { id: 'b', beat: 0 }] }]);
  assert.deepEqual(L.schiebeBefehle(clip, 39, -1), [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'a', beat: 1.25 }, { id: 'b', beat: 1 }] }]);
  // a row without its own length wraps at the pattern; other rows are not touched
  assert.deepEqual(L.schiebeBefehle(clip, 36, 1), [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'k', beat: 0 }] }]);
  assert.deepEqual(L.schiebeBefehle(clip, 40, 1), []);
});
