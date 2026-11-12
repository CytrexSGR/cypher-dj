// Front panels task 11: the shipped Surge panel and the live adapter (stub post and timer).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { anzeigeWert, anzeigeText, zeitInSekunden } from '../public/panel_display.js';
import { anzeigeWert as serverAnzeige } from '../devices_parameter.ts';
import { surgeAdapter, surgeAnzeige, surgeNorm, vergesseGesendet, surgeFensterKnopf, surgeFensterSenden } from '../public/surge_adapter.js';
import { steuerungen, parameterVon } from '../public/panel.js';
import { pruefePanel } from '../graphs.ts';
import { parameterTabelle, pfadeVon } from '../devices_parameter.ts';

const bereiche = JSON.parse(fs.readFileSync(path.join(pfadeVon().wurzel, 'djk', 'hosts', 'carla', 'surge_bereiche.json'), 'utf8')).parameter;
const panel = JSON.parse(fs.readFileSync(path.join(pfadeVon().paneele, 'surge.json'), 'utf8'));

test('shipped surge panel: valid, titled Surge quick panel, at most 64 bound parameters, every bound name is in surge_bereiche.json (so fahrbar), accent gruen, covers the curated set', () => {
  const tabelle = parameterTabelle({ art: 'surge' });
  assert.equal(panel.akzent, 'gruen');
  assert.equal(panel.title, 'Surge quick panel');
  assert.deepEqual(pruefePanel(panel, 'surge', {}, tabelle.map((p) => p.name)), []);
  const namen = steuerungen(panel).flatMap(parameterVon);
  assert.ok(namen.length > 0 && namen.length <= 64, `${namen.length} controls`);   // POST /klang ist takes at most 64 names per call (server.ts)
  assert.equal(new Set(namen).size, namen.length, 'every parameter is bound once');
  for (const n of namen) assert.ok(bereiche[n], `${n} is in surge_bereiche.json`);
  for (const n of ['a_filter1_cutoff', 'a_filter1_resonance', 'a_filter1_envmod', 'a_env1_attack', 'a_env1_decay', 'a_env1_sustain', 'a_env1_release', 'a_level_o1', 'a_level_o2', 'a_level_o3', 'a_lfo1_rate', 'a_lfo1_magnitude', 'a_send_fx_1']) assert.ok(namen.includes(n), n);
});

test('shipped surge panel: the sections of surge.md in the rows of the family table, both EGs draw their envelope from the log2 s controls', () => {
  const ids = panel.sections.map((x) => x.id);
  assert.deepEqual(panel.layout.rows, [['osc1', 'osc2', 'osc3', 'mix', 'filt1', 'filt2', 'feg', 'aeg'], ['lfo1', 'lfo2', 'fx', 'out']]);
  assert.deepEqual([...panel.layout.rows.flat()].sort(), [...ids].sort(), 'every section is in exactly one row');
  const alle = panel.sections.flatMap((x) => x.controls);
  const hue = alle.filter((c) => c.type === 'huelle');
  assert.equal(hue.length, 2);
  for (const h of hue) for (const k of ['a', 'd', 'r']) {
    const c = alle.find((x) => x.id === h.of[k]);
    assert.equal(c.unit, 'log2 s', `${h.id}.${k}`);
    assert.ok(/^a_env[12]_(attack|decay|release)$/.test(c.bind.param), c.bind.param);
  }
  assert.equal(alle.find((x) => x.id === hue[0].of.s).bind.param.endsWith('_sustain'), true);
});

test('envelope time unit: log2 s is exponentiated (Surge: 2^x seconds), any other unit stays seconds', () => {
  assert.equal(zeitInSekunden(2, 'log2 s'), 4);
  assert.equal(zeitInSekunden(-8, 'log2 s'), 2 ** -8);
  assert.equal(zeitInSekunden(0.3, 's'), 0.3);
  assert.equal(zeitInSekunden(0.3, undefined), 0.3);
});

test('window button: text follows the state, the host reason shows under the header, a refusal shows its text, the request goes to POST /klang fenster', async () => {
  assert.match(surgeFensterKnopf(false), /Open Surge window/);
  assert.match(surgeFensterKnopf(true), /Close Surge window/);
  assert.match(surgeFensterKnopf(true), /aria-pressed="true"/);
  const posts = [];
  const mit = (antwort) => async (pfad, body) => { posts.push([pfad, body]); return antwort; };
  assert.deepEqual(await surgeFensterSenden(mit({ ok: true, code: 200, j: { ok: true, fenster: true } }), 'bass', true), { an: true, hinweis: '' });
  assert.deepEqual(posts[0], ['/klang', { gruppe: 'bass', aktion: 'fenster', an: true }]);
  const r = await surgeFensterSenden(mit({ ok: true, code: 200, j: { ok: true, fenster: false, grund: 'keine_anzeige' } }), 'melodie', true);
  assert.equal(r.an, false); assert.match(r.hinweis, /keine_anzeige/); assert.match(r.hinweis, /display/);
  const u = await surgeFensterSenden(mit({ ok: true, code: 200, j: { ok: true, fenster: false, grund: 'anzeige_unerreichbar' } }), 'bass', true);
  assert.match(u.hinweis, /anzeige_unerreichbar/); assert.match(u.hinweis, /not reachable/);
  const k = await surgeFensterSenden(mit({ ok: true, code: 200, j: { ok: true, fenster: false, grund: 'kein_fenster' } }), 'bass', true);
  assert.match(k.hinweis, /kein_fenster/);
  const x = await surgeFensterSenden(mit({ ok: false, code: 409, j: { fehler: 'wirt', text: 'no host' } }), 'bass', true);
  assert.equal(x.an, false); assert.match(x.hinweis, /no host/);
  const t = await surgeFensterSenden(async () => { throw new Error('offline'); }, 'bass', false);
  assert.equal(t.an, false); assert.match(t.hinweis, /offline/);
  assert.equal((await surgeFensterSenden(mit({ ok: true, code: 200, j: { ok: true, fenster: false } }), 'bass', false)).hinweis, '', 'closing says nothing');
});

test('display value mapping is linear over min..max and clamped', () => {
  const p = { min: -60, max: 70 };
  assert.equal(surgeAnzeige(p, 0), -60);
  assert.equal(surgeAnzeige(p, 1), 70);
  assert.equal(surgeAnzeige(p, 5), 70);
  assert.equal(surgeNorm(p, 5), 0.5);
  assert.equal(surgeNorm({ min: 1, max: 1 }, 1), 0);
});

function aufbau() {
  vergesseGesendet();
  const timer = []; const posts = []; const meldungen = [];
  const parameter = [{ name: 'a_filter1_cutoff', min: -60, max: 70, vorgabe: 0.5 }, { name: 'a_level_o1', min: 0, max: 1, vorgabe: 0.5 }];
  const post = async (pfad, body) => { posts.push([pfad, body]); return { ok: true, code: 200, j: {} }; };
  const ad = surgeAdapter('bass', { parameter, post, melde: (t, f) => meldungen.push([t, f]), timer: { setTimeout: (f) => { timer.push(f); return timer.length; } } });
  return { ad, timer, posts, meldungen, parameter, post };
}

test('surgeAdapter: throttled per parameter (latest value wins), posts the right /klang body, no lernPfad', async () => {
  const a = aufbau();
  a.ad.set('a_filter1_cutoff', 0.1); a.ad.set('a_filter1_cutoff', 0.2); a.ad.set('a_filter1_cutoff', 0.75);
  a.ad.set('a_level_o1', 1);
  assert.equal(a.timer.length, 2, 'one pending send per parameter');
  assert.equal(a.posts.length, 0);
  for (const f of a.timer.splice(0)) await f();
  assert.equal(a.posts.length, 2);
  assert.deepEqual(a.posts[0], ['/klang', { gruppe: 'bass', aktion: 'fahre', parameter: 'a_filter1_cutoff', ziel: 37.5, sekunden: 0.03 }]);
  assert.deepEqual(a.posts[1][1], { gruppe: 'bass', aktion: 'fahre', parameter: 'a_level_o1', ziel: 1, sekunden: 0.03 });
  a.ad.set('a_filter1_cutoff', 0.5);
  assert.equal(a.timer.length, 1, 'a new send can be scheduled after the first went out');
  assert.equal(a.ad.lernPfad, undefined);
});

test('surgeAdapter: get = last sent value per group and parameter (survives a rebuilt adapter), else vorgabe; refusals are reported', async () => {
  const a = aufbau();
  assert.equal(a.ad.get('a_level_o1'), 0.5);
  a.ad.set('a_level_o1', 0.9);
  assert.equal(a.ad.get('a_level_o1'), 0.9);
  const neu = surgeAdapter('bass', { parameter: a.parameter, post: a.post });
  assert.equal(neu.get('a_level_o1'), 0.9, 'rebuilt panel keeps it');
  assert.equal(surgeAdapter('melodie', { parameter: a.parameter, post: a.post }).get('a_level_o1'), 0.5, 'another group is separate');
  assert.equal(neu.get('unknown'), undefined);
  const b = aufbau();
  const abgelehnt = surgeAdapter('bass', { parameter: b.parameter, post: async () => ({ ok: false, code: 409, j: { text: 'locked' } }), melde: (t, f) => b.meldungen.push([t, f]), timer: { setTimeout: (f) => { b.timer.push(f); } } });
  abgelehnt.set('a_level_o1', 0.3);
  await b.timer[0]();
  assert.deepEqual(b.meldungen, [['Knob refused: locked', true]]);
});

test('travel goes through the punkte curve (piecewise linear), not linear min..max: mid points, inverse, readout and server copy agree', () => {
  const p = { name: 'x', min: 0, max: 12, punkte: [0, 1, 10, 11, 12] };
  assert.equal(surgeAnzeige(p, 0.125), 0.5);
  assert.equal(surgeAnzeige(p, 0.375), 5.5);
  assert.equal(surgeAnzeige(p, 0.5), 10);
  assert.equal(surgeAnzeige(p, 1), 12);
  assert.ok(Math.abs(surgeNorm(p, 5.5) - 0.375) < 1e-12);
  assert.ok(Math.abs(surgeNorm(p, 0.5) - 0.125) < 1e-12);
  assert.equal(surgeNorm(p, -3), 0);
  assert.equal(surgeNorm(p, 99), 1);
  for (const w of [0, 0.5, 1, 3, 10, 10.5, 12]) assert.ok(Math.abs(surgeAnzeige(p, surgeNorm(p, w)) - w) < 1e-9, String(w));
  const fallend = { min: 5, max: -5, punkte: [5, 4, 0, -4, -5] };
  assert.ok(Math.abs(surgeNorm(fallend, 2) - 0.375) < 1e-12);
  assert.equal(anzeigeWert(p, 0.375), 5.5, 'the panel readout uses the same curve');
  assert.equal(serverAnzeige(p, 0.375), 5.5, 'and so does the server copy');
  const echt = parameterTabelle({ art: 'surge' }).find((q) => q.name === 'a_filter1_cutoff');
  assert.deepEqual(echt.punkte, bereiche.a_filter1_cutoff.punkte, 'the table carries the curve');
});

test('live adapter posts the curve value: ziel at travel 0.375 of a curved parameter', async () => {
  const a = aufbau();
  const kurve = [{ name: 'c', min: 0, max: 12, punkte: [0, 1, 10, 11, 12], vorgabe: 0.5 }];
  const ad = surgeAdapter('melodie', { parameter: kurve, post: a.post, timer: { setTimeout: (f) => { a.timer.push(f); } } });
  ad.set('c', 0.375);
  await a.timer[0]();
  assert.equal(a.posts[0][1].ziel, 5.5);
});

test('surgeAdapter: the host values (ist, display units) are what get() shows for untouched parameters, replacing an older remembered value', () => {
  const a = aufbau();
  a.ad.set('a_level_o1', 0.9);
  const neu = surgeAdapter('bass', { parameter: a.parameter, post: a.post, ist: { a_filter1_cutoff: 5, a_level_o1: 0.25, unknown: 3 } });
  assert.ok(Math.abs(neu.get('a_filter1_cutoff') - 0.5) < 1e-9, 'cutoff 5 of -60..70 is travel 0.5');
  assert.equal(neu.get('a_level_o1'), 0.25, 'the host value wins over what this page sent before');
  assert.equal(neu.get('unknown'), undefined);
  const ohne = surgeAdapter('melodie', { parameter: a.parameter, post: a.post });
  assert.equal(ohne.get('a_level_o1'), 0.5, 'without a host value: vorgabe');
});

test('surgeAdapter: a refused send forgets the value, reads the host again (lies) and redraws (beiAbgelehnt); vergesseGesendet(gruppe) clears one group', async () => {
  const b = aufbau();
  let gezeichnet = 0;
  const gelesen = [];
  const ad = surgeAdapter('bass', { parameter: b.parameter, post: async () => ({ ok: false, code: 409, j: { text: 'locked' } }), melde: (t, f) => b.meldungen.push([t, f]),
    lies: async (n) => { gelesen.push(n); return { a_level_o1: 0.5 }; }, beiAbgelehnt: () => { gezeichnet++; }, timer: { setTimeout: (f) => { b.timer.push(f); } } });
  ad.set('a_level_o1', 0.9);
  await b.timer[0]();
  assert.deepEqual(gelesen, [['a_level_o1']]);
  assert.equal(gezeichnet, 1);
  assert.equal(ad.get('a_level_o1'), 0.5, 'the host value, not the refused 0.9');
  const m = surgeAdapter('melodie', { parameter: b.parameter, post: b.post });
  m.set('a_level_o1', 0.7);
  ad.set('a_filter1_cutoff', 0.8);
  vergesseGesendet('bass');
  assert.equal(ad.get('a_filter1_cutoff'), 0.5, 'bass forgotten');
  assert.equal(m.get('a_level_o1'), 0.7, 'melodie kept');
});

test('Surge readouts in real units: EG times in seconds (2^x), mixer levels and volume in dB (cube law), the rest stays bare; knob and drawing agree', () => {
  const t = Object.fromEntries(parameterTabelle({ art: 'surge' }).map((p) => [p.name, p]));
  assert.equal(t.a_env1_attack.einheit, 'log2 s');
  assert.equal(anzeigeText(t.a_env1_attack, 0), '3.91 ms', '2^-8 s');
  assert.equal(anzeigeText(t.a_env1_attack, 1), '32.00 s', '2^5 s');
  for (const n of ['a_env1_decay', 'a_env1_release', 'a_env2_attack', 'a_env2_decay', 'a_env2_release']) assert.equal(t[n].einheit, 'log2 s', n);
  // measured: output peak at level 0.5 is 0.125 of the peak at level 1 (0.0375 / 0.2999): amplitude = x^3, so dB = 60 log10 x
  assert.equal(t.a_level_o1.einheit, 'amp3'); assert.equal(t.a_volume.einheit, 'amp3');
  assert.equal(anzeigeText(t.a_level_o1, 1), '0.0 dB');
  assert.equal(anzeigeText(t.a_level_o1, 0.5), '-18.1 dB');
  assert.equal(anzeigeText(t.a_level_o1, 0), '-inf dB');
  for (const n of ['a_filter1_cutoff', 'a_osc1_pitch', 'a_lfo1_rate', 'a_portamento', 'a_send_fx_1']) assert.equal(t[n].einheit, undefined, `${n} stays bare (unit not confirmed)`);
  // the drawing reads the same: the control unit and the table agree on log2 s
  const alle = panel.sections.flatMap((x) => x.controls);
  for (const c of alle.filter((x) => x.unit === 'log2 s')) assert.equal(t[c.bind.param].einheit, 'log2 s', c.id);
});
