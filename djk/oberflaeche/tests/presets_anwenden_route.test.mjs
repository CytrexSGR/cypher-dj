// Package 1.16 rest U3a: routes POST /presets/anwenden, POST /presets/von_ziel, GET /presets/katalog (T3a.4) on the real Router with a
// fake project, and one apply = one history entry through the real server (T3a.5, AK-B16-6, core mock).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { presetsBereich } from '../presets/bereich.ts';
import { KERN_KOMP } from '../presets/anwenden.ts';
import { KERN_KOMP as KERN_KOMP_SEITE } from '../oeffentlich/presets.js';
import { neuesProjekt } from '../projekt/modell.ts';
import { fuehreListeAus } from '../projekt/befehle.ts';
import { rbNorm } from '../projekt/rb_abbildung.ts';
import { stapel as echterStapel } from './hilfen/mediathek.mjs';
import { ruf, CYPHER } from './hilfen/proj_stapel.mjs';

const KOMP_B = { art: 'compressor', unterart: 'peak', charakter: ['clean'], genre: [], einsatz: ['mixdown'], energie: 2, text: 'From a stage.' };
const BASS_B = { art: 'bass', unterart: 'acid', charakter: ['dirty'], genre: [], einsatz: ['drop'], energie: 4, text: 'From a track.' };
const PAD_B = { art: 'pad', unterart: 'analog', charakter: ['warm'], genre: [], einsatz: ['intro'], energie: 1, text: 'From a bk track.' };

function fakeProjekt() {
  let p = neuesProjekt('T');
  const lauf = (b) => { p = fuehreListeAus(p, b, { quelle: 'andreas' }).projekt; };
  lauf([{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: rbNorm('cutoff', 200), wellenform: 1, decay: 0.5 } } }]);
  lauf([{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'pad', parameter: { k1: 0.2 } } }]);
  lauf([{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'insert_setzen', strang_id: 's3', pos: 0, art: 'komp', werte: { schwelle: -40, ratio: 2 } }]);
  return p;
}

async function stapel(t, quelle = 'andreas', extra = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-an-'));
  const nutzer = path.join(d, 'nutzer');
  const router = new Router();
  const z = { projekt: fakeProjekt() };
  router.melde(presetsBereich({ log: () => {}, quelle: () => quelle }, { nutzer, projekt: () => z.projekt,
    graphen: () => [{ name: 'lead', art: 'instrument' }, { name: 'fx', art: 'effekt' }, { name: 'pad', art: 'instrument' }], ...extra }));
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
  return { url: `http://127.0.0.1:${port}`, nutzer, z };
}

test('GET /presets/katalog: instruments (RB-338, Surge, one entry per instrument graph), effects with aktiv and grund', async (t) => {
  const s = await stapel(t);
  const k = (await ruf(s.url, 'GET', '/presets/katalog')).j;
  assert.deepEqual(k.instrumente, [
    { geraet: 'rb338', titel: 'RB-338', ziel: 'spur_neu' }, { geraet: 'surge', titel: 'Surge', ziel: 'spur_neu' },
    { geraet: 'bk', titel: 'lead', ziel: 'spur_neu', graph: 'lead' }, { geraet: 'bk', titel: 'pad', ziel: 'spur_neu', graph: 'pad' }]);
  assert.deepEqual(k.effekte.map((e) => [e.geraet, e.aktiv, typeof e.grund]), [['komp', true, 'undefined'], ['eq', true, 'undefined'], ['saett', true, 'undefined'], ['hall', false, 'string']]);
  assert.match(k.effekte.find((e) => e.geraet === 'hall').grund, /return hall lives on returns/);
});

test('POST /presets/anwenden: a plan, never a change; refusals with reason; malformed and unknown ids', async (t) => {
  const s = await stapel(t);
  const vorher = JSON.stringify(s.z.projekt);
  const r = await ruf(s.url, 'POST', '/presets/anwenden', { id: 'werk:komp/drum-bus', ziel: { art: 'insert', insert_id: 'i1' } });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.weg, r.j.befehle[0].befehl, r.j.uebersprungen], ['proj', 'insert_werte_setzen', ['extsc']]);
  assert.equal(JSON.stringify(s.z.projekt), vorher, 'the route changes nothing');
  const faelle = [
    [{ id: 'werk:hall/big-drop', ziel: { art: 'spur', spur_id: 's1' } }, 409, 'kein_ziel'],
    [{ id: 'werk:eq/air-shelf', ziel: { art: 'insert', insert_id: 'i1' } }, 409, 'geraet_passt_nicht'],   // i1 is a compressor stage; eq is an active kind since 1.10 slice 4b
    [{ id: 'werk:komp/drum-bus', ziel: { art: 'insert', insert_id: 'i7' } }, 404, 'ziel_unbekannt'],
    [{ id: 'werk:komp', ziel: { art: 'insert', insert_id: 'i1' } }, 400, 'preset_id_ungueltig'],
    [{ id: 'werk:komp/gibt-es-nicht', ziel: { art: 'insert', insert_id: 'i1' } }, 404, 'unbekannt'],
    [{ id: 'werk:gate/x', ziel: { art: 'kanal', kanal: 'bus/1' } }, 404, 'unbekannt'],
  ];
  for (const [k, code, grund] of faelle) {
    const a = await ruf(s.url, 'POST', '/presets/anwenden', k);
    assert.deepEqual([a.code, a.j.fehler, typeof a.j.text], [code, grund, 'string'], JSON.stringify(k));
  }
  s.z.projekt = null;
  assert.equal((await ruf(s.url, 'POST', '/presets/anwenden', { id: 'werk:rb338/dark-dub', ziel: { art: 'spur', spur_id: 's1' } })).j.fehler, 'kein_projekt');
  const kanal = await ruf(s.url, 'POST', '/presets/anwenden', { id: 'werk:komp/drum-bus', ziel: { art: 'kanal', kanal: 'deck/2' } });
  assert.deepEqual([kanal.code, kanal.j.weg, kanal.j.anfragen.length], [200, 'regler', 6], 'a channel target needs no project');
  assert.equal((await ruf(s.url, 'POST', '/presets/anwenden', {}, { origin: 'http://evil.example' })).code, 403);
});

test('the server komp channel mapping equals the page copy (D9)', () => { assert.deepEqual(KERN_KOMP, KERN_KOMP_SEITE); });

test('POST /presets/von_ziel: values read from the project (rb338 plain, bk knobs with graph, komp stage), saved with the source', async (t) => {
  const s = await stapel(t, 'cypher');
  const rb = await ruf(s.url, 'POST', '/presets/von_ziel', { ziel: { art: 'spur', spur_id: 's1' }, name: 'From Track', beschreibung: BASS_B });
  assert.equal(rb.code, 201, JSON.stringify(rb.j));
  const f = JSON.parse(fs.readFileSync(path.join(s.nutzer, 'rb338', 'from-track.preset.json'), 'utf8'));
  assert.ok(Math.abs(f.werte.cutoff - 200) < 1e-6 * 200); assert.equal(f.werte.wellenform, true); assert.ok(Math.abs(f.werte.decay - 0.65) < 1e-6);
  assert.equal(f.autor, 'cypher');
  const bk = await ruf(s.url, 'POST', '/presets/von_ziel', { ziel: { art: 'spur', spur_id: 's2' }, name: 'From Pad', beschreibung: PAD_B });
  assert.equal(bk.code, 201, JSON.stringify(bk.j));
  const g = JSON.parse(fs.readFileSync(path.join(s.nutzer, 'baukasten', 'from-pad.preset.json'), 'utf8'));
  assert.equal(g.graph, 'pad'); assert.deepEqual(g.werte, { knob1: 0.2, knob2: 0.5, knob3: 0.5, knob4: 0.5, knob5: 0.5, knob6: 0.5, knob7: 0.5, knob8: 0.5 });
  const k = await ruf(s.url, 'POST', '/presets/von_ziel', { ziel: { art: 'insert', insert_id: 'i1' }, name: 'From Stage', beschreibung: KOMP_B });
  assert.equal(k.code, 201, JSON.stringify(k.j));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.nutzer, 'komp', 'from-stage.preset.json'), 'utf8')).werte,
    { thresh: -40, ratio: 2, knee: 6, attack: 10, release: 120, makeup: 0, mix: 1, schp: 0 });
  // refusals: a channel target is saved through POST /presets with werte; unknown track; no project
  assert.equal((await ruf(s.url, 'POST', '/presets/von_ziel', { ziel: { art: 'kanal', kanal: 'deck/1' }, name: 'X', beschreibung: KOMP_B })).j.fehler, 'ziel_unbekannt');
  assert.equal((await ruf(s.url, 'POST', '/presets/von_ziel', { ziel: { art: 'spur', spur_id: 's3' }, name: 'X', beschreibung: KOMP_B })).j.fehler, 'geraet_passt_nicht');
  s.z.projekt = null;
  assert.equal((await ruf(s.url, 'POST', '/presets/von_ziel', { ziel: { art: 'spur', spur_id: 's1' }, name: 'X', beschreibung: BASS_B })).j.fehler, 'kein_projekt');
});

test('one apply on a project target = one history entry; undo restores the values (AK-B16-6, real server, core mock)', async (t) => {
  const nutzer = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-undo-'));
  t.after(() => fs.rmSync(nutzer, { recursive: true, force: true }));
  const { url } = await echterStapel(t, { presets: { nutzer } });
  await ruf(url, 'POST', '/proj/neu', { name: 'Apply' });
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Setup', befehle: [{ befehl: 'spur_neu', art: 'audio' },
    { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { schwelle: -40, ratio: 2, knie: 0, attack: 50, release: 500, makeup: 12, mix: 0.5, schp: 200 } }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const vorher = a.j.projekt.spuren[0].inserts[0];
  const plan = await ruf(url, 'POST', '/presets/anwenden', { id: 'werk:komp/drum-bus', ziel: { art: 'insert', insert_id: vorher.id } }, CYPHER);
  assert.equal(plan.code, 200, JSON.stringify(plan.j));
  const n0 = (await ruf(url, 'GET', '/proj/verlauf')).j.length;
  const w = await ruf(url, 'POST', '/proj/aendern', { rev: 1, label: plan.j.label, befehle: plan.j.befehle }, CYPHER);
  assert.equal(w.code, 200, JSON.stringify(w.j));
  assert.equal(w.j.rev, 2, 'rev raised by exactly 1');
  assert.equal((await ruf(url, 'GET', '/proj/verlauf')).j.length, n0 + 1, 'exactly one new history entry');
  assert.deepEqual(w.j.projekt.spuren[0].inserts[0].werte, { schwelle: -18, ratio: 4, knie: 6, attack: 30, release: 100, makeup: 3, mix: 1, schp: 90 });
  assert.equal(w.j.projekt.spuren[0].inserts[0].preset, 'werk:komp/drum-bus');
  const u = await ruf(url, 'POST', '/proj/undo', { rev: 2 });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.deepEqual(u.j.projekt.spuren[0].inserts[0], vorher, 'undo restores values and removes the preset field');
});
