// Task 4 of the browser-6 plan: POST /presets/vorhoeren on the real Router, with a fake PresetVorhoerer and a fake headphone previewer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { presetsBereich } from '../presets/area.ts';
import { PresetVorhoerFehler } from '../presets/prelisten.ts';
import { VorhoerFehler } from '../prelisten.ts';

async function stapel(t, o = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-vh-'));
  const aufrufe = [], gespielt = [];
  let nr = 0;
  const vorhoerer = o.vorhoerer ?? { pruefe: () => {}, vorhoer: async (id) => { aufrufe.push(id); return { schluessel: 'k'.repeat(64), datei: '/cache/k.wav', aus_cache: nr++ > 0, dauer_s: 3.75, spitze_db: -6, rms_db: -9, render_ms: 1 }; } };
  const spiele = o.spiele ?? (async (e) => { gespielt.push(e); });
  const router = new Router();
  router.melde(presetsBereich({ log: () => {}, quelle: () => 'andreas' }, { werk: path.join(d, 'werk'), nutzer: path.join(d, 'nutzer'), ...(o.ohne ? {} : { vorhoerer, spiele, ...(o.neuerKlick ? { neuerKlick: o.neuerKlick } : {}) }) }));
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
  return { url: `http://127.0.0.1:${port}`, aufrufe, gespielt, router };
}
async function post(basis, p, daten, kopf = { 'content-type': 'application/json' }) {
  const r = await fetch(basis + p, { method: 'POST', headers: kopf, body: typeof daten === 'string' ? daten : JSON.stringify(daten) });
  return { code: r.status, j: await r.json() };
}

test('a POST plays the cached preview on the headphones and answers exactly { ok, aus_cache }', async (t) => {
  const s = await stapel(t);
  const a = await post(s.url, '/presets/vorhoeren', { id: 'werk:rb338/x' });
  assert.equal(a.code, 200); assert.deepEqual(a.j, { ok: true, aus_cache: false });
  assert.deepEqual(s.gespielt, [{ pfad: '/cache/k.wav', typ: 'oneshot', sha: 'k'.repeat(64), bpm: null }]);
  const b = await post(s.url, '/presets/vorhoeren', { id: 'werk:rb338/x' });
  assert.deepEqual(b.j, { ok: true, aus_cache: true });
  assert.equal(s.gespielt.length, 2);
});

test('bad requests: missing id, no register id, wrong content type, foreign origin', async (t) => {
  const s = await stapel(t);
  const ohne = await post(s.url, '/presets/vorhoeren', {});
  assert.equal(ohne.code, 400); assert.equal(ohne.j.grund, 'argument_fehlt'); assert.equal(ohne.j.ok, false); assert.ok(ohne.j.text);
  const schief = await post(s.url, '/presets/vorhoeren', { id: '../x' });
  assert.equal(schief.code, 400); assert.equal(schief.j.grund, 'id_ungueltig');
  const roh = await post(s.url, '/presets/vorhoeren', 'id=1', { 'content-type': 'text/plain' });
  assert.equal(roh.code, 415); assert.equal(roh.j.fehler, 'nur_json');
  const fremd = await post(s.url, '/presets/vorhoeren', { id: 'werk:rb338/x' }, { 'content-type': 'application/json', origin: 'http://evil.example' });
  assert.equal(fremd.code, 403); assert.equal(fremd.j.fehler, 'fremde_herkunft');
  assert.equal(s.aufrufe.length, 0); assert.equal(s.gespielt.length, 0);
});

test('every PresetVorhoerFehler comes through with its status, reason and a text', async (t) => {
  const faelle = [[404, 'preset_unbekannt'], [409, 'preset_unlesbar'], [422, 'vorhoeren_nicht_moeglich'], [422, 'graph_fehlt'], [422, 'vorhoeren_stumm'],
    [503, 'starter_fehlt'], [503, 'render_fehlt'], [503, 'render_fehlgeschlagen']];
  for (const [code, grund] of faelle) {
    const s = await stapel(t, { vorhoerer: { pruefe: () => {}, vorhoer: async () => { throw new PresetVorhoerFehler(code, grund, `text of ${grund}`); } } });
    const a = await post(s.url, '/presets/vorhoeren', { id: 'werk:rb338/x' });
    assert.equal(a.code, code, grund); assert.equal(a.j.ok, false); assert.equal(a.j.grund, grund); assert.equal(a.j.text, `text of ${grund}`);
    assert.equal(s.gespielt.length, 0);
  }
});

test('a previewer refusal is passed on and the preview stays cached', async (t) => {
  const s = await stapel(t, { spiele: async () => { throw new VorhoerFehler(409, 'kein_kopfhoerer'); } });
  const a = await post(s.url, '/presets/vorhoeren', { id: 'werk:rb338/x' });
  assert.equal(a.code, 409); assert.equal(a.j.ok, false); assert.equal(a.j.grund, 'kein_kopfhoerer'); assert.ok(a.j.text.length > 10);
  const b = await post(s.url, '/presets/vorhoeren', { id: 'werk:rb338/x' });
  assert.equal(b.code, 409);
  assert.equal(s.aufrufe.length, 2);   // the service answers from its cache; the route asks it again
});

test('an unexpected error is a 500 with a reason, never a hang', async (t) => {
  const s = await stapel(t, { vorhoerer: { pruefe: () => {}, vorhoer: async () => { throw new Error('boom'); } } });
  const a = await post(s.url, '/presets/vorhoeren', { id: 'werk:rb338/x' });
  assert.equal(a.code, 500); assert.equal(a.j.ok, false); assert.ok(a.j.grund && a.j.text);
});

test('the route is registered before the catch-all; without a previewer the bereich stays a single route', async (t) => {
  const s = await stapel(t);
  const liste = s.router.liste();
  assert.equal(liste[0].pfad, '/presets/vorhoeren'); assert.equal(liste[0].methode, 'POST'); assert.equal(liste[0].schutz, 'fremdePost');
  assert.equal(liste.at(-1).pfad, '(muster)');
  const ohne = await stapel(t, { ohne: true });
  assert.deepEqual(ohne.router.liste().map((r) => `${r.methode} ${r.pfad}`), ['GET /presets/export', 'POST /presets/import', '* (muster)']);   // no preview route
  const r = await post(ohne.url, '/presets/vorhoeren', { id: 'werk:rb338/x' });
  assert.notEqual(r.code, 200);
});

test('the real page server wires the route: an unknown preset answers 404 preset_unbekannt', async (t) => {
  const { echterServer } = await import('./support/echter_server.mjs');
  const s = await echterServer(t, 'pvr');
  const a = await s.post('/presets/vorhoeren', { id: 'nutzer:rb338/no-such-preset-xyz' });
  assert.equal(a.code, 404); assert.equal(a.j.ok, false); assert.equal(a.j.grund, 'preset_unbekannt');
  const b = await s.post('/presets/vorhoeren', {});
  assert.equal(b.code, 400); assert.equal(b.j.grund, 'argument_fehlt');
});

test('the newest click wins: a render that finishes after a newer click is not played, whatever its start order (review probe 3 timing)', async (t) => {
  const WARTE = (ms) => new Promise((r) => setTimeout(r, ms));
  const vorhoerer = { pruefe: () => {}, vorhoer: async (id) => {
    const a = id.endsWith('acid-one');   // A renders 400 ms, B is a cache hit after 50 ms
    await WARTE(a ? 400 : 50);
    return { schluessel: (a ? 'a' : 'b').repeat(64), datei: `/cache/${a ? 'a' : 'b'}.wav`, aus_cache: !a, dauer_s: 3.75, spitze_db: -6, rms_db: -18, render_ms: 1 };
  } };
  const s = await stapel(t, { vorhoerer });
  const pa = post(s.url, '/presets/vorhoeren', { id: 'nutzer:rb338/acid-one' });
  await WARTE(20);
  const pb = post(s.url, '/presets/vorhoeren', { id: 'nutzer:rb338/acid-two' });
  const [a, b] = await Promise.all([pa, pb]);
  assert.equal(b.code, 200); assert.equal(b.j.ok, true);
  assert.equal(a.code, 409); assert.equal(a.j.ok, false); assert.equal(a.j.grund, 'ueberholt'); assert.ok(a.j.text.length > 10);
  assert.deepEqual(s.gespielt.map((e) => e.sha), ['b'.repeat(64)]);
  // a click after both are done plays again (the counter is not stuck)
  const c = await post(s.url, '/presets/vorhoeren', { id: 'nutzer:rb338/acid-two' });
  assert.equal(c.code, 200); assert.equal(s.gespielt.length, 2);
});

test('two callers, one click sequence: a preset render that finishes after a newer sample click is cached but not played, and an unplayable newer click cancels nothing', async (t) => {
  const WARTE = (ms) => new Promise((r) => setTimeout(r, ms));
  // the shared sequence as the page server's previewer has it: any caller takes a number, spiele refuses a stale one
  let zaehler = 0;
  const gespielt = [];
  const spiele = async (e, klick) => { if (klick !== undefined && klick !== zaehler) throw new VorhoerFehler(409, 'ueberholt'); if (klick === undefined) ++zaehler; gespielt.push(e.pfad); };
  const vorhoerer = { pruefe: (id) => { if (id.includes('hall')) throw new PresetVorhoerFehler(422, 'vorhoeren_nicht_moeglich', 'this preset cannot be previewed'); },
    vorhoer: async () => { await WARTE(200); return { schluessel: 'a'.repeat(64), datei: '/cache/a.wav', aus_cache: false, dauer_s: 3, spitze_db: -6, rms_db: -18, render_ms: 1 }; } };
  const s = await stapel(t, { vorhoerer, spiele, neuerKlick: () => ++zaehler });
  // wait until the request has taken its click number (a fixed 30 ms is not enough when the machine is busy)
  const nummer = async (vor) => { for (let i = 0; i < 500 && zaehler === vor; i++) await WARTE(10); assert.notEqual(zaehler, vor, 'the preset click never took a number'); };
  // (1) preset click, then a sample click on another route while the render runs
  const z1 = zaehler;
  const pa = post(s.url, '/presets/vorhoeren', { id: 'werk:rb338/x' });
  await nummer(z1);
  await spiele({ pfad: '/sample-newer.wav' });
  const a = await pa;
  assert.equal(a.code, 409); assert.equal(a.j.grund, 'ueberholt');
  assert.deepEqual(gespielt, ['/sample-newer.wav']);
  // (2) preset click, then a newer click that cannot play (hall): the older one still plays
  gespielt.length = 0;
  const z2 = zaehler;
  const pb = post(s.url, '/presets/vorhoeren', { id: 'werk:rb338/x' });
  await nummer(z2);
  const hall = await post(s.url, '/presets/vorhoeren', { id: 'werk:hall/saal' });
  assert.equal(hall.code, 422);
  const b = await pb;
  assert.equal(b.code, 200); assert.deepEqual(gespielt, ['/cache/a.wav']);
});
