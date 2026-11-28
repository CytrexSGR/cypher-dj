// The + INSERT entries of the dock (pure): pool counts, utility, plugins, Duck by Kick, the full strip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';

installiere();
const { plusEintraege, PLUS_VOLL_TEXT, DEESSER_WERTE, glueBefehl, masterGlueZustand, MASTER_VOLL_TEXT, GLUE_VORLAGEN } = await import('../public/dock/plus.js');
const { ARTEN, HOST_ART, MAX_PLAETZE, MAX_KOMP, MAX_EQ, MAX_SAETT, MAX_LIM, MAX_UTIL, MAX_GATE, MAX_MB } = await import('../public/production/inserts.js');
const { INSERT_ARTEN } = await import('../project/insert_key.ts');
const { MAX_HOST } = await import('../public/production/limits.js');
const { duckBefehl } = await import('../public/production/key_choice.js');

const ins = (id, art, slot, extra = {}) => ({ id, art, slot, an: true, werte: {}, ...extra });
const spur = (nr, inserts = []) => ({ id: `s${nr}`, nr, name: `T${nr}`, farbe: '#2fd6c3', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'g', parameter: {} }, clips: [], inserts });
const projekt = (spuren) => ({ name: 'M', rev: 1, spuren });
const GRAPHEN = [{ name: 'fx-delay-sync', art: 'effekt' }, { name: 'fx-plate', art: 'effekt' }, { name: 'bass-x', art: 'instrument' }];
const PLUGINS = [
  { id: 'p1', name: 'Fine EQ', art: 'effekt', status: 'bereit' },
  { id: 'p2', name: 'Broken', art: 'effekt', status: 'blockiert', grund: 'x', text: 'Needs a newer host' },
  { id: 'p3', name: 'Synth', art: 'instrument', status: 'bereit' },
];

test('plusEintraege with no options keeps the STUDIO list', () => {
  const e = plusEintraege(projekt([spur(1)]), 's1', GRAPHEN);
  assert.deepEqual(e.map((x) => x.text), ['Compressor', 'Glue', 'EQ', 'De-esser', 'Saturator', 'Clipper', 'Limiter', 'Gate', 'Multiband', 'Transient shaper', 'Imager', 'fx-delay-sync', 'fx-plate']);
  assert.deepEqual(e[2].befehl, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq' });
});

test('util and zaehler: Utility after Limiter and the used/max counts', () => {
  const p = projekt([spur(1, [ins('k1', 'komp', 1)])]);
  const e = plusEintraege(p, 's1', GRAPHEN, { util: true, zaehler: true });
  assert.deepEqual(e.slice(0, 8).map((x) => x.text), [`Compressor 1/${MAX_KOMP}`, `Glue 1/${MAX_KOMP}`, `EQ 0/${MAX_EQ}`, `De-esser 0/${MAX_EQ}`, `Saturator 0/${MAX_SAETT}`, `Clipper 0/${MAX_SAETT}`, `Limiter 0/${MAX_LIM}`, `Utility 0/${MAX_UTIL}`]);
  assert.deepEqual(e[7].befehl, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'utility' });
  assert.deepEqual(e.slice(8, 10).map((x) => x.text), [`Gate 0/${MAX_GATE}`, `Multiband 0/${MAX_MB}`], 'gate and multiband follow the utility');
  assert.deepEqual(e[8].befehl, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'gate' });
  assert.deepEqual(e[9].befehl, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'mb' });
});

test('the + menu lists Gate and Multiband with the contract pools, a full pool greys only its own entry', () => {
  const e0 = plusEintraege(projekt([spur(1)]), 's1', [], { zaehler: true });
  assert.deepEqual(e0.slice(7, 9).map((x) => x.text), [`Gate 0/${INSERT_ARTEN.gate.instanzen}`, `Multiband 0/${INSERT_ARTEN.mb.instanzen}`]);
  const mbs = Array.from({ length: MAX_MB }, (_, i) => ins(`m${i}`, 'mb', i + 1));
  const spuren = Array.from({ length: Math.ceil(MAX_MB / MAX_PLAETZE) }, (_, k) => spur(k + 1, mbs.slice(k * MAX_PLAETZE, (k + 1) * MAX_PLAETZE)));
  const e = plusEintraege(projekt([...spuren, spur(spuren.length + 1)]), `s${spuren.length + 1}`, [], { zaehler: true });
  const mb = e.find((x) => x.text === `Multiband ${MAX_MB}/${MAX_MB}`);
  assert.equal(mb.befehl, null); assert.equal(mb.grund, ARTEN.mb.voll);
  assert.notEqual(e.find((x) => x.text === `Gate 0/${MAX_GATE}`).befehl, null, 'negative control: the gate is still offered');
});

test('a full pool greys its entry with the pool text', () => {
  const eqs = Array.from({ length: MAX_EQ }, (_, i) => ins(`e${i}`, 'eq', i + 1));
  const kette = Array.from({ length: Math.ceil(MAX_EQ / MAX_PLAETZE) }, (_, k) => spur(k + 1, eqs.slice(k * MAX_PLAETZE, (k + 1) * MAX_PLAETZE)));
  const frei = kette.length + 1;
  const p = projekt([...kette, spur(frei)]);
  const e = plusEintraege(p, `s${frei}`, GRAPHEN, { zaehler: true });
  const eq = e.find((x) => x.text === `EQ ${MAX_EQ}/${MAX_EQ}`);
  assert.equal(eq.befehl, null);
  assert.equal(eq.grund, ARTEN.eq.voll);
  assert.notEqual(e.find((x) => x.text === `Compressor 0/${MAX_KOMP}`).befehl, null);
});

test('a strip with five stages greys every entry with the strip text', () => {
  const p = projekt([spur(1, Array.from({ length: MAX_PLAETZE }, (_, i) => ins(`e${i}`, 'eq', i + 1))), spur(2)]);
  const e = plusEintraege(p, 's1', GRAPHEN, { util: true, zaehler: true, plugins: PLUGINS, duck: [{ id: 's2', nr: 2, name: 'T2' }] });
  const eintraege = e.filter((x) => !x.gruppe);
  assert.ok(eintraege.length > 8);
  assert.ok(eintraege.every((x) => x.befehl === null && x.grund === PLUS_VOLL_TEXT));
});

test('plugins: effects only, the blocked one greyed with its reason', () => {
  const e = plusEintraege(projekt([spur(1)]), 's1', [], { zaehler: true, plugins: PLUGINS });
  const i = e.findIndex((x) => x.gruppe && x.text === 'Plugins');
  assert.ok(i >= 0);
  const pl = e.slice(i + 1);
  assert.deepEqual(pl.map((x) => x.text), [`Fine EQ 0/${MAX_HOST}`, `Broken 0/${MAX_HOST}`]);
  assert.deepEqual(pl[0].befehl, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'host', plugin_id: 'p1' });
  assert.equal(pl[1].befehl, null);
  assert.equal(pl[1].grund, 'Needs a newer host');
});

test('plugins: no group when the list is empty or only instruments', () => {
  const e = plusEintraege(projekt([spur(1)]), 's1', [], { plugins: [PLUGINS[2]] });
  assert.ok(!e.some((x) => x.gruppe));
});

test('four host stages in the project grey every plugin entry', () => {
  const hosts = Array.from({ length: MAX_HOST }, (_, i) => ins(`h${i}`, 'host', i + 1));
  const p = projekt([spur(1, hosts), spur(2)]);
  const e = plusEintraege(p, 's2', [], { zaehler: true, plugins: PLUGINS });
  const pl = e.slice(e.findIndex((x) => x.gruppe) + 1);
  assert.equal(pl.length, 2);
  assert.ok(pl.every((x) => x.befehl === null));
  assert.equal(pl[0].grund, HOST_ART.voll);
  assert.equal(pl[0].text, `Fine EQ ${MAX_HOST}/${MAX_HOST}`);
});

test('duck entries write duckBefehl with the label', () => {
  const e = plusEintraege(projekt([spur(1), spur(2)]), 's1', [], { duck: [{ id: 's2', nr: 2, name: 'Kick' }] });
  const i = e.findIndex((x) => x.gruppe && x.text === 'Duck by Kick');
  assert.ok(i >= 0);
  assert.equal(e[i + 1].text, 'Track 2 Kick');
  assert.deepEqual(e[i + 1].befehl, duckBefehl('s1', 's2'));
  assert.equal(e[i + 1].label, 'Duck T1 by Kick');
});

test('De-esser entry: an EQ stage with the D6 values; greyed with the EQ pool text when the pool is empty', () => {
  const e = plusEintraege(projekt([spur(1)]), 's1', GRAPHEN);
  const d = e.find((x) => x.text === 'De-esser');
  assert.equal(d.befehl.befehl, 'insert_setzen'); assert.equal(d.befehl.art, 'eq'); assert.deepEqual(d.befehl.werte, DEESSER_WERTE);
  assert.equal(d.label, 'Add De-esser to T1');
  const eqs = Array.from({ length: MAX_EQ }, (_, i) => ins(`e${i}`, 'eq', i + 1));
  const kette = Array.from({ length: Math.ceil(MAX_EQ / MAX_PLAETZE) }, (_, k) => spur(k + 1, eqs.slice(k * MAX_PLAETZE, (k + 1) * MAX_PLAETZE)));
  const voll = plusEintraege(projekt([...kette, spur(kette.length + 1)]), `s${kette.length + 1}`, GRAPHEN).find((x) => x.text === 'De-esser');
  assert.equal(voll.befehl, null); assert.equal(voll.grund, ARTEN.eq.voll);
});

test('Glue entry: after Compressor, one insert_setzen with the Bus recipe and glue 1; a full komp pool greys only it and the Compressor entry', () => {
  const e = plusEintraege(projekt([spur(1)]), 's1', GRAPHEN);
  assert.equal(e[1].text, 'Glue');
  assert.deepEqual(e[1].befehl, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { ...GLUE_VORLAGEN.bus.werte, glue: 1 } });
  assert.deepEqual(e[1].befehl.werte, { schwelle: -16, ratio: 2, attack: 10, auto: 1, knie: 4, makeup: 2, mix: 1, schp: 60, glue: 1 });
  assert.equal(e[1].label, 'Add Glue to T1');
  const komps = Array.from({ length: MAX_KOMP }, (_, i) => ins(`k${i}`, 'komp', i + 1));
  const kette = Array.from({ length: Math.ceil(MAX_KOMP / MAX_PLAETZE) }, (_, k) => spur(k + 1, komps.slice(k * MAX_PLAETZE, (k + 1) * MAX_PLAETZE)));
  const voll = plusEintraege(projekt([...kette, spur(kette.length + 1)]), `s${kette.length + 1}`, GRAPHEN, { zaehler: true });
  const g = voll.find((x) => x.text === `Glue ${MAX_KOMP}/${MAX_KOMP}`);
  assert.equal(g.befehl, null); assert.equal(g.grund, ARTEN.komp.voll);
  assert.notEqual(voll.find((x) => x.text === `EQ 0/${MAX_EQ}`).befehl, null, 'negative control: the EQ is still offered');
});

test('glueBefehl: the four recipes; an unknown one and a full strip give null', () => {
  const p = projekt([spur(1)]);
  assert.deepEqual(glueBefehl(p, 's1', 2, 'smash').werte, { schwelle: -30, ratio: 10, attack: 0.1, release: 100, auto: 0, knie: 0, makeup: 8, mix: 0.4, schp: 0, glue: 1 });
  assert.equal(glueBefehl(p, 's1', 2, 'smash').pos, 2);
  assert.deepEqual(glueBefehl(p, 's1', undefined, 'drums').werte, { schwelle: -18, ratio: 4, attack: 30, release: 100, auto: 0, knie: 4, makeup: 3, mix: 1, schp: 90, glue: 1 });
  assert.equal(glueBefehl(p, 's1', undefined, 'nope'), null);
  assert.equal(glueBefehl(projekt([spur(1, Array.from({ length: MAX_PLAETZE }, (_, i) => ins(`e${i}`, 'eq', i + 1)))]), 's1'), null);
});

test('masterGlueZustand: lit with a glue compressor; inserts before the clipper, else the limiter, else at the end; full chain disabled', () => {
  const m = (inserts) => ({ ...projekt([spur(1)]), master: { id: 'master', inserts } });
  const clip = ins('c1', 'saett', 1, { werte: { kurve: 2 } }), tanh = ins('t1', 'saett', 2, { werte: { kurve: 0 } }), lim = ins('l1', 'lim', 1);
  assert.equal(masterGlueZustand(m([])).befehl.pos, 0);
  assert.deepEqual(masterGlueZustand(m([])).befehl.werte, { ...GLUE_VORLAGEN.master.werte, glue: 1 });
  assert.equal(masterGlueZustand(m([tanh, clip, lim])).befehl.pos, 1, 'before the first clipper, not before a tanh saturator');
  assert.equal(masterGlueZustand(m([tanh, lim])).befehl.pos, 1, 'before the limiter');
  assert.equal(masterGlueZustand(m([tanh])).befehl.pos, 1, 'at the end');
  const an = ins('k1', 'komp', 1, { werte: { glue: 1 } });
  assert.equal(masterGlueZustand(m([clip, an])).insert, an);
  assert.equal(masterGlueZustand(m([clip, ins('k2', 'komp', 2, { werte: { glue: 0 } })])).insert, null, 'a plain compressor is not glue');
  const voll = masterGlueZustand(m(Array.from({ length: MAX_PLAETZE }, (_, i) => ins(`e${i}`, 'eq', i + 1))));
  assert.equal(voll.befehl, null); assert.equal(voll.grund, MASTER_VOLL_TEXT);
});
