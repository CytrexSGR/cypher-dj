// Agent keys on the page server: Host guard, bearer token check, /hand/ich and the key routes (strict mode, as on the production instance).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';

belegeTestInstanz();
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
async function start(t, hand) {
  const alt = process.env.CYPHERDJ_INSTANZ, altBk = process.env.CYPHERDJ_BK_ORDNER;
  process.env.CYPHERDJ_BK_ORDNER = tmp('kt-bk-');
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  const log = [];
  const huellen = path.join(tmp('kt-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('kt-bestand-'), arbeitsbestand: tmp('kt-ab-'),
    mutationen: [], loops: tmp('kt-loops-'), kits: tmp('kt-kits-'), welleCache: tmp('kt-welle-'), musterOrdner: tmp('kt-muster-'), hotcueOrdner: tmp('kt-hc-'),
    rasterOrdner: tmp('kt-raster-'), huellen, wirtOrdner: tmp('kt-wirt-'), sammlungen: tmp('kt-sets-'), musterBibliothek: tmp('kt-mb-'), musterSets: tmp('kt-ms-'),
    mediathek: path.join(tmp('kt-med-'), 'gibt-es-nicht.sqlite'), katalog: path.join(tmp('kt-kat-'), 'gibt-es-nicht.sqlite'),
    digitalout: path.join(tmp('kt-do-'), 'nix'), kernPruefmodus: true, hand,
    geraete: { konfigPfad: path.join(tmp('kt-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('kt-ger-'), 'eingaenge-kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    lernen: { ordner: path.join(tmp('kt-lern-'), 'controller'), geraeteKonfig: path.join(tmp('kt-lern-'), 'geraete.json') }, log: (z) => log.push(z),
    });
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt;
    if (altBk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = altBk;
  });
  return { o, log };
}
const roh = (port, methode, pfad, { kopf = {}, body, host = `127.0.0.1:${47300 + K}`, zeit = 4000 } = {}) => new Promise((ok) => {
  const q = http.request({ host: '127.0.0.1', port, method: methode, path: pfad, headers: { host, ...kopf }, agent: false }, (a) => {
    const teile = []; a.on('data', (d) => teile.push(d));
    a.on('end', () => { const text = Buffer.concat(teile).toString('utf8'); let j = null; try { j = JSON.parse(text); } catch { /* not json */ } ok({ code: a.statusCode, kopf: a.headers, text, j }); });
    a.on('error', () => ok({ code: -1 }));
  });
  q.on('error', (e) => ok({ code: -1, fehler: e.code }));
  if (body !== undefined) q.write(body);
  q.end();
  setTimeout(() => { q.destroy(); }, zeit).unref();
});
const lokal = (m, p, o = {}) => roh(47300 + K, m, p, o);
const JSONK = { 'content-type': 'application/json' };
const CYPHER = { ...JSONK, 'x-djk-quelle': 'cypher' };
const ANDREAS = { ...JSONK, 'x-djk-quelle': 'andreas' };
const bearer = (tok) => ({ ...JSONK, authorization: `Bearer ${tok}` });

test('strict: token check, Host guard, /hand/ich and the key routes', async (t) => {
  const ordner = tmp('kt-hand-');
  await start(t, { ordner, streng: true });
  const lokalTok = fs.readFileSync(path.join(ordner, 'hand.token'), 'utf8').trim();   // never printed

  assert.equal((await lokal('GET', '/lage')).code, 200, 'the page path (no header at all) is unchanged');
  assert.equal((await lokal('GET', '/lage', { kopf: ANDREAS })).code, 200, 'a controller bridge is unchanged');
  const fehlt = await lokal('GET', '/hand/ich', { kopf: { 'x-djk-quelle': 'cypher' } });
  assert.deepEqual([fehlt.code, fehlt.j.fehler], [401, 'schluessel_fehlt']);
  const ich = await lokal('GET', '/hand/ich', { kopf: { authorization: `Bearer ${lokalTok}` } });
  assert.deepEqual([ich.code, ich.j.id, ich.j.stufe, ich.j.gestoppt], [200, 'lokal', 'zerstoerend', false]);
  const ohneKopf = await lokal('GET', '/hand/ich');
  assert.deepEqual([ohneKopf.code, ohneKopf.j.id, ohneKopf.j.stufe], [200, null, null]);
  const falsch = await lokal('GET', '/hand/ich', { kopf: { authorization: `Bearer ${'x'.repeat(43)}`, 'x-djk-quelle': 'cypher' } });
  assert.deepEqual([falsch.code, falsch.j.fehler], [401, 'schluessel_ungueltig']);
  assert.equal((await lokal('GET', '/hand/ich', { kopf: { authorization: 'Bearer kurz' } })).j.fehler, 'schluessel_ungueltig');
  assert.equal((await lokal('GET', '/lage', { host: 'evil.example:80' })).code, 421);
  assert.equal((await lokal('GET', '/hand/ich', { host: 'evil.example:80', kopf: { authorization: `Bearer ${lokalTok}` } })).code, 421);
  assert.equal((await lokal('GET', '/lage', { host: `localhost:${47300 + K}` })).code, 200);

  assert.equal((await lokal('POST', '/hand/schluessel', { kopf: CYPHER, body: '{"name":"x","stufe":"lesen"}' })).code, 401);
  assert.equal((await lokal('POST', '/hand/schluessel', { kopf: bearer(lokalTok), body: '{"name":"x","stufe":"lesen"}' })).code, 403,
    'an agent cannot make keys');
  assert.equal((await lokal('GET', '/hand/schluessel', { kopf: bearer(lokalTok) })).code, 403);
  const liste0 = await lokal('GET', '/hand/schluessel');
  assert.deepEqual([liste0.code, liste0.j.schluessel.map((s) => s.id), liste0.j.schluessel[0].zuletzt > 0], [200, ['lokal'], true]);
  assert.equal(JSON.stringify(liste0.j).includes('hash'), false);

  assert.equal((await lokal('POST', '/hand/schluessel', { kopf: ANDREAS, body: '{"name":"","stufe":"lesen"}' })).j.fehler, 'name_ungueltig');
  assert.equal((await lokal('POST', '/hand/schluessel', { kopf: ANDREAS, body: '{"name":"x","stufe":"root"}' })).code, 400);
  const neu = await lokal('POST', '/hand/schluessel', { kopf: ANDREAS, body: '{"name":"reader","stufe":"lesen"}' });
  assert.equal(neu.code, 200);
  assert.match(neu.j.token, /^[A-Za-z0-9_-]{43}$/);
  const ich2 = await lokal('GET', '/hand/ich', { kopf: bearer(neu.j.token) });
  assert.deepEqual([ich2.j.id, ich2.j.name, ich2.j.stufe], [neu.j.id, 'reader', 'lesen']);
  assert.equal((await lokal('POST', '/hand/schluessel', { kopf: ANDREAS, body: '{"name":"x","stufe":"lesen"}', host: 'evil.example:80' })).code, 421);

  const weg = await lokal('POST', '/hand/schluessel/loeschen', { kopf: ANDREAS, body: JSON.stringify({ id: neu.j.id }) });
  assert.deepEqual([weg.code, weg.j.ok], [200, true]);
  assert.equal((await lokal('GET', '/hand/ich', { kopf: bearer(neu.j.token) })).j.fehler, 'schluessel_ungueltig');
  assert.equal((await lokal('POST', '/hand/schluessel/loeschen', { kopf: ANDREAS, body: JSON.stringify({ id: neu.j.id }) })).code, 404);
  assert.equal((await lokal('POST', '/hand/schluessel/loeschen', { kopf: CYPHER, body: '{"id":"lokal"}' })).code, 401);
});

test('tolerant (test instance default): a bare cypher header still works as cypher with level zerstoerend', async (t) => {
  await start(t, { ordner: tmp('kt-hand-') });
  const ich = await lokal('GET', '/hand/ich', { kopf: { 'x-djk-quelle': 'cypher' } });
  assert.deepEqual([ich.code, ich.j.id, ich.j.stufe], [200, 'ohne_schluessel', 'zerstoerend']);
  assert.equal((await lokal('GET', '/hand/ich', { kopf: { authorization: `Bearer ${'y'.repeat(43)}` } })).j.fehler, 'schluessel_ungueltig');
});
