// Browser plan 1, task 3: the folder picker GET /dateisystem/ordner and the path import POST /import/pfad, temp folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen, quelleAusKopf } from '../http/transport.ts';
import { ImportDienst, erlaubteWurzeln } from '../importe.ts';
import { importeBereich } from '../areas/importe/area.ts';

async function stapel(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'import-o-')));
  const heim = path.join(d, 'heim'), importe = path.join(d, 'importe'), aussen = path.join(d, 'aussen');
  for (const x of [heim, aussen]) fs.mkdirSync(x);
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const erlaubt = () => erlaubteWurzeln({ heim, wurzeln: [] });
  const dienst = new ImportDienst({ importeOrdner: () => importe, projektAudioOrdner: () => null, heute: () => '2026-11-23', erlaubt });
  const router = new Router();
  let quelle = 'andreas', port = 0;
  router.melde(importeBereich({ log: () => {}, quelle: () => quelle }, dienst, { port: () => port, erlaubt }));
  const server = http.createServer(async (q, a) => {
    quelle = quelleAusKopf(q);
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    if (r.schutz === 'fremdePost' && q.method === 'POST' && postAbgewiesen(q, a, port)) return;
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  t.after(() => server.close());
  const ruf = async (methode, pfad, body, kopf = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${pfad}`, methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(body ?? {}) });
    const text = await r.text();
    return { code: r.status, j: text ? JSON.parse(text) : null };
  };
  const ordner = (p) => ruf('GET', `/dateisystem/ordner?pfad=${encodeURIComponent(p)}`);
  return { d, heim, importe, aussen, ruf, ordner, port };
}

test('empty pfad answers wurzeln and ordner empty, eltern null', async (t) => {
  const s = await stapel(t);
  const r = await s.ordner('');
  assert.equal(r.code, 200);
  assert.deepEqual([r.j.pfad, r.j.eltern, r.j.ordner], ['', null, []]);
  assert.deepEqual(r.j.wurzeln[0], { name: 'Home', pfad: s.heim });
});

test('listing returns directories only, hidden skipped, natural order', async (t) => {
  const s = await stapel(t);
  for (const n of ['kick10', 'kick2', '.git', 'Ableton Folder Info', 'Zebra']) fs.mkdirSync(path.join(s.heim, n));
  fs.writeFileSync(path.join(s.heim, 'a.wav'), 'x');
  const r = await s.ordner(s.heim);
  assert.deepEqual(r.j.ordner.map((o) => o.name), ['kick2', 'kick10', 'Zebra']);
  assert.equal(r.j.ordner[0].pfad, path.join(s.heim, 'kick2'));
  assert.equal(r.j.pfad, s.heim);
  assert.equal(r.j.mehr, undefined);
});

test('eltern is the parent and null at a root', async (t) => {
  const s = await stapel(t);
  fs.mkdirSync(path.join(s.heim, 'a', 'b'), { recursive: true });
  assert.equal((await s.ordner(s.heim)).j.eltern, null);
  assert.equal((await s.ordner(path.join(s.heim, 'a'))).j.eltern, s.heim);
  assert.equal((await s.ordner(path.join(s.heim, 'a', 'b'))).j.eltern, path.join(s.heim, 'a'));
});

test('a path outside the roots is 403, .. is resolved before the check, symlinks out are not listed nor reachable', async (t) => {
  const s = await stapel(t);
  const o = await s.ordner(s.aussen);
  assert.deepEqual([o.code, o.j.grund, o.j.fehler], [403, 'pfad_ausserhalb', 'pfad_ausserhalb']);
  assert.equal(typeof o.j.text, 'string');
  assert.equal((await s.ordner(`${s.heim}/../aussen`)).j.grund, 'pfad_ausserhalb');
  assert.equal((await s.ordner(`${s.heim}/../heim`)).code, 200);
  assert.equal((await s.ordner('/etc')).code, 403);
  assert.equal((await s.ordner('/nonexistent/nowhere')).code, 403, 'a missing path outside the roots does not reveal anything');
  fs.symlinkSync(s.aussen, path.join(s.heim, 'ausweg'));
  fs.mkdirSync(path.join(s.heim, 'drin'));
  fs.symlinkSync(path.join(s.heim, 'drin'), path.join(s.heim, 'abkuerzung'));
  const l = await s.ordner(s.heim);
  assert.deepEqual(l.j.ordner.map((x) => x.name), ['abkuerzung', 'drin']);
  assert.equal((await s.ordner(path.join(s.heim, 'ausweg'))).code, 403);
});

test('a prefix sibling of a root is not inside it', async (t) => {
  const s = await stapel(t);
  const geschwister = `${s.heim}2`;
  fs.mkdirSync(geschwister);
  assert.equal((await s.ordner(geschwister)).code, 403);
});

test('a file path is 400 kein_ordner, a missing one inside the roots 404 pfad_fehlt, relative 400', async (t) => {
  const s = await stapel(t);
  fs.writeFileSync(path.join(s.heim, 'a.wav'), 'x');
  const f = await s.ordner(path.join(s.heim, 'a.wav'));
  assert.deepEqual([f.code, f.j.grund], [400, 'kein_ordner']);
  const m = await s.ordner(path.join(s.heim, 'nope'));
  assert.deepEqual([m.code, m.j.grund], [404, 'pfad_fehlt']);
  assert.equal((await s.ordner('relativ/pfad')).code, 400);
});

test('an unreadable folder is 403 pfad_nicht_lesbar', async (t) => {
  if (process.getuid?.() === 0) return t.skip('root reads everything');
  const s = await stapel(t);
  const zu = path.join(s.heim, 'zu');
  fs.mkdirSync(zu); fs.chmodSync(zu, 0);
  t.after(() => { try { fs.chmodSync(zu, 0o755); } catch { /* the stack already removed it */ } });
  const r = await s.ordner(zu);
  assert.deepEqual([r.code, r.j.grund], [403, 'pfad_nicht_lesbar']);
});

test('more than 2000 folders answer the first 2000 with mehr: true', async (t) => {
  const s = await stapel(t);
  const gross = path.join(s.heim, 'gross'); fs.mkdirSync(gross);
  for (let i = 0; i < 2003; i++) fs.mkdirSync(path.join(gross, `d${String(i).padStart(4, '0')}`));
  const r = await s.ordner(gross);
  assert.equal(r.j.ordner.length, 2000);
  assert.equal(r.j.mehr, true);
});

test('owner check: source cypher is 403 nur_andreas on the listing and on the import', async (t) => {
  const s = await stapel(t);
  const l = await s.ruf('GET', `/dateisystem/ordner?pfad=`, undefined, { 'x-djk-quelle': 'cypher' });
  assert.deepEqual([l.code, l.j.grund], [403, 'nur_andreas']);
  fs.writeFileSync(path.join(s.heim, 'a.wav'), 'x');
  const i = await s.ruf('POST', '/import/pfad', { pfad: path.join(s.heim, 'a.wav') }, { 'x-djk-quelle': 'cypher' });
  assert.equal(i.code, 200, 'the path import is a page route, not owner only');
});

test('POST /import/pfad copies a wav from heim into importe and leaves the source', async (t) => {
  const s = await stapel(t);
  const quelle = path.join(s.heim, 'Küche Beat.wav');
  fs.writeFileSync(quelle, 'abc');
  const r = await s.ruf('POST', '/import/pfad', { pfad: quelle, ziel: 'auto' });
  assert.equal(r.code, 200);
  assert.deepEqual([r.j.art, r.j.pfad], ['audio', path.join(s.importe, '2026-11-23', 'Küche Beat.wav')]);
  assert.equal(fs.readFileSync(r.j.pfad, 'utf8'), 'abc');
  assert.equal(fs.readFileSync(quelle, 'utf8'), 'abc');
  assert.equal(typeof r.j.sha256, 'string');
  const nochmal = await s.ruf('POST', '/import/pfad', { pfad: quelle });
  assert.equal(path.basename(nochmal.j.pfad), 'Küche Beat-2.wav');
});

test('POST /import/pfad: outside the roots 403, folder 400 ist_ordner, missing 404, wrong type 415, symlink out 403', async (t) => {
  const s = await stapel(t);
  fs.writeFileSync(path.join(s.aussen, 'a.wav'), 'x');
  const aus = await s.ruf('POST', '/import/pfad', { pfad: path.join(s.aussen, 'a.wav') });
  assert.deepEqual([aus.code, aus.j.grund], [403, 'pfad_ausserhalb']);
  fs.symlinkSync(path.join(s.aussen, 'a.wav'), path.join(s.heim, 'link.wav'));
  assert.equal((await s.ruf('POST', '/import/pfad', { pfad: path.join(s.heim, 'link.wav') })).j.grund, 'pfad_ausserhalb');
  assert.equal((await s.ruf('POST', '/import/pfad', { pfad: `${s.heim}/../aussen/a.wav` })).j.grund, 'pfad_ausserhalb');
  fs.mkdirSync(path.join(s.heim, 'ordner'));
  const o = await s.ruf('POST', '/import/pfad', { pfad: path.join(s.heim, 'ordner') });
  assert.deepEqual([o.code, o.j.grund], [400, 'ist_ordner']);
  assert.match(o.j.detail, /source/);
  assert.equal((await s.ruf('POST', '/import/pfad', { pfad: path.join(s.heim, 'weg.wav') })).code, 404);
  fs.writeFileSync(path.join(s.heim, 'n.txt'), 'x');
  assert.equal((await s.ruf('POST', '/import/pfad', { pfad: path.join(s.heim, 'n.txt') })).code, 415);
  assert.equal((await s.ruf('POST', '/import/pfad', {})).code, 400);
  assert.equal((await s.ruf('POST', '/import/pfad', { pfad: path.join(s.heim, 'a.wav'), ziel: 'x' })).code, 400);
  assert.equal(fs.existsSync(s.importe) ? fs.readdirSync(s.importe, { recursive: true }).filter((n) => n.endsWith('.wav')).length : 0, 0);
});

test('erlaubteWurzeln: home first, mount folders by base name, only directories', async (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'import-w-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const heim = path.join(d, 'heim'), media = path.join(d, 'media');
  fs.mkdirSync(heim); fs.mkdirSync(path.join(media, 'STICK'), { recursive: true }); fs.writeFileSync(path.join(media, 'datei.txt'), 'x');
  assert.deepEqual(erlaubteWurzeln({ heim, wurzeln: [media] }), [{ name: 'Home', pfad: heim }, { name: 'STICK', pfad: path.join(media, 'STICK') }]);
  assert.deepEqual(erlaubteWurzeln({ heim, wurzeln: [path.join(d, 'gibtsnicht')] }), [{ name: 'Home', pfad: heim }]);
});

test('the folder listing refuses a foreign Host (rebinding) and is closed to the tablet', async (t) => {
  const s = await stapel(t);
  const mitHost = (host) => new Promise((ok, fehler) => {
    const q = http.request({ host: '127.0.0.1', port: s.port, path: '/dateisystem/ordner?pfad=', headers: { host } }, (a) => { let b = ''; a.on('data', (c) => (b += c)); a.on('end', () => ok({ code: a.statusCode, j: JSON.parse(b) })); });
    q.on('error', fehler); q.end();
  });
  const fremd = await mitHost(`evil.example:${s.port}`);
  assert.deepEqual([fremd.code, fremd.j.grund], [421, 'falscher_host']);
  assert.equal((await mitHost(`localhost:${s.port}`)).code, 200);
  assert.equal((await mitHost(`127.0.0.1:${s.port}`)).code, 200);
  const { tabletVerboten } = await import('../http/coupling.ts');
  assert.equal(tabletVerboten('GET', '/dateisystem/ordner'), true);
});

test('a name is cut by UTF-8 bytes, never inside a surrogate pair', async () => {
  const { saubererName } = await import('../importe.ts');
  for (const z of ['漢', '😀']) {
    const n = saubererName(z.repeat(116) + '.wav');
    assert.ok(Buffer.byteLength(n) <= 120 && n.endsWith('.wav'));
    assert.equal(n.slice(0, -4).split(z).join(''), '');
  }
});

test('POST /import/pfad: a path with a hidden segment under a root is refused as pfad_ausserhalb', async (t) => {
  const s = await stapel(t);
  fs.mkdirSync(path.join(s.heim, '.versteckt'));
  fs.writeFileSync(path.join(s.heim, '.versteckt', 'a.wav'), 'x');
  fs.writeFileSync(path.join(s.heim, '.b.wav'), 'x');
  for (const p of [path.join(s.heim, '.versteckt', 'a.wav'), path.join(s.heim, '.b.wav')]) {
    const r = await s.ruf('POST', '/import/pfad', { pfad: p });
    assert.deepEqual([r.code, r.j.grund], [403, 'pfad_ausserhalb'], p);
  }
  assert.equal((await s.ordner(path.join(s.heim, '.versteckt'))).j.grund, 'pfad_ausserhalb');
});
