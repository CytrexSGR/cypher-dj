// Instrument picker plan, task 3 (decision D28): a sound loads its instrument. The pure apply plan with `graphLaden` (presets/apply.ts) and the route flag
// `graph_laden` of POST /presets/anwenden (presets/area.ts). Without the flag every refusal stays; the existing expectations are in presets_anwenden*.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { planeAnwendung } from '../presets/apply.ts';
import { PresetFehler } from '../presets/model.ts';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { presetsBereich } from '../presets/area.ts';
import { ruf } from './support/proj_stack.mjs';

// the graph folder of this file: two instruments with `vorgabe` values and an effect (vorgabenVon reads CYPHERDJ_BK_ORDNER)
const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-graph-'));
const instrument = (name, vorgabe) => ({ format: 'baukasten/2', name, stimmen: 1, regler_namen: { 1: 'A', 2: 'B' },
  knoten: [{ id: 'n', art: 'note' }, { id: 'o', art: 'ausgang' }, { id: 'k1', art: 'regler', nr: 1, min: 0, max: 1, vorgabe }, { id: 'k2', art: 'regler', nr: 2, min: 0, max: 1, vorgabe: 0.9 }], kanten: [] });
for (const g of [instrument('neu-a', 0.2), instrument('neu-b', 0.7), instrument('alt', 0.4)]) fs.writeFileSync(path.join(ORDNER, `${g.name}.json`), JSON.stringify(g));
process.env.CYPHERDJ_BK_ORDNER = ORDNER;
process.on('exit', () => { try { fs.rmSync(ORDNER, { recursive: true, force: true }); } catch { /* gone */ } });

const ARTEN = { 'neu-a': 'instrument', 'neu-b': 'instrument', alt: 'instrument', 'neu-lat': 'instrument', 'fx-x': 'effekt' };
const graphGibt = (n) => ARTEN[n] ?? null;
const graphLatenz = (n) => (n === 'neu-lat' ? 64 : 0);
const MIT = { graphLaden: true, graphGibt, graphLatenz };
const fehler = (f, grund) => { try { f(); } catch (e) { assert.ok(e instanceof PresetFehler, String(e)); assert.equal(e.fehler, grund); return e; } return assert.fail(`expected ${grund}`); };

const PRESET = { id: 'nutzer:baukasten/neu', name: 'Neu', geraet: 'baukasten', graph: 'neu-a', werte: { lautstaerke: 0.5, knob2: 0.25, knob8: 1 } };

// s1 bass (rb338), s2 pad (bk graph alt, knob 1 = 0.9), s3 kit, s4 audio
function projekt() {
  let p = neuesProjekt('T');
  const lauf = (b) => { p = fuehreListeAus(p, b, { quelle: 'andreas' }).projekt; };
  lauf([{ befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: { art: 'intern', name: 'rb338', parameter: {} } }]);
  lauf([{ befehl: 'spur_neu', art: 'instrument', name: 'Pad', geraet: { art: 'intern', name: 'bk', graph: 'alt', parameter: { k1: 0.9 } } }]);
  lauf([{ befehl: 'spur_neu', art: 'instrument', name: 'Drums', geraet: { art: 'intern', name: 'kit', kit: 'k909' } }]);
  return p;
}
const SPUR_PAD = { art: 'spur', spur_id: 's2' };

test('track with another graph and the flag: spur_aendern with the preset graph and ONLY the preset knobs, hint graph_gewechselt', () => {
  const p = projekt();
  const plan = planeAnwendung(PRESET, SPUR_PAD, p, undefined, MIT);
  assert.deepEqual(plan, { weg: 'proj', label: 'Preset Neu', uebersprungen: ['lautstaerke'], hinweise: ['graph_gewechselt'],
    befehle: [{ befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'intern', name: 'bk', graph: 'neu-a', parameter: { k2: 0.25, k8: 1 }, preset: PRESET.id } }] });
  assert.equal(plan.befehle[0].geraet.parameter.k1, undefined, 'the old knob 1 (0.9) meant something else in the old graph and is not carried over');
  // the plan runs as one command list through the model (graph lookup injected like the server does) and swaps the track
  const nach = fuehreListeAus(p, plan.befehle, { graphArt: graphGibt }).projekt.spuren[1].geraet;
  assert.deepEqual([nach.graph, nach.parameter.k2, nach.parameter.k1, nach.preset], ['neu-a', 0.25, undefined, PRESET.id]);
});

test('track, same graph with the flag: the plan is exactly the plan without the flag (no hint, old knobs kept)', () => {
  const p = projekt();
  const gleich = { ...PRESET, graph: 'alt' };
  const ohne = planeAnwendung(gleich, SPUR_PAD, p);
  assert.deepEqual(planeAnwendung(gleich, SPUR_PAD, p, undefined, MIT), ohne);
  assert.equal(ohne.hinweise, undefined);
  assert.deepEqual(ohne.befehle[0].geraet.parameter, { k1: 0.9, k2: 0.25, k8: 1 });
});

test('track, another graph WITHOUT the flag (absent, false, a string): graph_anders as before, naming the preset graph; no hint of loading', () => {
  const p = projekt();
  for (const opt of [undefined, {}, { graphLaden: false }, { graphLaden: 'true', graphGibt, graphLatenz }]) {
    const e = fehler(() => planeAnwendung(PRESET, SPUR_PAD, p, undefined, opt), 'graph_anders');
    assert.deepEqual(e.zusatz, { graph: 'neu-a' });
  }
});

test('track with kit or rb338 and the flag stays geraet_passt_nicht; a stage never swaps its graph', () => {
  const p = projekt();
  fehler(() => planeAnwendung(PRESET, { art: 'spur', spur_id: 's3' }, p, undefined, MIT), 'geraet_passt_nicht');
  fehler(() => planeAnwendung(PRESET, { art: 'spur', spur_id: 's1' }, p, undefined, MIT), 'geraet_passt_nicht');
  // an effect stage of another graph stays graph_anders with the flag; no `graph` field (the page must not offer to load anything)
  let q = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: 'A' }], { quelle: 'andreas' }).projekt;
  q = fuehreListeAus(q, [{ befehl: 'insert_setzen', strang_id: 's4', pos: 0, art: 'bk', graph: 'fx-x' }], { quelle: 'andreas' }).projekt;
  const id = q.spuren[3].inserts[0].id;
  const fx = { ...PRESET, graph: 'fx-y' };
  const e = fehler(() => planeAnwendung(fx, { art: 'insert', insert_id: id }, q, undefined, MIT), 'graph_anders');
  assert.equal(e.zusatz, undefined);
});

test('graph_fehlt (404, the instrument is not installed) for an unknown graph and for an effect graph, on a track and on a channel; nothing is planned', () => {
  const p = projekt();
  for (const graph of ['gibt-es-nicht', 'fx-x']) {
    const pr = { ...PRESET, graph };
    for (const [ziel, geladen] of [[SPUR_PAD, undefined], [{ art: 'kanal', kanal: 'erz/6' }, 'alt'], [{ art: 'kanal', kanal: 'erz/6' }, undefined]]) {
      const e = fehler(() => planeAnwendung(pr, ziel, p, geladen, MIT), 'graph_fehlt');
      assert.deepEqual([e.code, e.text], [404, 'the instrument of this preset is not installed'], `${graph} ${JSON.stringify(ziel)}`);
    }
  }
});

test('the latency rule of the SEQ picker is mirrored: a graph with latency is refused graph_latenz on a SEQ pattern track, fine on an ordinary track', () => {
  let p = neuesProjekt('S'); p.live = true; p.plaetze = [{ typ: 'track' }, { typ: 'track' }, { typ: 'track' }, { typ: 'track' }];
  const lauf = (b) => { p = fuehreListeAus(p, b, { quelle: 'andreas' }).projekt; };
  lauf([{ befehl: 'seq_anlegen', platz: 2 }]);
  lauf([{ befehl: 'seq_folge_neu', gruppe_id: p.gruppen[0].id, name: 'Bass', geraet: { art: 'intern', name: 'bk', graph: 'alt', parameter: {} } }]);
  lauf([{ befehl: 'spur_neu', art: 'instrument', name: 'Pad', geraet: { art: 'intern', name: 'bk', graph: 'alt', parameter: {} } }]);
  const [pattern, frei] = p.spuren;
  assert.equal(pattern.ausgang.id, p.gruppen[0].id, 'fixture: the first track plays into the SEQ group');
  const lat = { ...PRESET, graph: 'neu-lat' };
  assert.equal(fehler(() => planeAnwendung(lat, { art: 'spur', spur_id: pattern.id }, p, undefined, MIT), 'graph_latenz').code, 409);
  assert.equal(planeAnwendung(lat, { art: 'spur', spur_id: frei.id }, p, undefined, MIT).befehle[0].geraet.graph, 'neu-lat');
  // a graph without latency loads on the pattern; a pattern already playing the latency graph is not a swap
  assert.equal(planeAnwendung(PRESET, { art: 'spur', spur_id: pattern.id }, p, undefined, MIT).befehle[0].geraet.graph, 'neu-a');
  // the model itself does not check this (the plan mirrors it): the exchange alone is accepted by spur_aendern
  assert.doesNotThrow(() => fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: pattern.id, geraet: { art: 'intern', name: 'bk', graph: 'neu-lat', parameter: {} } }], { graphArt: graphGibt }));
});

test('channel with another graph or none loaded and the flag: graph {kanal, name} first, 64 requests against the PRESET graph defaults', () => {
  for (const geladen of ['alt', undefined, '']) {
    const plan = planeAnwendung(PRESET, { art: 'kanal', kanal: 'erz/6' }, null, geladen, MIT);
    assert.deepEqual(plan.graph, { kanal: 'erz/6', name: 'neu-a' });
    assert.equal(plan.weg, 'regler');
    assert.deepEqual(plan.anfragen.map((a) => a.pfad), Array.from({ length: 64 }, (_, i) => `erz/6/bk/${i + 1}`));
    assert.equal(plan.anfragen[0].nach, 0.2, 'knob 1: the preset has none, so the vorgabe of neu-a (0.2), not of alt (0.4)');
    assert.equal(plan.anfragen[1].nach, 0.25);
    assert.equal(plan.anfragen[2].nach, 0.5, 'a knob the graph does not define: 0.5');
    assert.deepEqual(plan.uebersprungen, [], 'unchanged channel behaviour: the volume is not reported here');
  }
});

test('channel, the graph is already loaded: no graph field, the plan equals the plan without the flag; without the flag the refusals stay', () => {
  const ohne = planeAnwendung(PRESET, { art: 'kanal', kanal: 'erz/6' }, null, 'neu-a');
  const mit = planeAnwendung(PRESET, { art: 'kanal', kanal: 'erz/6' }, null, 'neu-a', MIT);
  assert.deepEqual(mit, ohne);
  assert.equal('graph' in mit, false);
  assert.equal(fehler(() => planeAnwendung(PRESET, { art: 'kanal', kanal: 'erz/6' }, null, 'alt'), 'graph_anders').zusatz.graph, 'neu-a');
  assert.equal(fehler(() => planeAnwendung(PRESET, { art: 'kanal', kanal: 'erz/6' }, null), 'kein_graph').zusatz.graph, 'neu-a');
});

test('a channel that cannot carry an instrument graph (deck, container pad, bus, the drum kit stream erz/1, the production stream erz/4) refuses the swap with kanal_art', () => {
  for (const kanal of ['deck/1', 'bus/1', 'pad/1', 'pad/2', 'erz/1', 'erz/4']) {   // container core: pad/1, pad/2 are containers, the graphs of the pad streams sit on erz/9, erz/10
    for (const geladen of ['alt', undefined]) fehler(() => planeAnwendung(PRESET, { art: 'kanal', kanal }, null, geladen, MIT), 'kanal_art');
  }
  for (const kanal of ['erz/2', 'erz/3', 'erz/5', 'erz/7', 'erz/9', 'erz/10']) assert.deepEqual(planeAnwendung(PRESET, { art: 'kanal', kanal }, null, 'alt', MIT).graph, { kanal, name: 'neu-a' });
});

test('the flag changes nothing for other devices: komp channel and rb338 track plans are identical with it', () => {
  const p = projekt();
  const rb = { id: 'nutzer:rb338/x', name: 'X', geraet: 'rb338', werte: { cutoff: 800 } };
  assert.deepEqual(planeAnwendung(rb, { art: 'spur', spur_id: 's1' }, p, undefined, MIT), planeAnwendung(rb, { art: 'spur', spur_id: 's1' }, p));
  const komp = { id: 'nutzer:komp/x', name: 'K', geraet: 'komp', werte: { thresh: -18, ratio: 4 } };
  assert.deepEqual(planeAnwendung(komp, { art: 'kanal', kanal: 'deck/1' }, null, undefined, MIT), planeAnwendung(komp, { art: 'kanal', kanal: 'deck/1' }, null));
});

// ---- the route ----
async function stapel(t, extra = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-graph-'));
  const nutzer = path.join(d, 'nutzer');
  const router = new Router();
  const z = { projekt: projekt() };
  router.melde(presetsBereich({ log: () => {}, quelle: () => 'andreas' }, { nutzer, projekt: () => z.projekt,
    graphen: () => [{ name: 'neu-a', art: 'instrument', latenz: 0 }, { name: 'alt', art: 'instrument', latenz: 0 }, { name: 'neu-lat', art: 'instrument', latenz: 64 }, { name: 'fx-x', art: 'effekt', latenz: 0 }], ...extra }));
  let port = 0;
  const server = http.createServer(async (q, a) => {
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    if (r.schutz === 'fremdePost' && q.method === 'POST' && postAbgewiesen(q, a, port)) return;
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  t.after(() => { server.close(); fs.rmSync(d, { recursive: true, force: true }); });
  return { url: `http://127.0.0.1:${port}`, z };
}
// a stored instrument preset of the graph neu-a (the route reads it from the store)
const speichere = (s, graph = 'neu-a', name = 'Neu Sound') => ruf(s.url, 'POST', '/presets', { name, geraet: 'baukasten', graph, werte: { knob2: 0.25 },

  beschreibung: { art: 'pad', unterart: 'analog', charakter: ['warm'], genre: [], einsatz: ['intro'], energie: 1, text: 'A warm pad for the picker tests.' } });

test('POST /presets/anwenden: graph_laden true loads the instrument on a track (plan), the refusal names the graph, other values of the flag keep the refusal', async (t) => {
  const s = await stapel(t);
  const gespeichert = await speichere(s); assert.equal(gespeichert.code, 201, JSON.stringify(gespeichert.j));
  const id = 'nutzer:baukasten/neu-sound';
  const ziel = { art: 'spur', spur_id: 's2' };
  const vorher = JSON.stringify(s.z.projekt);
  const ohne = await ruf(s.url, 'POST', '/presets/anwenden', { id, ziel });
  assert.deepEqual([ohne.code, ohne.j.fehler, ohne.j.graph, typeof ohne.j.text], [409, 'graph_anders', 'neu-a', 'string']);
  for (const wert of ['true', 1, 'ja']) assert.equal((await ruf(s.url, 'POST', '/presets/anwenden', { id, ziel, graph_laden: wert })).j.fehler, 'graph_anders', String(wert));
  const mit = await ruf(s.url, 'POST', '/presets/anwenden', { id, ziel, graph_laden: true });
  assert.equal(mit.code, 200, JSON.stringify(mit.j));
  assert.deepEqual([mit.j.weg, mit.j.hinweise, mit.j.befehle[0].geraet.graph, mit.j.befehle[0].geraet.parameter], ['proj', ['graph_gewechselt'], 'neu-a', { k2: 0.25 }]);
  assert.equal(JSON.stringify(s.z.projekt), vorher, 'the route changes nothing');
});

test('POST /presets/anwenden: graph_laden on a channel gives the graph first; graph_fehlt, graph_latenz and a plain refusal answer with their text', async (t) => {
  const geladen = { 'erz/6': 'alt' };
  const s = await stapel(t, { graphVon: (k) => geladen[k] });
  await speichere(s);
  const id = 'nutzer:baukasten/neu-sound';
  const kanal = await ruf(s.url, 'POST', '/presets/anwenden', { id, ziel: { art: 'kanal', kanal: 'erz/6' }, graph_laden: true });
  assert.deepEqual([kanal.code, kanal.j.weg, kanal.j.graph, kanal.j.anfragen.length], [200, 'regler', { kanal: 'erz/6', name: 'neu-a' }, 64], JSON.stringify(kanal.j).slice(0, 200));
  const leer = await ruf(s.url, 'POST', '/presets/anwenden', { id, ziel: { art: 'kanal', kanal: 'erz/7' }, graph_laden: true });
  assert.deepEqual([leer.code, leer.j.graph], [200, { kanal: 'erz/7', name: 'neu-a' }]);
  assert.deepEqual((await ruf(s.url, 'POST', '/presets/anwenden', { id, ziel: { art: 'kanal', kanal: 'erz/7' } })).j.fehler, 'kein_graph');
  // an effect graph and an unknown one: graph_fehlt with the apply text
  await speichere(s, 'fx-x', 'Effekt Sound');
  const fx = await ruf(s.url, 'POST', '/presets/anwenden', { id: 'nutzer:baukasten/effekt-sound', ziel: { art: 'kanal', kanal: 'erz/7' }, graph_laden: true });
  assert.deepEqual([fx.code, fx.j.fehler, fx.j.text], [404, 'graph_fehlt', 'the instrument of this preset is not installed']);
  await speichere(s, 'weg-damit', 'Weg Sound');
  const weg = await ruf(s.url, 'POST', '/presets/anwenden', { id: 'nutzer:baukasten/weg-sound', ziel: { art: 'spur', spur_id: 's2' }, graph_laden: true });
  assert.deepEqual([weg.code, weg.j.fehler], [404, 'graph_fehlt']);
  // the save path keeps its own meaning of graph_fehlt (400, the preset names no graph)
  const speicher = await ruf(s.url, 'POST', '/presets', { name: 'Ohne Graph', geraet: 'baukasten', werte: { knob1: 0.5 },
    beschreibung: { art: 'pad', unterart: 'analog', charakter: ['warm'], genre: [], einsatz: ['intro'], energie: 1, text: 'A pad that names no graph at all.' } });
  assert.deepEqual([speicher.code, speicher.j.fehler, speicher.j.text], [400, 'graph_fehlt', 'a Baukasten preset needs the name of its graph (graph)']);
});

test('POST /presets/anwenden: a latency graph on a SEQ pattern track is refused graph_latenz (409) through the route', async (t) => {
  const s = await stapel(t);
  let p = neuesProjekt('S'); p.live = true; p.plaetze = [{ typ: 'track' }, { typ: 'track' }, { typ: 'track' }, { typ: 'track' }];
  const lauf = (b) => { p = fuehreListeAus(p, b, { quelle: 'andreas' }).projekt; };
  lauf([{ befehl: 'seq_anlegen', platz: 2 }]);
  lauf([{ befehl: 'seq_folge_neu', gruppe_id: p.gruppen[0].id, name: 'Bass', geraet: { art: 'intern', name: 'bk', graph: 'alt', parameter: {} } }]);
  s.z.projekt = p;
  await speichere(s, 'neu-lat', 'Latenz Sound');
  const r = await ruf(s.url, 'POST', '/presets/anwenden', { id: 'nutzer:baukasten/latenz-sound', ziel: { art: 'spur', spur_id: p.spuren[0].id }, graph_laden: true });
  assert.deepEqual([r.code, r.j.fehler, typeof r.j.text], [409, 'graph_latenz', 'string']);
  assert.match(r.j.text, /SEQ/);
});

// A hidden duplicate (kategorien.json `verborgen`) is only left out of the pickers: its sound is listed and loads the graph.
test('hidden instrument: its sound is listed in the sound list and graph_laden loads the hidden graph on a track and on a channel', async (t) => {
  const s = await stapel(t, { graphen: () => [{ name: 'neu-a', art: 'instrument', latenz: 0, verborgen: true }, { name: 'alt', art: 'instrument', latenz: 0 }] });
  assert.equal((await speichere(s)).code, 201);
  const liste = await ruf(s.url, 'GET', '/presets?geraet=baukasten');
  assert.ok(liste.j.some((e) => e.slug === 'neu-sound'), 'the sound list does not depend on the picker list');
  const id = 'nutzer:baukasten/neu-sound';
  const spur = await ruf(s.url, 'POST', '/presets/anwenden', { id, ziel: { art: 'spur', spur_id: 's2' }, graph_laden: true });
  assert.equal(spur.code, 200, JSON.stringify(spur.j));
  assert.equal(spur.j.befehle[0].geraet.graph, 'neu-a');
  const kanal = await ruf(s.url, 'POST', '/presets/anwenden', { id, ziel: { art: 'kanal', kanal: 'erz/5' }, graph_laden: true });
  assert.equal(kanal.code, 200, JSON.stringify(kanal.j));
  assert.equal(kanal.j.graph?.name, 'neu-a');
});
