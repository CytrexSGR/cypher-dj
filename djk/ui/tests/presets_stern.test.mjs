// Task 7 of the browser-6 plan: starring a preset is the existing Favourites collection, no new route. This test pins the contract that the page's
// star button relies on (plan 2): the fixed collection is created on first use, an item is added once, removed again, only register ids are accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { kollektionenBereich } from '../collections/area.ts';
import { FAVORITEN_SLUG } from '../collections/feste.ts';
import { presetsBereich } from '../presets/area.ts';
import { PresetSpeicher } from '../presets/store.ts';

const BESCHR = { art: 'bass', unterart: 'acid', charakter: ['warm'], genre: ['techno'], einsatz: ['drop'], energie: 3, text: 'A star test sound.' };

async function stapel(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-stern-'));
  const stand = { quelle: 'andreas' };
  const speicher = new PresetSpeicher({ nutzer: path.join(d, 'nutzer') });
  const router = new Router();
  let port = 0;
  const ctx = { log: () => {}, quelle: () => stand.quelle };
  router.melde(presetsBereich(ctx, { speicher, port: () => port }));
  router.melde(kollektionenBereich(ctx, { ordner: path.join(d, 'kollektionen') }));
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
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, daten, raw) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(daten) });
    return { code: r.status, j: await r.json() };
  };
  const fav = async () => (await (await fetch(`${base}/kollektionen/${FAVORITEN_SLUG}`)).json());
  return { speicher, stand, post, fav, base };
}
const POSTEN = `/kollektionen/${FAVORITEN_SLUG}/posten`;
const KOMP = { art: 'preset', id: 'werk:komp/drum-bus' };

test('adding a preset creates the Favourites collection on first use and lists the item', async (t) => {
  const s = await stapel(t);
  assert.equal((await fetch(`${s.base}/kollektionen/${FAVORITEN_SLUG}`)).status, 404);
  const a = await s.post(POSTEN, { hinzu: [KOMP] });
  assert.equal(a.code, 200); assert.equal(a.j.anzahl, 1);
  assert.deepEqual((await s.fav()).posten, [KOMP]);
});

test('adding the same item twice keeps one; weg removes it', async (t) => {
  const s = await stapel(t);
  await s.post(POSTEN, { hinzu: [KOMP] });
  const b = await s.post(POSTEN, { hinzu: [KOMP, KOMP] });
  assert.equal(b.j.anzahl, 1);
  const c = await s.post(POSTEN, { weg: [KOMP] });
  assert.equal(c.code, 200); assert.equal(c.j.anzahl, 0);
  assert.deepEqual((await s.fav()).posten, []);
});

test('an id that is no register id is refused 400 posten_ungueltig', async (t) => {
  const s = await stapel(t);
  for (const id of ['komp/drum-bus', 'werk:komp', '../x', 'other:komp/drum-bus', '']) {
    const a = await s.post(POSTEN, { hinzu: [{ art: 'preset', id }] });
    assert.equal(a.code, 400, id); assert.equal(a.j.fehler, 'posten_ungueltig', id);
  }
  assert.equal((await fetch(`${s.base}/kollektionen/${FAVORITEN_SLUG}`)).status, 404, 'nothing was created by a refused item');
});

test('a user preset imported through POST /presets/import can be starred', async (t) => {
  const s = await stapel(t);
  s.speicher.speichere({ name: 'Star Me', geraet: 'rb338', werte: { cutoff: 900 }, beschreibung: BESCHR });
  const bytes = fs.readFileSync(s.speicher.pfad('nutzer', 'rb338', 'star-me'), 'utf8');
  s.speicher.loesche('rb338', 'star-me');
  const imp = await fetch(`${s.base}/presets/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: bytes });
  const ij = await imp.json();
  assert.equal(imp.status, 200); assert.equal(ij.id, 'nutzer:rb338/star-me');
  const a = await s.post(POSTEN, { hinzu: [{ art: 'preset', id: ij.id }] });
  assert.equal(a.code, 200);
  assert.deepEqual((await s.fav()).posten, [{ art: 'preset', id: 'nutzer:rb338/star-me' }]);
});

test('source cypher may add; removing from the list of Andreas is refused (the existing rule, asserted as it is)', async (t) => {
  const s = await stapel(t);
  await s.post(POSTEN, { hinzu: [KOMP] });   // created by Andreas
  s.stand.quelle = 'cypher';
  const add = await s.post(POSTEN, { hinzu: [{ art: 'preset', id: 'werk:eq/dark-room' }] });
  assert.equal(add.code, 200); assert.equal(add.j.anzahl, 2);
  const weg = await s.post(POSTEN, { weg: [KOMP] });
  assert.equal(weg.code, 403); assert.equal(weg.j.fehler, 'nur_andreas_kollektion');
  assert.equal((await s.fav()).posten.length, 2);
});
