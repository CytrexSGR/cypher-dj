// Package 1.16 rest U3a: the rb338 mapping (projekt/rb_abbildung.ts, C2) and the pure apply plan (presets/anwenden.ts, F1, F1a).
// Pure calculation: no server, no core. The routes are in tests/presets_anwenden_route.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { rbNorm, rbPlain, RB_DEFS } from '../projekt/rb_abbildung.ts';
import { RB_VORGABE_NORM, RB_PARAMETER, neuesProjekt } from '../projekt/modell.ts';
import { INSERT_ARTEN } from '../projekt/insert_schluessel.ts';
import { fuehreListeAus } from '../projekt/befehle.ts';
import { planeAnwendung, insertWerteAusPreset, werteVonZiel } from '../presets/anwenden.ts';
import { PresetSpeicher } from '../presets/speicher.ts';
import { PresetFehler } from '../presets/modell.ts';
import { geraetVon } from '../presets/geraete.ts';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const werk = new PresetSpeicher({ nutzer: '/nonexistent-b116' });
const lies = (geraet, slug) => ({ id: `werk:${geraet}/${slug}`, ...werk.lies('werk', geraet, slug) });
const fehler = (f, grund) => { try { f(); } catch (e) { assert.ok(e instanceof PresetFehler, String(e)); assert.equal(e.fehler, grund); return e; } assert.fail(`expected ${grund}`); };

// ---- T3a.1 rb338 mapping ----
// Evaluates the few Rust expressions defs() uses: literals, db_zu_faktor(x), schief(x), schief_pegel(a, b) (f32 maths in Rust, f64 here)
function rustWert(x) {
  const t = x.trim();
  const db = (d) => (d > -100 ? 10 ** (d * 0.05) : 0);
  let m;
  if ((m = /^db_zu_faktor\((-?[\d.]+)\)$/.exec(t))) return db(Number(m[1]));
  if ((m = /^schief\((-?[\d.]+)\)$/.exec(t))) return 2 ** Number(m[1]);
  if ((m = /^schief_pegel\((-?[\d.]+),\s*(-?[\d.]+)\)$/.exec(t))) {
    const a = Number(m[1]), b = Number(m[2]), min = db(a), max = db(b), mitte = db((a + b) / 2);
    return Math.log(0.5) / Math.log((mitte - min) / (max - min));   // Rust 0.5f32.log(x): log of 0.5 to the base x
  }
  if (/^-?[\d.]+$/.test(t)) return Number(t);
  throw new Error(`unknown Rust expression ${t}`);
}
function rustDefs() {
  const src = fs.readFileSync(path.join(REPO, 'djk/instrumente/rb_dsp/src/parameter.rs'), 'utf8');
  const rumpf = /pub fn defs\(\) -> \[Def; 7\] \{([\s\S]*?)\n\}/.exec(src)[1];
  const aus = {};
  for (const m of rumpf.matchAll(/Def \{ id: "(\w+)",[^]*?vorgabe: ([^,]+(?:\([^)]*\))?),\s*bereich: Bereich::(\w+)(?: \{ min: ([^,]+(?:\([^)]*\))?), max: ([^,]+(?:\([^)]*\))?)(?:, faktor: ([^}]+?))? \})?,/g)) {
    aus[m[1]] = { vorgabe: rustWert(m[2]), art: m[3], ...(m[4] ? { min: rustWert(m[4]), max: rustWert(m[5]) } : {}), ...(m[6] ? { faktor: rustWert(m[6]) } : {}) };
  }
  return aus;
}
const nah = (a, b, rel = 1e-6) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

test('rb338 mapping: drift pin against parameter.rs defs() (kind, range, skew factor, default) for all seven parameters', () => {
  const r = rustDefs();
  assert.deepEqual(Object.keys(r), RB_PARAMETER);
  assert.deepEqual(Object.keys(RB_DEFS), RB_PARAMETER);
  for (const [name, d] of Object.entries(r)) {
    const t = RB_DEFS[name];
    assert.equal(t.art, { Linear: 'linear', Schief: 'schief', Schalter: 'schalter' }[d.art], name);
    for (const k of ['min', 'max', 'faktor', 'vorgabe']) {
      if (d[k] === undefined) { assert.equal(t[k], k === 'vorgabe' ? t[k] : undefined, `${name}.${k}`); continue; }
      assert.ok(nah(t[k], d[k]), `${name}.${k}: ${t[k]} vs Rust ${d[k]}`);
    }
  }
});

test('the drift pin fails on a table with one inverted skew factor (deliberately broken table)', () => {
  const r = rustDefs();
  assert.ok(!nah(1 / RB_DEFS.cutoff.faktor, r.cutoff.faktor), 'an inverted cutoff skew factor would be seen');
});

test('rb338 mapping: plain → normalised → Def::wert round trip within 1e-4 for all 10 factory presets; defaults equal RB_VORGABE_NORM', () => {
  const presets = werk.liste({ herkunft: 'werk', geraet: 'rb338' });
  assert.equal(presets.length, 10);
  for (const e of presets) {
    const p = werk.lies('werk', 'rb338', e.slug);
    for (const [name, w] of Object.entries(p.werte)) {
      const plain = typeof w === 'boolean' ? (w ? 1 : 0) : w;
      const n = rbNorm(name, w);
      assert.ok(n >= 0 && n <= 1, `${e.slug}.${name} normalised ${n}`);
      assert.ok(nah(rbPlain(name, n), plain, 1e-4), `${e.slug}.${name}: ${plain} → ${n} → ${rbPlain(name, n)}`);
    }
  }
  for (const k of Object.keys(RB_VORGABE_NORM)) assert.ok(nah(rbNorm(k, RB_DEFS[k].vorgabe), RB_VORGABE_NORM[k], 1e-9), k);
  // the skew direction: cutoff 200 Hz on 40..5000 with factor 1/4 lies at ((160/4960)^0.25), well above the linear 0.032
  assert.ok(nah(rbNorm('cutoff', 200), (160 / 4960) ** 0.25));
  assert.equal(rbNorm('wellenform', true), 1); assert.equal(rbNorm('wellenform', false), 0);
  assert.equal(rbNorm('cutoff', 1e9), 1, 'clamped');
});

// ---- T3a.2 plan builder ----
function projekt() {
  let p = neuesProjekt('T');
  const lauf = (b) => { p = fuehreListeAus(p, b, { quelle: 'andreas' }).projekt; };
  lauf([{ befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: { art: 'intern', name: 'rb338', parameter: { decay: 0.7 } } }]);
  lauf([{ befehl: 'spur_neu', art: 'instrument', name: 'Pad', geraet: { art: 'intern', name: 'bk', graph: 'pad', parameter: { k2: 0.9 } } }]);
  lauf([{ befehl: 'spur_neu', art: 'audio', name: 'Drums' }]);
  lauf([{ befehl: 'insert_setzen', strang_id: 's3', pos: 0, art: 'komp' }]);
  return p;
}
const BK = { id: 'nutzer:baukasten/pad', name: 'Pad', geraet: 'baukasten', graph: 'pad', werte: { lautstaerke: 0.5, knob1: 0.25, knob8: 1 } };

test('plan: rb338 preset on an rb338 track → one spur_aendern with normalised values, kept parameters and the preset id', () => {
  const p = projekt(), pr = lies('rb338', 'dark-dub');
  const plan = planeAnwendung(pr, { art: 'spur', spur_id: 's1' }, p);
  assert.equal(plan.weg, 'proj');
  assert.equal(plan.befehle.length, 1);
  const b = plan.befehle[0];
  assert.deepEqual(Object.keys(b), ['befehl', 'spur_id', 'geraet']);
  assert.deepEqual([b.befehl, b.spur_id, b.geraet.art, b.geraet.name, b.geraet.preset], ['spur_aendern', 's1', 'intern', 'rb338', 'werk:rb338/dark-dub']);
  assert.ok(nah(b.geraet.parameter.cutoff, rbNorm('cutoff', 200)));
  assert.equal(b.geraet.parameter.wellenform, 1);
  assert.deepEqual(Object.keys(b.geraet.parameter).sort(), [...RB_PARAMETER].sort());
  assert.deepEqual(plan.uebersprungen, []); assert.equal(plan.hinweise, undefined);
  assert.match(plan.label, /Dark Dub/);
  // the plan runs as one command list on the project (valid values)
  assert.equal(fuehreListeAus(p, plan.befehle).projekt.spuren[0].geraet.preset, 'werk:rb338/dark-dub');
  // a preset with only some values keeps the track's other parameters
  const teil = planeAnwendung({ id: 'nutzer:rb338/x', name: 'X', geraet: 'rb338', werte: { cutoff: 800 } }, { art: 'spur', spur_id: 's1' }, p);
  assert.deepEqual(Object.keys(teil.befehle[0].geraet.parameter).sort(), ['cutoff', 'decay']);
  assert.equal(teil.befehle[0].geraet.parameter.decay, 0.7);
});

test('plan: baukasten preset on a bk track of the same graph → knobs k1..k8, lautstaerke skipped; another graph → graph_anders', () => {
  const p = projekt();
  const plan = planeAnwendung(BK, { art: 'spur', spur_id: 's2' }, p);
  assert.deepEqual(plan.befehle, [{ befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'intern', name: 'bk', graph: 'pad', parameter: { k2: 0.9, k1: 0.25, k8: 1 }, preset: BK.id } }]);
  assert.deepEqual(plan.uebersprungen, ['lautstaerke']);
  fehler(() => planeAnwendung({ ...BK, graph: 'lead' }, { art: 'spur', spur_id: 's2' }, p), 'graph_anders');
  fehler(() => planeAnwendung(BK, { art: 'spur', spur_id: 's1' }, p), 'geraet_passt_nicht');
  fehler(() => planeAnwendung(lies('rb338', 'dark-dub'), { art: 'spur', spur_id: 's2' }, p), 'geraet_passt_nicht');
  fehler(() => planeAnwendung(lies('rb338', 'dark-dub'), { art: 'spur', spur_id: 's3' }, p), 'geraet_passt_nicht');
});

test('plan: freeze_geht when the target track has a freeze and the values change; no hinweise otherwise', () => {
  // the model allows a freeze only on host tracks (D26), so this state is synthetic: the plan is pure and guards it anyway
  const p = projekt();
  p.spuren[0].freeze = { datei: 'f.f32', frames: 1, kennung: 1, sha256: 'c'.repeat(64) };
  assert.deepEqual(planeAnwendung(lies('rb338', 'dark-dub'), { art: 'spur', spur_id: 's1' }, p).hinweise, ['freeze_geht']);
  const q = projekt();
  assert.equal(planeAnwendung(lies('rb338', 'dark-dub'), { art: 'spur', spur_id: 's1' }, q).hinweise, undefined, 'unfrozen: no hinweise');
});

test('plan: komp preset on a komp stage → insert_werte_setzen with the 8 mapped rows; extsc skipped; insert_neu appends at the chain end', () => {
  const p = projekt(), pr = lies('komp', 'drum-bus');
  const plan = planeAnwendung(pr, { art: 'insert', insert_id: 'i1' }, p);
  assert.deepEqual(plan.befehle, [{ befehl: 'insert_werte_setzen', insert_id: 'i1', preset: 'werk:komp/drum-bus',
    werte: { schwelle: -18, ratio: 4, knie: 6, attack: 30, release: 100, makeup: 3, mix: 1, schp: 90 } }]);
  assert.deepEqual(plan.uebersprungen, ['extsc']);
  const neu = planeAnwendung(pr, { art: 'insert_neu', strang_id: 's3' }, p);
  assert.deepEqual(neu.befehle, [{ befehl: 'insert_setzen', strang_id: 's3', pos: 1, art: 'komp', preset: 'werk:komp/drum-bus',
    werte: { schwelle: -18, ratio: 4, knie: 6, attack: 30, release: 100, makeup: 3, mix: 1, schp: 90 } }]);
  assert.equal(fuehreListeAus(p, neu.befehle).projekt.spuren[2].inserts.length, 2);
  assert.equal(planeAnwendung(pr, { art: 'insert_neu', strang_id: 'master' }, p).befehle[0].pos, 0);
});

test('plan: refusals — hall kein_ziel, a preset of another kind than the stage geraet_passt_nicht, unknown ids ziel_unbekannt, no project kein_projekt, wrong kind', () => {
  const p = projekt();
  for (const ziel of [{ art: 'spur', spur_id: 's1' }, { art: 'insert', insert_id: 'i1' }, { art: 'kanal', kanal: 'deck/1' }]) {
    fehler(() => planeAnwendung(lies('hall', 'big-drop'), ziel, p), 'kein_ziel');
  }
  // integration with 1.10 slice 4b: eq and saett are active kinds now (INSERT_ARTEN_AKTIV), so art_nicht_aktiv is gone for them; the stage i1 is a compressor
  fehler(() => planeAnwendung(lies('eq', 'air-shelf'), { art: 'insert', insert_id: 'i1' }, p), 'geraet_passt_nicht');
  fehler(() => planeAnwendung(lies('saett', 'acid-bite'), { art: 'insert', insert_id: 'i1' }, p), 'geraet_passt_nicht');
  fehler(() => planeAnwendung(lies('komp', 'drum-bus'), { art: 'insert', insert_id: 'i9' }, p), 'ziel_unbekannt');
  fehler(() => planeAnwendung(lies('komp', 'drum-bus'), { art: 'insert_neu', strang_id: 'x9' }, p), 'ziel_unbekannt');
  fehler(() => planeAnwendung(lies('rb338', 'dark-dub'), { art: 'spur', spur_id: 's9' }, p), 'ziel_unbekannt');
  fehler(() => planeAnwendung(lies('rb338', 'dark-dub'), { art: 'spur', spur_id: 's1' }, null), 'kein_projekt');
  fehler(() => planeAnwendung(lies('rb338', 'dark-dub'), { art: 'insert', insert_id: 'i1' }, p), 'geraet_passt_nicht');
  fehler(() => planeAnwendung(lies('komp', 'drum-bus'), { art: 'spur', spur_id: 's3' }, p), 'geraet_passt_nicht');
  fehler(() => planeAnwendung(lies('komp', 'drum-bus'), { art: 'nirgends' }, p), 'ziel_unbekannt');
});

test('plan: channel targets — komp on a source channel → /regler komp fields (D9); kern devices → /regler <kanal>/<pfad>, switches 1/0; kanal_art', () => {
  const k = planeAnwendung(lies('komp', 'drum-bus'), { art: 'kanal', kanal: 'deck/1' }, null);
  assert.deepEqual(k, { weg: 'regler', uebersprungen: ['knee', 'extsc', 'schp'], anfragen: [
    { pfad: 'deck/1/komp/schwelle', nach: -18 }, { pfad: 'deck/1/komp/ratio', nach: 4 }, { pfad: 'deck/1/komp/attack', nach: 30 },
    { pfad: 'deck/1/komp/release', nach: 100 }, { pfad: 'deck/1/komp/makeup', nach: 3 }, { pfad: 'deck/1/komp/mix', nach: 1 }] });
  fehler(() => planeAnwendung(lies('komp', 'drum-bus'), { art: 'kanal', kanal: 'bus/1' }, null), 'kanal_art');
  const gate = { id: 'nutzer:gate/g', name: 'G', geraet: 'gate', werte: { an: true, schwelle: -40 } };
  // Review 1.15: the on switch goes last when it switches the tool on (a preset with `an: false` below sends it first)
  assert.deepEqual(planeAnwendung(gate, { art: 'kanal', kanal: 'erz/2' }, null).anfragen, [{ pfad: 'erz/2/gate/schwelle', nach: -40 }, { pfad: 'erz/2/gate/an', nach: 1 }]);
  fehler(() => planeAnwendung(gate, { art: 'kanal', kanal: 'bus/1' }, null), 'kanal_art');
  fehler(() => planeAnwendung(gate, { art: 'kanal', kanal: 'nix/9' }, null), 'ziel_unbekannt');
  const lim = { id: 'nutzer:kanal-limiter/l', name: 'L', geraet: 'kanal-limiter', werte: { an: false, decke: -1 } };
  assert.deepEqual(planeAnwendung(lim, { art: 'kanal', kanal: 'bus/2' }, null).anfragen, [{ pfad: 'bus/2/lim/an', nach: 0 }, { pfad: 'bus/2/lim/decke', nach: -1 }]);
  fehler(() => planeAnwendung(lies('rb338', 'dark-dub'), { art: 'kanal', kanal: 'deck/1' }, null), 'geraet_passt_nicht');
  fehler(() => planeAnwendung(gate, { art: 'insert', insert_id: 'i1' }, projekt()), 'geraet_passt_nicht');
});

// ---- T3a.3 eq/saett mapping ready for 4b ----
test('eq and saett mapping ready for 4b: every mapped row names a plugin parameter; enums map by index; booleans to 1/0', () => {
  for (const art of ['eq', 'saett']) {
    const g = geraetVon(art);
    for (const q of INSERT_ARTEN[art].parameter) if (q.geraet !== null) assert.ok(g.parameter.some((x) => x.name === q.geraet), `${art}: ${q.geraet}`);
  }
  const w = insertWerteAusPreset('eq', { type_1: 'Bell', type_2: 'Band Pass', slope_1: '48 dB/oct', place_1: 'Side', on_1: true, freq_1: 120, propq: false });
  assert.deepEqual(w.werte, { 'b1/typ': 0, 'b2/typ': 6, 'b1/steil': 3, 'b1/platz': 2, 'b1/an': 1, 'b1/freq': 120, propq: 0 });
  assert.deepEqual(w.uebersprungen, []);
  assert.deepEqual(insertWerteAusPreset('saett', { drive: 6, out: -3, mix: 0.5 }).werte, { drive: 6, out: -3, mix: 0.5 });
  // every factory eq and saett preset maps completely
  for (const art of ['eq', 'saett']) for (const e of werk.liste({ herkunft: 'werk', geraet: art })) {
    assert.deepEqual(insertWerteAusPreset(art, werk.lies('werk', art, e.slug).werte).uebersprungen, [], `${art}/${e.slug}`);
  }
});

test('integration with 1.10 slice 4b: an eq preset on an eq stage and a saett preset as a new stage run on the project (insert_werte_setzen, insert_setzen); save-from-stage reads them back', () => {
  let p = projekt();
  p = fuehreListeAus(p, [{ befehl: 'insert_setzen', strang_id: 's3', pos: 1, art: 'eq' }], { quelle: 'andreas' }).projekt;   // i2 = the eq stage
  const eq = lies('eq', 'air-shelf');
  const plan = planeAnwendung(eq, { art: 'insert', insert_id: 'i2' }, p);
  assert.equal(plan.befehle[0].befehl, 'insert_werte_setzen');
  assert.equal(plan.befehle[0].preset, eq.id);
  assert.ok(Object.keys(plan.befehle[0].werte).length > 10, 'the band rows travel');
  const q = fuehreListeAus(p, plan.befehle).projekt;                                   // the project accepts the eq rows (names, ranges, steps of the kind)
  assert.equal(q.spuren[2].inserts[1].preset, eq.id);
  const neu = planeAnwendung(lies('saett', 'acid-bite'), { art: 'insert_neu', strang_id: 's3' }, q);
  assert.deepEqual([neu.befehle[0].befehl, neu.befehle[0].art], ['insert_setzen', 'saett']);
  assert.equal(fuehreListeAus(q, neu.befehle).projekt.spuren[2].inserts.length, 3);
  // the inverse: the eq stage as a preset (plugin ids), and the values of what was applied come back
  const zurueck = werteVonZiel({ art: 'insert', insert_id: 'i2' }, q);
  assert.equal(zurueck.geraet, 'eq');
  const [name, wert] = Object.entries(eq.werte).find(([k, v]) => k.startsWith('freq_') && v !== 1000) ?? Object.entries(eq.werte).find(([k]) => k.startsWith('freq_'));
  assert.equal(zurueck.werte[name], wert, `${name} round-trips`);
  // negative control: the compressor stage still reads back as komp
  assert.equal(werteVonZiel({ art: 'insert', insert_id: 'i1' }, q).geraet, 'komp');
});
