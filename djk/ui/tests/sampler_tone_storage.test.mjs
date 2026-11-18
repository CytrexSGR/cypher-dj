// Sampler C task 3: the tone store (make, read, list, root change, delete), tone text and the graph category. Temp folders only.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listeGraphen, normalisierePanel, pruefePanel, reglerBereiche } from '../graphs.ts';
import { SchnittFehler, legeSchnitt } from '../sampler/schnitt.ts';
import { legeTon, liesTon, liesTonVonGraph, listeToene, loescheTon, loescheToeneVon, notenName, setzeGrund, tonGraph, tonKategorieText, tonNachSchnitt, tonText } from '../sampler/tone.ts';

const wurzeln = [];
function neueDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-c3-'));
  wurzeln.push(root);
  const d = { root, ordner: path.join(root, 'sampler'), bk: path.join(root, 'bk'), loops: path.join(root, 'loops'), module: path.join(root, 'module') };
  for (const p of [d.ordner, d.bk, d.loops, d.module]) fs.mkdirSync(p);
  return d;
}
after(() => { for (const r of wurzeln) fs.rmSync(r, { recursive: true, force: true }); });

const FR = 90000;
// a loop of 4 beats (90 000 frames); `ton(i)` = the mono sample of frame i
function schreibeLoop(d, name, ton) {
  const f = new Float32Array(FR * 2);
  for (let i = 0; i < FR; i++) { f[2 * i] = ton(i); f[2 * i + 1] = ton(i); }
  fs.mkdirSync(path.join(d.loops, name));
  fs.writeFileSync(path.join(d.loops, name, 'loop.f32'), Buffer.from(f.buffer));
  fs.writeFileSync(path.join(d.loops, name, 'loop.json'), JSON.stringify({ schema: 1, bpm: 128, beats: 4, frames: FR, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-16T10:00:00Z' }));
}
const rampe = (i) => i;
const saege = (hz) => (i) => 0.5 * (2 * ((i * hz / 48000) % 1) - 1);
const stille = () => 0;
const grenzen16 = Array.from({ length: 17 }, (_, k) => Math.round(k * FR / 16));
// a cut written by hand (the id is chosen by the test), with audio `ton`
function handSchnitt(d, id, { tonart, ton = stille } = {}) {
  const s = { schema: 1, id, name: `Cut ${id}`, quelle: { art: 'loop', ref: 'x' }, bpm: 128, beats: 4, ...(tonart ? { tonart } : {}), frames: FR, methode: 'raster', grenzen: grenzen16,
    guete: Array.from({ length: 16 }, () => ({ staerke: null, raster_abstand_beats: 0 })), erstellt: '2026-11-16T10:00:00Z' };
  fs.mkdirSync(path.join(d.ordner, id), { recursive: true });
  fs.writeFileSync(path.join(d.ordner, id, 'schnitt.json'), JSON.stringify(s));
  const f = new Float32Array(FR * 2);
  for (let i = 0; i < FR; i++) { f[2 * i] = ton(i); f[2 * i + 1] = ton(i); }
  fs.mkdirSync(path.join(d.bk, 'samples'), { recursive: true });
  fs.writeFileSync(path.join(d.bk, 'samples', `smp-${id}.f32`), Buffer.from(f.buffer));
  return s;
}
function baum(p) {
  const aus = [];
  const geh = (x) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const q = path.join(x, e.name); aus.push(path.relative(p, q)); if (e.isDirectory()) geh(q); } };
  geh(p);
  return aus.sort();
}
const mitEnv = (d, f) => {
  const saved = process.env.CYPHERDJ_SAMPLER;
  process.env.CYPHERDJ_SAMPLER = d.ordner;
  try { return f(); } finally { if (saved === undefined) delete process.env.CYPHERDJ_SAMPLER; else process.env.CYPHERDJ_SAMPLER = saved; }
};
const liesJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const fehler = (grund, code) => (e) => e instanceof SchnittFehler && e.grund === grund && (code === undefined || e.code === code);

function einSchnitt() {
  const dirs = neueDirs();
  schreibeLoop(dirs, 'l4', rampe);
  const s = legeSchnitt({ quelle: { art: 'loop', ref: 'l4' } }, dirs);
  return { dirs, s };
}

test('legeTon: region in frames from the cut, files in order, numbers count up', () => {
  const { dirs, s } = einSchnitt();
  const t = legeTon({ schnitt_id: s.id, von: 2, bis: 3 }, dirs);
  assert.deepEqual([t.a, t.b, t.nr, t.graph, t.scheiben], [11250, 22500, 1, `ton-${s.id}-1`, [2, 3]]);
  assert.ok(['erkannt', 'tonart', 'vorgabe'].includes(t.grund_quelle));
  assert.equal(t.name, `${s.name} · 3-4`);
  for (const f of [`${t.graph}.json`, `panels/${t.graph}.json`]) assert.ok(fs.existsSync(path.join(dirs.bk, f)));
  assert.deepEqual(liesJson(path.join(dirs.ordner, s.id, 'ton-1.json')), JSON.parse(JSON.stringify(t)));
  const g = liesJson(path.join(dirs.bk, `${t.graph}.json`));
  assert.deepEqual(g, JSON.parse(JSON.stringify(tonGraph({ graph: t.graph, schnitt_id: s.id, name: t.name, a: 11250, b: 22500, grund: t.grund }))));
  assert.deepEqual(pruefePanel(liesJson(path.join(dirs.bk, 'panels', `${t.graph}.json`)), t.graph, reglerBereiche(g)), []);
  const t2 = legeTon({ schnitt_id: s.id, von: 0 }, dirs);
  assert.deepEqual([t2.nr, t2.scheiben, t2.a, t2.b, t2.name], [2, [0, 0], 0, 5625, `${s.name} · 1`]);
  assert.deepEqual(listeToene(s.id, dirs).map((x) => x.nr), [1, 2]);
  assert.deepEqual(liesTon(s.id, 2, dirs), t2);
  assert.equal(liesTon(s.id, 3, dirs), null);
  assert.deepEqual(liesTonVonGraph(t.graph, dirs), t);
  assert.equal(liesTonVonGraph('ton-unbekannt-1', dirs), null);
  assert.equal(liesTonVonGraph(`ton-${s.id}-9`, dirs), null);
  const t3 = legeTon({ schnitt_id: s.id, von: 1, name: ' Mein Ton ', grund: 40 }, dirs);
  assert.deepEqual([t3.name, t3.grund, t3.grund_quelle], ['Mein Ton', 40, 'hand']);
});

test('the root comes from detection, then from the key, then the default', () => {
  const d = neueDirs();
  handSchnitt(d, 'saege-0001', { ton: saege(220) });
  handSchnitt(d, 'tonart-0002', { tonart: '8A' });
  handSchnitt(d, 'leer-0003');
  const e = legeTon({ schnitt_id: 'saege-0001', von: 2, bis: 3 }, d);
  assert.deepEqual([e.grund, e.grund_quelle, e.erkannt.note], [57, 'erkannt', 57]);
  assert.ok(e.erkannt.konfidenz >= 0.9 && Math.abs(e.erkannt.hz - 220) < 1);
  const k = legeTon({ schnitt_id: 'tonart-0002', von: 0 }, d);
  assert.deepEqual([k.grund, k.grund_quelle, k.erkannt], [69, 'tonart', { note: null, hz: null, konfidenz: 0 }]);
  const v = legeTon({ schnitt_id: 'leer-0003', von: 0 }, d);
  assert.deepEqual([v.grund, v.grund_quelle], [60, 'vorgabe']);
  // a grund given by hand wins over the detection
  assert.deepEqual([legeTon({ schnitt_id: 'saege-0001', von: 0, grund: 70 }, d).grund_quelle, liesTon('saege-0001', 2, d).grund], ['hand', 70]);
});

test('28-character cut ids: names fit and do not collide (review focus 1)', () => {
  const d = neueDirs();
  const x = 'abcdefghijklmnopqrstuvw-9f3c', y = 'abcdefghijklmnopqrstzz-9f3c';
  assert.equal(x.length, 28);
  handSchnitt(d, x); handSchnitt(d, y);
  const a = legeTon({ schnitt_id: x, von: 0 }, d), b = legeTon({ schnitt_id: y, von: 0 }, d);
  assert.notEqual(a.graph, b.graph);
  for (const t of [a, b]) assert.ok(/^ton-[a-z0-9-]+$/.test(t.graph) && t.graph.length <= 32, t.graph);
  assert.equal(a.graph, 'ton-abcdefghijklmnopqrst-9f3c-1');
  assert.equal(b.graph, 'ton-abcdefghijklmnopqrst-9f3c-2');   // same short form: the next number is taken
  assert.deepEqual([liesTonVonGraph(a.graph, d).schnitt_id, liesTonVonGraph(b.graph, d).schnitt_id], [x, y]);
  assert.deepEqual([liesTonVonGraph(a.graph, d).nr, liesTonVonGraph(b.graph, d).nr], [1, 2]);   // the tone number of cut y is the one of its graph name
  assert.deepEqual(listeToene(x, d).map((t) => t.graph), [a.graph]);
});

test('a marker moved later does not move the tone', () => {
  const { dirs, s } = einSchnitt();
  const t = legeTon({ schnitt_id: s.id, von: 2, bis: 3 }, dirs);
  const graphVorher = fs.readFileSync(path.join(dirs.bk, `${t.graph}.json`), 'utf8');
  const sj = path.join(dirs.ordner, s.id, 'schnitt.json');
  const j = liesJson(sj);
  j.grenzen = j.grenzen.map((g, i) => (i === 0 || i === 16 ? g : g + 100));
  fs.writeFileSync(sj, JSON.stringify(j));
  const l = liesTon(s.id, 1, dirs);
  assert.deepEqual([l.a, l.b], [11250, 22500]);
  assert.equal(fs.readFileSync(path.join(dirs.bk, `${t.graph}.json`), 'utf8'), graphVorher);
});

test('setzeGrund changes grund in the graph and nothing else', () => {
  const { dirs, s } = einSchnitt();
  const t = legeTon({ schnitt_id: s.id, von: 2, bis: 3 }, dirs);
  const gf = path.join(dirs.bk, `${t.graph}.json`), pf = path.join(dirs.bk, 'panels', `${t.graph}.json`);
  const panelVorher = fs.readFileSync(pf);
  const vorher = liesJson(gf);
  const t2 = setzeGrund(t.graph, 69, dirs);
  assert.deepEqual([t2.grund, t2.grund_quelle, t2.a, t2.b, t2.nr, t2.name, t2.erkannt], [69, 'hand', t.a, t.b, t.nr, t.name, t.erkannt]);
  const nachher = liesJson(gf);
  const sm = nachher.knoten.find((k) => k.art === 'sampler');
  assert.equal(sm.grund, 440);
  assert.deepEqual(sm.grenzen, [11250, 22500]);
  vorher.knoten.find((k) => k.art === 'sampler').grund = 440;
  assert.deepEqual(nachher, vorher);
  assert.ok(fs.readFileSync(pf).equals(panelVorher));
  assert.deepEqual(liesTon(s.id, 1, dirs), t2);
  for (const n of [15, 96, 60.5, '60', null, NaN]) assert.throws(() => setzeGrund(t.graph, n, dirs), fehler('argument_ungueltig', 400));
  assert.throws(() => setzeGrund('ton-gibt-es-nicht-1', 60, dirs), fehler('ton_unbekannt', 404));
  assert.deepEqual(setzeGrund(t.graph, 16, dirs).grund, 16);
  assert.deepEqual(setzeGrund(t.graph, 95, dirs).grund, 95);
  assert.equal(liesJson(gf).knoten.find((k) => k.art === 'sampler').grund, 440 * 2 ** ((95 - 69) / 12));
});

test('refusals write nothing', () => {
  const { dirs, s } = einSchnitt();
  const vorher = baum(dirs.root);
  const nein = (a, grund, code) => { assert.throws(() => legeTon(a, dirs), fehler(grund, code), JSON.stringify(a)); assert.deepEqual(baum(dirs.root), vorher, JSON.stringify(a)); };
  nein({ schnitt_id: s.id, von: 16 }, 'argument_ungueltig', 400);
  nein({ schnitt_id: s.id, von: -1 }, 'argument_ungueltig', 400);
  nein({ schnitt_id: s.id, von: 1.5 }, 'argument_ungueltig', 400);
  nein({ schnitt_id: s.id, von: 2, bis: 1 }, 'argument_ungueltig', 400);
  nein({ schnitt_id: s.id, von: 2, bis: 16 }, 'argument_ungueltig', 400);
  nein({ schnitt_id: s.id, von: 0, grund: 15 }, 'argument_ungueltig', 400);
  nein({ schnitt_id: s.id, von: 0, grund: 96 }, 'argument_ungueltig', 400);
  nein({ schnitt_id: s.id, von: 0, grund: 60.5 }, 'argument_ungueltig', 400);
  nein({ schnitt_id: s.id, von: 0, name: '' }, 'argument_ungueltig', 400);
  nein({ schnitt_id: s.id, von: 0, name: 'x'.repeat(61) }, 'argument_ungueltig', 400);
  nein({ schnitt_id: 'gibt-es-nicht', von: 0 }, 'schnitt_unbekannt', 404);
  nein({ schnitt_id: '../x', von: 0 }, 'schnitt_unbekannt', 404);
  // 99 tone files present: no number is free
  for (let n = 1; n <= 99; n++) fs.writeFileSync(path.join(dirs.ordner, s.id, `ton-${n}.json`), '{}');
  const voll = baum(dirs.root);
  assert.throws(() => legeTon({ schnitt_id: s.id, von: 0 }, dirs), fehler('toene_voll', 409));
  assert.deepEqual(baum(dirs.root), voll);
});

test('a number whose graph name is taken is skipped (the name is reserved by the graph file)', () => {
  const { dirs, s } = einSchnitt();
  fs.writeFileSync(path.join(dirs.bk, `ton-${s.id}-1.json`), '{"keep":true}');
  const t = legeTon({ schnitt_id: s.id, von: 0 }, dirs);
  assert.equal(t.nr, 2);
  assert.equal(fs.readFileSync(path.join(dirs.bk, `ton-${s.id}-1.json`), 'utf8'), '{"keep":true}');
});

test('a failed write leaves neither graph nor tone file behind', () => {
  const { dirs, s } = einSchnitt();
  fs.rmSync(path.join(dirs.bk, 'panels'), { recursive: true });
  fs.writeFileSync(path.join(dirs.bk, 'panels'), 'not a folder');
  const vorher = baum(dirs.root);
  assert.throws(() => legeTon({ schnitt_id: s.id, von: 0 }, dirs));
  assert.deepEqual(baum(dirs.root), vorher);
  assert.ok(!baum(dirs.bk).some((n) => n.includes('ton-')));
  assert.deepEqual(listeToene(s.id, dirs), []);
});

test('tonText: one line, the sources of the root', () => {
  const d = neueDirs();
  handSchnitt(d, 'saege-0001', { ton: saege(220) });
  handSchnitt(d, 'tonart-0002', { tonart: '8A' });
  handSchnitt(d, 'leer-0003');
  const e = legeTon({ schnitt_id: 'saege-0001', von: 2, bis: 3, name: 'Saw' }, d);
  const kt = tonText(e);
  assert.ok(!kt.includes('\n'));
  assert.ok(/^tone ton-saege-0001-1 "Saw"  cut saege-0001  slices 3-4  root A2 \(note 57, from detection\)  detected A2  confidence (0\.[6-9]\d|1\.00)$/.test(kt), kt);
  assert.equal(tonText(legeTon({ schnitt_id: 'leer-0003', von: 4, name: 'Leer' }, d)), 'tone ton-leer-0003-1 "Leer"  cut leer-0003  slices 5  root C3 (note 60, default)  detected none  confidence 0.00');
  const k = legeTon({ schnitt_id: 'tonart-0002', von: 0, name: 'Key' }, d);
  assert.equal(tonText(k, '8A'), 'tone ton-tonart-0002-1 "Key"  cut tonart-0002  slices 1  root A3 (note 69, from the key 8A)  detected none  confidence 0.00');
  const h = setzeGrund(k.graph, 40, d);
  assert.equal(tonText(h), 'tone ton-tonart-0002-1 "Key"  cut tonart-0002  slices 1  root E1 (note 40, set by hand)  detected none  confidence 0.00');
});

test('category sampler with the tone text; loescheToeneVon removes graphs and panels', () => {
  const { dirs, s } = einSchnitt();
  const t = legeTon({ schnitt_id: s.id, von: 1, bis: 2 }, dirs), t2 = legeTon({ schnitt_id: s.id, von: 4 }, dirs);
  mitEnv(dirs, () => {
    const g = listeGraphen(dirs.bk).graphen.find((x) => x.name === t.graph);
    assert.deepEqual({ kategorie: g.kategorie, text: g.text }, { kategorie: 'sampler', text: `Tone · ${t.name} · root ${notenName(t.grund)}` });
    assert.equal(g.art, 'instrument');
    assert.equal(g.regler_namen['1'], 'Tune');
    assert.equal(tonKategorieText(t.graph), g.text);
    assert.equal(tonKategorieText('ton-gibt-es-nicht-1'), 'Tone from a cut');
    assert.ok(g.text.length <= 90);
  });
  // a stray graph named ton-... without a tone file is filed under sampler too
  fs.writeFileSync(path.join(dirs.bk, 'ton-fremd.json'), fs.readFileSync(path.join(dirs.bk, `${t.graph}.json`)));
  mitEnv(dirs, () => {
    const g = listeGraphen(dirs.bk).graphen.find((x) => x.name === 'ton-fremd');
    assert.deepEqual([g.kategorie, g.text], ['sampler', 'Tone from a cut']);
  });
  fs.rmSync(path.join(dirs.bk, 'ton-fremd.json'));
  assert.deepEqual(loescheToeneVon(s.id, dirs).sort(), [t.graph, t2.graph].sort());
  assert.ok(!baum(dirs.bk).some((n) => n.includes('ton-')), baum(dirs.bk).join(','));
  assert.deepEqual(listeToene(s.id, dirs), []);
  assert.ok(fs.existsSync(path.join(dirs.bk, `smp-${s.id}.json`)), 'the cut device stays');
  assert.deepEqual(loescheToeneVon(s.id, dirs), []);
});

test('loescheTon removes graph, panel and tone file of one tone', () => {
  const { dirs, s } = einSchnitt();
  const t = legeTon({ schnitt_id: s.id, von: 0 }, dirs), t2 = legeTon({ schnitt_id: s.id, von: 1 }, dirs);
  loescheTon(t.graph, dirs);
  assert.ok(!fs.existsSync(path.join(dirs.bk, `${t.graph}.json`)) && !fs.existsSync(path.join(dirs.bk, 'panels', `${t.graph}.json`)));
  assert.equal(liesTon(s.id, 1, dirs), null);
  assert.deepEqual(listeToene(s.id, dirs).map((x) => x.graph), [t2.graph]);
  assert.throws(() => loescheTon(t.graph, dirs), fehler('ton_unbekannt', 404));
  // the freed number is taken again
  assert.equal(legeTon({ schnitt_id: s.id, von: 3 }, dirs).nr, 1);
});

test('after the cut changed the tone follows the new slice numbers; a region off the bounds says so', () => {
  const d = neueDirs();
  const s = handSchnitt(d, 'saege-0001', { ton: saege(220) });
  const auto = legeTon({ schnitt_id: 'saege-0001', von: 4, bis: 5 }, d);      // the default name carries the slice numbers
  const eigen = legeTon({ schnitt_id: 'saege-0001', von: 4, bis: 5, name: 'Mine' }, d);
  assert.equal(auto.name, 'Cut saege-0001 · 5-6');
  assert.deepEqual(tonNachSchnitt(auto, s), auto, 'an unchanged cut changes nothing');
  // a marker before the region is removed: the same audio is slices 4-5 now
  const weg = { ...s, grenzen: s.grenzen.filter((_, i) => i !== 2), guete: s.guete.slice(1) };
  const jetzt = tonNachSchnitt(auto, weg);
  assert.deepEqual([jetzt.scheiben, jetzt.name, jetzt.a, jetzt.b], [[3, 4], 'Cut saege-0001 · 4-5', auto.a, auto.b]);
  assert.equal(tonNachSchnitt(eigen, weg).name, 'Mine', 'a name the owner gave is kept');
  assert.deepEqual(tonNachSchnitt(eigen, weg).scheiben, [3, 4]);
  assert.match(tonText(auto, undefined, weg), /slices 4-5 /);
  // cut again to 4 equal slices: the region is no slice of the cut any more
  const vier = { ...s, grenzen: [0, 22500, 45000, 67500, 90000], guete: s.guete.slice(0, 4) };
  assert.equal(tonNachSchnitt(auto, vier).name, auto.name);
  assert.match(tonText(auto, undefined, vier), new RegExp(`frames ${auto.a}-${auto.b} \\(no slice bounds of the cut any more\\)`));
  assert.match(tonText(auto), /slices 5-6 /, 'without a cut the stored numbers');
});
