// panel_wirkung.js: whether a panel control is heard with the current settings, and the Mono Synth rules in its panel file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bedingungGilt, ruhendeSteuerungen } from '../public/panel_wirkung.js';
import { steuerungen } from '../public/panel.js';

const werte = (m) => (id) => m[id];
const opt = (m) => (id) => m[id] ?? 0;

test('ueber, unter, weg, ist, alle, eine', () => {
  assert.equal(bedingungGilt({ ueber: ['a', 0.02] }, werte({ a: 0 }), opt({})), false);
  assert.equal(bedingungGilt({ ueber: ['a', 0.02] }, werte({ a: 0.5 }), opt({})), true);
  assert.equal(bedingungGilt({ unter: ['a', 0.98] }, werte({ a: 1 }), opt({})), false);
  assert.equal(bedingungGilt({ weg: ['a'] }, werte({ a: 0.5 }), opt({})), false);
  assert.equal(bedingungGilt({ weg: ['a'] }, werte({ a: 0.7 }), opt({})), true);
  assert.equal(bedingungGilt({ ist: ['w', [2]] }, werte({ w: 1 }), opt({ w: 3 })), true);
  assert.equal(bedingungGilt({ ist: ['w', [2]] }, werte({ w: 0.5 }), opt({ w: 3 })), false);
  assert.equal(bedingungGilt({ alle: [{ ueber: ['a', 0.1] }, { ueber: ['b', 0.1] }] }, werte({ a: 1, b: 0 }), opt({})), false);
  assert.equal(bedingungGilt({ eine: [{ ueber: ['a', 0.1] }, { ueber: ['b', 0.1] }] }, werte({ a: 1, b: 0 }), opt({})), true);
});

test('an unknown control or a broken rule never greys', () => {
  assert.equal(bedingungGilt({ ueber: ['fehlt', 0.5] }, werte({}), opt({})), true);
  assert.equal(bedingungGilt({ quatsch: 1 }, werte({}), opt({})), true);
  assert.equal(bedingungGilt(null, werte({}), opt({})), true);
});

const mono = JSON.parse(fs.readFileSync(new URL('../../instruments/modular_dsp/paneele/synth-mono.json', import.meta.url), 'utf8'));
const alle = steuerungen(mono);

test('Mono Synth: every rule names controls of the panel', () => {
  const ids = new Set(alle.map((c) => c.id));
  const namen = (b) => (!b ? [] : b.alle ? b.alle.flatMap(namen) : b.eine ? b.eine.flatMap(namen) : [Object.values(b)[0][0]]);
  for (const c of alle.filter((x) => x.wirkt)) for (const n of namen(c.wirkt)) assert.ok(ids.has(n), `${c.id}: ${n}`);
});

test('Mono Synth acid-303 state: osc2, pulse width and sub wave are greyed, cutoff is not', () => {
  // k8 osc mix 0, k9 sub 0, k14 osc1 wave Tri (0), k15 osc2 wave 0.5 (Pulse), k3 env amount 0.377
  const k = { k8: 0, k9: 0, k14: 0, k15: 0.5, k3: 0.377, k47: 0.5, k45: 0, k53: 0.15, k57: 0.22 };
  const r = ruhendeSteuerungen(alle, k);
  for (const id of ['interval', 'detune', 'wave2', 'octave', 'sync', 'pw', 'subwave', 'l2rate']) assert.ok(r[id], id);
  for (const id of ['wave1', 'fattack', 'chmode', 'dtime']) assert.equal(r[id], null, id);
  assert.equal(r.cutoff, undefined);   // no rule: always heard
  const auf = ruhendeSteuerungen(alle, { ...k, k8: 0.5 });
  for (const id of ['interval', 'detune', 'pw']) assert.equal(auf[id], null, id);   // osc2 pulse heard
});

// Every rule of a panel names controls of that panel.
const panel = (name) => steuerungen(JSON.parse(fs.readFileSync(new URL(`../../instruments/modular_dsp/paneele/${name}.json`, import.meta.url), 'utf8')));
const regelnPruefen = (titel, name, mindestens) => test(`${titel}: every rule names controls of the panel`, () => {
  const sts = panel(name);
  const ids = new Set(sts.map((c) => c.id));
  const namen = (b) => (!b ? [] : b.alle ? b.alle.flatMap(namen) : b.eine ? b.eine.flatMap(namen) : [Object.values(b)[0][0]]);
  const mit = sts.filter((x) => x.wirkt);
  assert.ok(mit.length >= mindestens, `${mit.length} rules`);
  for (const c of mit) {
    assert.equal(typeof c.wirkt_text, 'string', `${c.id}: text`);
    for (const n of namen(c.wirkt)) assert.ok(ids.has(n), `${c.id}: ${n}`);
  }
});
regelnPruefen('Poly Synth', 'synth-poly', 20);
regelnPruefen('Neuro Bass', 'synth-neuro', 15);
regelnPruefen('Wavetable Reese', 'wavetable-reese', 4);
regelnPruefen('Wavetable Supersaw', 'wavetable-supersaw', 4);
regelnPruefen('Wavetable Choir', 'wavetable-chor', 4);

test('Poly Synth: osc 2 off, no pulse, warp off and phase mod off grey their controls; the filter envelope and chorus stay', () => {
  // k46 osc 2 level 0, k47 osc 2 wave Saw, k12 pulse 0, k3 env amount 0.5, k7 chorus 0.5, k43 LFO 2 amount 0.5 (off), k59 warp 0, k53 phase mod 0
  const k = { k46: 0, k47: 0, k12: 0, k3: 0.5, k7: 0.5, k43: 0.5, k59: 0, k53: 0 };
  const p = panel('synth-poly');
  const r = ruhendeSteuerungen(p, k);
  for (const id of ['o2det', 'o2sync', 'mosc2', 'pw', 'lpwm', 'l2rate', 'l2target', 'wdepth', 'pmratio']) assert.ok(r[id], id);
  for (const id of ['fattack', 'cmode']) assert.equal(r[id], null, id);
  assert.equal(ruhendeSteuerungen(p, { ...k, k12: 0.5 }).pw, null);              // the pulse is heard
  assert.equal(ruhendeSteuerungen(p, { ...k, k46: 0.5, k47: 1 }).pw, null);      // osc 2 on a pulse wave is heard
});

test('Neuro Bass: vowel filter greys cutoff-bound controls, off effects grey theirs', () => {
  // k7 type Vowel (index 4 of 7), k28 osc 2 level 0, k15 FM 0, k17 ring 0, k43 delay mix 0, k10 env amount 0.5
  const k = { k7: 4 / 6, k28: 0, k15: 0, k17: 0, k43: 0, k10: 0.5 };
  const p = panel('synth-neuro');
  const r = ruhendeSteuerungen(p, k);
  for (const id of ['kf', 'vcut', 'chcut', 'o2det', 'ratio', 'dtime', 'dfb']) assert.ok(r[id], id);
  assert.equal(r.decay, null);
  const tp = ruhendeSteuerungen(p, { ...k, k7: 0.5 });   // Lowpass
  for (const id of ['kf', 'vcut', 'chcut']) assert.equal(tp[id], null, id);
});

test('Wavetable panels: a centred wave envelope, chaos and warp grey their controls, a moved one does not', () => {
  const faelle = [
    ['wavetable-reese', { k7: 0.5, k14: 0.5, k10: 0, k15: 0 }, ['wattack', 'wdecay', 'crate', 'warpdepth', 'subokt']],
    ['wavetable-supersaw', { k7: 0.5, k14: 0.5, k10: 0, k15: 0 }, ['wattack', 'wdecay', 'crate', 'warpdepth', 'chmode']],
    ['wavetable-chor', { k7: 0.5, k14: 0.5, k10: 0, k16: 0 }, ['wattack', 'wdecay', 'crate', 'warpdepth', 'chmode']],
  ];
  for (const [name, k, grau] of faelle) {
    const p = panel(name);
    const r = ruhendeSteuerungen(p, k);
    for (const id of grau) assert.ok(r[id], `${name} ${id}`);
    const auf = ruhendeSteuerungen(p, { ...k, k7: 0.8, k14: 0.2 });
    for (const id of ['wattack', 'wdecay', 'crate']) assert.equal(auf[id], null, `${name} ${id}`);
  }
});
