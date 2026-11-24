// Task 6 of the browser-6 plan: GET /presets/export and POST /presets/import on the real Router with a temp store (the factory presets are read-only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { tabletVerboten } from '../http/coupling.ts';
import { presetsBereich } from '../presets/area.ts';
import { PresetSpeicher } from '../presets/store.ts';
import { planeAnwendung } from '../presets/apply.ts';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';

const BESCHR = { art: 'bass', unterart: 'acid', charakter: ['warm'], genre: ['techno'], einsatz: ['drop'], energie: 3, text: 'An exchange test sound.' };

async function stapel(t, o = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-ax-'));
  const speicher = new PresetSpeicher({ nutzer: path.join(d, 'nutzer') });
  const stand = { quelle: 'andreas' };
  const router = new Router();
  let port = 0;
  router.melde(presetsBereich({ log: () => {}, quelle: () => stand.quelle }, { speicher, port: () => port }));
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
  const post = async (daten, kopf = { 'content-type': 'application/json' }) => {
    const r = await fetch(`${base}/presets/import`, { method: 'POST', headers: kopf, body: typeof daten === 'string' ? daten : daten });
    return { code: r.status, j: await r.json() };
  };
  const hole = (pfad) => fetch(base + pfad);
  return { d, speicher, stand, post, hole, base, port, router };
}
const sichere = (s, name = 'Acid One', extra = {}) => s.speichere({ name, geraet: 'rb338', werte: { cutoff: 900 }, beschreibung: BESCHR, ...extra });
const datei = (s, slug = 'acid-one') => s.pfad('nutzer', 'rb338', slug);
const ordnerLeer = (s) => !fs.existsSync(path.dirname(datei(s))) || fs.readdirSync(path.dirname(datei(s))).filter((n) => n.endsWith('.preset.json')).length === 0;

test('export returns the stored bytes with an attachment header, for user and factory presets; unknown id 404', async (t) => {
  const s = await stapel(t);
  sichere(s.speicher);
  const r = await s.hole('/presets/export?id=nutzer:rb338/acid-one');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/json');
  assert.equal(r.headers.get('content-disposition'), 'attachment; filename="acid-one.preset.json"');
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(fs.readFileSync(datei(s.speicher))));
  const eintrag = s.speicher.liste({ herkunft: 'werk', geraet: 'komp' })[0];
  const w = await s.hole(`/presets/export?id=werk:komp/${eintrag.slug}`);
  assert.equal(w.status, 200);
  assert.ok(Buffer.from(await w.arrayBuffer()).equals(fs.readFileSync(s.speicher.pfad('werk', 'komp', eintrag.slug))));
  const nein = await s.hole('/presets/export?id=nutzer:rb338/nope');
  assert.equal(nein.status, 404); const nj = await nein.json(); assert.ok(nj.fehler && nj.text);
  assert.equal((await s.hole('/presets/export')).status, 400);
  assert.equal((await s.hole('/presets/export?id=../etc/passwd')).status, 400);
});

test('export, delete, import: the file comes back byte for byte; a second import writes nothing', async (t) => {
  const s = await stapel(t);
  sichere(s.speicher);
  const original = Buffer.from(await (await s.hole('/presets/export?id=nutzer:rb338/acid-one')).arrayBuffer());
  s.speicher.loesche('rb338', 'acid-one');
  assert.ok(ordnerLeer(s.speicher));
  const a = await s.post(original.toString('utf8'));
  assert.equal(a.code, 200); assert.deepEqual(a.j, { ok: true, id: 'nutzer:rb338/acid-one', schon_da: false });
  assert.ok(fs.readFileSync(datei(s.speicher)).equals(original));
  const m0 = fs.statSync(datei(s.speicher)).mtimeMs;
  await new Promise((ok) => setTimeout(ok, 20));
  const b = await s.post(original.toString('utf8'));
  assert.deepEqual(b.j, { ok: true, id: 'nutzer:rb338/acid-one', schon_da: true });
  assert.equal(fs.statSync(datei(s.speicher)).mtimeMs, m0);
});

test('the same name with one changed value is 409 name_vergeben and the file stays', async (t) => {
  const s = await stapel(t);
  sichere(s.speicher);
  const j = JSON.parse(fs.readFileSync(datei(s.speicher), 'utf8'));
  j.werte.cutoff = 901;
  const vorher = fs.readFileSync(datei(s.speicher));
  const a = await s.post(JSON.stringify(j));
  assert.equal(a.code, 409); assert.equal(a.j.ok, false); assert.equal(a.j.grund, 'name_vergeben'); assert.ok(a.j.text);
  assert.ok(fs.readFileSync(datei(s.speicher)).equals(vorher));
});

test('bad files are refused with a reason and nothing is written', async (t) => {
  const s = await stapel(t);
  sichere(s.speicher);
  const gut = JSON.parse(fs.readFileSync(datei(s.speicher), 'utf8'));
  s.speicher.loesche('rb338', 'acid-one');
  const mit = (f) => { const x = structuredClone(gut); f(x); return JSON.stringify(x); };
  const faelle = [
    ['not json', 'text that is not json', 400, 'kein_json'],
    ['array', '[1,2,3]', 400, 'kein_json'],
    ['300 KiB', JSON.stringify({ ...gut, notiz: 'x'.repeat(300 * 1024) }), 413, 'zu_gross'],
    ['empty object', '{}', 400, 'schema'],
    ['schema 2', mit((x) => { x.schema = 2; }), 400, 'schema'],
    ['unknown vocabulary word', mit((x) => { x.beschreibung.art = 'nonsense'; }), 400, 'schema'],
    ['path name', mit((x) => { x.name = '../x'; }), 400, 'schema'],
    ['empty name', mit((x) => { x.name = ''; }), 400, 'schema'],
    ['plugin state blob', '{"state":"AAAA","name":"x"}', 400, 'schema'],
  ];
  for (const [was, body, code, grund] of faelle) {
    const a = await s.post(body);
    assert.equal(a.code, code, was); assert.equal(a.j.ok, false, was); assert.equal(a.j.grund, grund, was); assert.ok(a.j.text, was);
  }
  const voc = await s.post(mit((x) => { x.beschreibung.art = 'nonsense'; }));
  assert.ok(Array.isArray(voc.j.details) && voc.j.details.length > 0, 'the store details are passed on');
  assert.ok(ordnerLeer(s.speicher));
});

test('only the owner imports; a foreign Host and a wrong content type are refused', async (t) => {
  const s = await stapel(t);
  sichere(s.speicher);
  const bytes = fs.readFileSync(datei(s.speicher), 'utf8');
  s.speicher.loesche('rb338', 'acid-one');
  s.stand.quelle = 'cypher';
  const a = await s.post(bytes);
  assert.equal(a.code, 403); assert.equal(a.j.grund, 'nur_andreas');
  assert.ok(ordnerLeer(s.speicher));
  s.stand.quelle = 'andreas';
  const roh = await s.post('id=1', { 'content-type': 'text/plain' });
  assert.equal(roh.code, 415); assert.equal(roh.j.fehler, 'nur_json');
  // a request that names another host (DNS rebinding) is refused before the body is read
  const fremd = await new Promise((ok, nein) => {
    const q = http.request({ host: '127.0.0.1', port: s.port, path: '/presets/import', method: 'POST', headers: { host: `evil.example:${s.port}`, 'content-type': 'application/json' } },
      (r) => { let t2 = ''; r.on('data', (c) => { t2 += c; }); r.on('end', () => ok({ code: r.statusCode, j: JSON.parse(t2) })); });
    q.on('error', nein); q.end(bytes);
  });
  assert.equal(fremd.code, 421); assert.equal(fremd.j.grund, 'falscher_host');
  assert.ok(ordnerLeer(s.speicher));
  // the paired tablet's listener is closed for the route by the deny list
  assert.equal(tabletVerboten('POST', '/presets/import'), true);
});

test('import ignores autor, takes valid timestamps, stamps a file without them', async (t) => {
  const s = await stapel(t);
  sichere(s.speicher);
  const gut = JSON.parse(fs.readFileSync(datei(s.speicher), 'utf8'));
  s.speicher.loesche('rb338', 'acid-one');
  const a = await s.post(JSON.stringify({ ...gut, autor: 'cypher', extra: 'ignored' }));
  assert.equal(a.code, 200);
  const gespeichert = JSON.parse(fs.readFileSync(datei(s.speicher), 'utf8'));
  assert.equal(gespeichert.autor, undefined); assert.equal(gespeichert.extra, undefined);
  assert.equal(gespeichert.angelegt, gut.angelegt); assert.equal(gespeichert.geaendert, gut.geaendert);
  s.speicher.loesche('rb338', 'acid-one');
  const ohne = { ...gut }; delete ohne.angelegt; delete ohne.geaendert;
  const b = await s.post(JSON.stringify(ohne));
  assert.equal(b.code, 200);
  const g2 = JSON.parse(fs.readFileSync(datei(s.speicher), 'utf8'));
  assert.equal(g2.angelegt, g2.geaendert); assert.match(g2.angelegt, /^\d{4}-\d{2}-\d{2}T/);
});

test('an imported preset is listed, applies, and a factory slug collision stays a user preset', async (t) => {
  const s = await stapel(t);
  const werk = s.speicher.liste({ herkunft: 'werk', geraet: 'rb338' })[0];
  sichere(s.speicher, werk.name);   // a user preset carrying the name (and so the slug) of a factory preset
  const bytes = fs.readFileSync(s.speicher.pfad('nutzer', 'rb338', werk.slug));
  s.speicher.loesche('rb338', werk.slug);
  const werkBytes = fs.readFileSync(s.speicher.pfad('werk', 'rb338', werk.slug));
  const a = await s.post(bytes.toString('utf8'));
  assert.deepEqual(a.j, { ok: true, id: `nutzer:rb338/${werk.slug}`, schon_da: false });
  assert.ok(fs.readFileSync(s.speicher.pfad('werk', 'rb338', werk.slug)).equals(werkBytes));
  const liste = await (await s.hole('/presets?geraet=rb338')).json();
  assert.ok(JSON.stringify(liste).includes(`"slug":"${werk.slug}"`));
  const p0 = neuesProjekt('x');
  const r1 = fuehreListeAus(p0, [{ befehl: 'spur_neu', art: 'instrument', name: 'T', geraet: { art: 'intern', name: 'rb338', parameter: {} } }]);
  const spur = r1.projekt.spuren[0];
  const lies = s.speicher.lies('nutzer', 'rb338', werk.slug);
  const plan = planeAnwendung({ id: `nutzer:rb338/${werk.slug}`, name: lies.name, geraet: lies.geraet, werte: lies.werte }, { art: 'spur', spur_id: spur.id }, r1.projekt);
  assert.equal(plan.weg, 'proj'); assert.ok(plan.befehle.length > 0);
});
