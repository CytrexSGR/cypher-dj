// Controller presets and follow: the routes of areas/controller/sequences.ts on the real Router with a fake context (a fake project, fake loaded graphs, a kern
// that takes every table), real learn files in a temp folder. The guard, the focus derivation, the follow rule and its hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { lernenBereich } from '../areas/learn/area.ts';
import { controllerBereich } from '../areas/controller/sequences.ts';
import { neuerTastenArm } from '../areas/controller/tasten.ts';
import { sendeLiveTasten, stromVonKanal, LIVE_TASTEN_ADRESSE } from '../areas/controller/tasten_live.ts';
import { GeraeteSpeicher, standard } from '../areas/devices/store.ts';
import { ruf, CYPHER } from './support/proj_stack.mjs';

const LPD = 'Midi-Bridge:LPD8: MIDI 1 (capture)', LC3 = 'Midi-Bridge:LC3: MIDI 1 (capture)';
const bk = (id, nr, graph = 'synth-poly') => ({ id, nr, name: `Track ${nr}`, art: 'instrument', geraet: { art: 'intern', name: 'bk', graph, parameter: {} } });

async function aufbau(t, o = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-ctl-folgen-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const konfigPfad = path.join(d, 'geraete.json'), ordner = path.join(d, 'controller'), werk = path.join(d, 'werk');
  const speicher = new GeraeteSpeicher(konfigPfad);
  const k = { ...standard(), midi: { profil: null, port: LPD, frei_fuer_cypher: false }, controller: [{ platz: 2, port: LC3, folgen: true }] };
  if (o.konfig) o.konfig(k);
  speicher.schreibe(k);
  const st = { geladen: { 'erz/5': 'synth-poly', 'erz/6': 'bass-mono' }, projekt: null, quelle: 'andreas', ...(o.stand ?? {}) };
  const sendet = [], verteilt = [], logs = [];
  let id = 100;
  const ctx = { sende: (a, f) => { sendet.push({ a, f }); return ++id; }, warteQuittung: async () => ({ status: 3, grund: '' }), quelle: () => st.quelle, kiGestoppt: () => false,
    verteile: (e) => verteilt.push(e), log: (z) => logs.push(z), baukasten: { geladen: () => ({ ...st.geladen }) }, projekt: () => st.projekt };
  const lern = lernenBereich(ctx, { ordner, geraeteKonfig: konfigPfad, zeit: { setzen: () => ({}), loeschen: () => {} } });
  lern.ereignis('/zustand/ein', { verbunden: 0x200 });   // proof that the kern knows the places 2..8
  const tastenArm = neuerTastenArm();
  const cb = controllerBereich(ctx, lern, { geraeteKonfig: konfigPfad, werk, tasten: tastenArm });
  const router = new Router();
  router.melde(lern); router.melde(cb);
  let port = 0;
  const server = http.createServer(async (q, a) => {
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    st.quelle = q.headers['x-djk-quelle'] === 'cypher' ? 'cypher' : 'andreas';   // as the server derives it for the running request
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    if (r.schutz === 'fremdePost' && q.method === 'POST' && postAbgewiesen(q, a, port)) return;
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  t.after(() => server.close());
  const url = `http://127.0.0.1:${port}`;
  const ziele = (platz) => lern.speicher.lies().zuordnungen.filter((z) => z.platz === platz).map((z) => z.pfad).sort();
  const mappings = () => sendet.filter((s) => s.a === '/k/mapping').map((s) => s.f.geraet);
  const fokusEreignisse = () => verteilt.filter((e) => e.a === 'controller_fokus');
  const werkPreset = (modell, slug, p) => { fs.mkdirSync(path.join(werk, modell), { recursive: true }); fs.writeFileSync(path.join(werk, modell, `${slug}.json`), JSON.stringify(p)); };
  return { d, url, st, lern, cb, tastenArm, speicher, ziele, mappings, fokusEreignisse, werkPreset, sendet, verteilt, logs, konfigPfad,
    fokus: (b, kopf) => ruf(url, 'POST', '/controller/fokus', b, kopf), get: (p) => ruf(url, 'GET', p), post: (p, b, kopf) => ruf(url, 'POST', p, b, kopf) };
}
const knoepfe = (basis, n) => Array.from({ length: n }, (_, i) => `${basis}${i + 1}`).sort();
const synthPoly = { schema: 1, name: 'synth-poly', modell: 'lc3', art: 'instrument', graph: 'synth-poly', eintraege: [{ regler: 'Enc 1', knopf: 45 }, { regler: 'Enc 2', knopf: 52 }] };

test('guard: every route that changes an assignment or a preset, and the focus message, is 403 nur_andreas for cypher and changes nothing', async (t) => {
  const x = await aufbau(t);
  for (const [p, b] of [['/controller/fokus', { kanal: 'erz/5' }], ['/controller/presets/speichern', { platz: 2, art: 'fest', name: 'a' }],
    ['/controller/presets/laden', { platz: 2, id: 'nutzer:lc3/a' }], ['/controller/presets/loeschen', { id: 'nutzer:lc3/a' }]]) {
    const r = await x.post(p, b, CYPHER);
    assert.deepEqual([r.code, r.j.fehler], [403, 'nur_andreas'], p);
  }
  assert.deepEqual((await x.get('/controller/fokus')).j.fokus, null);
  assert.deepEqual(x.ziele(2), []);
  assert.deepEqual(x.mappings(), []);
  assert.deepEqual(x.fokusEreignisse(), []);
  assert.equal(fs.existsSync(path.join(x.d, 'controller', 'presets')), false);
  assert.equal((await x.get('/controller/presets')).code, 200, 'reading the list is open');
});

test('focus: an instrument channel gives graph and base; a channel without bk rows or without a graph gives no base and the reason', async (t) => {
  const x = await aufbau(t);
  const a = await x.fokus({ kanal: 'erz/5' });
  assert.equal(a.code, 200);
  assert.deepEqual(a.j.fokus, { kanal: 'erz/5', graph: 'synth-poly', basis: 'erz/5/bk/' });
  assert.deepEqual((await x.fokus({ kanal: 'erz/4' })).j.fokus, { kanal: 'erz/4', graph: null, basis: null, grund: 'kein_bk' });
  assert.deepEqual((await x.fokus({ kanal: 'erz/1' })).j.fokus, { kanal: 'erz/1', graph: null, basis: null, grund: 'kein_graph' });
  assert.deepEqual((await x.get('/controller/fokus')).j.fokus, { kanal: 'erz/1', graph: null, basis: null, grund: 'kein_graph' });
  assert.deepEqual((await x.fokus({})).j.fokus, null);
});

test('focus: a project track gives the slot of its Baukasten order as base; slot 9 has no rows; a track that is no Baukasten track or no track at all gives kein_bk', async (t) => {
  const spuren = [...Array.from({ length: 10 }, (_, i) => bk(`s${i + 1}`, i + 1)), { id: 'k1', nr: 20, name: 'Kit', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: 'k' } },
    { id: 'a1', nr: 21, name: 'Audio', art: 'audio', clips: [] }, bk('leer', 30, '')];
  const x = await aufbau(t, { stand: { projekt: { spuren } } });
  assert.deepEqual((await x.fokus({ spur_id: 's3' })).j.fokus, { spur_id: 's3', graph: 'synth-poly', basis: 'spur/3/bk/' });
  assert.deepEqual((await x.fokus({ spur_id: 's8' })).j.fokus, { spur_id: 's8', graph: 'synth-poly', basis: 'spur/8/bk/' });
  assert.deepEqual((await x.fokus({ spur_id: 's9' })).j.fokus, { spur_id: 's9', graph: 'synth-poly', basis: null, grund: 'slot_ohne_zeile' });
  assert.deepEqual((await x.fokus({ spur_id: 'k1' })).j.fokus, { spur_id: 'k1', graph: null, basis: null, grund: 'kein_bk' });
  assert.deepEqual((await x.fokus({ spur_id: 'a1' })).j.fokus, { spur_id: 'a1', graph: null, basis: null, grund: 'kein_bk' });
  assert.deepEqual((await x.fokus({ spur_id: 'nope' })).j.fokus, { spur_id: 'nope', graph: null, basis: null, grund: 'kein_bk' });
  assert.deepEqual((await x.fokus({ spur_id: 'leer' })).j.fokus, { spur_id: 'leer', graph: null, basis: null, grund: 'kein_graph' });
  x.st.projekt = null;
  assert.equal((await x.fokus({ spur_id: 's3' })).j.fokus.grund, 'kein_bk', 'no project open');
  for (const b of [{ kanal: 'x' }, { kanal: 5 }, { spur_id: 'a b' }, { spur_id: 7 }, { kanal: 'erz/5', spur_id: 's1' }]) assert.deepEqual([(await x.fokus(b)).code, (await x.fokus(b)).j.fehler], [400, 'argument_ungueltig'], JSON.stringify(b));
});

test('follow: a following place gets the factory instrument preset on the base, a place that does not follow is never touched; one reload, one event', async (t) => {
  const x = await aufbau(t);
  x.werkPreset('lc3', 'synth-poly', synthPoly);
  await x.lern.ersetze(1, [{ pfad: 'erz/5/bk/9', kanal: 1, nr: 1 }]);   // place 1 does not follow: its own entry stays
  const vorher = x.mappings().length;
  const a = await x.fokus({ kanal: 'erz/5' });
  assert.deepEqual(a.j.plaetze, [{ platz: 1, modell: 'lpd8', folgen: false, preset: null }, { platz: 2, modell: 'lc3', folgen: true, preset: 'werk:lc3/synth-poly' }]);
  assert.deepEqual(x.ziele(2), ['erz/5/bk/45', 'erz/5/bk/52']);
  assert.deepEqual(x.lern.speicher.lies().zuordnungen.filter((z) => z.platz === 2).map((z) => [z.kanal, z.nr]).sort(), [[0, 13], [0, 14]]);
  assert.deepEqual(x.ziele(1), ['erz/5/bk/9']);
  assert.deepEqual(x.mappings().slice(vorher), ['lernen-2'], 'one kern reload, for the one place that changed');
  assert.deepEqual(x.fokusEreignisse().map((e) => e.f), [a.j], 'the event carries the body of GET /controller/fokus');
});

test('follow: without an instrument preset the default bank lands on knob 1, 2, 3 ...; the old knob entries go, deck filters and buttons stay', async (t) => {
  const x = await aufbau(t);
  x.werkPreset('lc3', 'synth-poly', synthPoly);
  await x.lern.ersetze(2, [{ pfad: 'deck/1/fader', kanal: 16, nr: 40 }, { pfad: 'deck/1/pfl', kanal: 16, nr: 41, art: 'taste' }], 'alle');
  await x.fokus({ kanal: 'erz/5' });
  assert.deepEqual(x.ziele(2), ['deck/1/fader', 'deck/1/pfl', 'erz/5/bk/45', 'erz/5/bk/52']);
  const b = await x.fokus({ kanal: 'erz/6' });
  assert.deepEqual(x.ziele(2), ['deck/1/fader', 'deck/1/pfl', ...knoepfe('erz/6/bk/', 16)].sort());
  assert.equal(b.j.plaetze[1].preset, 'bank');
});

test('follow: the same focus again changes nothing (no write, no reload, no event); a focus without a base or no focus removes nothing', async (t) => {
  const x = await aufbau(t);
  await x.fokus({ kanal: 'erz/6' });
  const n = x.mappings().length, e = x.fokusEreignisse().length, vorher = x.ziele(2);
  await x.fokus({ kanal: 'erz/6' });
  assert.equal(x.mappings().length, n);
  assert.equal(x.fokusEreignisse().length, e);
  for (const b of [{ kanal: 'erz/4' }, { kanal: 'erz/1' }, {}]) {
    await x.fokus(b);
    assert.deepEqual(x.ziele(2), vorher, JSON.stringify(b));
  }
  assert.equal(x.mappings().length, n, 'no reload without a base');
  assert.equal((await x.get('/controller/fokus')).j.plaetze[1].preset, 'bank', 'what was applied is still reported');
});

test('follow: a user preset wins over the factory one; the entries it names that the device lacks are left out without harm', async (t) => {
  const x = await aufbau(t);
  x.werkPreset('lc3', 'synth-poly', synthPoly);
  fs.mkdirSync(path.join(x.d, 'controller', 'presets', 'lc3'), { recursive: true });
  fs.writeFileSync(path.join(x.d, 'controller', 'presets', 'lc3', 'synth-poly.json'), JSON.stringify({ ...synthPoly, eintraege: [{ regler: 'Enc 3', knopf: 7 }, { regler: 'Enc 99', knopf: 8 }] }));
  const a = await x.fokus({ kanal: 'erz/5' });
  assert.equal(a.j.plaetze[1].preset, 'nutzer:lc3/synth-poly');
  assert.deepEqual(x.ziele(2), ['erz/5/bk/7']);
});

test('follow: a project track follows through its slot: the track list changes, the base moves, the table is rewritten by the hook', async (t) => {
  const spuren = [bk('s1', 1), bk('s2', 2), bk('s3', 3)];
  const x = await aufbau(t, { stand: { projekt: { spuren } } });
  await x.fokus({ spur_id: 's3' });
  assert.deepEqual(x.ziele(2), knoepfe('spur/3/bk/', 16));
  spuren.shift();   // s1 removed: s3 is now the second Baukasten track
  await x.cb.anstoss();
  assert.deepEqual(x.ziele(2), knoepfe('spur/2/bk/', 16));
  assert.deepEqual((await x.get('/controller/fokus')).j.fokus, { spur_id: 's3', graph: 'synth-poly', basis: 'spur/2/bk/' });
  assert.equal(x.fokusEreignisse().length, 2);
  spuren[1].geraet.graph = 'bass-mono';   // another graph on the focused track
  await x.cb.anstoss();
  assert.equal((await x.get('/controller/fokus')).j.fokus.graph, 'bass-mono');
  spuren.splice(0, 1);   // the focused track is now the only one: slot 1
  await x.cb.anstoss();
  assert.deepEqual(x.ziele(2), knoepfe('spur/1/bk/', 16));
});

test('follow: the kern event /e/graph (another graph on the focused channel) re-resolves; an event for nothing new writes nothing', async (t) => {
  const x = await aufbau(t);
  x.werkPreset('lc3', 'synth-poly', synthPoly);
  await x.fokus({ kanal: 'erz/5' });
  assert.deepEqual(x.ziele(2), ['erz/5/bk/45', 'erz/5/bk/52']);
  const n = x.mappings().length;
  x.cb.ereignis('/e/graph', { kanal: 'erz/5', name: 'synth-poly' });
  await x.cb.anstoss();
  assert.equal(x.mappings().length, n, 'same graph: nothing');
  x.st.geladen['erz/5'] = 'bass-mono';
  x.cb.ereignis('/e/graph', { kanal: 'erz/5', name: 'bass-mono' });
  await x.cb.anstoss();
  assert.deepEqual(x.ziele(2), knoepfe('erz/5/bk/', 16));
  assert.equal((await x.get('/controller/fokus')).j.plaetze[1].preset, 'bank');
});

test('follow: turning the flag on (a change of the devices file) applies at the next pass; place 1 follows through midi.folgen; the lower place keeps a doubled target', async (t) => {
  const x = await aufbau(t, { konfig: (k) => { delete k.controller[0].folgen; } });
  await x.fokus({ kanal: 'erz/6' });
  assert.deepEqual(x.ziele(2), [], 'nobody follows yet');
  const k = x.speicher.lies();
  k.midi.folgen = true; k.controller[0].folgen = true;
  x.speicher.schreibe(k);
  await x.cb.anstoss();
  assert.deepEqual(x.ziele(1), knoepfe('erz/6/bk/', 8), 'the LPD8 knobs K1..K8 on knob 1..8');
  assert.deepEqual(x.ziele(2), Array.from({ length: 8 }, (_, i) => `erz/6/bk/${i + 9}`).sort(), 'the LC3 gets what is left: place 1 keeps its targets');
  assert.deepEqual(x.lern.speicher.lies().zuordnungen.filter((z) => z.platz === 1).map((z) => [z.kanal, z.nr]).sort(), Array.from({ length: 8 }, (_, i) => [0, i + 1]));
});

test('follow: a damaged learn file is never overwritten; the follow reports it in the log and leaves the place', async (t) => {
  const x = await aufbau(t);
  fs.mkdirSync(path.join(x.d, 'controller'), { recursive: true });
  fs.writeFileSync(path.join(x.d, 'controller', 'lernen-3.json'), '{ broken');
  await x.fokus({ kanal: 'erz/6' });
  assert.equal(fs.readFileSync(path.join(x.d, 'controller', 'lernen-3.json'), 'utf8'), '{ broken');
  assert.deepEqual(x.ziele(2), []);
  assert.ok(x.logs.some((z) => z.typ === 'controller_folgen_fehler'));
});

test('presets: save the instrument preset of the focus from the table of a place; the list shows it; without a base in the focus it is 409 kein_fokus', async (t) => {
  const x = await aufbau(t);
  const ohne = await x.post('/controller/presets/speichern', { platz: 2, art: 'instrument' });
  assert.deepEqual([ohne.code, ohne.j.fehler], [409, 'kein_fokus']);
  await x.fokus({ kanal: 'erz/4' });
  assert.equal((await x.post('/controller/presets/speichern', { platz: 2, art: 'instrument' })).j.fehler, 'kein_fokus');
  await x.fokus({ kanal: 'erz/6' });   // the bank lands on the place
  await x.lern.ersetze(2, [{ pfad: 'erz/6/bk/20', kanal: 16, nr: 13 }, { pfad: 'erz/6/bk/21', kanal: 16, nr: 14 }]);
  const r = await x.post('/controller/presets/speichern', { platz: 2, art: 'instrument' });
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.preset, { id: 'nutzer:lc3/bass-mono', name: 'bass-mono', modell: 'lc3', art: 'instrument', graph: 'bass-mono', herkunft: 'nutzer', eintraege_zahl: 2 });
  const f = JSON.parse(fs.readFileSync(path.join(x.d, 'controller', 'presets', 'lc3', 'bass-mono.json'), 'utf8'));
  assert.deepEqual(f.eintraege, [{ regler: 'Enc 1', knopf: 20 }, { regler: 'Enc 2', knopf: 21 }]);
  assert.deepEqual((await x.get('/controller/presets?modell=lc3')).j.presets.map((p) => p.id), ['nutzer:lc3/bass-mono']);
  assert.deepEqual((await x.get('/controller/presets?modell=lpd8')).j.presets, []);
  assert.equal((await x.get('/controller/presets')).j.presets.length, 1);
  // an empty place has nothing to save
  assert.equal((await x.post('/controller/presets/speichern', { platz: 1, art: 'instrument' })).code, 400);
});

test('presets: a saved preset comes back by itself when that synth is selected again', async (t) => {
  const x = await aufbau(t);
  await x.fokus({ kanal: 'erz/6' });
  await x.lern.ersetze(2, [{ pfad: 'erz/6/bk/30', kanal: 16, nr: 13 }]);
  await x.post('/controller/presets/speichern', { platz: 2, art: 'instrument' });
  await x.fokus({ kanal: 'erz/5' });
  assert.deepEqual(x.ziele(2), knoepfe('erz/5/bk/', 16));
  const b = await x.fokus({ kanal: 'erz/6' });
  assert.deepEqual(x.ziele(2), ['erz/6/bk/30']);
  assert.equal(b.j.plaetze[1].preset, 'nutzer:lc3/bass-mono');
});

test('presets: a fest preset is a snapshot of the whole place under a name, the same name replaces it, and it loads back as the whole table', async (t) => {
  const x = await aufbau(t);
  await x.lern.ersetze(2, [{ pfad: 'deck/1/fader', kanal: 16, nr: 13 }, { pfad: 'deck/1/pfl', kanal: 1, nr: 37, art: 'taste' }, { pfad: 'deck/2/fader', kanal: 16, nr: 99 }], 'alle');
  const s = await x.post('/controller/presets/speichern', { platz: 2, art: 'fest', name: 'DJ filters' });
  assert.equal(s.j.preset.id, 'nutzer:lc3/dj-filters');
  assert.equal(s.j.preset.eintraege_zahl, 2, 'CC 99 is no control of the device: left out');
  assert.equal((await x.post('/controller/presets/speichern', { platz: 2, art: 'fest', name: 'dj FILTERS' })).j.preset.id, 'nutzer:lc3/dj-filters');
  assert.equal((await x.post('/controller/presets/speichern', { platz: 2, art: 'fest' })).code, 400);
  assert.equal((await x.post('/controller/presets/speichern', { platz: 2, art: 'fest', name: '!!!' })).code, 400);
  assert.equal((await x.post('/controller/presets/speichern', { platz: 2, art: 'wat' })).code, 400);
  await x.lern.ersetze(2, [{ pfad: 'deck/3/fader', kanal: 16, nr: 15 }], 'alle');
  const l = await x.post('/controller/presets/laden', { platz: 2, id: 'nutzer:lc3/dj-filters' });
  assert.equal(l.code, 200);
  assert.equal(l.j.gesetzt, 2);
  assert.deepEqual(l.j.uebersprungen, []);
  assert.ok(Array.isArray(l.j.zuordnungen), 'the answer carries the /lernen state');
  assert.deepEqual(x.ziele(2), ['deck/1/fader', 'deck/1/pfl']);
});

test('presets: load an instrument preset onto the focus base; skipped entries are listed; no focus is kein_fokus, another graph is graph_anders; the model must match', async (t) => {
  const x = await aufbau(t);
  x.werkPreset('lc3', 'bass-mono', { ...synthPoly, name: 'bass-mono', graph: 'bass-mono', eintraege: [{ regler: 'Enc 1', knopf: 3 }, { regler: 'Enc 99', knopf: 4 }, { regler: 'Enc 2', knopf: 70 }] });
  const id = 'werk:lc3/bass-mono';
  assert.equal((await x.post('/controller/presets/laden', { platz: 2, id })).j.fehler, 'kein_fokus');
  await x.fokus({ kanal: 'erz/5' });
  const anders = await x.post('/controller/presets/laden', { platz: 2, id });
  assert.deepEqual([anders.code, anders.j.fehler], [409, 'graph_anders']);
  await x.fokus({ kanal: 'erz/6' });
  const ok = await x.post('/controller/presets/laden', { platz: 2, id });
  assert.equal(ok.code, 200);
  assert.equal(ok.j.gesetzt, 1);
  assert.deepEqual(ok.j.uebersprungen, [{ regler: 'Enc 99', grund: 'regler_unbekannt' }, { regler: 'Enc 2', grund: 'ziel_ungueltig' }]);
  assert.deepEqual(x.ziele(2), ['erz/6/bk/3']);
  assert.equal((await x.get('/controller/fokus')).j.plaetze[1].preset, id);
  const falsch = await x.post('/controller/presets/laden', { platz: 1, id });
  assert.deepEqual([falsch.code, falsch.j.fehler], [400, 'argument_ungueltig']);
  assert.equal((await x.post('/controller/presets/laden', { platz: 2, id: 'nutzer:lc3/none' })).j.fehler, 'preset_unbekannt');
  assert.equal((await x.post('/controller/presets/laden', { platz: 5, id })).code, 400);
  assert.equal((await x.post('/controller/presets/laden', { platz: 2 })).code, 400);
});

test('presets: delete is for user presets only: a factory one is 409 werk_preset, an unknown one 404 preset_unbekannt', async (t) => {
  const x = await aufbau(t);
  x.werkPreset('lc3', 'synth-poly', synthPoly);
  await x.post('/controller/presets/speichern', { platz: 2, art: 'fest', name: 'mine' });
  assert.deepEqual((await x.get('/controller/presets')).j.presets.map((p) => p.id).sort(), ['nutzer:lc3/mine', 'werk:lc3/synth-poly']);
  const w = await x.post('/controller/presets/loeschen', { id: 'werk:lc3/synth-poly' });
  assert.deepEqual([w.code, w.j.fehler], [409, 'werk_preset']);
  assert.equal((await x.post('/controller/presets/loeschen', { id: 'nutzer:lc3/mine' })).code, 200);
  const u = await x.post('/controller/presets/loeschen', { id: 'nutzer:lc3/mine' });
  assert.deepEqual([u.code, u.j.fehler], [404, 'preset_unbekannt']);
  assert.equal((await x.post('/controller/presets/loeschen', {})).code, 400);
  assert.deepEqual((await x.get('/controller/presets')).j.presets.map((p) => p.id), ['werk:lc3/synth-poly']);
});

// ---- keys follow the focus (plan addendum N1) ----
const spurMit = (id, nr, geraet, art = 'instrument') => ({ id, nr, name: `Track ${nr}`, art, ...(geraet ? { geraet } : {}) });
const BKG = { art: 'intern', name: 'bk', graph: 'synth-poly', parameter: {} };

test('keys: the switch is on by default; a project track with a sink becomes the focus arm and the answer names it; the focus moving takes it back', async (t) => {
  const x = await aufbau(t, { stand: { projekt: { spuren: [spurMit('s1', 1, BKG), spurMit('s2', 2, { art: 'intern', name: 'kit', kit: 'k' }), spurMit('s3', 3, null, 'audio')] } } });
  assert.deepEqual((await x.get('/controller/fokus')).j.tasten, { an: true, ziel: null, grund: 'kein_fokus' });
  assert.equal(x.tastenArm.spur(), null);
  assert.deepEqual((await x.fokus({ spur_id: 's1' })).j.tasten, { an: true, ziel: { spur_id: 's1' } });
  assert.equal(x.tastenArm.spur(), 's1');
  assert.deepEqual((await x.fokus({ spur_id: 's2' })).j.tasten, { an: true, ziel: { spur_id: 's2' } }, 'a kit track takes the keys too, though it has no Baukasten knobs');
  assert.equal(x.tastenArm.spur(), 's2');
  assert.deepEqual((await x.fokus({ spur_id: 's3' })).j.tasten, { an: true, ziel: null, grund: 'kein_instrument' });
  assert.equal(x.tastenArm.spur(), null, 'an audio track in front: the arm is taken back');
  assert.deepEqual((await x.fokus({ spur_id: 's9' })).j.tasten, { an: true, ziel: null, grund: 'kein_instrument' }, 'unknown track');
  assert.deepEqual((await x.fokus({})).j.tasten, { an: true, ziel: null, grund: 'kein_fokus' });
});

test('keys: an instrument track without a sink (host track with no slot) gives no target and the reason', async (t) => {
  const x = await aufbau(t, { stand: { projekt: { spuren: [spurMit('s1', 1, { art: 'wirt', name: 'surge' }), spurMit('s2', 2, { art: 'wirt', name: 'surge', slot: 1 }), spurMit('s3', 3, { art: 'rack', glieder: [], kette: 0 })] } } });
  assert.deepEqual((await x.fokus({ spur_id: 's1' })).j.tasten, { an: true, ziel: null, grund: 'keine_senke' });
  assert.equal(x.tastenArm.spur(), null);
  assert.equal((await x.fokus({ spur_id: 's2' })).j.tasten.ziel.spur_id, 's2');
  assert.equal((await x.fokus({ spur_id: 's3' })).j.tasten.ziel.spur_id, 's3');
});

test('keys: the switch takes the arm back and gives it again; it is a route with the guard, an event goes out, and the focus is kept', async (t) => {
  const x = await aufbau(t, { stand: { projekt: { spuren: [spurMit('s1', 1, BKG)] } } });
  await x.fokus({ spur_id: 's1' });
  const n = x.fokusEreignisse().length;
  const nein = await x.post('/controller/fokus/tasten', { an: false });
  assert.equal(nein.code, 200);
  assert.deepEqual(nein.j.tasten, { an: false, ziel: null });
  assert.deepEqual(nein.j.fokus, { spur_id: 's1', graph: 'synth-poly', basis: 'spur/1/bk/' }, 'the focus is not lost');
  assert.equal(x.tastenArm.spur(), null);
  assert.equal(x.fokusEreignisse().length, n + 1);
  assert.deepEqual((await x.fokus({ spur_id: 's1' })).j.tasten, { an: false, ziel: null }, 'a focus message with the switch off arms nothing');
  assert.equal(x.tastenArm.spur(), null);
  assert.equal((await x.post('/controller/fokus/tasten', { an: true })).j.tasten.ziel.spur_id, 's1');
  assert.equal(x.tastenArm.spur(), 's1');
  assert.equal((await x.post('/controller/fokus/tasten', { an: 'ja' })).code, 400);
  const c = await x.post('/controller/fokus/tasten', { an: false }, CYPHER);
  assert.deepEqual([c.code, c.j.fehler], [403, 'nur_andreas']);
  assert.equal(x.tastenArm.spur(), 's1', 'cypher changed nothing');
});

test('keys: the switch works without any focus and tells the pages', async (t) => {
  const x = await aufbau(t);
  const r = await x.post('/controller/fokus/tasten', { an: false });
  assert.deepEqual(r.j.tasten, { an: false, ziel: null });
  assert.equal(x.fokusEreignisse().length, 1);
  assert.equal(x.fokusEreignisse()[0].f.tasten.an, false);
});

test('keys: a live channel takes the focus arm back and sets the live-key target of the core to the stream of the channel', async (t) => {
  const x = await aufbau(t, { stand: { projekt: { spuren: [spurMit('s1', 1, BKG)] } } });
  await x.fokus({ spur_id: 's1' });
  assert.equal(x.tastenArm.spur(), 's1');
  const vorher = x.sendet.length;
  const r = await x.fokus({ kanal: 'erz/5' });
  assert.deepEqual(r.j.tasten, { an: true, ziel: { kanal: 'erz/5' } });
  assert.equal(x.tastenArm.spur(), null, 'the arm is taken back');
  assert.deepEqual(x.sendet.slice(vorher).filter((s) => s.a.startsWith('/k/live')), [{ a: '/k/live/tasten', f: { strom: 5 } }], 'the stream of erz/5');
  assert.deepEqual((await x.fokus({ kanal: 'erz/4' })).j.tasten, { an: true, ziel: null, grund: 'kein_ziel' }, 'a channel without a stream');
  assert.deepEqual((await x.fokus({ kanal: 'erz/1' })).j.tasten, { an: true, ziel: null, grund: 'kein_ziel' }, 'the drum kit takes no keys');
});

test('keys: a restart of the page server (a new controller area) has the switch on and no focus', async (t) => {
  const x = await aufbau(t);
  await x.post('/controller/fokus/tasten', { an: false });
  const y = await aufbau(t);
  assert.deepEqual((await y.get('/controller/fokus')).j.tasten, { an: true, ziel: null, grund: 'kein_fokus' });
  assert.equal((await y.get('/controller/fokus')).j.fokus, null);
});

test('keys: the project changing under the focus (track removed, device without a sink) moves the arm at the next hook', async (t) => {
  const x = await aufbau(t, { stand: { projekt: { spuren: [spurMit('s1', 1, BKG)] } } });
  await x.fokus({ spur_id: 's1' });
  assert.equal(x.tastenArm.spur(), 's1');
  x.st.projekt = { spuren: [spurMit('s1', 1, { art: 'wirt', name: 'surge' })] };
  await x.cb.anstoss();
  assert.equal(x.tastenArm.spur(), null);
  assert.equal((await x.get('/controller/fokus')).j.tasten.grund, 'keine_senke');
});

test('keys live: the sender is a no-op without an address; with an address it sends the stream of the channel (0 for none) and maps a refusal to kern_alt', async () => {
  assert.equal(LIVE_TASTEN_ADRESSE, '/k/live/tasten', 'switched on: the core command of N2');
  const gesendet = [];
  const ctx = (status) => ({ sende: (a, f) => { gesendet.push([a, f]); return 7; }, warteQuittung: async () => (status === null ? null : { status, grund: '' }) });
  assert.deepEqual(await sendeLiveTasten(ctx(3), 'erz/5', null), { ok: false, grund: 'kern_alt' });
  assert.deepEqual(gesendet, []);
  assert.deepEqual(await sendeLiveTasten(ctx(3), 'erz/5', '/k/test'), { ok: true });
  assert.deepEqual(await sendeLiveTasten(ctx(3), 'pad/2', '/k/test'), { ok: true });
  assert.deepEqual(await sendeLiveTasten(ctx(3), null, '/k/test'), { ok: true });
  assert.deepEqual(gesendet, [['/k/test', { strom: 5 }], ['/k/test', { strom: 10 }], ['/k/test', { strom: 0 }]]);
  assert.deepEqual(await sendeLiveTasten(ctx(7), 'erz/5', '/k/test'), { ok: false, grund: 'kern_alt' });
  assert.deepEqual(await sendeLiveTasten(ctx(null), 'erz/5', '/k/test'), { ok: false, grund: 'kern_alt' });
  assert.deepEqual(await sendeLiveTasten(ctx(3), 'erz/4', '/k/test'), { ok: false, grund: 'kern_alt' }, 'a channel without a stream is never sent');
  assert.deepEqual([stromVonKanal('erz/1'), stromVonKanal('erz/2'), stromVonKanal('erz/8'), stromVonKanal('pad/1')], [null, 2, null, 9]);
});

test('pages: a focus with a page takes the entries of that page of the preset; the page stays for the same synth and goes with another one', async (t) => {
  const x = await aufbau(t, { stand: { projekt: { spuren: [spurMit('s1', 1, BKG), spurMit('s2', 2, BKG)] } } });
  x.werkPreset('lc3', BKG.graph, { schema: 1, name: BKG.graph, modell: 'lc3', art: 'instrument', graph: BKG.graph,
    eintraege: [{ regler: 'Enc 1', knopf: 1 }], seiten: { mod: [{ regler: 'Enc 1', knopf: 40 }, { regler: 'Enc 2', knopf: 41 }] } });
  await x.post('/geraete/controller', { platz: 2, folgen: true });
  const r = await x.fokus({ spur_id: 's1' });
  assert.equal(r.j.fokus.seite, undefined);
  assert.deepEqual(x.ziele(2), ['spur/1/bk/1']);
  assert.equal((await x.fokus({ spur_id: 's1', seite: 'mod' })).j.fokus.seite, 'mod');
  assert.deepEqual(x.ziele(2), ['spur/1/bk/40', 'spur/1/bk/41']);
  await x.fokus({ spur_id: 's1' });
  assert.deepEqual(x.ziele(2), ['spur/1/bk/40', 'spur/1/bk/41'], 'the same synth without a page keeps the page');
  await x.fokus({ spur_id: 's1', seite: 'fx' });
  assert.deepEqual(x.ziele(2), ['spur/1/bk/1'], 'a page the preset does not have takes the entries without a page');
  await x.fokus({ spur_id: 's1', seite: 'mod' });
  assert.equal((await x.fokus({ spur_id: 's2' })).j.fokus.seite, undefined, 'another synth starts without a page');
  assert.deepEqual(x.ziele(2), ['spur/2/bk/1']);
  assert.equal((await x.fokus({ spur_id: 's2', seite: 'NO' })).code, 400);
});

test('programs: a place takes program 1, POST /controller/programm steps it and moves the page; a page from the window takes the first program of that page; the ends hold', async (t) => {
  const x = await aufbau(t, { stand: { projekt: { spuren: [spurMit('s1', 1, BKG), spurMit('s2', 2, BKG)] } } });
  const e = (k) => [{ regler: 'Enc 1', knopf: k }];
  x.werkPreset('lc3', BKG.graph, { schema: 1, name: BKG.graph, modell: 'lc3', art: 'instrument', graph: BKG.graph, eintraege: e(1),
    programme: [{ name: 'Top', seite: 'main', eintraege: e(1) }, { name: 'Bottom', seite: 'main', eintraege: e(2) }, { name: 'Mod', seite: 'mod', eintraege: e(3) }] });
  await x.post('/geraete/controller', { platz: 2, folgen: true });
  const r = await x.fokus({ spur_id: 's1', seite: 'main' });
  assert.deepEqual(r.j.plaetze.find((p) => p.platz === 2).programm, { nr: 1, von: 3, name: 'Top' });
  assert.deepEqual(x.ziele(2), ['spur/1/bk/1']);
  const zwei = await x.post('/controller/programm', { platz: 2, schritt: 1 });
  assert.deepEqual([zwei.j.plaetze.find((p) => p.platz === 2).programm.nr, zwei.j.fokus.seite], [2, 'main']);
  assert.deepEqual(x.ziele(2), ['spur/1/bk/2']);
  await x.fokus({ spur_id: 's1', seite: 'main' });
  assert.deepEqual(x.ziele(2), ['spur/1/bk/2'], 'the same page again keeps program 2');
  const drei = await x.post('/controller/programm', { platz: 2, schritt: 1 });
  assert.deepEqual([drei.j.plaetze.find((p) => p.platz === 2).programm.nr, drei.j.fokus.seite], [3, 'mod'], 'the page in front follows the program');
  assert.equal((await x.post('/controller/programm', { platz: 2, schritt: 1 })).j.plaetze.find((p) => p.platz === 2).programm.nr, 3, 'the end holds');
  await x.fokus({ spur_id: 's1', seite: 'main' });
  assert.deepEqual(x.ziele(2), ['spur/1/bk/1'], 'a page picked in the window takes its first program');
  assert.equal((await x.post('/controller/programm', { platz: 2, nr: 3 })).j.plaetze.find((p) => p.platz === 2).programm.name, 'Mod');
  assert.equal((await x.post('/controller/programm', { platz: 2, nr: 9 })).code, 400);
  await x.fokus({ spur_id: 's2' });
  assert.deepEqual(x.ziele(2), ['spur/2/bk/1'], 'another synth starts at program 1');
});
