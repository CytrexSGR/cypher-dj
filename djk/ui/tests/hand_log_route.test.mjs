// Agent log route: GET /hand/log lists one line per tool call and per refusal; Andreas only; no repeated lines for one call.
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
async function start(t) {
  const alt = process.env.CYPHERDJ_INSTANZ, altBk = process.env.CYPHERDJ_BK_ORDNER;
  process.env.CYPHERDJ_BK_ORDNER = tmp('kt-bk-');
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  const log = [], logOrdner = tmp('kt-handlog-');
  const huellen = path.join(tmp('kt-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('kt-bestand-'),
    arbeitsbestand: tmp('kt-ab-'),
    mutationen: [], loops: tmp('kt-loops-'), kits: tmp('kt-kits-'), welleCache: tmp('kt-welle-'), musterOrdner: tmp('kt-muster-'), hotcueOrdner: tmp('kt-hc-'),
    rasterOrdner: tmp('kt-raster-'), huellen, wirtOrdner: tmp('kt-wirt-'), sammlungen: tmp('kt-sets-'), musterBibliothek: tmp('kt-mb-'),
      musterSets: tmp('kt-ms-'),
    mediathek: path.join(tmp('kt-med-'), 'gibt-es-nicht.sqlite'), katalog: path.join(tmp('kt-kat-'), 'gibt-es-nicht.sqlite'),
    digitalout: path.join(tmp('kt-do-'), 'nix'), kernPruefmodus: true, hand: { logOrdner },
    geraete: { konfigPfad: path.join(tmp('kt-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('kt-ger-'), 'eingaenge-kanten'), cacheMs: 0,
      erkenne: async () => ({ audio: [], midi: [] }) },
    lernen: { ordner: path.join(tmp('kt-lern-'), 'controller'), geraeteKonfig: path.join(tmp('kt-lern-'), 'geraete.json') }, log: (z) => log.push(z),
    });
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt;
    if (altBk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = altBk;
  });
  return { o, log, logOrdner };
}
const roh = (port, methode, pfad, { kopf = {}, body, host = `127.0.0.1:${47300 + K}`, zeit = 4000 } = {}) => new Promise((ok) => {
  const q = http.request({ host: '127.0.0.1', port, method: methode, path: pfad, headers: { host, ...kopf }, agent: false }, (a) => {
    const teile = []; a.on('data', (d) => teile.push(d));
    a.on('end',
      () => { const text = Buffer.concat(teile).toString('utf8'); let j = null;
      try { j = JSON.parse(text); } catch { /* not json */ }
      ok({ code: a.statusCode, kopf: a.headers, text, j }); });
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


const H = (werkzeug, aufruf, extra = {}) => ({ ...CYPHER, 'x-djk-werkzeug': werkzeug, 'x-djk-aufruf': aufruf, ...extra });

test('log: one line per tool call, none for polling, a refusal at once, Andreas only, no secrets on disk', async (t) => {
  const { logOrdner } = await start(t);
  await lokal('POST', '/regler', { kopf: H('regler', 'a1', { authorization: 'Bearer GEHEIM' }), body: '{}' });
  await lokal('POST', '/regler', { kopf: H('regler', 'a1'), body: '{}' });
  await lokal('GET', '/lage', { kopf: { 'x-djk-quelle': 'cypher' } });
  await lokal('POST', '/regler', { kopf: ANDREAS, body: '{}' });
  const l1 = await lokal('GET', '/hand/log?n=50', { kopf: ANDREAS });
  assert.equal(l1.code, 200);
  assert.equal(l1.j.zeilen.length, 1);
  const z = l1.j.zeilen[0];
  assert.deepEqual([z.werkzeug, z.pfad, z.methode, z.ok, typeof z.code, typeof z.t], ['regler', '/regler', 'POST', z.code < 400, 'number', 'number']);
  await lokal('POST', '/hand/bremse', { kopf: ANDREAS, body: '{"an":true}' });
  await lokal('POST', '/regler', { kopf: H('regler', 'a2'), body: '{}' });
  const l2 = (await lokal('GET', '/hand/log?n=1', { kopf: ANDREAS })).j;
  assert.equal(l2.zeilen.length, 1);
  assert.deepEqual([l2.zeilen[0].ok, l2.zeilen[0].fehler, l2.zeilen[0].code], [false, 'ki_gestoppt', 409]);
  assert.equal((await lokal('GET', '/hand/log', { kopf: { 'x-djk-quelle': 'cypher' } })).code === 200, false);
  assert.equal((await lokal('GET', '/hand/log', { kopf: ANDREAS, host: 'evil.example:80' })).code, 421);
  const text = fs.readFileSync(l2.datei, 'utf8');
  assert.ok(!/GEHEIM|authorization/i.test(text));
  assert.equal(path.dirname(l2.datei), logOrdner);
});
