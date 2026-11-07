// Package 1.9 U4 (O28): the direction table of the RB-338 (projekt/richtung.ts), spec 4.3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ladeVokabular } from '../presets/vokabular.ts';
import { RICHTUNGEN, SCHRITT_BASIS, STAERKE_MAX, richtungsWorte, wendeAn } from '../projekt/richtung.ts';
import { RB_VORGABE_NORM7 } from '../projekt/rb_abbildung.ts';
import { RB_PARAMETER } from '../projekt/modell.ts';

const naeher = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const WORTE = ['aggressive', 'bright', 'dark', 'deep', 'soft', 'tight'];

test('T4.1 table: exactly the six words of spec 4.3, each one a word of the closed vocabulary, each parameter a RB-338 parameter', () => {
  assert.deepEqual(Object.keys(RICHTUNGEN.rb338).sort(), WORTE);
  assert.deepEqual(richtungsWorte('rb338'), WORTE);
  const vok = ladeVokabular();
  for (const wort of Object.keys(RICHTUNGEN.rb338)) {
    assert.ok(vok.inhalt.charakter.includes(wort), `${wort} is not in presets/vokabular.json inhalt.charakter`);
    for (const s of RICHTUNGEN.rb338[wort]) assert.ok(RB_PARAMETER.includes(s.param), `${wort}: ${s.param}`);
  }
  const t = RICHTUNGEN.rb338;
  const form = (w) => t[w].map((s) => `${s.param}${s.vorzeichen > 0 ? '+' : '-'}${s.faktor ?? 1}`).join(' ');
  assert.equal(form('bright'), 'cutoff+1 env_mod+1');
  assert.equal(form('dark'), 'cutoff-1 env_mod-1');
  assert.equal(form('aggressive'), 'resonanz+1 accent+1');
  assert.equal(form('soft'), 'resonanz-1 accent-1');
  assert.equal(form('tight'), 'decay-1');
  assert.equal(form('deep'), 'cutoff-2.5', 'deep: cutoff by 2.5 steps (measured, ledger D58), lautstaerke untouched');
  assert.equal(SCHRITT_BASIS, 0.12);
  assert.equal(STAERKE_MAX, 3);
});

test('T4.1 step: 0.12 x staerke on the plugin default when the track does not hold the parameter yet', () => {
  const d = RB_VORGABE_NORM7;
  const r1 = wendeAn('rb338', {}, 'bright', 1);
  assert.ok(!('grund' in r1), JSON.stringify(r1));
  assert.ok(naeher(r1.parameter.cutoff, d.cutoff + 0.12, 1e-6), `${r1.parameter.cutoff} vs ${d.cutoff + 0.12}`);
  assert.ok(naeher(r1.parameter.env_mod, d.env_mod + 0.12, 1e-6));
  assert.deepEqual(Object.keys(r1.parameter).sort(), ['cutoff', 'env_mod'], 'only the parameters of the word are written');
  const r3 = wendeAn('rb338', { cutoff: 0.5, env_mod: 0.2 }, 'bright', 3);
  assert.ok(naeher(r3.parameter.cutoff, 0.5 + 0.36, 1e-6) && naeher(r3.parameter.env_mod, 0.2 + 0.36, 1e-6), JSON.stringify(r3));
  const dark = wendeAn('rb338', { cutoff: 0.5, env_mod: 0.5, resonanz: 0.7 }, 'dark', 2);
  assert.ok(naeher(dark.parameter.cutoff, 0.5 - 0.24, 1e-6) && naeher(dark.parameter.env_mod, 0.5 - 0.24, 1e-6));
  assert.equal(dark.parameter.resonanz, 0.7, 'a parameter outside the word keeps its value');
  const tief = wendeAn('rb338', { cutoff: 0.5, lautstaerke: 0.3 }, 'deep', 1);
  assert.ok(naeher(tief.parameter.cutoff, 0.5 - 0.3, 1e-6), `2.5 steps: ${tief.parameter.cutoff}`);
  assert.equal(tief.parameter.lautstaerke, 0.3, 'lautstaerke unchanged');
  assert.ok(naeher(wendeAn('rb338', { decay: 0.5 }, 'tight', 1).parameter.decay, 0.38, 1e-6));
  assert.ok(naeher(wendeAn('rb338', { resonanz: 0.1, accent: 0.4 }, 'aggressive', 1).parameter.accent, 0.52, 1e-6));
  assert.ok(naeher(wendeAn('rb338', { resonanz: 0.5, accent: 0.4 }, 'soft', 1).parameter.accent, 0.28, 1e-6));
});

test('T4.1 input: the parameter object passed in is not changed', () => {
  const p = Object.freeze({ cutoff: 0.5 });
  const r = wendeAn('rb338', p, 'bright', 1);
  assert.ok(!('grund' in r));
  assert.deepEqual(p, { cutoff: 0.5 });
});

test('T4.1 clamping (AK-O4): a step never leaves 0..1; at the bound the word answers richtung_grenze', () => {
  const hoch = wendeAn('rb338', { cutoff: 0.95, env_mod: 0.5 }, 'bright', 1);
  assert.equal(hoch.parameter.cutoff, 1, 'clamped at the top, not 1.07');
  assert.ok(naeher(hoch.parameter.env_mod, 0.62, 1e-6), 'the other parameter of the word still moves');
  const tief = wendeAn('rb338', { cutoff: 0.03, env_mod: 0.5 }, 'dark', 3);
  assert.equal(tief.parameter.cutoff, 0, 'clamped at the bottom');
  assert.equal(tief.parameter.env_mod, 0.14);
  // repeat until the bound: every call stays inside 0..1, the last one is richtung_grenze without a change
  let p = {};
  let letzte = null;
  for (let i = 0; i < 40; i += 1) {
    const r = wendeAn('rb338', p, 'bright', 1);
    if ('grund' in r) { letzte = r; break; }
    for (const v of Object.values(r.parameter)) assert.ok(v >= 0 && v <= 1, `step ${i}: ${v}`);
    p = r.parameter;
  }
  assert.ok(letzte, 'richtung_grenze must come within 40 calls');
  assert.equal(letzte.grund, 'richtung_grenze');
  assert.equal(p.cutoff, 1);
  assert.equal(p.env_mod, 1);
  assert.match(letzte.text, /bright/);
});

test('T4.1 refusals: unknown word (with the word list), staerke 0, 4, 1.5, a string', () => {
  const u = wendeAn('rb338', {}, 'warm', 1);
  assert.equal(u.grund, 'richtung_unbekannt');
  for (const w of WORTE) assert.match(u.text, new RegExp(w), `the list names ${w}`);
  assert.equal(wendeAn('rb338', {}, 'Bright', 1).grund, 'richtung_unbekannt', 'the words are lower case');
  assert.equal(wendeAn('rb338', {}, 'constructor', 1).grund, 'richtung_unbekannt', 'no prototype keys');
  for (const s of [0, 4, 1.5, '2', NaN, -1]) assert.equal(wendeAn('rb338', {}, 'bright', s).grund, 'argument_ungueltig', `staerke ${String(s)}`);
  assert.equal(wendeAn('bk', {}, 'bright', 1).grund, 'richtung_unbekannt', 'a device without a table refuses every word');
  // negative control: the harmless input is not refused
  assert.ok(!('grund' in wendeAn('rb338', {}, 'bright', 1)));
});

// --- T4.2 the command geraet_richtung ---------------------------------------------------------------------------------
import { fuehreListeAus, BefehlFehler } from '../projekt/befehle.ts';
import { wende } from '../projekt/patch.ts';
import { kanonisch, pruefeFehler, wiedergabeSicht } from '../projekt/modell.ts';
import { specProjekt } from './hilfen/projekt.mjs';
import { grundCode } from '../bereiche/proj/abbildung.ts';
import { grundText } from '../http/gruende.ts';

const lehntAb = (fn, grund) => assert.throws(fn, (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const rb = (p) => p.spuren.find((s) => s.geraet?.name === 'rb338');

test('T4.2 command: the parameters move, the model stays valid, the playback is reloaded', () => {
  const p = specProjekt();
  const r = fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's2', wort: 'dark' }]);
  const s = rb(r.projekt);
  assert.ok(naeher(s.geraet.parameter.cutoff, RB_VORGABE_NORM7.cutoff - 0.12, 1e-6));
  assert.ok(naeher(s.geraet.parameter.env_mod, RB_VORGABE_NORM7.env_mod - 0.12, 1e-6));
  assert.equal(pruefeFehler(r.projekt), null);
  assert.equal(r.betrifft_wiedergabe, true, 'a changed parameter object is a new playback');
  assert.deepEqual(rb(p).geraet.parameter, {}, 'the input project is untouched');
  assert.notEqual(kanonisch(wiedergabeSicht(p)), kanonisch(wiedergabeSicht(r.projekt)));
  // staerke 2 moves twice as far; the default is 1
  const r2 = fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's2', wort: 'dark', staerke: 2 }]);
  assert.ok(naeher(rb(r2.projekt).geraet.parameter.cutoff, RB_VORGABE_NORM7.cutoff - 0.24, 1e-6));
});

test('T4.2 AK-O3 at model level: the backward patch of the one command restores the parameter object deep-equal', () => {
  const p = specProjekt();
  rb(p).geraet.parameter = { cutoff: 0.6, resonanz: 0.2 };
  const r = fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's2', wort: 'bright', staerke: 3 }]);
  assert.notDeepEqual(rb(r.projekt).geraet.parameter, rb(p).geraet.parameter);
  const zurueck = wende(r.projekt, r.zurueck);
  assert.deepEqual(rb(zurueck).geraet.parameter, { cutoff: 0.6, resonanz: 0.2 });
  assert.equal(kanonisch(zurueck), kanonisch(p), 'the whole project is back, not only the parameters');
  assert.equal(kanonisch(wende(zurueck, r.vor)), kanonisch(r.projekt), 'redo');
});

test('T4.2 AK-O2: an unknown word, a bad staerke and a device without a table are refused and change nothing', () => {
  const p = specProjekt();
  const vorher = kanonisch(p);
  lehntAb(() => fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's2', wort: 'warm' }]), 'richtung_unbekannt');
  try { fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's2', wort: 'warm' }]); } catch (e) {
    for (const w of WORTE) assert.match(e.detail, new RegExp(w), `the refusal lists ${w}`);
  }
  lehntAb(() => fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's2', wort: 'dark', staerke: 0 }]), 'argument_ungueltig');
  lehntAb(() => fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's2', wort: 'dark', staerke: 4 }]), 'argument_ungueltig');
  lehntAb(() => fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's2', wort: 'dark', extra: 1 }]), 'argument_unbekannt');
  lehntAb(() => fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's2' }]), 'argument_ungueltig');
  lehntAb(() => fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 'gibt-es-nicht', wort: 'dark' }]), 'spur_unbekannt');
  lehntAb(() => fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's1', wort: 'dark' }]), 'richtung_unbekannt');   // audio track
  lehntAb(() => fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's3', wort: 'deep' }]), 'richtung_unbekannt');   // Surge has a table since U5, but no word 'deep' (projekt_richtung_surge.test.mjs)
  const bk = specProjekt(); bk.format = 'cypherdj-projekt/2'; bk.gruppen = []; bk.master = { fader_db: 0 };
  bk.spuren[1].geraet = { art: 'intern', name: 'bk', graph: 'g', parameter: {} };
  lehntAb(() => fuehreListeAus(bk, [{ befehl: 'geraet_richtung', spur_id: 's2', wort: 'dark' }]), 'richtung_unbekannt');
  assert.equal(kanonisch(p), vorher);
  // a refusal anywhere in a list refuses the whole list (all or nothing)
  lehntAb(() => fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's2', wort: 'dark' }, { befehl: 'geraet_richtung', spur_id: 's2', wort: 'warm' }]), 'richtung_unbekannt');
  // negative control
  assert.ok(fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's2', wort: 'dark' }]).projekt);
});

test('T4.2 AK-O4 through the command: repeated until the bound, the last call is richtung_grenze, every state valid', () => {
  let p = specProjekt();
  let letzte = null;
  for (let i = 0; i < 20; i += 1) {
    try { p = fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's2', wort: 'soft', staerke: 3 }]).projekt; } catch (e) { letzte = e; break; }
    assert.equal(pruefeFehler(p), null);
  }
  assert.ok(letzte instanceof BefehlFehler);
  assert.equal(letzte.grund, 'richtung_grenze');
  assert.deepEqual([rb(p).geraet.parameter.resonanz, rb(p).geraet.parameter.accent], [0, 0]);
  assert.equal(grundCode('richtung_grenze'), 409);
});

test('T4.2 reasons: richtung_unbekannt is a 404 like the other *_unbekannt, all new reasons have an English text', () => {
  assert.equal(grundCode('richtung_unbekannt'), 404);
  assert.equal(grundCode('preset_unbekannt'), 404);
  for (const g of ['richtung_unbekannt', 'richtung_grenze', 'preset_unbekannt']) assert.match(grundText(g), /^[a-z]/, g);
});
