// Presets (package 1.16): the device catalogue must match the nih-plug parameter IDs in djk/instrumente, and the factory presets
// must keep the values of the compressor presets the plugin itself ships (komp/presets/presets.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GERAETE, EQ_BAENDER } from '../presets/geraete.ts';
import http from 'node:http';
import { PresetSpeicher, WERK_VORGABE } from '../presets/speicher.ts';
import { pruefeWerte, PresetFehler } from '../presets/modell.ts';
import { presetsBereich } from '../presets/bereich.ts';
import { Router } from '../http/router.ts';
import { json } from '../http/transport.ts';

const INSTRUMENTE = path.resolve(import.meta.dirname, '..', '..', 'instrumente');
const idsAusRust = (quelle) => [...fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', '..', quelle), 'utf8').matchAll(/#\[id = "([^"]+)"\]/g)].map((m) => m[1]);

// A kern device (herkunft 'kern') has no #[id] in a Rust source: its table is the header of D5, checked by pruefeKern below.
// `lies` is the Rust reader, injectable so a test can prove that it is never called for a kern device.
function pruefeKatalog(geraete, lies = idsAusRust) {
  for (const g of geraete.filter((x) => (x.herkunft ?? 'plugin') === 'plugin')) {
    const rust = lies(g.quelle);
    assert.ok(rust.length > 0, `${g.id}: no #[id] found in ${g.quelle}`);
    // EQ: the band struct is nested as an array; nih-plug suffixes its IDs with _1.._N
    const erwartet = g.id === 'eq'
      ? [...Array.from({ length: EQ_BAENDER }, (_, i) => rust.slice(0, 7).map((x) => `${x}_${i + 1}`)).flat(), ...rust.slice(7)]
      : rust;
    assert.deepEqual(g.parameter.map((p) => p.name).sort(), [...erwartet].sort(), g.id);
  }
}

test('every catalogue parameter is a #[id] of the Rust plugin and every #[id] is in the catalogue', () => {
  pruefeKatalog(GERAETE);
});

test('the catalogue test fails on a catalogue that lost a parameter (deliberately broken implementation)', () => {
  const kaputt = GERAETE.map((g) => (g.id === 'komp' ? { ...g, parameter: g.parameter.filter((p) => p.name !== 'schp') } : g));
  assert.throws(() => pruefeKatalog(kaputt), assert.AssertionError);
});

test('the EQ band count matches eq_dsp::BAENDER and the nested array is still declared', () => {
  const dsp = fs.readFileSync(path.join(INSTRUMENTE, 'eq_dsp', 'src', 'lib.rs'), 'utf8');
  assert.equal(Number(/pub const BAENDER: usize = (\d+);/.exec(dsp)?.[1]), EQ_BAENDER);
  assert.match(fs.readFileSync(path.join(INSTRUMENTE, 'eq', 'src', 'lib.rs'), 'utf8'), /#\[nested\(array, group = "Band"\)\]/);
});

test('enum values are the #[name] texts of the Rust variants', () => {
  const namen = (datei, aufzaehlung) => {
    const s = fs.readFileSync(path.join(INSTRUMENTE, datei), 'utf8');
    const block = new RegExp(`pub enum ${aufzaehlung} \\{([\\s\\S]*?)\\n\\}`).exec(s)[1];
    // a variant without #[name] is shown under its own identifier
    return [...block.matchAll(/(?:#\[name = "([^"]+)"\]\s*)?(\w+),/g)].map((m) => m[1] ?? m[2]);
  };
  const werte = (geraet, name) => GERAETE.find((g) => g.id === geraet).parameter.find((p) => p.name === name).def.werte;
  assert.deepEqual(werte('eq', 'type_1'), namen('eq/src/lib.rs', 'ArtP'));
  assert.deepEqual(werte('eq', 'slope_8'), namen('eq/src/lib.rs', 'SteilP'));
  assert.deepEqual(werte('eq', 'place_3'), namen('eq/src/lib.rs', 'KanalP'));
  assert.deepEqual(werte('hall', 'fft'), namen('hall/src/lib.rs', 'RahmenP'));
});

test('factory compressor presets carry exactly the values of komp/presets/presets.json', (t) => {
  const quelle = JSON.parse(fs.readFileSync(path.join(INSTRUMENTE, 'komp', 'presets', 'presets.json'), 'utf8'));
  const s = new PresetSpeicher({ werk: WERK_VORGABE, nutzer: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'presets-g-')), 'n') });
  t.after(() => fs.rmSync(path.dirname(s.nutzer), { recursive: true, force: true }));
  const werk = Object.fromEntries(s.liste({ herkunft: 'werk', geraet: 'komp' }).map((e) => [e.name, s.lies('werk', 'komp', e.slug).werte]));
  const { _quelle, ...erwartet } = quelle;
  assert.deepEqual(werk, erwartet);
});

// ---- A8: second kind of device, the four mix tools of the kern (ENTSCHEIDUNGEN D22, Plan A decision D15) ----------------------------
const KOPF = 'djk/kern/stellwerk/include/cypherdj/stellwerk/werkzeug_regler.h';
const KOPF_TEXT = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', '..', KOPF), 'utf8');
const TOOL_GERAET = { gate: 'gate', utility: 'utility', multiband: 'multiband', limiter: 'kanal-limiter' };
const KANALARTEN = { quellen: ['quelle'], quellen_busse: ['quelle', 'bus'], busse: ['bus'] };
const KANAELE = { quellen: 13, quellen_busse: 17, busse: 4, global: 1 };

// Strict parser of the rows of WERKZEUG_ZEILEN: one {...} per line. Any line inside the braces that is not a row throws, and a
// header with no row at all throws, so the comparison below can never be green on an empty table.
function parseKopf(text) {
  const von = text.indexOf('WERKZEUG_ZEILEN[] = {'), bis = text.indexOf('\n};', von);
  if (von < 0 || bis < 0) throw new Error('WERKZEUG_ZEILEN not found in the header');
  const zahl = '(-?\\d+(?:\\.\\d+)?)f?';
  const zeile = new RegExp(`^\\s*\\{WzTool::(\\w+), "([a-z_/]+)", ${zahl}, ${zahl}, ${zahl}, KurvenTyp::(\\w+), (\\d+), (true|false), WzKanalart::(\\w+)\\},$`);
  const zeilen = [];
  for (const roh of text.slice(von, bis).split('\n').slice(1)) {
    const m = zeile.exec(roh);
    if (!m) throw new Error(`header line not understood: ${roh}`);
    zeilen.push({ tool: m[1], suffix: m[2], min: Number(m[3]), max: Number(m[4]), vorgabe: Number(m[5]), kurve: m[6], ms: Number(m[7]), ganz: m[8] === 'true', kanalart: m[9] });
  }
  if (zeilen.length === 0) throw new Error('no row in the header');
  return zeilen;
}
const zeilenZaehlen = (zeilen) => zeilen.reduce((n, z) => n + KANAELE[z.kanalart], 0);
const nameVon = (suffix) => suffix.split('/').slice(1).join('_');   // mb/tief/schwelle -> tief_schwelle, util/phase_l -> phase_l

// Both directions: every row of the header is a parameter of its device with the same range, and every parameter of a kern device is a row.
function pruefeKern(geraete, zeilen) {
  const kern = geraete.filter((g) => g.herkunft === 'kern');
  assert.deepEqual(kern.map((g) => g.id).sort(), ['gate', 'kanal-limiter', 'multiband', 'utility']);
  const nutzbar = zeilen.filter((z) => TOOL_GERAET[z.tool]);
  for (const g of kern) {
    const mein = nutzbar.filter((z) => TOOL_GERAET[z.tool] === g.id);
    assert.deepEqual(g.parameter.map((p) => p.name).sort(), mein.map((z) => nameVon(z.suffix)).sort(), `${g.id}: names`);
    for (const z of mein) {
      const p = g.parameter.find((x) => x.name === nameVon(z.suffix));
      assert.equal(p.pfad, z.suffix, `${g.id}/${p.name}: path`);
      // curve and integer flag per field: a switch is a 'schalter' row, a stepped integer ('stufen', ganz) is flagged on the parameter, the rest is linear
      assert.equal(!!p.ganz, z.ganz, `${g.id}/${p.name}: integer flag`);
      assert.equal(z.kurve, p.def.art === 'schalter' ? 'schalter' : p.ganz ? 'stufen' : 'linear', `${g.id}/${p.name}: curve ${z.kurve}`);
      if (z.kurve === 'schalter') assert.deepEqual(p.def, { art: 'schalter' }, `${g.id}/${p.name}: switch`);
      else { assert.equal(p.def.art, 'zahl', `${g.id}/${p.name}`); assert.deepEqual([p.def.min, p.def.max], [z.min, z.max], `${g.id}/${p.name}: range`); }
    }
    assert.deepEqual(g.kanalArten, KANALARTEN[mein[0].kanalart], `${g.id}: channel kinds`);
    assert.ok(mein.every((z) => z.kanalart === mein[0].kanalart), `${g.id}: one channel set per device`);
    assert.equal(g.quelle, KOPF, `${g.id}: source is the header`);
  }
}

test('A8 the strict header parser reads the real header to 44 suffix rows = 345 controller rows (positive control)', () => {
  const zeilen = parseKopf(KOPF_TEXT);
  assert.equal(zeilen.length, 44);
  assert.equal(zeilenZaehlen(zeilen), 345);
  const lim = zeilen.find((z) => z.suffix === 'lim/decke');
  assert.deepEqual([lim.min, lim.max, lim.vorgabe], [-60, 0, -0.3], 'the 0.3f literal is read as a number');
});

test('A8 the strict header parser throws on a line it does not understand and on an empty table (never an empty green)', () => {
  const kaputt = KOPF_TEXT.replace('{WzTool::gate, "gate/an", 0, 1, 0,', '{WzTool::gate, "gate/an", 0, 1,');
  assert.throws(() => parseKopf(kaputt), /header line not understood/);
  assert.throws(() => parseKopf('inline constexpr WerkzeugZeile WERKZEUG_ZEILEN[] = {\n};\n'), /no row in the header/);
  assert.throws(() => parseKopf('nothing here'), /not found/);
});

test('A8 the four kern devices exist, and names, paths, ranges and channel kinds equal the header in both directions', () => {
  assert.deepEqual(GERAETE.filter((g) => g.herkunft === 'kern').map((g) => g.id), ['gate', 'utility', 'multiband', 'kanal-limiter']);
  assert.deepEqual(GERAETE.filter((g) => g.herkunft === 'kern').map((g) => g.parameter.length), [9, 7, 24, 3]);
  pruefeKern(GERAETE, parseKopf(KOPF_TEXT));
});

test('A8 the plugin devices have no herkunft kern, and the plugin check never reads Rust for a kern device', () => {
  const gelesen = [];
  pruefeKatalog(GERAETE, (q) => { gelesen.push(q); return idsAusRust(q); });
  assert.equal(gelesen.length, 6, 'six plugin devices');
  assert.ok(!gelesen.includes(KOPF), 'the header is not a Rust source');
  assert.ok(GERAETE.filter((g) => g.herkunft !== 'kern').every((g) => g.quelle.endsWith('lib.rs')));
});

test('A8 a deliberately broken catalogue fails: a removed parameter, a range off by one, a dropped header row, a wrong channel kind', () => {
  const zeilen = parseKopf(KOPF_TEXT);
  const aendere = (id, f) => GERAETE.map((g) => (g.id === id ? f(g) : g));
  const ohne = aendere('gate', (g) => ({ ...g, parameter: g.parameter.filter((p) => p.name !== 'hold') }));
  assert.throws(() => pruefeKern(ohne, zeilen), assert.AssertionError);
  const verschoben = aendere('gate', (g) => ({ ...g, parameter: g.parameter.map((p) => (p.name === 'schwelle' ? { ...p, def: { ...p.def, min: -89 } } : p)) }));
  assert.throws(() => pruefeKern(verschoben, zeilen), assert.AssertionError);
  assert.throws(() => pruefeKern(GERAETE, zeilen.filter((z) => z.suffix !== 'util/dc')), assert.AssertionError);
  const falsch = aendere('multiband', (g) => ({ ...g, kanalArten: ['quelle'] }));
  assert.throws(() => pruefeKern(falsch, zeilen), assert.AssertionError);
  // negative control: the untouched catalogue passes
  pruefeKern(GERAETE, zeilen);
});

test('A8 a user preset for gate is accepted by pruefeWerte, an unknown field, a wrong type and an out-of-range value are refused', () => {
  const gate = GERAETE.find((g) => g.id === 'gate');
  const r = pruefeWerte(gate, { an: true, schwelle: -30, bereich: -60, sc: 5 }, true);
  assert.deepEqual(r.werte, { an: true, schwelle: -30, bereich: -60, sc: 5 });
  const fehler = (roh, code) => assert.throws(() => pruefeWerte(gate, roh, true), (e) => e instanceof PresetFehler && e.fehler === code, JSON.stringify(roh));
  fehler({ schwelle: -30, gain: 1 }, 'parameter_unbekannt');
  fehler({ schwelle: 3 }, 'wert_ungueltig');
  fehler({ an: 1 }, 'wert_ungueltig');
  fehler({ sc: 15 }, 'wert_ungueltig');
  // multiband takes the band fields under their flat names
  assert.deepEqual(pruefeWerte(GERAETE.find((g) => g.id === 'multiband'), { tief_schwelle: -20, mitte_umgehen: true, grenze_hoch: 3000 }, true).verworfen, []);
});

test('A8 GET /presets/geraete serves herkunft, kanalArten and the path of every parameter of the kern devices', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-g8-'));
  const router = new Router();
  router.melde(presetsBereich({ log: () => {}, quelle: () => 'andreas' }, { werk: path.join(d, 'werk'), nutzer: path.join(d, 'nutzer') }));
  const server = http.createServer(async (q, a) => {
    const r = router.finde(q.method ?? '', new URL(q.url ?? '/', 'http://127.0.0.1').pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    await r.handler(q, a, new URL(q.url ?? '/', 'http://127.0.0.1'));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => { server.close(); fs.rmSync(d, { recursive: true, force: true }); });
  const j = await (await fetch(`http://127.0.0.1:${server.address().port}/presets/geraete`)).json();
  const kern = j.filter((g) => g.herkunft === 'kern');
  assert.deepEqual(kern.map((g) => [g.id, g.kanalArten]), [['gate', ['quelle']], ['utility', ['quelle', 'bus']], ['multiband', ['bus']], ['kanal-limiter', ['bus']]]);
  assert.equal(kern.find((g) => g.id === 'multiband').parameter.find((p) => p.name === 'tief_schwelle').pfad, 'mb/tief/schwelle');
  assert.equal(j.length, 10);
  assert.ok(j.filter((g) => g.herkunft !== 'kern').every((g) => !('kanalArten' in g)), 'the plugin devices carry no kern fields');
});

test('A8 a user preset for gate and for multiband is saved and read back through the store; a bus-only field name is not a gate field', (t) => {
  const s = new PresetSpeicher({ werk: WERK_VORGABE, nutzer: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'presets-g8s-')), 'n') });
  t.after(() => fs.rmSync(path.dirname(s.nutzer), { recursive: true, force: true }));
  const beschr = { art: 'compressor', unterart: 'channel', charakter: ['tight'], genre: [], einsatz: ['mixdown'], energie: 2, text: 'Tight gate for the tests.' };
  const r = s.speichere({ name: 'Tight Gate', geraet: 'gate', werte: { an: true, schwelle: -35, release: 60 }, beschreibung: beschr });
  assert.deepEqual(s.lies('nutzer', 'gate', r.slug).werte, { an: true, schwelle: -35, release: 60 });
  s.speichere({ name: 'Open Mids', geraet: 'multiband', werte: { mitte_schwelle: -18, mitte_ratio: 3 }, beschreibung: beschr });
  assert.deepEqual(s.liste({ geraet: 'multiband' }).map((e) => e.name), ['Open Mids']);
  assert.throws(() => s.speichere({ name: 'Wrong', geraet: 'gate', werte: { tief_schwelle: -10 }, beschreibung: beschr }), (e) => e instanceof PresetFehler && e.fehler === 'parameter_unbekannt');
});
