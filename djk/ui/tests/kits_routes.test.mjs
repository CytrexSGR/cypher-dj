// Browser plan 5, tasks 2 to 4: the /kits routes on the real Router with the real kit store, temp folders only (no studio, no core).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Router } from '../http/router.ts';
import { json, quelleAusKopf } from '../http/transport.ts';
import { kitsBereich } from '../areas/kits/area.ts';
import { kitInhaltHash } from '../project/kit_storage.ts';
import { schreibeKit, schreibeZip, tmpOrdner, zipVonKit } from './support/kit_build.mjs';

const ROH = { 'x-djk-roh': '1', 'content-type': 'application/octet-stream' };

async function stapel(t, opt = {}) {
  const d = tmpOrdner(t, 'kits-r-');
  const kits = path.join(d, 'kits'), projekt = path.join(d, 'proj');
  fs.mkdirSync(kits);
  const router = new Router();
  const log = [];
  const vorhoert = [];
  let quelle = 'andreas', port = 0;
  router.melde(kitsBereich({ log: (z) => log.push(z), quelle: () => quelle }, {
    kitsOrdner: kits, projektOrdner: () => (opt.projekt ? projekt : null), port: () => port, rohOrdner: path.join(d, 'roh'), maxBytes: opt.maxBytes,
    projekteWurzel: () => path.join(d, 'projekte'), projektNamen: opt.projektNamen,
    vorhoeren: opt.ohneVorhoeren ? undefined : async (wav, sha) => { if (opt.vorhoerenFehler) throw opt.vorhoerenFehler; vorhoert.push({ wav, sha, kopf: fs.readFileSync(wav).subarray(0, 4).toString(), bytes: fs.statSync(wav).size }); },
    ...(opt.bereich ?? {}),
  }));
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
  const ruf = async (methode, pfad, o = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${pfad}`, { method: methode, headers: o.kopf, body: o.body });
    const buf = Buffer.from(await r.arrayBuffer());
    let j = null;
    if ((r.headers.get('content-type') ?? '').includes('json')) j = JSON.parse(buf.toString('utf8'));
    return { code: r.status, j, buf, kopf: r.headers };
  };
  const post = (pfad, body, kopf = {}) => ruf('POST', pfad, { kopf: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(body) });
  return { d, kits, projekt, ruf, post, log, vorhoert, port, setzeQuelle: (q) => { quelle = q; } };
}
const hand = { 'x-djk-quelle': 'cypher' };

test('GET /kits lists', async (t) => {
  const s = await stapel(t, { projekt: true });
  schreibeKit(path.join(s.kits, 'a-kit'));
  schreibeKit(path.join(s.projekt, 'kits', 'p-kit'), { noten: [36] });
  const r = await s.ruf('GET', '/kits');
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.kits, [{ name: 'a-kit', pads: 2, quelle: 'global' }, { name: 'p-kit', pads: 1, quelle: 'projekt' }]);
});

test('export then import into a clean kit folder gives the same hash', async (t) => {
  const s = await stapel(t);
  schreibeKit(path.join(s.kits, 'mein-kit'), { noten: [36, 40, 41], frames: 333 });
  const ex = await s.ruf('GET', '/kits/export?name=mein-kit');
  assert.equal(ex.code, 200);
  assert.equal(ex.kopf.get('content-type'), 'application/zip');
  assert.match(ex.kopf.get('content-disposition'), /mein-kit\.kit\.zip/);
  const s2 = await stapel(t);
  const im = await s2.ruf('POST', '/kits/import?name=neu-da', { kopf: ROH, body: ex.buf });
  assert.equal(im.code, 200, JSON.stringify(im.j));
  assert.deepEqual([im.j.ok, im.j.name], [true, 'neu-da']);
  assert.equal(await kitInhaltHash(path.join(s2.kits, 'neu-da')), await kitInhaltHash(path.join(s.kits, 'mein-kit')));
  assert.deepEqual(fs.readdirSync(s2.kits), ['neu-da']);
  assert.equal(fs.existsSync(path.join(s2.d, 'roh')) ? fs.readdirSync(path.join(s2.d, 'roh')).length : 0, 0, 'no temp zip is left');
});

test('import without a name takes the name inside the zip; a clash with other content answers umbenannt', async (t) => {
  const s = await stapel(t);
  const q = path.join(s.d, 'q');
  schreibeKit(q, { name: 'drums' });
  const z = fs.readFileSync(zipVonKit(path.join(s.d, 'a.zip'), q));
  assert.equal((await s.ruf('POST', '/kits/import', { kopf: ROH, body: z })).j.name, 'drums');
  fs.rmSync(path.join(s.kits, 'drums'), { recursive: true });
  schreibeKit(path.join(s.kits, 'drums'), { fuell: 0.9 });
  const r = await s.ruf('POST', '/kits/import', { kopf: ROH, body: z });
  assert.equal(r.code, 200);
  assert.equal(r.j.umbenannt.alt, 'drums');
  assert.match(r.j.name, /^drums-[0-9a-f]{8}$/);
});

test('import as non-owner answers 403 nur_andreas', async (t) => {
  const s = await stapel(t);
  const r = await s.ruf('POST', '/kits/import', { kopf: { ...ROH, ...hand }, body: Buffer.from('x') });
  assert.deepEqual([r.code, r.j.grund], [403, 'nur_andreas']);
});

test('import without x-djk-roh answers 403 roh_ohne_kopf', async (t) => {
  const s = await stapel(t);
  const r = await s.ruf('POST', '/kits/import', { kopf: { 'content-type': 'application/octet-stream' }, body: Buffer.from('x') });
  assert.deepEqual([r.code, r.j.grund], [403, 'roh_ohne_kopf']);
});

test('import over the cap answers 413', async (t) => {
  const s = await stapel(t, { maxBytes: 100 });
  const r = await s.ruf('POST', '/kits/import', { kopf: ROH, body: Buffer.alloc(500, 1) });
  assert.deepEqual([r.code, r.j.grund], [413, 'datei_zu_gross']);
  assert.deepEqual(fs.readdirSync(s.kits), []);
});

test('import of a zip without kit.json answers 400 kit_json_fehlt and a bad zip 400 zip_abgelehnt', async (t) => {
  const s = await stapel(t);
  const a = await s.ruf('POST', '/kits/import', { kopf: ROH, body: fs.readFileSync(schreibeZip(path.join(s.d, 'a.zip'), { 'x.txt': 'x' })) });
  assert.deepEqual([a.code, a.j.grund], [400, 'kit_json_fehlt']);
  const b = await s.ruf('POST', '/kits/import', { kopf: ROH, body: Buffer.from('not a zip at all') });
  assert.deepEqual([b.code, b.j.grund], [400, 'zip_abgelehnt']);
  assert.deepEqual(fs.readdirSync(s.kits), []);
});

test('export as non-owner (hand source) answers 403 nur_andreas', async (t) => {
  const s = await stapel(t);
  schreibeKit(path.join(s.kits, 'k'));
  const r = await s.ruf('GET', '/kits/export?name=k', { kopf: hand });
  assert.deepEqual([r.code, r.j.grund], [403, 'nur_andreas']);
});

test('export with a foreign Host answers 421 falscher_host', async (t) => {
  const s = await stapel(t);
  schreibeKit(path.join(s.kits, 'k'));
  const r = await new Promise((ok) => http.get({ host: '127.0.0.1', port: s.port, path: '/kits/export?name=k', headers: { host: 'evil.example' } }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => ok({ code: res.statusCode, j: JSON.parse(b) }));
  }));
  assert.deepEqual([r.code, r.j.grund], [421, 'falscher_host']);
});

test('export of an unknown kit answers 404 kit_unbekannt, a bad name 400', async (t) => {
  const s = await stapel(t);
  assert.deepEqual((await s.ruf('GET', '/kits/export?name=nix')).j.grund, 'kit_unbekannt');
  assert.deepEqual((await s.ruf('GET', '/kits/export?name=..%2Fx')).j.grund, 'kit_name_ungueltig');
});

test('error body has grund, text and fehler', async (t) => {
  const s = await stapel(t);
  const r = await s.ruf('GET', '/kits/export?name=nix');
  assert.equal(r.j.ok, false);
  assert.equal(r.j.grund, 'kit_unbekannt');
  assert.equal(r.j.fehler, 'kit_unbekannt');
  assert.match(r.j.text, /kit/);
});

// ---- task 3: rename, copy, delete, preview ----

test('umbenennen, kopie and loeschen through the routes', async (t) => {
  const s = await stapel(t);
  schreibeKit(path.join(s.kits, 'a'));
  assert.deepEqual((await s.post('/kits/umbenennen', { name: 'a', neu: 'b' })).j, { ok: true, name: 'b' });
  assert.deepEqual((await s.post('/kits/kopie', { name: 'b' })).j, { ok: true, name: 'b-2' });
  assert.deepEqual((await s.post('/kits/kopie', { name: 'b', neu: 'c' })).j, { ok: true, name: 'c' });
  const doppelt = await s.post('/kits/umbenennen', { name: 'b', neu: 'c' });
  assert.deepEqual([doppelt.code, doppelt.j.grund, doppelt.j.fehler, typeof doppelt.j.text], [409, 'kit_vorhanden', 'kit_vorhanden', 'string']);
  assert.deepEqual((await s.post('/kits/loeschen', { name: 'c' })).j, { ok: true, name: 'c' });
  assert.deepEqual(fs.readdirSync(s.kits).filter((n) => !n.startsWith('.')).sort(), ['b', 'b-2']);
  const schlecht = await s.post('/kits/umbenennen', { name: 'b', neu: '../x' });
  assert.deepEqual([schlecht.code, schlecht.j.grund], [400, 'kit_name_ungueltig']);
});

test('a kit a project names: umbenennen and loeschen answer 409 kit_in_benutzung, loeschen with trotzdem works', async (t) => {
  const s = await stapel(t);
  schreibeKit(path.join(s.kits, 'a'));
  const o = path.join(s.d, 'projekte', 'song');
  fs.mkdirSync(o, { recursive: true });
  fs.writeFileSync(path.join(o, 'project.json'), JSON.stringify({ spuren: [{ geraet: { art: 'intern', name: 'kit', kit: 'a' } }] }));
  for (const [pfad, body] of [['/kits/umbenennen', { name: 'a', neu: 'b' }], ['/kits/loeschen', { name: 'a' }]]) {
    const r = await s.post(pfad, body);
    assert.deepEqual([r.code, r.j.grund], [409, 'kit_in_benutzung'], pfad);
  }
  assert.deepEqual(fs.readdirSync(s.kits), ['a']);
  assert.equal((await s.post('/kits/loeschen', { name: 'a', trotzdem: true })).code, 200);
});

test('vorhoeren answers ok and calls the callback with a WAV file', async (t) => {
  const s = await stapel(t);
  schreibeKit(path.join(s.kits, 'k'), { noten: [36, 37] });
  const r = await s.post('/kits/vorhoeren', { name: 'k' });
  assert.deepEqual([r.code, r.j], [200, { ok: true }]);
  assert.equal(s.vorhoert.length, 1);
  assert.equal(s.vorhoert[0].kopf, 'RIFF');
  assert.equal(s.vorhoert[0].bytes, 58 + (2 * 100 + 12000) * 8);
  const eins = await s.post('/kits/vorhoeren', { name: 'k', pad: 37 });
  assert.equal(eins.code, 200);
  assert.equal(s.vorhoert[1].bytes, 58 + 100 * 8);
  assert.equal(fs.readdirSync(path.dirname(s.vorhoert[1].wav)).length, 1, 'older previews are removed');
});

test('vorhoeren without headphone cue answers 409 kein_kopfhoerer', async (t) => {
  const { VorhoerFehler } = await import('../prelisten.ts');
  const s = await stapel(t, { vorhoerenFehler: new VorhoerFehler(409, 'kein_kopfhoerer') });
  schreibeKit(path.join(s.kits, 'k'));
  const r = await s.post('/kits/vorhoeren', { name: 'k' });
  assert.deepEqual([r.code, r.j.grund, r.j.fehler], [409, 'kein_kopfhoerer', 'kein_kopfhoerer']);
  assert.match(r.j.text, /headphone/);
});

test('pad 99 answers 404 pad_unbekannt, an unknown kit 404 kit_unbekannt', async (t) => {
  const s = await stapel(t);
  schreibeKit(path.join(s.kits, 'k'));
  const r = await s.post('/kits/vorhoeren', { name: 'k', pad: 99 });
  assert.deepEqual([r.code, r.j.grund], [404, 'pad_unbekannt']);
  assert.equal((await s.post('/kits/vorhoeren', { name: 'nix' })).j.grund, 'kit_unbekannt');
  assert.equal(s.vorhoert.length, 0);
});

// ---- task 4: new kit from a folder ----

test('aus_ordner builds a kit, the hand may too, a path outside the roots is refused', async (t) => {
  const dekodiere = async (p) => { const b = fs.readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
  let wurzel = '';
  const s = await stapel(t, { bereich: { ausOrdner: { erlaubt: () => [{ name: 'd', pfad: wurzel }], dekodiere } } });
  wurzel = fs.realpathSync(s.d);
  const quelle = path.join(s.d, 'quelle');
  fs.mkdirSync(quelle);
  const f = new Float32Array(400).fill(0.3);
  fs.writeFileSync(path.join(quelle, 'kick.wav'), Buffer.from(f.buffer));
  fs.writeFileSync(path.join(quelle, 'snare.wav'), Buffer.from(f.buffer));
  const r = await s.post('/kits/aus_ordner', { pfad: quelle, name: 'neu' });
  assert.deepEqual([r.code, r.j], [200, { ok: true, name: 'neu', pads: 2, uebrig: [] }]);
  assert.deepEqual(fs.readdirSync(s.kits), ['neu']);
  const hand2 = await s.post('/kits/aus_ordner', { pfad: quelle, name: 'x' }, hand);
  assert.deepEqual([hand2.code, hand2.j.ok, hand2.j.name], [200, true, 'x'], 'page protection: the hand may build a kit from a folder');
  const aussen = await s.post('/kits/aus_ordner', { pfad: '/etc', name: 'x' });
  assert.deepEqual([aussen.code, aussen.j.grund, aussen.j.fehler], [403, 'pfad_verboten', 'pfad_verboten']);
  const doppelt = await s.post('/kits/aus_ordner', { pfad: quelle, name: 'neu' });
  assert.deepEqual([doppelt.code, doppelt.j.grund], [409, 'kit_vorhanden']);
  assert.equal((await s.post('/kits/aus_ordner', { name: 'x' })).j.grund, 'argument_ungueltig');
});

// ---- review fixes ----

test('import with a foreign Origin answers 403, the origin header is present and nothing is installed', async (t) => {
  const s = await stapel(t);
  const z = zipVonKit(path.join(s.d, 'a.zip'), schreibeKit(path.join(s.d, 'q')));
  const kopf = { ...ROH, origin: 'http://evil.example' };
  const r = await s.ruf('POST', '/kits/import', { kopf, body: fs.readFileSync(z) });
  assert.equal(r.code, 403);
  assert.equal(r.j.ok, false);
  assert.deepEqual(fs.readdirSync(s.kits), []);
  // the own origin passes the same check
  const gut = await s.ruf('POST', '/kits/import', { kopf: { ...ROH, origin: `http://127.0.0.1:${s.port}` }, body: fs.readFileSync(z) });
  assert.equal(gut.code, 200);
});

test('quelle projekt: a project-only kit can be previewed, copied, renamed and deleted; the same name prefers the named one', async (t) => {
  const s = await stapel(t, { projekt: true });
  schreibeKit(path.join(s.projekt, 'kits', 'nur-hier'), { noten: [36] });
  schreibeKit(path.join(s.kits, 'doppelt'), { noten: [36, 37, 38] });
  schreibeKit(path.join(s.projekt, 'kits', 'doppelt'), { noten: [40] });
  // without quelle a project-only kit is still found (the global one is tried first)
  assert.equal((await s.post('/kits/vorhoeren', { name: 'nur-hier' })).code, 200);
  // the same name: quelle picks which one (pad 40 exists only in the project copy)
  assert.equal((await s.post('/kits/vorhoeren', { name: 'doppelt', pad: 40 })).j.grund, 'pad_unbekannt');
  assert.equal((await s.post('/kits/vorhoeren', { name: 'doppelt', pad: 40, quelle: 'projekt' })).code, 200);
  assert.equal((await s.post('/kits/vorhoeren', { name: 'doppelt', pad: 37, quelle: 'projekt' })).j.grund, 'pad_unbekannt');
  // copy, rename and delete act inside the project kit folder
  assert.deepEqual((await s.post('/kits/kopie', { name: 'nur-hier', quelle: 'projekt' })).j, { ok: true, name: 'nur-hier-2' });
  assert.ok(fs.existsSync(path.join(s.projekt, 'kits', 'nur-hier-2', 'kit.json')));
  assert.equal((await s.post('/kits/umbenennen', { name: 'nur-hier-2', neu: 'zwei', quelle: 'projekt' })).code, 200);
  assert.ok(fs.existsSync(path.join(s.projekt, 'kits', 'zwei', 'kit.json')));
  assert.equal((await s.post('/kits/loeschen', { name: 'doppelt', quelle: 'projekt' })).code, 200);
  assert.ok(fs.existsSync(path.join(s.kits, 'doppelt', 'kit.json')), 'the global kit of that name stays');
  assert.equal(fs.existsSync(path.join(s.projekt, 'kits', 'doppelt')), false);
  // an explicit quelle never falls back
  assert.equal((await s.post('/kits/vorhoeren', { name: 'zwei', quelle: 'global' })).j.grund, 'kit_unbekannt');
  assert.equal((await s.post('/kits/vorhoeren', { name: 'zwei', quelle: 'sonstwo' })).j.grund, 'argument_ungueltig');
});

test('quelle projekt without an open project answers 409 kein_projekt', async (t) => {
  const s = await stapel(t);
  assert.deepEqual((await s.post('/kits/vorhoeren', { name: 'x', quelle: 'projekt' })).j.grund, 'kein_projekt');
});

test('kit export carries only kit.json and the files it names, and refuses a broken kit', async (t) => {
  const s = await stapel(t);
  schreibeKit(path.join(s.kits, 'k'));
  fs.writeFileSync(path.join(s.kits, 'k', 'stray.txt'), 'x');
  const ex = await s.ruf('GET', '/kits/export?name=k');
  assert.equal(ex.code, 200);
  const zielZip = path.join(s.d, 'e.zip');
  fs.writeFileSync(zielZip, ex.buf);
  const { execFileSync } = await import('node:child_process');
  const namen = JSON.parse(execFileSync('python3', ['-I', '-c', 'import sys,json,zipfile;print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', zielZip]).toString());
  assert.deepEqual(namen, ['36.f32', '37.f32', 'kit.json']);
  fs.appendFileSync(path.join(s.kits, 'k', '36.f32'), Buffer.alloc(4));
  const kaputt = await s.ruf('GET', '/kits/export?name=k');
  assert.deepEqual([kaputt.code, kaputt.j.grund], [409, 'kit_ungueltig']);
});
