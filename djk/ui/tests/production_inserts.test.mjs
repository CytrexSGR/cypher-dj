// Slice 4a T7: the pure parts of the insert chain (production/inserts.js), run in node. The page tests of the removed INSERTS rows are gone (plan 1.11 task 14);
// the dock tests (dock_teile, dock_plus) and the face and popover tests cover the stages.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { INSERT_ARTEN } from '../project/insert_key.ts';
import { poolVoll } from './support/inserts_scenario.mjs';
import { KOMP_PARAMETER, KOMP_VOLL_TEXT, MAX_PLAETZE, MAX_KOMP, MAX_EQ, MAX_SAETT, MAX_LIM, LIM_PARAMETER, MAX_UTIL, UTIL_PARAMETER, MAX_GATE, MAX_MB, GATE_PARAMETER, MB_KOPF_PARAMETER, MB_BAND_PARAMETER, MB_BAENDER, MB_BAND_NAMEN, parameterNamen, parameterLabel, MAX_BK, BK_PARAMETER, BK_STANDARD_GRAPH, plaetze, neuerInsertBefehl, paramBefehl, preBefehl,
  SAETT_PARAMETER, EQ_KOPF_PARAMETER, EQ_BAND_PARAMETER, EQ_BAENDER, EQ_BAND_TYP_VORGABE, EQ_BAND_FREQ_VORGABE, EQ_TYPEN, EQ_STEIL, EQ_PLATZ, parameterVon, wertText,
  freqVonPos, posVonFreq, POS_MAX, anzahl, frei, ARTEN,
  INS_GR_FRIST_MS, insGrAufnehmen, insGrLesung, insGrLesungArt, insPegelAufnehmen, insPegelLesung, insGrAblaufIn, insGrText } from '../public/production/inserts.js';

const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;

// four audio tracks, one group, two returns; `ketten`: {strangId: n} compressors appended per strip with the real command
function projekt(ketten = {}, art = 'komp') {
  let p = neuesProjekt('Inserts page');
  p = lauf(p, ['Kick', 'Bass', 'Lead', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2', 's3'] }, { befehl: 'return_neu', name: 'Hall' }, { befehl: 'return_neu', name: 'Plate' }]);
  // four more tracks for the tests that place a few stages on several strips; the full pools come from poolVoll
  p = lauf(p, ['T5', 'T6', 'T7', 'T8'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  for (const [strang, n] of Object.entries(ketten)) {
    for (let pos = 0; pos < n; pos++) p = lauf(p, [{ befehl: 'insert_setzen', strang_id: strang, pos, art, ...(art === 'bk' ? { graph: BK_STANDARD_GRAPH } : {}) }]);
  }
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}

test('inserts.js: the literal komp table equals the generated contract, the limits equal the model', () => {
  const vertrag = INSERT_ARTEN.komp.parameter.filter((q) => q.name !== 'an' && q.name !== 'sc');
  assert.deepEqual(KOMP_PARAMETER.map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]), vertrag.map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]));
  assert.equal(MAX_PLAETZE, 5); assert.equal(MAX_KOMP, INSERT_ARTEN.komp.instanzen);
});

test('inserts.js: five places per strip, no gaps; commands; the pool message', () => {
  const p = projekt({ s1: 2 });
  const pl = plaetze(p.spuren[0]);
  assert.equal(pl.length, 5); assert.deepEqual(pl.map((x) => x?.id ?? null), ['i1', 'i2', null, null, null]);
  assert.deepEqual(neuerInsertBefehl(p, 's1'), { befehl: 'insert_setzen', strang_id: 's1', pos: 2, art: 'komp' });
  assert.equal(neuerInsertBefehl(projekt({ s1: 5 }), 's1'), null, 'five stages are the end of a chain');
  const klon = (x) => JSON.parse(JSON.stringify(x));
  assert.equal(neuerInsertBefehl(klon(poolVoll('komp', MAX_KOMP).projekt), 'master'), null, 'the last compressor of the pool is the end of the pool');
  assert.notEqual(neuerInsertBefehl(klon(poolVoll('komp', MAX_KOMP - 1).projekt), 'master'), null, 'negative control: one free compressor is offered');
  assert.equal(KOMP_VOLL_TEXT, 'No free compressor');
  assert.deepEqual(paramBefehl('i1', 'schwelle', -20), { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'schwelle', wert: -20 });
  assert.deepEqual(preBefehl('r1', true), { befehl: 'return_aendern', return_id: 'r1', pre: true });
});

test('inserts.js: gain-reduction readings (/e/ins_gr): taken per slot, clamped, a stale reading is none, foreign addresses and junk are refused', () => {
  const g = {};
  assert.equal(INS_GR_FRIST_MS, 500);
  assert.equal(insGrAufnehmen(g, { kanal: 'ins/komp/3', gr_db: 4.5 }, 1000), true);
  assert.equal(insGrAufnehmen(g, { kanal: `ins/komp/${MAX_KOMP}`, gr_db: -2 }, 1000), true);
  assert.equal(insGrLesung(g, 3, 1100), 4.5);
  assert.equal(insGrLesung(g, MAX_KOMP, 1100), 0, 'a negative reading is clamped to 0');
  assert.equal(insGrLesung(g, 3, 1500), null, 'older than 500 ms: no reading');
  assert.equal(insGrLesung(g, 4, 1100), null, 'never reported');
  assert.equal(insGrAblaufIn(g, 1100), 400);
  assert.equal(insGrAblaufIn(g, 1600), null);
  for (const f of [{ kanal: 'ins/komp/0', gr_db: 1 }, { kanal: `ins/komp/${MAX_KOMP + 1}`, gr_db: 1 }, { kanal: 'bus/1', gr_db: 1 }, { kanal: 'ins/komp/2', gr_db: NaN },
    { kanal: 'ins/komp/2', gr_db: '3' }, { gr_db: 1 }, null]) assert.equal(insGrAufnehmen(g, f, 1000), false, JSON.stringify(f));
  assert.equal(g[2], undefined, 'nothing was taken for slot 2');
  assert.equal(insGrText(null), '–'); assert.equal(insGrText(4.46), '4.5 dB');
});

test('inserts.js T8: limiter readings (ins/lim/1..MAX_LIM) are taken apart from the compressor readings, ins/lim/(MAX_LIM+1), ins/lim/0 and one komp slot beyond the pool are refused, the 500 ms rule holds', () => {
  const g = {};
  assert.equal(insGrAufnehmen(g, { kanal: 'ins/lim/2', gr_db: 3 }, 1000), true);
  assert.equal(insGrLesungArt(g, 'lim', 2, 1100), 3);
  assert.equal(insGrLesungArt(g, 'komp', 2, 1100), null, 'a limiter reading is not the compressor reading of the same number');
  assert.equal(insGrAufnehmen(g, { kanal: 'ins/komp/2', gr_db: 7 }, 1000), true);
  assert.equal(insGrAufnehmen(g, { kanal: 'ins/lim/2', gr_db: 4 }, 1050), true);
  assert.equal(insGrLesungArt(g, 'komp', 2, 1100), 7, 'the limiter reading did not overwrite the compressor reading');
  assert.equal(insGrLesungArt(g, 'lim', 2, 1100), 4);
  assert.equal(insGrLesungArt(g, 'lim', 2, 1549), 4);
  assert.equal(insGrLesungArt(g, 'lim', 2, 1550), null, '500 ms after the reading: none');
  assert.equal(insGrAufnehmen(g, { kanal: 'ins/lim/1', gr_db: -1 }, 1000), true);
  assert.equal(insGrLesungArt(g, 'lim', 1, 1100), 0, 'clamped to 0');
  for (const f of [{ kanal: `ins/lim/${MAX_LIM + 1}`, gr_db: 1 }, { kanal: 'ins/lim/0', gr_db: 1 }, { kanal: `ins/komp/${MAX_KOMP + 1}`, gr_db: 1 }, { kanal: 'ins/lim/1', gr_db: NaN }, { kanal: 'ins/eq/1', gr_db: 1 }]) {
    assert.equal(insGrAufnehmen(g, f, 1000), false, JSON.stringify(f));
  }
  assert.equal(g[`lim${MAX_LIM + 1}`], undefined);
});

test('inserts.js strand 1 slice 4: gate and multiband readings (ins/gate/<n>, ins/mb/<n>) are stored per kind and slot, bounded by their pools', () => {
  const g = {};
  assert.equal(insGrAufnehmen(g, { kanal: `ins/gate/${MAX_GATE}`, gr_db: 12 }, 1000), true);
  assert.equal(insGrAufnehmen(g, { kanal: `ins/mb/${MAX_MB}`, gr_db: 3 }, 1000), true);
  assert.equal(insGrAufnehmen(g, { kanal: 'ins/mb/1', gr_db: 2 }, 1000), true);
  assert.equal(insGrLesungArt(g, 'gate', MAX_GATE, 1100), 12);
  assert.equal(insGrLesungArt(g, 'mb', MAX_MB, 1100), 3);
  assert.equal(insGrLesungArt(g, 'komp', 1, 1100), null, 'a multiband reading is not the compressor reading of the same number');
  assert.equal(insGrLesungArt(g, 'mb', MAX_MB, 1500), null, '500 ms rule');
  for (const f of [{ kanal: `ins/gate/${MAX_GATE + 1}`, gr_db: 1 }, { kanal: `ins/mb/${MAX_MB + 1}`, gr_db: 1 }, { kanal: 'ins/mb/0', gr_db: 1 }]) assert.equal(insGrAufnehmen(g, f, 1000), false, JSON.stringify(f));
  assert.equal(insPegelAufnehmen({}, { kanal: 'ins/mb/2', ein_db: -6, aus_db: -9 }, 1000), true);
  assert.equal(insPegelAufnehmen({}, { kanal: `ins/gate/${MAX_GATE + 1}`, ein_db: -6, aus_db: -9 }, 1000), false);
});

test('inserts.js T9: level readings (/e/stufe_pegel) are taken for ins/komp/1..MAX_KOMP and ins/lim/1..MAX_LIM, refused for everything else and for non-finite values, 500 ms rule', () => {
  const g = {};
  assert.equal(insPegelAufnehmen(g, { kanal: 'ins/komp/3', ein_db: -12, aus_db: -15.2 }, 1000), true);
  assert.equal(insPegelAufnehmen(g, { kanal: 'ins/lim/2', ein_db: -3, aus_db: -6 }, 1000), true);
  assert.equal(insPegelAufnehmen(g, { kanal: `ins/komp/${MAX_KOMP}`, ein_db: -200, aus_db: -200 }, 1000), true, 'silence is a report');
  assert.deepEqual(insPegelLesung(g, 'ins/komp/3', 1100), { ein: -12, aus: -15.2 });
  assert.deepEqual(insPegelLesung(g, 'ins/lim/2', 1100), { ein: -3, aus: -6 });
  assert.deepEqual(insPegelLesung(g, `ins/komp/${MAX_KOMP}`, 1100), { ein: -200, aus: -200 }, 'the -200 is kept, the face turns it into a dash');
  assert.equal(insPegelLesung(g, 'ins/komp/3', 1500), null, '500 ms after the report: none');
  assert.equal(insPegelLesung(g, 'ins/komp/4', 1100), null, 'never reported');
  assert.equal(insPegelLesung(g, `ins/lim/${MAX_LIM + 1}`, 1100), null);
  for (const f of [{ kanal: `ins/komp/${MAX_KOMP + 1}`, ein_db: -1, aus_db: -1 }, { kanal: 'ins/komp/0', ein_db: -1, aus_db: -1 }, { kanal: `ins/lim/${MAX_LIM + 1}`, ein_db: -1, aus_db: -1 }, { kanal: 'bus/1', ein_db: -1, aus_db: -1 },
    { kanal: 'komp/erz/1', ein_db: -1, aus_db: -1 }, { kanal: 'ins/eq/1', ein_db: -1, aus_db: -1 }, { kanal: 'ins/komp/2', ein_db: NaN, aus_db: -1 }, { kanal: 'ins/komp/2', ein_db: -1, aus_db: Infinity },
    { kanal: 'ins/komp/2', ein_db: '-1', aus_db: -1 }, { kanal: 'ins/komp/2', ein_db: -1 }, { ein_db: -1, aus_db: -1 }, null]) assert.equal(insPegelAufnehmen(g, f, 1000), false, JSON.stringify(f));
  assert.equal(g['ins/komp/2'], undefined, 'nothing was taken for slot 2');
});

// ---- slice 4b T12: the eq and saturator parts of the page --------------------------------------------------------------------------------------
const vertragWerte = (art) => INSERT_ARTEN[art].parameter.filter((q) => q.name !== 'an' && q.name !== 'sc');
test('inserts.js 4b: the literal saturator and EQ tables equal the generated contract (range, default, unit, integer steps), all eight bands', () => {
  assert.deepEqual(SAETT_PARAMETER.map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]), vertragWerte('saett').map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]));
  assert.equal(MAX_EQ, INSERT_ARTEN.eq.instanzen); assert.equal(MAX_SAETT, INSERT_ARTEN.saett.instanzen);
  assert.deepEqual(LIM_PARAMETER.map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]), vertragWerte('lim').map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]));
  assert.equal(MAX_LIM, INSERT_ARTEN.lim.instanzen);
  assert.deepEqual(UTIL_PARAMETER.map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]), vertragWerte('utility').map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]), 'arr-fx: the utility table');
  assert.equal(MAX_UTIL, INSERT_ARTEN.utility.instanzen);
  assert.deepEqual(BK_PARAMETER.map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]), vertragWerte('bk').map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]), 'arr-bk: the knob table k1..k8');
  assert.equal(MAX_BK, INSERT_ARTEN.bk.instanzen);
  assert.deepEqual(GATE_PARAMETER.map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]), vertragWerte('gate').map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]), 'the gate table');
  assert.equal(MAX_GATE, INSERT_ARTEN.gate.instanzen); assert.equal(MAX_MB, INSERT_ARTEN.mb.instanzen);
  // the multiband: two crossover rows and the same rows for each of the three bands, nothing more and nothing less than the contract
  const mb = Object.fromEntries(vertragWerte('mb').map((q) => [q.name, q]));
  assert.equal(Object.keys(mb).length, MB_KOPF_PARAMETER.length + MB_BAENDER * MB_BAND_PARAMETER.length);
  for (const q of MB_KOPF_PARAMETER) assert.deepEqual([q.min, q.max, q.vorgabe, q.einheit], [mb[q.name].min, mb[q.name].max, mb[q.name].vorgabe, mb[q.name].einheit], q.name);
  for (let m = 1; m <= MB_BAENDER; m++) for (const q of MB_BAND_PARAMETER) {
    const v = mb[`b${m}/${q.name}`], l = parameterVon('mb', `b${m}/${q.name}`);
    assert.ok(v, `b${m}/${q.name} is in the contract`);
    assert.deepEqual([l.min, l.max, l.vorgabe, l.einheit], [v.min, v.max, v.vorgabe, v.einheit], `b${m}/${q.name}`);
    assert.equal(q.typ === 'schalter', v.ganz, `${q.name}: a switch is an integer row`);
  }
  assert.deepEqual(MB_BAND_NAMEN, ['Low', 'Mid', 'High']);
  assert.deepEqual(parameterNamen('mb'), vertragWerte('mb').map((q) => q.name), 'popover order = contract order');
  assert.equal(parameterLabel('mb', 'b2/ratio'), 'Mid band Ratio'); assert.equal(parameterLabel('eq', 'b2/freq'), 'Band 2 Frequency');
  assert.equal(wertText('mb', 'b1/ratio', 4), '4.0:1'); assert.equal(wertText('gate', 'ratio', 100), '100.0:1');
  assert.equal(wertText('gate', 'release', 250), '250 ms'); assert.equal(wertText('mb', 'grenze_tief', 200), '200 Hz'); assert.equal(wertText('mb', 'b3/umgehen', 1), 'on');
  const eq = Object.fromEntries(vertragWerte('eq').map((q) => [q.name, q]));
  for (const q of EQ_KOPF_PARAMETER) assert.deepEqual([q.min, q.max, q.vorgabe, q.einheit], [eq[q.name].min, eq[q.name].max, eq[q.name].vorgabe, eq[q.name].einheit], q.name);
  assert.equal(EQ_BAENDER, 8);
  for (let m = 1; m <= EQ_BAENDER; m++) {
    for (const q of EQ_BAND_PARAMETER) {
      const v = eq[`b${m}/${q.name}`], l = parameterVon('eq', `b${m}/${q.name}`);
      assert.ok(v, `b${m}/${q.name} is in the contract`);
      assert.deepEqual([l.min, l.max, l.vorgabe, l.einheit], [v.min, v.max, v.vorgabe, v.einheit], `b${m}/${q.name}`);
      assert.equal(q.typ === 'wahl' || q.typ === 'schalter' || q.name === 'typ', v.ganz, `${q.name}: a select or switch is an integer row`);
    }
  }
  assert.equal(Object.keys(eq).length, EQ_KOPF_PARAMETER.length + EQ_BAENDER * EQ_BAND_PARAMETER.length, 'the page offers every row of the contract, no more');
  assert.deepEqual(EQ_BAND_TYP_VORGABE, [1, 2, 3, 4, 5, 6, 7, 8].map((m) => eq[`b${m}/typ`].vorgabe));
  assert.deepEqual(EQ_BAND_FREQ_VORGABE, [1, 2, 3, 4, 5, 6, 7, 8].map((m) => eq[`b${m}/freq`].vorgabe));
  assert.equal(EQ_TYPEN.length, eq['b1/typ'].max + 1); assert.equal(EQ_STEIL.length, eq['b1/steil'].max + 1); assert.equal(EQ_PLATZ.length, eq['b1/platz'].max + 1);
});

test('inserts.js 4b: the log frequency slider maps both ends exactly and round-trips; value texts; pool counts per kind', () => {
  assert.equal(freqVonPos(0), 10); assert.ok(Math.abs(freqVonPos(POS_MAX) - 22000) < 1e-6);
  for (const f of [10, 30, 100, 1000, 2500, 18000, 22000]) assert.ok(Math.abs(freqVonPos(posVonFreq(f)) / f - 1) < 0.01, `${f} Hz survives the slider`);
  assert.equal(posVonFreq(5), 0, 'below the range clamps'); assert.equal(posVonFreq(99999), POS_MAX);
  assert.equal(wertText('eq', 'b1/typ', 3), 'Low cut'); assert.equal(wertText('eq', 'b2/steil', 1), '24 dB/oct'); assert.equal(wertText('eq', 'b3/platz', 2), 'Side');
  assert.equal(wertText('eq', 'b4/freq', 2500), '2.50 kHz'); assert.equal(wertText('eq', 'b4/freq', 80), '80.0 Hz'); assert.equal(wertText('eq', 'b4/q', 0.707), '0.71');
  assert.equal(wertText('eq', 'propq', 1), 'on'); assert.equal(wertText('saett', 'mix', 0.5), '50 %'); assert.equal(wertText('saett', 'drive', 12), '12.0 dB');
  assert.equal(wertText('komp', 'ratio', 4), '4.0:1', 'the compressor keeps its 4a texts');
  assert.throws(() => wertText('eq', 'b9/gain', 0)); assert.throws(() => wertText('saett', 'schwelle', 0));
  assert.equal(wertText('lim', 'decke', -1), '-1.0 dB'); assert.equal(wertText('lim', 'abklingen', 80), '80 ms');
  assert.throws(() => wertText('lim', 'schwelle', 0));
  // arr-fx: the utility texts (width as a percentage, mono below as a frequency or off, balance as a side)
  assert.equal(wertText('utility', 'breite', 1), '100 %'); assert.equal(wertText('utility', 'breite', 1.5), '150 %'); assert.equal(wertText('utility', 'breite', 4), '400 %');
  assert.equal(wertText('utility', 'mono_unter', 0), 'off'); assert.equal(wertText('utility', 'mono_unter', 120), '120 Hz'); assert.equal(wertText('utility', 'mono_unter', 5), '20 Hz', 'the module clamps 1..19 to 20');
  assert.equal(wertText('utility', 'gain', 6), '6.0 dB'); assert.equal(wertText('utility', 'balance', 0), 'centre'); assert.equal(wertText('utility', 'balance', -0.5), 'L 50 %');
  assert.throws(() => wertText('utility', 'schwelle', 0));
  const pu = projekt({ s1: 3, master: 1 }, 'utility');
  assert.deepEqual([anzahl(pu, 'utility'), frei(pu, 'utility')], [4, 4], 'four of eight utilities placed on a track and the master');
  assert.notEqual(neuerInsertBefehl(pu, 's2', 'utility'), null);
  const p1 = projekt({ s1: 1 }, 'eq');
  assert.deepEqual([anzahl(p1, 'eq'), frei(p1, 'eq')], [1, MAX_EQ - 1], 'one EQ placed, the rest of the pool is free');
  assert.deepEqual(neuerInsertBefehl(p1, 's1', 'eq'), { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'eq' }, 'negative control: the second EQ is offered');
  const p = projekt({ s1: 2 }, 'eq');
  assert.deepEqual([anzahl(p, 'eq'), frei(p, 'eq'), anzahl(p, 'komp'), frei(p, 'komp'), frei(p, 'saett')], [2, MAX_EQ - 2, 0, MAX_KOMP, MAX_SAETT]);
  const pv = JSON.parse(JSON.stringify(poolVoll('eq', MAX_EQ).projekt));
  assert.deepEqual([anzahl(pv, 'eq'), frei(pv, 'eq')], [MAX_EQ, 0], 'the pool of EQs is placed');
  assert.equal(neuerInsertBefehl(pv, 'master', 'eq'), null, 'the pool of EQs is empty');
  assert.notEqual(neuerInsertBefehl(pv, 'master', 'saett'), null, 'negative control: a saturator is still offered');
  assert.deepEqual(neuerInsertBefehl(p, 's1', 'saett'), { befehl: 'insert_setzen', strang_id: 's1', pos: 2, art: 'saett' });
  assert.deepEqual(neuerInsertBefehl(p, 's1'), { befehl: 'insert_setzen', strang_id: 's1', pos: 2, art: 'komp' }, 'the default kind is the compressor');
  assert.equal(neuerInsertBefehl(p, 's1', 'host'), null, 'an unknown kind');
  assert.deepEqual(neuerInsertBefehl(p, 's1', 'bk'), { befehl: 'insert_setzen', strang_id: 's1', pos: 2, art: 'bk', graph: BK_STANDARD_GRAPH }, 'arr-bk: the Fx button names the shipped delay');
  assert.deepEqual(Object.keys(ARTEN), ['komp', 'eq', 'saett', 'lim', 'utility', 'gate', 'mb', 'bk']);
  const pl = projekt({ s1: 1 }, 'lim');
  assert.deepEqual([anzahl(pl, 'lim'), frei(pl, 'lim')], [1, MAX_LIM - 1], 'one of the limiters of the pool is placed');
  assert.notEqual(neuerInsertBefehl(pl, 's2', 'lim'), null, 'negative control: the next limiter is offered');
  const pl2 = JSON.parse(JSON.stringify(poolVoll('lim', MAX_LIM).projekt));
  assert.deepEqual([anzahl(pl2, 'lim'), frei(pl2, 'lim')], [MAX_LIM, 0], 'every limiter of the pool is placed');
  assert.equal(neuerInsertBefehl(pl2, 'master', 'lim'), null, 'the pool of limiters is empty');
  assert.notEqual(neuerInsertBefehl(pl, 's2', 'komp'), null, 'negative control: a compressor is still offered');
});

test('page 4b: production.js says the new reasons in words (art_unbekannt, ins_voll); the temporary pdc_fehlt is gone', () => {
  const t = fs.readFileSync(new URL('../public/production/production.js', import.meta.url), 'utf8');
  assert.doesNotMatch(t, /pdc_fehlt/);
  assert.match(t, /art_unbekannt: 'That insert kind is not available \(compressor, EQ, saturator, limiter, utility, gate, multiband and effect graph exist/);
  assert.match(t, /ins_voll: 'All stages of that kind are in use/);
});

