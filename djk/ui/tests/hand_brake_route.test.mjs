// Agent brake route: POST /hand/bremse from the loopback page refuses every agent write until released.
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
  const log = [];
  const huellen = path.join(tmp('kt-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('kt-bestand-'), arbeitsbestand: tmp('kt-ab-'),
    mutationen: [], loops: tmp('kt-loops-'), kits: tmp('kt-kits-'), welleCache: tmp('kt-welle-'), musterOrdner: tmp('kt-muster-'), hotcueOrdner: tmp('kt-hc-'),
    rasterOrdner: tmp('kt-raster-'), huellen, wirtOrdner: tmp('kt-wirt-'), sammlungen: tmp('kt-sets-'), musterBibliothek: tmp('kt-mb-'), musterSets: tmp('kt-ms-'),
    mediathek: path.join(tmp('kt-med-'), 'gibt-es-nicht.sqlite'), katalog: path.join(tmp('kt-kat-'), 'gibt-es-nicht.sqlite'),
    digitalout: path.join(tmp('kt-do-'), 'nix'), kernPruefmodus: true,
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

test('brake: set from the page, every agent write refused, the person unaffected, state on /strom, release lifts it', async (t) => {
  await start(t);
  assert.deepEqual((await lokal('GET', '/hand/bremse')).j, { gestoppt: false, bremse: false, kern_ki: false });
  assert.equal((await lokal('POST', '/regler', { kopf: CYPHER, body: '{}' })).j?.fehler === 'ki_gestoppt', false);
  assert.equal((await lokal('POST', '/hand/bremse', { kopf: CYPHER, body: '{"an":true}' })).code, 403, 'an agent cannot set the brake');
  const an = await lokal('POST', '/hand/bremse', { kopf: ANDREAS, body: '{"an":true}' });
  assert.deepEqual([an.code, an.j], [200, { gestoppt: true, bremse: true, kern_ki: false }]);
  const c = await lokal('POST', '/regler', { kopf: CYPHER, body: '{}' });
  assert.deepEqual([c.code, c.j.fehler], [409, 'ki_gestoppt']);
  const p = await lokal('POST', '/regler', { kopf: ANDREAS, body: '{}' });
  assert.notEqual(p.j?.fehler, 'ki_gestoppt');
  const fremd = await lokal('POST', '/hand/bremse', { kopf: CYPHER, body: '{"an":false}' });
  assert.equal(fremd.code, 409, 'braked: the central rule answers before the route, an agent cannot release it');
  assert.equal((await lokal('POST', '/hand/bremse', { kopf: ANDREAS, body: '{}' })).j.fehler, 'an_fehlt');
  assert.equal((await lokal('POST', '/hand/bremse', { kopf: ANDREAS, body: '{"an":true}', host: 'evil.example:80' })).code, 421);
  const strom = await new Promise((ok) => {
    const q = http.get({ host: '127.0.0.1', port: 47300 + K, path: '/strom', headers: { host: `127.0.0.1:${47300 + K}` }, agent: false }, (a) => {
      let s = ''; a.on('data', (d) => { s += d; if (s.includes('"a":"hand"')) { q.destroy(); ok(s); } });
    });
    q.on('error', () => {});
    setTimeout(() => { q.destroy(); ok(''); }, 3000).unref();
  });
  assert.match(strom, /"a":"hand","f":\{"gestoppt":true,"bremse":true/);
  const aus = await lokal('POST', '/hand/bremse', { kopf: ANDREAS, body: '{"an":false}' });
  assert.deepEqual(aus.j, { gestoppt: false, bremse: false, kern_ki: false });
  assert.notEqual((await lokal('POST', '/regler', { kopf: CYPHER, body: '{}' })).j?.fehler, 'ki_gestoppt');
});
