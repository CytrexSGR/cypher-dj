// FIND SOUND part 1, task 4: the round (areas/proj/sound_runde.ts) with a fake output area (records rendereKlangVarianten calls), a fake measuring step
// (features derived from the knob values of the variant) and a fake open project. No render program, no worker, no core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KlangRunde } from '../areas/proj/sound_runde.ts';
import { AusgabeFehler } from '../areas/proj/output.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { stammbaumNachWahl } from '../project/sound_runde.ts';
import { pruefeStammbaum, SKALA, MERKMALE, ZIELE, MAX_MESSUNGEN, MAX_MESSUNGEN_LEER, UEBERSCHUSS } from '../project/sound_runde_contract.ts';
import { wirkung } from '../project/sound_runde.ts';
import { aufbau } from './support/output_setup.mjs';

const NULL = { hell: 0, sub: 0, hoehen: 0, bewegung: 0, fuelle: 0, breite: 0, punch: 0, pegel: 0 };
const tabelle = (n) => Array.from({ length: n }, (_, i) => ({ name: `k${i + 1}`, label: ['Cutoff', 'Res', 'Env', 'Drive', 'Decay', 'Mix'][i] ?? `Knob ${i + 1}`,
  min: 100, max: 1000, log: false, vorgabe: 0.5 }));
const FEATURES = MERKMALE.filter((m) => m !== 'pegel');

// W[k] = effect units per 1.0 of knob travel per feature (effect of a move = travel * W); features follow from the variant
function aufbauRunde(t, { knoepfe = 4, W = {}, parameter = { k1: 0.4 }, stamm, still = false, auto = [], huell = [], render, fader, linear = false, skala = ZIELE.normal } = {}) {
  const projekt = { rev: 1, loop: { an: true, von_beat: 0, bis_beat: 8 }, spuren: [{ id: 's1', nr: 1, name: 'Bass', clips: [{ huellkurven: huell }],
    automation: auto, ...(fader === undefined ? {} : { fader_db: fader }), geraet: { art: 'intern', name: 'bk', graph: 'g', parameter: { ...parameter } }, ...(stamm ? { stammbaum: stamm } : {}) }] };
  const log = { render: [], kern: [], zeit: [], timer: [], warten: 0 };
  let schliess = null;
  const zugang = { offen: () => (projekt ? { slug: 'p', projekt } : null), hoereBk: async (id, w, q, f) => { log.kern.push(f === undefined ? [id, { ...w }, q] : [id, { ...w }, q, f]); },
    beiSchliessen: (f) => { schliess = f; } };
  const basis = (k) => parameter[k] ?? 0.5;
  const ausgabe = { rendereKlangVarianten: async (spurId, varianten, von, bis, nimm) => {
    log.render.push({ spurId, varianten, von, bis });
    if (render) await render(log.render.length);
    return nimm({ rev: projekt.rev, slug: 'p', tempo_bpm: 120, teile: varianten.map((v) => (still ? { stumm: true }
      : { datei: JSON.stringify(v), spitze_db: -3, frames: 96000 })) });
  } };
  const merkmaleVon = async (datei) => {
    const v = JSON.parse(datei), m = { ...NULL };
    for (const [k, x] of Object.entries(v)) for (const [f, w] of Object.entries(W[k] ?? {})) m[f] += (x - basis(k)) * w * SKALA[f];
    return { m, bild: [] };
  };
  // the audibility of the fake is the old strength of its effect vector, one old unit = ZIELE.normal (the old threshold 1 is the default level)
  // `linear: false` (default) saturates at the upper bound of the level, so a fake knob with a huge effect is a place at its first try and the
  // tests about other things do not depend on the narrowing; the tests of the narrowing and the ladder use the linear fake
  const unterschied = (a, v) => { const d = wirkung(a.m, v.m).staerke * skala; return linear ? d : Math.min(d, UEBERSCHUSS * ZIELE.normal); };
  const r = new KlangRunde({ ausgabe, zugang, tabelle: () => tabelle(knoepfe), merkmaleVon, unterschied, quelle: () => 'cypher',
    warte: async () => { log.warten++; }, setzeTimer: (f, ms) => { const h = { f, ms }; log.timer.push(h); return h; }, loescheTimer: (h) => { h.weg = true; } });
  return { r, projekt, log, schliess: () => schliess(), spur: projekt.spuren[0] };
}
const alleVarianten = (log) => log.render.flatMap((x) => x.varianten).filter((v) => Object.keys(v).length);
const FEIN = { k1: { hell: 10 }, k2: { sub: 10 }, k3: { breite: 10 }, k4: { pegel: 10 } };

test('three places on three knobs in the order found, with text', async (t) => {
  const { r, log } = aufbauRunde(t, { W: FEIN });
  const s = r.starte({ spur_id: 's1' });
  assert.deepEqual([s.zustand, s.plaetze.length, s.runde, s.aktiv, s.schritt], ['misst', 0, 1, 'A', 'normal']);
  await r.warteFertig();
  const l = r.lage();
  assert.equal(l.zustand, 'fertig');
  assert.deepEqual(l.plaetze.map((p) => [p.platz, p.param, p.wert]), [['A', null, null], ['B', 'k1', 0.75], ['C', 'k2', 0.15], ['D', 'k3', 0.85]]);
  assert.deepEqual(l.plaetze.map((p) => p.text), ['current', 'brighter · Cutoff 460 → 775', 'less sub · Res 550 → 235', 'wider · Env 550 → 865']);
  assert.deepEqual([l.von_beat, l.bis_beat, l.fortschritt], [0, 8, { gemessen: 3, hoechstens: 8 }]);
  assert.equal(log.render.length, 1);
  assert.deepEqual(log.render[0].varianten, [{}, { k1: 0.75 }, { k2: 0.15 }, { k3: 0.85 }]);
  assert.deepEqual([l.stammbaum, l.weg, l.zurueck_moeglich, l.spur_name], [null, [], false, 'Bass']);
});

test('inaudible candidates are widened to their range end, the round stops at the budget of renders, then fills up', async (t) => {
  const W = { k1: { hell: 10 }, k2: { hell: 10 } };
  for (let i = 3; i <= 20; i++) W[`k${i}`] = { hell: i % 2 ? 10 : 0 };   // odd knobs go up (brighter, the same direction as k1), even ones do nothing
  const { r, log } = aufbauRunde(t, { knoepfe: 20, W });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const l = r.lage();
  assert.equal(alleVarianten(log).length, MAX_MESSUNGEN, 'at most MAX_MESSUNGEN renders');
  assert.deepEqual(log.render.map((x) => x.varianten.length), [4, 4, 4, 4, 4, 4, 1]);
  assert.deepEqual([l.zustand, l.fortschritt], ['fertig', { gemessen: MAX_MESSUNGEN, hoechstens: MAX_MESSUNGEN }]);
  // k1+ is accepted, k2- points the other way; every other audible one points the same way as k1+ and would read "brighter" again: since no word is
  // repeated in a round, nothing is filled up and the round shows two places
  assert.deepEqual(l.plaetze.map((p) => p.param), [null, 'k1', 'k2']);
});

test('while nothing audible is found the round measures on, up to forty-eight candidates', async (t) => {
  const W = {};
  for (let i = 1; i <= 40; i++) W[`k${i}`] = { hell: 0 };
  const { r, log } = aufbauRunde(t, { knoepfe: 40, W });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const l = r.lage();
  assert.equal(alleVarianten(log).length, 48, 'forty-eight of the eighty candidates');
  assert.deepEqual([l.zustand, l.fortschritt], ['fertig', { gemessen: 48, hoechstens: 48 }]);
  assert.deepEqual(l.plaetze.map((p) => p.param), [null]);
});

test('another step size offers the same knobs again', async (t) => {
  const { r } = aufbauRunde(t, { knoepfe: 3, W: { k1: { hell: 30 }, k2: { sub: 30 }, k3: { breite: 30 } } });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const knoepfe = () => r.lage().plaetze.map((p) => p.param).filter(Boolean).sort();
  assert.deepEqual(knoepfe(), ['k1', 'k2', 'k3']);
  r.starte({ spur_id: 's1', schritt: 'fein' });
  await r.warteFertig();
  assert.deepEqual(knoepfe(), ['k1', 'k2', 'k3'], 'the finer step measures the same three knobs again (the order may differ)');
});

test('a knob that only changes the level is never a place, nor one that is far quieter', async (t) => {
  const { r } = aufbauRunde(t, { knoepfe: 6, W: { k1: { pegel: 10 }, k2: { sub: 10, pegel: 100 }, k3: { hell: 10 }, k4: { sub: 10 }, k5: { breite: 10 }, k6: { hoehen: 10 } } });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const l = r.lage();
  assert.equal(l.zustand, 'fertig');
  assert.deepEqual(l.plaetze.map((p) => p.param), [null, 'k3', 'k4', 'k5']);
});

test('a lane-driven knob is never rendered', async (t) => {
  const { r, log } = aufbauRunde(t, { W: FEIN, auto: [{ id: 'l1', ziel: 'geraet.k1', punkte: [] }], huell: [{ ziel: 'geraet.k2', punkte: [] }] });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const knoepfe = new Set(alleVarianten(log).flatMap((v) => Object.keys(v)));
  assert.deepEqual([...knoepfe].sort(), ['k3', 'k4'], 'only k3 and k4 are candidates');
  assert.equal(r.lage().plaetze.some((p) => p.param === 'k1' || p.param === 'k2'), false);
});

test('listening resets the old knob and sets the new one in one call, A only resets', async (t) => {
  const { r, log } = aufbauRunde(t, { W: FEIN });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const h = async (platz) => { const n = log.kern.length; const l = await r.hoere({ platz }); return [l.aktiv, log.kern.slice(n)]; };
  assert.deepEqual(await h('B'), ['B', [['s1', { k1: 0.75 }, 'cypher']]]);
  assert.deepEqual(await h('C'), ['C', [['s1', { k1: 0.4, k2: 0.15 }, 'cypher']]], 'k1 goes back to the project value, not the basis of another place');
  assert.deepEqual(await h('A'), ['A', [['s1', { k2: 0.5 }, 'cypher']]]);
  assert.deepEqual(await h('A'), ['A', []], 'A on A has nothing to write');
  await assert.rejects(r.hoere({ platz: 'E' }), (e) => e.grund === 'argument_ungueltig');
  await assert.rejects(r.hoere({ platz: 'B', runde: 7 }), (e) => e.grund === 'runde_veraltet');
});

test('a place that is not there yet is platz_leer', async (t) => {
  let los;
  const tor = new Promise((ok) => { los = ok; });
  const { r } = aufbauRunde(t, { W: FEIN, render: async () => { await tor; } });
  r.starte({ spur_id: 's1' });
  await assert.rejects(r.hoere({ platz: 'B' }), (e) => e.grund === 'platz_leer');
  los();
  await r.warteFertig();
  assert.equal((await r.hoere({ platz: 'B' })).aktiv, 'B');
});

test('the plan of a pick: knob command and tree (root with all knobs, child with one)', async (t) => {
  const { r, projekt } = aufbauRunde(t, { W: FEIN });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const p = await r.waehle({ platz: 'B', runde: 1 });
  assert.deepEqual([p.weg, p.rev, p.label], ['proj', 1, 'Find sound: brighter · Cutoff 460 → 775']);
  assert.deepEqual(p.befehle[0], { befehl: 'geraet_param_setzen', spur_id: 's1', param: 'k1', wert: 0.75 });
  const b = p.befehle[1];
  assert.equal(b.befehl, 'stammbaum_setzen');
  assert.deepEqual(pruefeStammbaum(b.stammbaum), []);
  assert.deepEqual(b.stammbaum, { graph: 'g', aktiv: 'n2', knoten: [
    { id: 'n1', eltern: null, werte: { k1: 0.4, k2: 0.5, k3: 0.5, k4: 0.5 }, text: 'start' },
    { id: 'n2', eltern: 'n1', werte: { k1: 0.75 }, text: 'brighter · Cutoff 460 → 775' }] });
  assert.equal(projekt.rev, 1, 'planning writes nothing');
  await assert.rejects(r.waehle({ platz: 'A' }), (e) => e.grund === 'argument_ungueltig');
  await assert.rejects(r.waehle({ platz: 'D', runde: 2 }), (e) => e.grund === 'runde_veraltet');
});

test('the next round does not offer the reverse of the pick and new neighbours offers other candidates', async (t) => {
  // reverse of the pick: four knobs, only k1 and k2 audible, so a round measures every candidate (negative control: a fresh memory renders k1 at 0.4)
  const W = { k1: { hell: 10 }, k2: { sub: 10 } };
  const a = aufbauRunde(t, { W });
  a.r.starte({ spur_id: 's1' });
  await a.r.warteFertig();
  assert.ok(alleVarianten(a.log).length >= 8 - 0, 'every candidate of a small table is measured');
  const plan = await a.r.waehle({ platz: 'B' });
  a.spur.geraet.parameter.k1 = 0.75; a.projekt.rev++; a.spur.stammbaum = plan.befehle[1].stammbaum;
  a.log.render.length = 0;
  a.r.starte({ spur_id: 's1' });
  await a.r.warteFertig();
  assert.equal(alleVarianten(a.log).some((v) => v.k1 === 0.4), false, 'the way back is not offered');
  const frisch = aufbauRunde(t, { W, parameter: { k1: 0.75 } });
  frisch.r.starte({ spur_id: 's1' });
  await frisch.r.warteFertig();
  assert.equal(alleVarianten(frisch.log).some((v) => v.k1 === 0.4), true, 'negative control: without memory the way back is a candidate');
  // new neighbours: the same basis, other places
  const W2 = {};
  FEATURES.forEach((f, i) => { for (const k of [i + 1, i + 8, i + 15]) W2[`k${k}`] = { [f]: 10 }; });
  const b = aufbauRunde(t, { knoepfe: 21, W: W2 });
  b.r.starte({ spur_id: 's1' });
  await b.r.warteFertig();
  const eins = b.r.lage().plaetze.slice(1).map((p) => `${p.param}:${p.wert}`);
  b.r.starte({ spur_id: 's1' });
  await b.r.warteFertig();
  const zwei = b.r.lage().plaetze.slice(1).map((p) => `${p.param}:${p.wert}`);
  assert.equal(eins.length, 3);
  assert.equal(zwei.length, 3);
  assert.deepEqual(eins.filter((x) => zwei.includes(x)), []);
  assert.equal(b.r.lage().runde, 2);
});

test('a knob changed outside makes the state stale and a pick is refused; other edits do not', async (t) => {
  const { r, projekt, spur } = aufbauRunde(t, { W: FEIN });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  projekt.rev = 9;
  assert.equal(r.lage().zustand, 'fertig', 'another edit keeps a finished round');
  spur.geraet.parameter.k2 = 0.9;
  assert.equal(r.lage().zustand, 'veraltet');
  await assert.rejects(r.waehle({ platz: 'B' }), (e) => e.grund === 'runde_veraltet');
  await assert.rejects(r.hoere({ platz: 'B' }), (e) => e.grund === 'runde_veraltet');
  spur.geraet.parameter.k2 = 0.5;
  assert.equal(r.lage().zustand, 'fertig');
  projekt.spuren.length = 0;
  assert.equal(r.lage().zustand, 'veraltet', 'the track is gone');
});

test('a project that moves on while measuring restarts from A, twice at most', async (t) => {
  const { r, projekt, log } = aufbauRunde(t, { knoepfe: 20, W: { k1: { hell: 10 } }, render: async (n) => { if (n >= 2 && n <= 6) projekt.rev++; } });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const l = r.lage();
  assert.equal(l.zustand, 'veraltet', 'the third change ends the round');
  assert.ok(log.render.filter((x) => x.varianten.length && Object.keys(x.varianten[0]).length === 0).length >= 3, 'A was rendered again');
  const g = aufbauRunde(t, { knoepfe: 20, W: { k1: { hell: 10 } }, render: async (n) => { if (n === 2) g.projekt.rev++; } });
  g.r.starte({ spur_id: 's1' });
  await g.r.warteFertig();
  assert.equal(g.r.lage().zustand, 'fertig', 'one restart is fine');
  assert.equal(g.r.lage().rev, 2);
});

test('back: plan with the knobs to write, kein_stammbaum without a tree', async (t) => {
  const baum = { graph: 'g', aktiv: 'n2', knoten: [
    { id: 'n1', eltern: null, werte: { k1: 0.4, k2: 0.5, k3: 0.5, k4: 0.5 }, text: 'start' }, { id: 'n2', eltern: 'n1', werte: { k1: 0.58 }, text: 'brighter · Cutoff' }] };
  const { r, spur } = aufbauRunde(t, { W: FEIN, parameter: { k1: 0.58 }, stamm: baum });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const l = r.lage();
  assert.deepEqual([l.stammbaum.aktiv, l.weg.map((x) => x.id), l.zurueck_moeglich], ['n2', ['n1', 'n2'], true]);
  const p = await r.zurueck({});
  assert.deepEqual([p.weg, p.label], ['proj', 'Find sound: back to start']);
  assert.deepEqual(p.befehle.map((b) => b.befehl), ['geraet_param_setzen', 'stammbaum_setzen']);
  assert.deepEqual(p.befehle[0], { befehl: 'geraet_param_setzen', spur_id: 's1', param: 'k1', wert: 0.4 });
  assert.equal(p.befehle[1].stammbaum.aktiv, 'n1');
  assert.deepEqual((await r.zurueck({ knoten: 'n1' })).befehle, p.befehle);
  await assert.rejects(r.zurueck({ knoten: 'n9' }), (e) => e.grund === 'argument_ungueltig');
  // a knob turned by hand since the active node: back goes to the active node itself and records the hand change
  spur.geraet.parameter.k3 = 0.9;
  assert.equal(r.lage().zustand, 'veraltet');
  const h = await r.zurueck({});
  assert.deepEqual(h.befehle.slice(0, -1).map((b) => [b.param, b.wert]), [['k3', 0.5]]);
  assert.equal(h.befehle.at(-1).stammbaum.knoten.at(-1).text, 'manual');
  assert.equal(h.befehle.at(-1).stammbaum.aktiv, 'n2');
  delete spur.stammbaum;
  await assert.rejects(r.zurueck({}), (e) => e.grund === 'kein_stammbaum');
  const leer = aufbauRunde(t, { W: FEIN });
  leer.r.starte({ spur_id: 's1' });
  await leer.r.warteFertig();
  await assert.rejects(leer.r.zurueck({}), (e) => e.grund === 'kein_stammbaum');
});

test('a silent track ends with spur_still', async (t) => {
  const { r } = aufbauRunde(t, { W: FEIN, still: true });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const l = r.lage();
  assert.deepEqual([l.zustand, l.grund], ['fehler', 'spur_still']);
  assert.match(l.text, /silent/);
});

test('a busy lock is retried and then reported', async (t) => {
  const busy = () => { throw new AusgabeFehler('beschaeftigt', 'another run holds the lock'); };
  const a = aufbauRunde(t, { W: FEIN, render: async (n) => { if (n <= 20) busy(); } });
  a.r.starte({ spur_id: 's1' });
  await a.r.warteFertig();
  assert.deepEqual([a.r.lage().zustand, a.log.warten, a.log.render.length], ['fertig', 20, 21], 'the 21st attempt gets through');
  const b = aufbauRunde(t, { W: FEIN, render: async () => busy() });
  b.r.starte({ spur_id: 's1' });
  await b.r.warteFertig();
  const l = b.r.lage();
  assert.deepEqual([l.zustand, l.grund, l.text, b.log.warten, b.log.render.length], ['fehler', 'beschaeftigt', 'another run holds the lock', 20, 21]);
});

test('ending removes the override and is idempotent; a project that closes drops the round without writing; idle ends it', async (t) => {
  const W = {};
  FEATURES.forEach((f, i) => { for (const k of [i + 1, i + 8, i + 15]) W[`k${k}`] = { [f]: 10 }; });
  const { r, log, schliess } = aufbauRunde(t, { knoepfe: 21, W });
  const frisch = async (platz) => {
    r.starte({ spur_id: 's1' });
    await r.warteFertig();
    const p = (await r.hoere({ platz })).plaetze.find((x) => x.platz === platz).param;
    return { p, alt: p === 'k1' ? 0.4 : 0.5 };
  };
  const { p, alt } = await frisch('B');
  const n = log.kern.length;
  assert.deepEqual(await r.ende(), { ok: true });
  // taking the override off is the server cleaning up: it goes as the owner, whoever asked (Stop Cypher must not keep an override alive)
  assert.deepEqual(log.kern.slice(n), [['s1', { [p]: alt }, 'andreas']]);
  assert.deepEqual(await r.ende(), { ok: true });
  assert.equal(log.kern.length, n + 1, 'the second end writes nothing');
  assert.throws(() => r.lage(), (e) => e.grund === 'keine_runde');
  // closing
  await frisch('C');
  const m = log.kern.length;
  schliess();
  assert.equal(log.kern.length, m, 'no write');
  assert.throws(() => r.lage(), (e) => e.grund === 'keine_runde');
  // idle: 15 minutes
  const x = await frisch('B');
  const live = log.timer.filter((y) => !y.weg);
  assert.equal(live.length, 1);
  assert.equal(live[0].ms, 15 * 60_000);
  const k = log.kern.length;
  live[0].f();
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(log.kern.slice(k), [['s1', { [x.p]: x.alt }, 'andreas']], 'the idle end takes the override off');
  assert.throws(() => r.lage(), (e) => e.grund === 'keine_runde');
});

test('starting a round takes the override of the old round off first; arguments are checked', async (t) => {
  const { r, log } = aufbauRunde(t, { W: FEIN });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  await r.hoere({ platz: 'D' });
  const n = log.kern.length;
  r.starte({ spur_id: 's1', schritt: 'grob' });
  await new Promise((ok) => setImmediate(ok));   // the write runs in the chain of core writes
  assert.deepEqual(log.kern.slice(n), [['s1', { k3: 0.5 }, 'andreas']]);
  assert.equal(r.lage().schritt, 'grob');
  assert.throws(() => r.starte({ spur_id: 's1', schritt: 'x' }), (e) => e.grund === 'argument_ungueltig');
  assert.throws(() => r.starte({ spur_id: 's1', zusatz: 1 }), (e) => e.grund === 'argument_ungueltig');
  assert.throws(() => r.starte({ spur_id: 's9' }), (e) => e.grund === 'spur_unbekannt');
  assert.throws(() => r.starte({}), (e) => e.grund === 'argument_ungueltig');
  await r.warteFertig();
});

test('listens that cross, and an end or a restart while a listen is on its way, leave no knob behind', async (t) => {
  const { r, log } = aufbauRunde(t, { W: FEIN });
  // what the core holds after all writes, per knob (the last write wins)
  const kern = () => { const k = {}; for (const [, werte] of log.kern) Object.assign(k, werte); return k; };
  const start = async () => { r.starte({ spur_id: 's1' }); await r.warteFertig(); return r.lage(); };
  const projekt = (l, param) => (param === 'k1' ? 0.4 : 0.5);
  let l = await start();
  const [b, c] = [l.plaetze[1], l.plaetze[2]];
  // two listens at once, then A: both knobs are back at the project value
  await Promise.all([r.hoere({ platz: 'B' }), r.hoere({ platz: 'C' })]);
  assert.equal(r.lage().aktiv, 'C');
  assert.equal(kern()[b.param], projekt(l, b.param), 'B was taken off when C came');
  await r.hoere({ platz: 'A' });
  assert.equal(kern()[c.param], projekt(l, c.param));
  // a listen on its way when the round ends
  const h1 = r.hoere({ platz: 'B' });
  await r.ende();
  await h1.catch(() => undefined);   // refused or taken off again, either way nothing stays
  assert.equal(kern()[b.param], projekt(l, b.param), 'the end leaves no knob behind');
  // a listen on its way when a new round starts
  l = await start();
  const b2 = l.plaetze[1];
  const h2 = r.hoere({ platz: 'B' });
  r.starte({ spur_id: 's1' });
  await h2.catch(() => undefined);
  await r.warteFertig();
  await new Promise((ok) => setImmediate(ok));
  assert.equal(kern()[b2.param], projekt(l, b2.param), 'the restart takes off what the listen had just written');
  assert.equal(r.lage().aktiv, 'A');
});

test('a tree whose ids would run past six digits starts again instead of failing every pick', () => {
  const baum = { graph: 'g1', aktiv: 'n999999', knoten: [{ id: 'n1', eltern: null, werte: { k1: 0.5 }, text: 'start' },
    { id: 'n999999', eltern: 'n1', werte: { k1: 0.6 }, text: 'x' }] };
  const neu = stammbaumNachWahl({ baum, graph: 'g1', basis: { k1: 0.6 }, param: 'k1', wert: 0.78, text: 'p' });
  assert.deepEqual(pruefeStammbaum(neu), []);
  assert.deepEqual(neu.knoten.map((k) => k.id), ['n1', 'n2']);
});

test('the pick plan is a valid command list on a project', async (t) => {
  const { r } = aufbauRunde(t, { W: FEIN });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const p = await r.waehle({ platz: 'C' });
  const { specProjekt } = await import('./support/project.mjs');
  const pr = specProjekt();
  pr.spuren = [{ id: 's1', nr: 1, name: 'Bass', farbe: '#3b8de0', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'g', parameter: { k1: 0.4 } },
    fader_db: 0, pan: 0, mute: false, solo: false, clips: [] }];
  const e = fuehreListeAus(pr, p.befehle);
  const s = e.projekt.spuren[0];
  assert.equal(s.geraet.parameter.k2, 0.15);
  assert.equal(s.stammbaum.aktiv, 'n2');
});

// --- level match -------------------------------------------------------------------------------------------------------------------------
const LAUT = { k1: { hell: 10, pegel: 5 } };   // k1 up 0.35 (first rung) -> +2.6 dB; the place carries its true pegel_db
const settle = () => new Promise((ok) => { setImmediate(ok); });

test('a louder place is played quieter by its level difference and A restores the project fader', async (t) => {
  const { r, log } = aufbauRunde(t, { W: { ...FEIN, ...LAUT }, fader: -6 });
  r.starte({ spur_id: 's1' }); await r.warteFertig(); await settle();
  const b = r.lage().plaetze.find((p) => p.param === 'k1');
  assert.ok(b.pegel_db > 1, `the place is louder: ${b.pegel_db}`);
  assert.equal(b.ausgleich_db, -b.pegel_db);
  log.kern.length = 0;
  await r.hoere({ platz: 'B', runde: 1 });
  assert.deepEqual(log.kern, [['s1', { k1: b.wert }, 'cypher', -6 - b.pegel_db]]);
  assert.equal(r.lage().plaetze.find((p) => p.platz === 'B').pegel_db, b.pegel_db, 'the true level difference stays on the place');
  await r.hoere({ platz: 'C', runde: 1 });
  assert.equal(log.kern.at(-1)[1].k1, 0.4, 'the knob of the left place goes back');
  assert.equal(log.kern.at(-1)[3], -6, 'a place at the level of A needs no gain: the project fader');
  await r.hoere({ platz: 'B', runde: 1 });
  assert.equal(log.kern.at(-1)[3], -6 - b.pegel_db);
  await r.hoere({ platz: 'A', runde: 1 });
  assert.deepEqual(log.kern.at(-1), ['s1', { k1: 0.4 }, 'cypher', -6], 'A takes the fader back to the project value');
});

test('no fader write when the track has a fader lane, is off, or has no fader value', async (t) => {
  for (const o of [{ fader: -6, auto: [{ ziel: 'fader', punkte: [] }] }, { fader: -200 }, {}]) {
    const { r, log } = aufbauRunde(t, { W: { ...FEIN, ...LAUT }, ...o });
    r.starte({ spur_id: 's1' }); await r.warteFertig(); await settle();
    await r.hoere({ platz: 'B', runde: 1 }); await r.hoere({ platz: 'A', runde: 1 }); await r.ende();
    assert.ok(log.kern.length >= 2 && log.kern.every((k) => k.length === 3), JSON.stringify(log.kern));
  }
});

test('the pick plan carries no fader command; ending, a new round and the fader: the last fader write is the project value', async (t) => {
  const { r, log } = aufbauRunde(t, { W: { k1: { hell: 10, pegel: 5 }, k2: { sub: 10, pegel: 5 }, k3: { breite: 10, pegel: 5 } }, fader: -6 });
  r.starte({ spur_id: 's1' }); await r.warteFertig(); await settle();
  await r.hoere({ platz: 'B', runde: 1 });
  const plan = await r.waehle({ platz: 'B', runde: 1 });
  assert.deepEqual(plan.befehle.map((b) => b.befehl), ['geraet_param_setzen', 'stammbaum_setzen']);
  assert.equal(JSON.stringify(plan).includes('fader'), false);
  const vor = log.kern.length;
  await settle();
  assert.equal(log.kern.length, vor, 'no write between the plan answer and the window\'s project write');
  r.starte({ spur_id: 's1' }); await settle(); await r.warteFertig(); await settle();
  const fader = log.kern.filter((k) => k.length === 4).map((k) => k[3]);
  assert.equal(fader.at(-1), -6, 'the new round leaves the project fader');
  // the old round took its audition off, as the owner
  assert.ok(log.kern.some((k, i) => i >= vor && k[2] === 'andreas' && k[3] === -6));
  // ending after a listen
  await r.hoere({ platz: 'B', runde: 2 });
  assert.notEqual(log.kern.at(-1)[3], -6);
  await r.ende();
  assert.equal(log.kern.at(-1)[2], 'andreas');
  assert.equal(log.kern.at(-1)[3], -6, 'the last fader write is the project value');
});

test('a new round writes the project fader once even when no old round exists (heal after a restart)', async (t) => {
  const { r, log } = aufbauRunde(t, { W: FEIN, fader: -9 });
  r.starte({ spur_id: 's1' }); await settle();
  assert.deepEqual(log.kern, [['s1', {}, 'andreas', -9]]);
  await r.warteFertig(); await settle();
  assert.equal(log.kern.length, 1);
});

test('hoereBk writes the fader row of the track number (not the slot) and survives a refused fader row but not a refused knob row', async (t) => {
  const a = await aufbau(t, { mitKick: false, mitWirt: false });
  await a.aendern([{ befehl: 'spur_neu', art: 'instrument', name: 'Pad', geraet: { art: 'intern', name: 'bk', graph: 'bassmusik' } }]);
  const spur = a.projekt().spuren.find((s) => s.name === 'Pad');
  a.protokoll.gesendet.length = 0;
  await a.echt.hoereBk(spur.id, { k3: 0.7 }, 'andreas', -9);
  const teile = () => a.protokoll.gesendet.filter((g) => g.adresse === '/k/teil').map((g) => [g.felder.pfad, g.felder.nach]).sort();
  assert.deepEqual(teile(), [['spur/1/bk/3', 0.7], [`spur/${spur.nr}/fader`, -9]]);
  a.protokoll.gesendet.length = 0;
  await a.echt.hoereBk(spur.id, {}, 'andreas', -3);
  assert.deepEqual(teile(), [[`spur/${spur.nr}/fader`, -3]]);
  await assert.rejects(a.echt.hoereBk(spur.id, { k3: 0.7 }, 'andreas', 7), (e) => e.grund === 'argument_ungueltig');
  const echt = a.s.kern.setzeRegler.bind(a.s.kern);
  const refuse = (re) => { a.s.kern.setzeRegler = async (l, q) => (await echt(l, q)).map((x) => (re.test(x.pfad) ? { ...x, quittung: { status: 6, grund: 'x' }, ok: false } : x)); };
  refuse(/fader$/);
  await a.echt.hoereBk(spur.id, { k3: 0.5 }, 'andreas', -4);
  refuse(/bk\/3$/);
  await assert.rejects(a.echt.hoereBk(spur.id, { k3: 0.5 }, 'andreas', -4), (e) => e.grund === 'regler_abgelehnt');
});

test('hoereBk writes the transient rows of the right slot and leaves the project untouched', async (t) => {
  const a = await aufbau(t, { mitKick: false, mitWirt: false });
  await a.aendern([{ befehl: 'spur_neu', art: 'instrument', name: 'Pad', geraet: { art: 'intern', name: 'bk', graph: 'bassmusik' } }]);
  const spur = a.projekt().spuren.find((s) => s.name === 'Pad');
  const rev = a.projekt().rev, vor = JSON.stringify(a.projekt());
  a.protokoll.gesendet.length = 0;
  await a.echt.hoereBk(spur.id, { k3: 0.7, k10: 0.25 }, 'andreas');
  const teile = a.protokoll.gesendet.filter((g) => g.adresse === '/k/teil');
  assert.deepEqual(teile.map((g) => [g.felder.pfad, g.felder.nach, g.felder.dauer_beats]).sort(), [['spur/1/bk/10', 0.25, 0], ['spur/1/bk/3', 0.7, 0]]);
  assert.deepEqual([a.projekt().rev, JSON.stringify(a.projekt())], [rev, vor], 'no revision, no change');
  assert.equal(a.protokoll.gesendet.some((g) => g.adresse === '/k/arr/laden'), false);
  await assert.rejects(a.echt.hoereBk(spur.id, { k65: 0.5 }, 'andreas'), (e) => e.grund === 'argument_ungueltig');
  await assert.rejects(a.echt.hoereBk('s2', { k1: 0.5 }, 'andreas'), (e) => e.grund === 'geraet_falsch');
  await assert.rejects(a.echt.hoereBk('nix', { k1: 0.5 }, 'andreas'), (e) => e.grund === 'spur_unbekannt');
});

test('the default level is normal: a knob that cannot reach D 2 at its range end is a fallback place marked max, below subtle it is no place', async (t) => {
  // D of the fake = 2 x effect = 2 x travel x W. k1: reaches any target quickly; k2: W 1.5 -> D 3 x travel = 1.5 at the end of the travel (between subtle
  // and clear); k3: W 0.6 -> 0.6 at the end, under subtle
  const W = { k1: { hell: 10 }, k2: { sub: 1.5 }, k3: { breite: 0.6 } };
  const { r } = aufbauRunde(t, { knoepfe: 3, W });
  assert.equal(r.starte({ spur_id: 's1' }).schritt, 'normal');
  await r.warteFertig();
  const params = () => [...new Set(r.lage().plaetze.map((p) => p.param).filter(Boolean))].sort();   // fill-up may offer the other direction of k1
  assert.deepEqual(params(), ['k1', 'k2']);
  const [, b, c] = r.lage().plaetze;
  assert.ok(b.param === 'k1' && b.staerke >= ZIELE.normal && !b.anschlag && !b.text.endsWith(' · max'));
  assert.ok(c.param === 'k2' && c.staerke < ZIELE.normal && c.staerke >= ZIELE.fein && c.anschlag === true && c.text.endsWith(' · max'), JSON.stringify(c));
  assert.ok(c.wert === 0 || c.wert === 1);
  assert.equal(r.lage().hinweis, undefined);
  r.starte({ spur_id: 's1', schritt: 'fein' });
  await r.warteFertig();
  assert.deepEqual(params(), ['k1', 'k2']);
  assert.ok(r.lage().plaetze.slice(1).every((p) => !p.anschlag), 'at subtle both reach the target');
  assert.ok(ZIELE.fein < 1.5 && 1.5 < ZIELE.normal);
});

// FIND SOUND, real-core fix: measured-like values of the real fm-bass. Brightness (k1) D 1.66 at travel 0.35 and about 2.3 at its range end, Decay (k3) 1.29 and
// 1.20 at its two range ends, Drive (k4) and Feedback (k2) under 0.7 at their range ends. The fake D is linear in the travel (skala 2 x travel x W; the
// scale 2 keeps the effect of a subtle place over the word threshold WORT_MIN, as the real measure does).
const REAL = { k1: { hell: 2.37 }, k2: { breite: 0.65 }, k3: { hoehen: 1.25 }, k4: { sub: 0.65 } };
test('three rounds in a row on one track (fein, normal, grob): the memory never empties the round, range-end knobs are marked max', async (t) => {
  const { r } = aufbauRunde(t, { knoepfe: 4, W: REAL, parameter: { k1: 0.5 }, linear: true, skala: 2 });
  const runde = async (schritt) => { r.starte({ spur_id: 's1', schritt }); await r.warteFertig(); return r.lage(); };
  const fein = await runde('fein');
  assert.equal(fein.zustand, 'fertig');
  assert.deepEqual([...new Set(fein.plaetze.slice(1).map((p) => p.param))].sort(), ['k1', 'k3']);
  assert.ok(fein.plaetze.slice(1).every((p) => !p.anschlag), 'subtle: both reach the target');
  for (const schritt of ['normal', 'grob']) {
    const l = await runde(schritt);
    const plaetze = l.plaetze.slice(1);
    assert.equal(l.zustand, 'fertig');
    assert.ok(plaetze.length >= 2, `${schritt}: ${plaetze.length} places, measured ${l.fortschritt.gemessen}`);
    assert.ok(plaetze.every((p) => p.anschlag === true && p.text.endsWith(' · max') && (p.wert === 0 || p.wert === 1)), `${schritt}: ${JSON.stringify(plaetze.map((p) => [p.param, p.wert, p.staerke]))}`);
    assert.deepEqual(plaetze.slice(0, 2).map((p) => p.param).sort(), ['k1', 'k3'], 'two different knobs first');
    assert.ok(plaetze.every((p) => p.param === 'k1' || p.param === 'k3'), 'Drive and Feedback are inaudible even at their range ends');
    assert.equal(l.hinweis, undefined);
  }
});

test('no audible knob: the round is finished with a state text instead of a bare A', async (t) => {
  const { r } = aufbauRunde(t, { knoepfe: 2, W: { k1: { hell: 0.1 }, k2: { sub: 0.1 } } });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const l = r.lage();
  assert.equal(l.zustand, 'fertig');
  assert.equal(l.plaetze.length, 1);
  assert.equal(l.hinweis, 'no knob of this sound makes an audible difference on this pattern');
});

// --- widening steps (task 2) ---------------------------------------------------------------------------------------------------------------------
// The ladder against the six measured verdict vectors cannot be tested: the fixture holds one step per knob, the ladder needs a render per rung.
// The fake audibility is linear in the travel (D = 2 x travel x W), so the rung that reaches a target is known.
const einKnopf = (W, parameter = { k1: 0.2 }, extra = {}) => aufbauRunde(null, { knoepfe: 1, W: { k1: W }, parameter, linear: true, ...extra });
const lauf = async (x, d = {}) => { x.r.starte({ spur_id: 's1', ...d }); await x.r.warteFertig(); return x.r.lage(); };
const stapel = (x) => x.log.render.map((c) => c.varianten.filter((v) => Object.keys(v).length).map((v) => v.k1));

test('a knob whose first step is too small is widened until the target: three renders at most, the range end last', async () => {
  const x = einKnopf({ hell: 1.5 });   // D = 3 x travel from 0.2: 0.35 -> 1.05, 0.6 -> 1.8, 0.8 (end) -> 2.4
  const l = await lauf(x);
  // the downward key (0.2 -> 0, travel 0.2: D 0.6) is hopeless: one try at its end; the upward key goes 0.55, 0.8, then the range end 1
  assert.deepEqual(stapel(x), [[0.55, 0], [0.8], [1]]);
  assert.deepEqual(l.plaetze.map((p) => [p.param, p.wert]), [[null, null], ['k1', 1]]);
  assert.ok(l.plaetze[1].staerke >= ZIELE.normal);
  assert.deepEqual(l.fortschritt, { gemessen: 4, hoechstens: 4 });
});

test('the place carries the widened value and a pick writes it', async () => {
  const x = einKnopf({ hell: 1.5 });
  await lauf(x);
  const plan = await x.r.waehle({ platz: 'B' });
  assert.equal(plan.befehle[0].wert, 1);
  assert.equal(plan.befehle[0].param, 'k1');
});

test('a knob that cannot reach the target at the range end is dropped and the next candidate takes the place', async (t) => {
  const { r, log } = aufbauRunde(t, { knoepfe: 4, W: { k1: { hell: 0.8 }, k2: { sub: 10 }, k3: { breite: 10 }, k4: { punch: 10 } } });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const l = r.lage();
  const k1 = alleVarianten(log).filter((v) => 'k1' in v).map((v) => v.k1);
  assert.ok(k1.length <= 2 * 3, 'three tries per direction at most');
  assert.deepEqual(l.plaetze.map((p) => p.param), [null, 'k2', 'k3', 'k4'], 'k1 is no place, the next ones took the places');
});

test('a hopeless knob is tried up to the range end of both directions, once per rung at most, then never again', async (t) => {
  const { r, log } = aufbauRunde(t, { knoepfe: 3, W: { k1: { hell: 0.8 }, k2: { sub: 10 }, k3: { breite: 10 } } });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const k1 = alleVarianten(log).filter((v) => 'k1' in v).map((v) => v.k1);
  assert.deepEqual(k1.sort(), [0, 0.05, 0.75, 1], 'down: 0.05 then the end 0; up: 0.75 then the end 1');
  assert.equal(r.lage().plaetze.some((p) => p.param === 'k1'), false);
});

test('the second round on the same knob starts at the remembered rung (fewer renders)', async () => {
  const x = einKnopf({ hell: 1.5 });
  await lauf(x);                           // normal: 0.55, 0.8, 1 for the upward key
  const vor = stapel(x).flat().length;
  const l = await lauf(x, { schritt: 'fein' });   // remembered D / travel = 3: fein (target 1) is reached at 0.35 of the travel
  assert.deepEqual(stapel(x).slice(3), [[0.55, 0]], 'one render per key, the upward one at the remembered rung');
  assert.ok(stapel(x).flat().length - vor < vor, 'fewer renders than the first round');
  assert.deepEqual(l.plaetze.map((p) => p.param), [null, 'k1']);
});

test('renders never exceed MAX_MESSUNGEN, or MAX_MESSUNGEN_LEER while nothing audible was found', async (t) => {
  const W = {};
  for (let i = 1; i <= 40; i++) W[`k${i}`] = { hell: i === 1 ? 10 : 0 };
  const { r, log } = aufbauRunde(t, { knoepfe: 40, W });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  assert.equal(alleVarianten(log).length, MAX_MESSUNGEN, 'k1 is audible: the short budget');
  const leer = aufbauRunde(t, { knoepfe: 40, W: { k1: { hell: 0 } } });
  leer.r.starte({ spur_id: 's1' });
  await leer.r.warteFertig();
  assert.equal(alleVarianten(leer.log).length, MAX_MESSUNGEN_LEER, 'nothing audible: the long budget');
  assert.ok(leer.r.lage().fortschritt.gemessen <= leer.r.lage().fortschritt.hoechstens);
});

test('fein, normal and grob give places at three increasing differences for the same knob', async () => {
  const platz = async (schritt) => (await lauf(einKnopf({ hell: 2.5 }), { schritt })).plaetze[1];   // D = 5 x travel from 0.2
  const [f, n, g] = [await platz('fein'), await platz('normal'), await platz('grob')];
  assert.ok(f.staerke < n.staerke && n.staerke < g.staerke, `${f.staerke} ${n.staerke} ${g.staerke}`);
  assert.deepEqual([g.wert, n.wert], [1, 0.8], 'normal: 0.55 gives D 1.75, the next rung 0.8 gives 3 = the bound; strong: only the range end');
});


// FIND SOUND rework T3: no two places of one round carry the same word.
// k1 and k2 both read "fewer highs"; k2 has no other clearly present feature (four weak ones, each under half of the leading one), so it is not
// offered; k3 and k4 take the places instead.
const PAAR = { k1: { hoehen: -10 }, k2: { hoehen: 10, hell: 4, sub: 4, breite: 4, punch: 4 }, k3: { sub: -10 }, k4: { bewegung: -10 } };

test('the fewer-highs pair: the second highs candidate is not offered, the next candidate takes the place, all words differ', async (t) => {
  const { r } = aufbauRunde(t, { W: PAAR });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const l = r.lage();
  assert.equal(l.zustand, 'fertig');
  assert.deepEqual(l.plaetze.map((p) => [p.platz, p.param, p.wort]), [['A', null, 'current'], ['B', 'k1', 'fewer highs'], ['C', 'k3', 'less sub'], ['D', 'k4', 'more movement']]);
  const worte = l.plaetze.slice(1).map((p) => p.wort);
  assert.equal(new Set(worte).size, worte.length);
  assert.ok(l.plaetze[1].text.startsWith('fewer highs · '));
});

test('fill-up never repeats a word, and without another candidate the round shows fewer than three places', async (t) => {
  const { r } = aufbauRunde(t, { W: { k1: PAAR.k1, k2: PAAR.k2 }, knoepfe: 4 });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  const l = r.lage();
  assert.equal(l.zustand, 'fertig');
  // k2 downwards reads "fewer highs" again and is not offered; k2 upwards reads "more highs", a different word
  assert.deepEqual(l.plaetze.map((p) => [p.platz, p.param, p.wort]), [['A', null, 'current'], ['B', 'k1', 'fewer highs'], ['C', 'k2', 'more highs']]);
});

// FIND SOUND rework, review fix: a knob that is sensitive (its first step already gives D far over the target) gives three different places at the
// three levels: the round narrows the step, subtle < clear < strong in D and in distance.
test('a sensitive knob gives three increasing places at fein, normal and grob (the round narrows an overshooting step)', async () => {
  const lauf1 = async (schritt) => { const l = await lauf(einKnopf({ hell: 3 }), { schritt }); return l.plaetze[1]; };   // D = 6 x travel: 2.1 at 0.35
  const [f, n, g] = [await lauf1('fein'), await lauf1('normal'), await lauf1('grob')];
  assert.ok(f.wert < n.wert && n.wert < g.wert, `${f.wert} ${n.wert} ${g.wert}`);
  assert.ok(f.staerke >= ZIELE.fein && f.staerke <= UEBERSCHUSS * ZIELE.fein, `fein D ${f.staerke}`);
  assert.ok(n.staerke >= ZIELE.normal && n.staerke <= UEBERSCHUSS * ZIELE.normal, `normal D ${n.staerke}`);
  assert.ok(g.staerke >= ZIELE.grob && g.staerke <= UEBERSCHUSS * ZIELE.grob, `grob D ${g.staerke}`);
  assert.ok(f.staerke < n.staerke && n.staerke < g.staerke);
});

test('hoereBk reaches every bk track up to BK_LIVE_SLOTS (spur/<slot>/bk/<k>): the 9th and the 16th are live, nothing is refused, the project untouched', async (t) => {
  const a = await aufbau(t, { mitKick: false, mitWirt: false });
  await a.aendern(Array.from({ length: 16 }, (_, i) => ({ befehl: 'spur_neu', art: 'instrument', name: `P${i + 1}`,
    geraet: { art: 'intern', name: 'bk', graph: 'bassmusik' } })));
  const rev = a.projekt().rev, vor = JSON.stringify(a.projekt());
  for (const [name, slot] of [['P8', 8], ['P9', 9], ['P16', 16]]) {
    const sp = a.projekt().spuren.find((s) => s.name === name);
    a.protokoll.gesendet.length = 0;
    await a.echt.hoereBk(sp.id, { k3: 0.7 }, 'andreas');
    assert.deepEqual(a.protokoll.gesendet.filter((g) => g.adresse === '/k/teil').map((g) => g.felder.pfad), [`spur/${slot}/bk/3`], `${name} is live`);
  }
  assert.deepEqual([a.projekt().rev, JSON.stringify(a.projekt())], [rev, vor]);
});
