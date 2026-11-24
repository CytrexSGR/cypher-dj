// Browser plan 6, task 10: GET /plugins/pfade and POST /plugins/pfade/dazu|weg on the real Router, temp HOME, fake PluginIndex (counts scanne).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { tabletVerboten } from '../http/coupling.ts';
import { pluginsBereich } from '../areas/plugins/area.ts';

async function stapel(t, { quelle = 'andreas', laeuft = false, umgebung } = {}) {
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pfade-r-')));
  t.after(() => fs.rmSync(h, { recursive: true, force: true }));
  const alt = process.env.CYPHERDJ_VST3_PFADE;
  if (umgebung) process.env.CYPHERDJ_VST3_PFADE = umgebung;
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_VST3_PFADE; else process.env.CYPHERDJ_VST3_PFADE = alt; });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pfade-root-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const zaehler = { scan: 0, nachlauf: 0 };
  const idx = { liste: () => [], scanStand: () => ({}), scanne: () => { zaehler.scan++; return !laeuft; }, merkeNachlauf: () => { zaehler.nachlauf++; return true; }, entsperre: () => null };
  const q = { wert: quelle };
  const router = new Router();
  let port = 0;
  const ctx = { quelle: () => q.wert, log: () => {}, kiGestoppt: () => false, sende: () => 0, warteQuittung: async () => null, verteile: () => {} };
  router.melde(pluginsBereich(ctx, idx, { insertParameter: async () => ({ code: 200, j: {} }), insertFenster: async () => ({ code: 200, j: {} }) },
    { port: () => port, home: () => h, wurzel: root, erlaubt: () => [{ name: 'Home', pfad: h }] }));
  const server = http.createServer(async (rq, a) => {
    const url = new URL(rq.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(rq.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    if (r.schutz === 'fremdePost' && rq.method === 'POST' && postAbgewiesen(rq, a, port)) return;
    await r.handler(rq, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  t.after(() => server.close());
  const basis = `http://127.0.0.1:${port}`;
  const ruf = async (m, p, body, kopf = {}) => {
    const r = await fetch(basis + p, { method: m, headers: m === 'POST' ? { 'content-type': 'application/json', origin: basis, ...kopf } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
    return { code: r.status, j: await r.json() };
  };
  const datei = path.join(h, '.config/cypherdj/plugin_pfade.txt');
  const ordner = (n) => { const p = path.join(h, n); fs.mkdirSync(p, { recursive: true }); return p; };
  return { ruf, h, root, datei, ordner, zaehler, q, port };
}

test('GET lists nutzer, umgebung, datei, paket in that order plus the standard folders', async (t) => {
  const s = await stapel(t, { umgebung: '/opt/env-a' });
  fs.mkdirSync(path.join(s.root, 'lib/vst3'), { recursive: true });   // the package row, in a temp root
  fs.mkdirSync(path.dirname(s.datei), { recursive: true });
  fs.writeFileSync(s.datei, `# c\n/opt/mine\n`);
  const r = await s.ruf('GET', '/plugins/pfade');
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.pfade.map((x) => x.quelle), ['nutzer', 'umgebung', 'datei', 'paket']);
  assert.equal(r.j.pfade[2].pfad, '/opt/mine');
  assert.deepEqual(r.j.standard, [`${s.h}/.vst3`, '/usr/lib/vst3', '/usr/local/lib/vst3', `${s.h}/.lv2`, '/usr/lib/lv2', '/usr/local/lib/lv2']);
});

test('dazu writes the line, starts one rescan; a second add is pfad_schon_da with no second scan', async (t) => {
  const s = await stapel(t);
  const o = s.ordner('plug');
  const r = await s.ruf('POST', '/plugins/pfade/dazu', { pfad: o });
  assert.deepEqual([r.code, r.j], [200, { ok: true, scan_gestartet: true }]);
  assert.equal(fs.readFileSync(s.datei, 'utf8'), `${o}\n`);
  assert.equal(s.zaehler.scan, 1);
  const z = await s.ruf('POST', '/plugins/pfade/dazu', { pfad: o });
  assert.equal(z.code, 409); assert.equal(z.j.grund, 'pfad_schon_da'); assert.equal(z.j.ok, false); assert.ok(z.j.text);
  assert.equal(s.zaehler.scan, 1);
  assert.equal(fs.readFileSync(s.datei, 'utf8'), `${o}\n`);
});

test('dazu with a running scan answers scan_gestartet false', async (t) => {
  const s = await stapel(t, { laeuft: true });
  const r = await s.ruf('POST', '/plugins/pfade/dazu', { pfad: s.ordner('p') });
  assert.deepEqual([r.code, r.j.scan_gestartet, r.j.scan_vorgemerkt], [200, false, true]);
  assert.match(r.j.text, /next scan/);
  assert.equal(s.zaehler.nachlauf, 1);
});

test('bad folders are refused and the file stays unchanged', async (t) => {
  const s = await stapel(t);
  fs.writeFileSync(path.join(s.h, 'datei.txt'), 'x');
  const faelle = [[{ pfad: 'rel/x' }, 400, 'pfad_ungueltig'], [{ pfad: `${s.h}/a\nb` }, 400, 'pfad_ungueltig'], [{}, 400, 'pfad_ungueltig'], [{ pfad: 7 }, 400, 'pfad_ungueltig'],
    [{ pfad: path.join(s.h, 'fehlt') }, 400, 'pfad_fehlt_ordner'], [{ pfad: path.join(s.h, 'datei.txt') }, 400, 'pfad_fehlt_ordner'],
    [{ pfad: '/usr/lib/vst3' }, 409, 'pfad_schon_da'], [{ pfad: '/usr' }, 403, 'pfad_ausserhalb'], [{ pfad: '/etc/gibtsnicht' }, 403, 'pfad_ausserhalb'], [{ pfad: '/proc/self' }, 403, 'pfad_ausserhalb']];
  for (const [body, code, grund] of faelle) {
    const r = await s.ruf('POST', '/plugins/pfade/dazu', body);
    assert.deepEqual([r.code, r.j.grund, r.j.ok], [code, grund, false], JSON.stringify(body));
  }
  assert.equal(fs.existsSync(s.datei), false);
  assert.equal(s.zaehler.scan, 0);
});

test('a standard folder inside the roots is pfad_schon_da', async (t) => {
  const s = await stapel(t);
  const v = s.ordner('.vst3');
  const r = await s.ruf('POST', '/plugins/pfade/dazu', { pfad: v });
  assert.deepEqual([r.code, r.j.grund], [409, 'pfad_schon_da']);
  assert.equal(fs.existsSync(s.datei), false);
});

test('weg removes a datei row; paket and nutzer rows are pfad_fest; unknown is pfad_unbekannt', async (t) => {
  const s = await stapel(t);
  const o = s.ordner('plug');
  await s.ruf('POST', '/plugins/pfade/dazu', { pfad: o });
  const fest = (await s.ruf('GET', '/plugins/pfade')).j.pfade[0].pfad;   // the nutzer row
  const f = await s.ruf('POST', '/plugins/pfade/weg', { pfad: fest });
  assert.deepEqual([f.code, f.j.grund], [409, 'pfad_fest']);
  const u = await s.ruf('POST', '/plugins/pfade/weg', { pfad: '/opt/gibtsnicht' });
  assert.deepEqual([u.code, u.j.grund], [404, 'pfad_unbekannt']);
  const w = await s.ruf('POST', '/plugins/pfade/weg', { pfad: o });
  assert.deepEqual([w.code, w.j], [200, { ok: true }]);
  assert.equal(fs.readFileSync(s.datei, 'utf8'), '');
});

test('source cypher gets 403 nur_andreas on both writes, nothing written', async (t) => {
  const s = await stapel(t, { quelle: 'cypher' });
  const o = s.ordner('plug');
  for (const p of ['/plugins/pfade/dazu', '/plugins/pfade/weg']) {
    const r = await s.ruf('POST', p, { pfad: o });
    assert.deepEqual([r.code, r.j.grund], [403, 'nur_andreas']);
  }
  assert.equal(fs.existsSync(s.datei), false); assert.equal(s.zaehler.scan, 0);
});

test('a foreign Origin is refused before the handler (403), and a non-JSON type is 415', async (t) => {
  const s = await stapel(t);
  const o = s.ordner('plug');
  const r = await s.ruf('POST', '/plugins/pfade/dazu', { pfad: o }, { origin: 'http://evil.example' });
  assert.equal(r.code, 403); assert.equal(r.j.fehler ?? r.j.grund, 'fremde_herkunft');
  const t2 = await fetch(`http://127.0.0.1:${s.port}/plugins/pfade/dazu`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ pfad: o }) });
  assert.equal(t2.status, 415);
  assert.equal(fs.existsSync(s.datei), false);
});

test('a non-loopback Host name is refused with 421', async (t) => {
  const s = await stapel(t);
  const o = s.ordner('plug');
  const code = await new Promise((ok, fehl) => {
    const rq = http.request({ host: '127.0.0.1', port: s.port, path: '/plugins/pfade/dazu', method: 'POST', headers: { host: `evil.example:${s.port}`, 'content-type': 'application/json', origin: `http://127.0.0.1:${s.port}` } }, (res) => { res.resume(); ok(res.statusCode); });
    rq.on('error', fehl); rq.end(JSON.stringify({ pfad: o }));
  });
  assert.equal(code, 421);
  assert.equal(fs.existsSync(s.datei), false);
});

test('the paired tablet listener refuses both writes', () => {
  assert.equal(tabletVerboten('POST', '/plugins/pfade/dazu'), true);
  assert.equal(tabletVerboten('POST', '/plugins/pfade/weg'), true);
});
