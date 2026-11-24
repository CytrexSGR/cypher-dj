// Browser plan 1, task 1: POST /import/datei on the real Router with the real ImportDienst, temp folders only. No studio, no test instance.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import zlib from 'node:zlib';
import { Router } from '../http/router.ts';
import { json, quelleAusKopf } from '../http/transport.ts';
import { ImportDienst, ImportFehler } from '../importe.ts';
import { importeBereich } from '../areas/importe/area.ts';

const ROH = { 'x-djk-roh': '1', 'content-type': 'application/octet-stream' };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const lsr = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }) : []);

async function stapel(t, opt = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'import-b-'));
  const importe = path.join(d, 'importe'), projekt = path.join(d, 'projekt');
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const hook = [];
  const dienst = new ImportDienst({ importeOrdner: () => importe, projektAudioOrdner: () => (opt.ohneProjekt ? null : path.join(projekt, 'audio')),
    heute: () => '2026-11-23', nachImport: (r) => hook.push(r), ...(opt.dienst ?? {}) });
  const router = new Router();
  const log = [];
  let quelle = 'andreas', port = 0;
  router.melde(importeBereich({ log: (z) => log.push(z), quelle: () => quelle }, dienst, { port: () => port }));
  const server = http.createServer(async (q, a) => {
    quelle = quelleAusKopf(q);
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  t.after(() => server.close());
  const post = async (query, body, kopf = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}/import/datei?${query}`, { method: 'POST', headers: { ...ROH, ...kopf }, body });
    const text = await r.text();
    return { code: r.status, j: text ? JSON.parse(text) : null };
  };
  return { d, importe, projekt, dienst, hook, log, post, port };
}
const q = (name, ziel) => `name=${encodeURIComponent(name)}${ziel ? `&ziel=${ziel}` : ''}`;

test('import wav lands under importe/<date>/ and answers pfad, art audio', async (t) => {
  const s = await stapel(t);
  const bytes = Buffer.from('RIFFxxxxWAVEdata-bytes');
  const r = await s.post(q('kick.wav'), bytes);
  assert.equal(r.code, 200);
  assert.equal(r.j.ok, true);
  assert.equal(r.j.art, 'audio');
  assert.equal(r.j.pfad, path.join(s.importe, '2026-11-23', 'kick.wav'));
  assert.deepEqual(fs.readFileSync(r.j.pfad), bytes);
});

test('name with spaces umlauts and leading dot is kept readable, path parts are cut', async (t) => {
  const s = await stapel(t);
  const b = Buffer.from('x');
  assert.equal(path.basename((await s.post(q('Küche Beat 1.wav'), b)).j.pfad), 'Küche Beat 1.wav');
  assert.equal(path.basename((await s.post(q('../../x.wav'), b)).j.pfad), 'x.wav');
  assert.equal(path.basename((await s.post(q('..\\..\\y.wav'), b)).j.pfad), 'y.wav');
  assert.equal(path.basename((await s.post(q('.hidden.wav'), b)).j.pfad), 'hidden.wav');
  const e = await s.post(q('../..'), b);
  assert.deepEqual([e.code, e.j.grund, e.j.fehler], [400, 'name_ungueltig', 'name_ungueltig']);
  assert.equal(typeof e.j.text, 'string');
  assert.equal((await s.post('', b)).j.grund, 'name_ungueltig');
  assert.ok(lsr(s.importe).every((n) => !n.includes('..')));
  assert.equal(fs.existsSync(path.join(s.d, 'x.wav')), false);
});

test('second import of the same name gets a suffix', async (t) => {
  const s = await stapel(t);
  const a = await s.post(q('kick.wav'), Buffer.from('first'));
  const b = await s.post(q('kick.wav'), Buffer.from('second'));
  const c = await s.post(q('kick.wav'), Buffer.from('third'));
  assert.deepEqual([a, b, c].map((r) => path.basename(r.j.pfad)), ['kick.wav', 'kick-2.wav', 'kick-3.wav']);
  assert.equal(fs.readFileSync(a.j.pfad, 'utf8'), 'first');
  assert.equal(fs.readFileSync(b.j.pfad, 'utf8'), 'second');
});

test('unsupported extension is refused before the body is read; mid and json classes', async (t) => {
  const s = await stapel(t);
  const e = await s.post(q('notes.txt'), Buffer.from('hello'));
  assert.deepEqual([e.code, e.j.grund, e.j.detail], [415, 'typ_unbekannt', 'txt']);
  assert.equal(lsr(s.importe).length, 0);
  const m = await s.post(q('Song.MID'), Buffer.from('MThd'));
  assert.deepEqual([m.code, m.j.art], [200, 'midi']);
  const p = await s.post(q('lead.json'), Buffer.from('{}'));
  assert.deepEqual([p.code, p.j.art, p.j.weiter], [200, 'preset', { route: '/presets/import' }]);
});

test('zero bytes, size caps, aborted upload leave no file', async (t) => {
  const s = await stapel(t);
  const leer = await s.post(q('a.wav'), Buffer.alloc(0));
  assert.deepEqual([leer.code, leer.j.grund], [400, 'quelle_leer']);
  await assert.rejects(s.dienst.nimmAn(new PassThrough(), 'big.wav', 'auto', 2 * 2 ** 30 + 1), (e) => e instanceof ImportFehler && e.code === 413 && e.grund === 'datei_zu_gross');
  // the counter stops a body that outgrows its cap without a declared length
  const klein = new ImportDienst({ importeOrdner: () => s.importe, projektAudioOrdner: () => null, heute: () => '2026-11-24', maxBytes: 8 });
  const st = new PassThrough(); st.end(Buffer.alloc(20));
  await assert.rejects(klein.nimmAn(st, 'x.wav', 'auto', null), (e) => e.grund === 'datei_zu_gross');
  // client abort after 10 bytes, with and without an error
  const ab = new PassThrough();
  const lauf = s.dienst.nimmAn(ab, 'abbruch.wav', 'auto', null);
  ab.write(Buffer.alloc(10));
  await new Promise((r) => setTimeout(r, 30));
  ab.destroy(new Error('aborted'));
  await assert.rejects(lauf, (e) => e instanceof ImportFehler && e.grund === 'upload_abgebrochen');
  const ab2 = new PassThrough(); const lauf2 = s.dienst.nimmAn(ab2, 'abbruch2.wav', 'auto', null);
  ab2.write(Buffer.alloc(10)); await new Promise((r) => setTimeout(r, 30)); ab2.destroy();
  await assert.rejects(lauf2, (e) => e.grund === 'upload_abgebrochen');
  // a declared length that the stream does not deliver
  const kurz = new PassThrough(); kurz.end(Buffer.alloc(5));
  await assert.rejects(s.dienst.nimmAn(kurz, 'kurz.wav', 'auto', 50), (e) => e.grund === 'upload_abgebrochen');
  const alle = lsr(s.importe).filter((n) => fs.statSync(path.join(s.importe, n)).isFile());
  assert.deepEqual(alle, [], `no file at all remains: ${alle}`);
});

test('declared content-length above 2 GB answers 413 over HTTP, free space below the size answers 507', async (t) => {
  const s = await stapel(t, { dienst: { freierPlatz: () => 100 } });
  const roh = await new Promise((ok) => {
    const req = http.request({ host: '127.0.0.1', port: s.port, path: `/import/datei?${q('big.wav')}`, method: 'POST', headers: { ...ROH, 'content-length': String(3 * 2 ** 30) } }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => ok({ code: res.statusCode, j: JSON.parse(d) }));
    });
    req.on('error', () => ok({ code: 0 }));
    req.write(Buffer.alloc(16));   // never the 3 GB
    setTimeout(() => req.destroy(), 1500);
  });
  assert.deepEqual([roh.code, roh.j?.grund], [413, 'datei_zu_gross']);
  const voll = await s.post(q('f.wav'), Buffer.alloc(1000));
  assert.deepEqual([voll.code, voll.j.grund], [507, 'platte_voll']);
  assert.deepEqual(lsr(s.importe).filter((n) => /\.(teil|wav)$/.test(n)), []);
});

test('ziel=projekt lands in <project>/audio, without a project it is 409, a zip is 400', async (t) => {
  const s = await stapel(t);
  const r = await s.post(q('a.wav', 'projekt'), Buffer.from('abc'));
  assert.equal(r.j.pfad, path.join(s.projekt, 'audio', 'a.wav'));
  assert.equal(fs.readFileSync(r.j.pfad, 'utf8'), 'abc');
  const z = await s.post(q('a.zip', 'projekt'), Buffer.from('PK'));
  assert.deepEqual([z.code, z.j.grund], [400, 'ziel_unpassend']);
  const o = await stapel(t, { ohneProjekt: true });
  const k = await o.post(q('a.wav', 'projekt'), Buffer.from('abc'));
  assert.deepEqual([k.code, k.j.grund], [409, 'kein_projekt']);
  const bad = await s.post(q('a.wav', 'woandershin'), Buffer.from('abc'));
  assert.deepEqual([bad.code, bad.j.grund], [400, 'argument_ungueltig']);
});

test('protection: header, content-type, origin, source', async (t) => {
  const s = await stapel(t);
  const b = Buffer.from('abc');
  const ohneKopf = await fetch(`http://127.0.0.1:${s.port}/import/datei?${q('a.wav')}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: b });
  assert.deepEqual([ohneKopf.status, (await ohneKopf.json()).grund], [403, 'roh_ohne_kopf']);
  const jsonTyp = await s.post(q('a.wav'), b, { 'content-type': 'application/json' });
  assert.deepEqual([jsonTyp.code, jsonTyp.j.grund], [415, 'nur_roh']);
  const fremd = await s.post(q('a.wav'), b, { origin: 'http://evil.example' });
  assert.deepEqual([fremd.code, fremd.j.grund], [403, 'fremde_herkunft']);
  const eigen = await s.post(q('a.wav'), b, { origin: `http://localhost:${s.port}` });
  assert.equal(eigen.code, 200);
  const cy = await s.post(q('b.wav'), b, { 'x-djk-quelle': 'cypher' });
  assert.deepEqual([cy.code, cy.j.grund], [403, 'nur_andreas']);
  assert.equal(fs.existsSync(path.join(s.importe, '2026-11-23', 'b.wav')), false);
  assert.ok(s.log.some((z) => z.typ === 'import_abgelehnt' && z.grund === 'nur_andreas'));
});

test('audio answers the sha256 of the stored bytes, the others none', async (t) => {
  const s = await stapel(t);
  const gross = crypto.randomBytes(3 * 2 ** 20);
  const a = await s.post(q('big.wav'), gross);
  assert.equal(a.j.sha256, sha(gross));
  assert.equal(a.j.sha256, sha(fs.readFileSync(a.j.pfad)));
  const b = await s.post(q('big2.wav'), gross.subarray(0, gross.length - 1));
  assert.notEqual(b.j.sha256, a.j.sha256);
  const c = await s.post(q('big.wav'), gross);
  assert.equal(path.basename(c.j.pfad), 'big-2.wav');
  assert.equal(c.j.sha256, a.j.sha256);
  for (const n of ['m.mid', 'z.zip', 'p.json']) assert.equal('sha256' in (await s.post(q(n), Buffer.from('x'))).j, false, n);
});

test('the nachImport hook runs once per accepted file with the result, not for refusals', async (t) => {
  const s = await stapel(t);
  await s.post(q('a.wav'), Buffer.from('x'));
  await s.post(q('b.txt'), Buffer.from('x'));
  await s.post(q('c.mid'), Buffer.from('x'));
  assert.deepEqual(s.hook.map((r) => [r.art, path.basename(r.pfad)]), [['audio', 'a.wav'], ['midi', 'c.mid']]);
});

// ---- task 2: zip import through djk/tools/zipwerk.py ----
// a stored (uncompressed) zip from {name: Buffer}, no dependency
function zipVon(eintraege) {
  const teile = [], zentral = []; let off = 0;
  for (const [name, inhalt] of Object.entries(eintraege)) {
    const n = Buffer.from(name), c = zlib.crc32(inhalt);
    const lok = Buffer.alloc(30); lok.writeUInt32LE(0x04034b50, 0); lok.writeUInt16LE(20, 4); lok.writeUInt32LE(c, 14); lok.writeUInt32LE(inhalt.length, 18); lok.writeUInt32LE(inhalt.length, 22); lok.writeUInt16LE(n.length, 26);
    const z = Buffer.alloc(46); z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(20, 4); z.writeUInt16LE(20, 6); z.writeUInt32LE(c, 16); z.writeUInt32LE(inhalt.length, 20); z.writeUInt32LE(inhalt.length, 24); z.writeUInt16LE(n.length, 28); z.writeUInt32LE(off, 42);
    teile.push(lok, n, inhalt); zentral.push(z, n); off += 30 + n.length + inhalt.length;
  }
  const zb = Buffer.concat(zentral);
  const ende = Buffer.alloc(22); ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(Object.keys(eintraege).length, 8); ende.writeUInt16LE(Object.keys(eintraege).length, 10); ende.writeUInt32LE(zb.length, 12); ende.writeUInt32LE(off, 16);
  return Buffer.concat([...teile, zb, ende]);
}

test('an audio zip is unpacked into a folder of its name, counted, other files listed', async (t) => {
  const s = await stapel(t);
  const r = await s.post(q('Pack One.zip'), zipVon({ 'a.wav': Buffer.from('aa'), 'sub/b.wav': Buffer.from('bb'), 'notes.txt': Buffer.from('t') }));
  assert.equal(r.code, 200);
  assert.deepEqual([r.j.art, r.j.eintraege], ['zip', 2]);
  assert.deepEqual(r.j.uebersprungen, [{ name: 'notes.txt', grund: 'typ_unbekannt' }]);
  assert.equal(r.j.pfad, path.join(s.importe, '2026-11-23', 'Pack One'));
  assert.equal(fs.readFileSync(path.join(r.j.pfad, 'sub', 'b.wav'), 'utf8'), 'bb');
  assert.equal(fs.existsSync(path.join(r.j.pfad, 'notes.txt')), false);
  const zweite = await s.post(q('Pack One.zip'), zipVon({ 'a.wav': Buffer.from('cc') }));
  assert.equal(path.basename(zweite.j.pfad), 'Pack One-2');
  assert.equal(fs.readFileSync(path.join(r.j.pfad, 'a.wav'), 'utf8'), 'aa');
});

test('a kit zip and a project zip stay zips and point to their routes', async (t) => {
  const s = await stapel(t);
  const k = await s.post(q('kit.zip'), zipVon({ 'kit.json': Buffer.from('{}'), 'a.wav': Buffer.from('a') }));
  assert.deepEqual([k.code, k.j.art, k.j.weiter], [200, 'kit', { route: '/kits/import' }]);
  assert.equal(fs.statSync(k.j.pfad).isFile(), true);
  assert.match(k.j.pfad, /kit\.zip$/);
  const p = await s.post(q('proj.zip'), zipVon({ 'project.json': Buffer.from('{}') }));
  assert.deepEqual([p.j.art, p.j.weiter], ['zip', { route: '/proj/import_zip' }]);
  assert.equal(fs.statSync(p.j.pfad).isFile(), true);
});

test('a refused zip answers 400 zip_abgelehnt with the helper reason in detail and leaves nothing behind', async (t) => {
  const s = await stapel(t);
  const r = await s.post(q('bad.zip'), zipVon({ '../evil.wav': Buffer.from('e') }));
  assert.deepEqual([r.code, r.j.grund, r.j.detail], [400, 'zip_abgelehnt', 'pfad_verlaesst_ordner']);
  const kaputt = await s.post(q('broken.zip'), Buffer.from('this is not a zip'));
  assert.deepEqual([kaputt.code, kaputt.j.grund, kaputt.j.detail], [400, 'zip_abgelehnt', 'zip_kaputt']);
  assert.deepEqual(lsr(s.importe).filter((n) => fs.statSync(path.join(s.importe, n)).isFile()), []);
});
