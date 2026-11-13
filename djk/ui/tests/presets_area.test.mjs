// Presets (package 1.16): the HTTP routes under /presets, mounted on the real Router with the same dispatch as server.ts
// (anfrageInnen: router.finde, fremdePost check for POST, then the handler). server.ts itself is not touched by this package.
// One test runs the prefix check against a deliberately broken prefix rule and requires it to fail there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { presetsBereich, istPresetPfad, beschreibungsFilter } from '../presets/area.ts';
import { liesRegister, schreibeRegister, bauen } from '../presets/register.ts';
import { PresetSpeicher } from '../presets/store.ts';

const FIX = path.join(import.meta.dirname, 'fixtures', 'presets');
const ACID = { art: 'bass', unterart: 'acid', charakter: ['dirty', 'aggressive'], genre: ['acid', 'techno'], einsatz: ['drop'], energie: 4, text: 'Squelchy acid line for the tests.' };
const SAETT = { art: 'saturation', unterart: 'tape', charakter: ['warm'], genre: [], einsatz: ['mixdown'], energie: 2, text: 'Warm tape drive for the tests.' };
const KOMP_B = { art: 'compressor', unterart: 'peak', charakter: ['clean'], genre: [], einsatz: ['mixdown'], energie: 2, text: 'Peak control for the tests.' };

async function stapel(t, quelle = 'andreas', extra = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-h-'));
  const werk = path.join(d, 'werk'), nutzer = path.join(d, 'nutzer');
  fs.mkdirSync(path.join(werk, 'komp'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'gueltig.json'), path.join(werk, 'komp', 'test-glue.preset.json'));
  const log = [];
  const router = new Router();
  const b = presetsBereich({ log: (z) => log.push(z), quelle: () => quelle }, { werk, nutzer, ...extra });
  router.melde(b);
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
  return { url: `http://127.0.0.1:${port}`, log, werk, nutzer, router, d };
}
async function hole(basis, p) { const r = await fetch(basis + p); return { code: r.status, j: await r.json() }; }
async function post(basis, p, daten, kopf = {}) {
  const r = await fetch(basis + p, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: typeof daten === 'string' ? daten : JSON.stringify(daten) });
  return { code: r.status, j: await r.json() };
}

test('routes: one Bereich named presets, one route under its own prefix, POST protected', async (t) => {
  const s = await stapel(t);
  assert.deepEqual(s.router.liste(), [{ bereich: 'presets', methode: '*', pfad: '(muster)', schutz: 'fremdePost' }]);
  assert.equal(s.router.finde('GET', '/proj/presets'), null);
  assert.equal(s.router.finde('GET', '/presetsx'), null);
  pruefePrefix(istPresetPfad);
});

// The prefix rule as one function, so the same assertions can run against a broken rule below
function pruefePrefix(regel) {
  for (const p of ['/presets', '/presets/', '/presets/geraete', '/presets/werk/komp/x', '/presets/suche']) assert.equal(regel(p), true, p);
  for (const p of ['/presetsx', '/presets.json', '/proj/presets', '/proj/x/presets', '/', '/preset', '/lernen/presets']) assert.equal(regel(p), false, p);
}

test('the prefix test fails on a rule that only checks the start of the path (deliberately broken implementation)', () => {
  assert.throws(() => pruefePrefix((p) => p.startsWith('/presets')), assert.AssertionError);
  assert.throws(() => pruefePrefix((p) => p.includes('/presets')), assert.AssertionError);
});

test('save, list, search, read, overwrite, rename, delete over HTTP', async (t) => {
  const s = await stapel(t);
  const neu = await post(s.url, '/presets', { name: 'Acid One', geraet: 'rb338', werte: { cutoff: 700, wellenform: true }, beschreibung: ACID, tags: ['acid'] });
  assert.equal(neu.code, 201);
  assert.deepEqual({ ...neu.j, geaendert: typeof neu.j.geaendert }, { herkunft: 'nutzer', geraet: 'rb338', slug: 'acid-one', geaendert: 'string' });
  assert.deepEqual((await hole(s.url, '/presets')).j.map((e) => `${e.herkunft}:${e.slug}`), ['nutzer:acid-one', 'werk:test-glue']);
  assert.deepEqual((await hole(s.url, '/presets?q=acid')).j.map((e) => e.slug), ['acid-one']);
  assert.deepEqual((await hole(s.url, '/presets?tag=test')).j.map((e) => e.slug), ['test-glue']);
  assert.deepEqual((await hole(s.url, '/presets?geraet_typ=instrument')).j.map((e) => e.slug), ['acid-one']);
  const einer = await hole(s.url, '/presets/nutzer/rb338/acid-one');
  assert.equal(einer.code, 200); assert.deepEqual(einer.j.werte, { cutoff: 700, wellenform: true }); assert.equal(einer.j.herkunft, 'nutzer');
  assert.deepEqual(einer.j.beschreibung, ACID);
  assert.equal((await post(s.url, '/presets', { name: 'acid one', geraet: 'rb338', werte: { cutoff: 100 }, beschreibung: ACID })).j.fehler, 'name_vergeben');
  const ueber = await post(s.url, '/presets', { name: 'Acid One', geraet: 'rb338', werte: { cutoff: 900 }, beschreibung: ACID, ueberschreiben: true, erwartet: neu.j.geaendert });
  assert.equal(ueber.code, 200);
  const veraltet = await post(s.url, '/presets', { name: 'Acid One', geraet: 'rb338', werte: { cutoff: 50 }, beschreibung: ACID, ueberschreiben: true, erwartet: neu.j.geaendert });
  assert.deepEqual([veraltet.code, veraltet.j.fehler], [409, 'veraltet']);
  assert.deepEqual((await post(s.url, '/presets/nutzer/rb338/acid-one/umbenennen', { name: 'Acid Two' })).j, { ok: true, herkunft: 'nutzer', geraet: 'rb338', slug: 'acid-two' });
  assert.equal((await hole(s.url, '/presets/nutzer/rb338/acid-one')).code, 404);
  assert.deepEqual((await hole(s.url, '/presets/nutzer/rb338/acid-two')).j.werte, { cutoff: 900 });
  assert.deepEqual(await post(s.url, '/presets/nutzer/rb338/acid-two/loeschen', {}), { code: 200, j: { ok: true } });
  assert.equal((await hole(s.url, '/presets/nutzer/rb338/acid-two')).code, 404);
  assert.deepEqual(s.log.map((z) => z.typ), ['preset_gespeichert', 'preset_gespeichert', 'preset_umbenannt', 'preset_geloescht']);
});

test('device catalogue for the page', async (t) => {
  const s = await stapel(t);
  const g = (await hole(s.url, '/presets/geraete')).j;
  assert.deepEqual(g.map((x) => x.id), ['eq', 'komp', 'hall', 'saett', 'rb338', 'baukasten', 'gate', 'utility', 'multiband', 'kanal-limiter']);
  assert.deepEqual(g.find((x) => x.id === 'komp').parameter[0], { name: 'thresh', titel: 'Threshold', def: { art: 'zahl', min: -60, max: 0, einheit: 'dB' } });
});

test('failures: factory read-only, bad input, traversal, foreign origin, wrong content type, bad JSON', async (t) => {
  const s = await stapel(t);
  for (const was of ['umbenennen', 'loeschen']) {
    const r = await post(s.url, `/presets/werk/komp/test-glue/${was}`, { name: 'X' });
    assert.deepEqual([r.code, r.j.fehler], [403, 'werk_schreibgeschuetzt'], was);
  }
  assert.ok(fs.existsSync(path.join(s.werk, 'komp', 'test-glue.preset.json')));
  const r1 = await post(s.url, '/presets', { name: 'X', geraet: 'komp', werte: { thresh: 99 }, beschreibung: KOMP_B });
  assert.deepEqual([r1.code, r1.j.fehler], [400, 'wert_ungueltig']); assert.match(r1.j.text, /Threshold \(thresh\) must be a number from -60 to 0/);
  assert.equal((await post(s.url, '/presets', { name: '', geraet: 'komp', werte: { thresh: 0 }, beschreibung: KOMP_B })).j.fehler, 'name_ungueltig');
  // encoded slashes and dots reach the handler as one path part and fail the name checks
  for (const p of ['/presets/nutzer/komp/..%2F..%2Fx', '/presets/nutzer/..%2Fkomp/x', '/presets/..%2Fnutzer/komp/x', '/presets/nutzer/komp/%E0%A4%A', '/presets/nutzer/komp/x%00']) {
    const r = await hole(s.url, p);
    assert.equal(r.code, 400, p); assert.match(r.j.fehler, /^(slug|geraet|herkunft)_ungueltig$|^geraet_unbekannt$/, p);
  }
  // dot segments (also %2e%2e) are resolved by the URL parser before routing; sent raw they end outside /presets or on no preset route
  for (const p of ['/presets/nutzer/komp/../../../etc/passwd', '/presets/nutzer/komp/%2e%2e/%2e%2e/x', '/presets/%2e%2e/komp/x']) {
    const r = await new Promise((ok, nein) => http.get(s.url + p, (a) => { let b = ''; a.on('data', (x) => { b += x; }); a.on('end', () => ok({ code: a.statusCode, j: JSON.parse(b) })); }).on('error', nein));
    assert.equal(r.code, 404, p); assert.match(r.j.fehler, /^(keine_route|nicht_gefunden)$/, p);
  }
  assert.equal((await hole(s.url, '/presets/nutzer/komp')).code, 404);
  assert.deepEqual((await post(s.url, '/presets/nutzer/komp/test-glue', {})).code, 405);
  const fremd = await post(s.url, '/presets', { name: 'X', geraet: 'komp', werte: { thresh: 0 } }, { origin: 'http://evil.example' });
  assert.deepEqual([fremd.code, fremd.j.fehler], [403, 'fremde_herkunft']);
  const text = await fetch(s.url + '/presets', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(text.status, 415);
  assert.deepEqual(await post(s.url, '/presets', '{nein'), { code: 400, j: { fehler: 'koerper_ungueltig', text: 'the request body must be a JSON object' } });
  assert.deepEqual(fs.existsSync(s.nutzer) ? fs.readdirSync(s.nutzer) : [], [], 'nothing written by any refused request');
});

test('a corrupt file answers 409 json_kaputt and stays in the list', async (t) => {
  const s = await stapel(t);
  fs.mkdirSync(path.join(s.nutzer, 'komp'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'kaputt.json'), path.join(s.nutzer, 'komp', 'kaputt.preset.json'));
  fs.copyFileSync(path.join(FIX, 'schema2.json'), path.join(s.nutzer, 'komp', 'zukunft.preset.json'));
  assert.deepEqual((await hole(s.url, '/presets/nutzer/komp/kaputt')).j.fehler, 'json_kaputt');
  const z = await hole(s.url, '/presets/nutzer/komp/zukunft');
  assert.deepEqual([z.code, z.j.fehler], [409, 'schema_unbekannt']);
  assert.deepEqual((await hole(s.url, '/presets?herkunft=nutzer')).j.map((e) => `${e.slug}:${e.fehler}`), ['kaputt:json_kaputt', 'zukunft:schema_unbekannt']);
});

test('concurrent saves of the same new name over HTTP: one 201, the rest 409 name_vergeben', async (t) => {
  const s = await stapel(t);
  const r = await Promise.all([1, 2, 3, 4, 5].map((i) => post(s.url, '/presets', { name: 'Same', geraet: 'saett', werte: { drive: i }, beschreibung: SAETT })));
  assert.deepEqual(r.map((x) => x.code).sort(), [201, 409, 409, 409, 409]);
  assert.deepEqual(fs.readdirSync(path.join(s.nutzer, 'saett')), ['same.preset.json']);
});

test('save refuses a missing or invalid description with every error and the allowed words; nothing written', async (t) => {
  const s = await stapel(t);
  const ohne = await post(s.url, '/presets', { name: 'X', geraet: 'saett', werte: { drive: 3 } });
  assert.deepEqual([ohne.code, ohne.j.fehler, ohne.j.details[0].feld], [400, 'beschreibung_ungueltig', 'beschreibung']);
  const r = await post(s.url, '/presets', { name: 'X', geraet: 'saett', werte: { drive: 3 }, beschreibung: { ...SAETT, art: 'bass', charakter: ['fat'], energie: 9 } });
  assert.deepEqual([r.code, r.j.fehler], [400, 'beschreibung_ungueltig']);
  assert.deepEqual(r.j.details.map((d) => `${d.feld}:${d.code}`), ['unterart:unbekanntes_wort', 'charakter:unbekanntes_wort', 'energie:bereich']);
  assert.ok(r.j.details[1].erlaubt.includes('warm'));
  assert.deepEqual(r.j.details[2].erlaubt, ['1..5']);
  assert.match(r.j.text, /allowed: /);
  const fam = await post(s.url, '/presets', { name: 'X', geraet: 'saett', werte: { drive: 3 }, beschreibung: ACID });
  assert.deepEqual(fam.j.details.map((d) => `${d.feld}:${d.code}`), ['art:familie']);
  assert.ok(!fs.existsSync(path.join(s.nutzer, 'saett', 'x.preset.json')));
});

test('list filters by description over the query string; invented words are refused, not ignored', async (t) => {
  const s = await stapel(t);
  await post(s.url, '/presets', { name: 'Acid One', geraet: 'rb338', werte: { cutoff: 700 }, beschreibung: ACID });
  await post(s.url, '/presets', { name: 'Tape', geraet: 'saett', werte: { drive: 6 }, beschreibung: SAETT });
  const slugs = async (q) => { const r = await hole(s.url, `/presets?${q}`); assert.equal(r.code, 200, `${q}: ${JSON.stringify(r.j)}`); return r.j.map((e) => e.slug); };
  assert.deepEqual(await slugs('art=bass'), ['acid-one']);
  assert.deepEqual(await slugs('art=bass,saturation'), ['acid-one', 'tape']);
  assert.deepEqual(await slugs('familie=effekt'), ['tape', 'test-glue']);
  assert.deepEqual(await slugs('charakter=dirty,aggressive'), ['acid-one']);
  assert.deepEqual(await slugs('charakter=dirty,warm'), []);
  assert.deepEqual(await slugs('genre=house,techno'), ['acid-one']);
  assert.deepEqual(await slugs('einsatz=mixdown'), ['tape', 'test-glue']);
  assert.deepEqual(await slugs('energie=4'), ['acid-one']);
  assert.deepEqual(await slugs('energie=-2'), ['tape', 'test-glue']);
  assert.deepEqual(await slugs('energie=3-5&herkunft=nutzer'), ['acid-one']);
  assert.deepEqual(await slugs('art=saturation&q=tape'), ['tape']);
  const e = (await hole(s.url, '/presets?geraet=rb338')).j[0];
  assert.deepEqual([e.familie, e.beschreibung.unterart], ['instrument', 'acid']);
  for (const [q, feld] of [['charakter=fat', 'charakter'], ['art=synth', 'art'], ['energie=9', 'energie'], ['energie=a-b', 'energie'], ['familie=synth', 'familie'], ['genre=', null]]) {
    const r = await hole(s.url, `/presets?${q}`);
    if (feld === null) { assert.equal(r.code, 200, q); continue; }
    assert.deepEqual([r.code, r.j.fehler, r.j.details[0].feld], [400, 'anfrage_ungueltig', feld], q);
  }
  assert.ok((await hole(s.url, '/presets?charakter=fat')).j.details[0].erlaubt.includes('thick'));
});

test('query string parsing of the description filter', () => {
  const f = (q) => beschreibungsFilter(new URLSearchParams(q));
  assert.deepEqual(f('art=bass, pad&charakter=warm&energie=2-4'), { art: ['bass', 'pad'], charakter: ['warm'], energie: { min: 2, max: 4 } });
  assert.deepEqual(f('energie=3'), { energie: 3 });
  assert.deepEqual(f('energie=2-'), { energie: { min: 2 } });
  assert.deepEqual(f('energie=-'), { energie: '-' });
  assert.deepEqual(f('q=x&tag=y'), {});
});

test('vocabulary, register, register query and tool schema over HTTP', async (t) => {
  const s = await stapel(t);
  await post(s.url, '/presets', { name: 'Acid One', geraet: 'rb338', werte: { cutoff: 700 }, beschreibung: ACID });
  const v = (await hole(s.url, '/presets/vokabular')).j;
  assert.equal(v.version, 2); assert.ok(v.inhalt.charakter.includes('warm')); assert.deepEqual(v.anzahl.charakter, [1, 6]);
  const reg = (await hole(s.url, '/presets/register')).j;
  assert.deepEqual(reg.register.eintraege.map((e) => e.id), ['nutzer:rb338/acid-one', 'werk:komp/test-glue']);
  assert.deepEqual([reg.ungueltig, reg.doppelt], [[], []]);
  const a = await post(s.url, '/presets/suche', { charakter: ['dirty'], text: 'squelchy' });
  assert.deepEqual([a.code, a.j.gesamt, a.j.treffer[0].id], [200, 1, 'nutzer:rb338/acid-one']);
  const b = await post(s.url, '/presets/suche', { charakter: ['fat'], quelle: ['werk'] });
  assert.deepEqual([b.code, b.j.fehler, b.j.details.map((d) => `${d.feld}:${d.code}`)], [400, 'anfrage_ungueltig', ['quelle:unbekanntes_feld', 'charakter:unbekanntes_wort']]);
  assert.equal((await post(s.url, '/presets/suche', '[1]')).code, 400);
  const fremd = await post(s.url, '/presets/suche', {}, { origin: 'http://evil.example' });
  assert.equal(fremd.code, 403);
  const schema = (await hole(s.url, '/presets/suche/schema')).j;
  assert.equal(schema.name, 'presets_suchen'); assert.equal(schema.input_schema.additionalProperties, false);
});

test('drift of the committed factory register over HTTP', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-reg-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const datei = path.join(d, 'register.json');
  const s = await stapel(t, 'andreas', { register: datei });
  schreibeRegister(datei, bauen(new PresetSpeicher({ werk: s.werk, nutzer: s.nutzer }), ['werk']).register);
  assert.equal((await hole(s.url, '/presets/register/pruefen')).j.sauber, true);
  await post(s.url, '/presets', { name: 'Mine', geraet: 'saett', werte: { drive: 1 }, beschreibung: SAETT });
  assert.equal((await hole(s.url, '/presets/register/pruefen')).j.sauber, true, 'user presets are not part of the factory register');
  fs.rmSync(path.join(s.werk, 'komp', 'test-glue.preset.json'));
  const r = (await hole(s.url, '/presets/register/pruefen')).j;
  assert.deepEqual([r.sauber, r.fehlend], [false, ['werk:komp/test-glue']]);
  assert.equal(liesRegister(datei).eintraege.length, 1, 'checking never rewrites the register');
});

// ---------- package 1.16 rest, U1 T1.4: Cypher's preset rights over HTTP (AK-B16-1) ----------
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const KOMP_W = { thresh: -10, ratio: 2 };
// Two stacks over the same folders: Andreas' and Cypher's (the stub ctx fixes the source per stack; a header is ignored there)
async function zwei(t) {
  const an = await stapel(t, 'andreas');
  const cy = await stapel(t, 'cypher', { werk: an.werk, nutzer: an.nutzer });
  return { an, cy };
}

test('rights: Cypher overwriting, renaming or deleting an unmarked preset gets 403 nur_andreas_preset, file bytes unchanged', async (t) => {
  const { an, cy } = await zwei(t);
  assert.equal((await post(an.url, '/presets', { name: 'His Glue', geraet: 'komp', werte: KOMP_W, beschreibung: KOMP_B })).code, 201);
  const f = path.join(an.nutzer, 'komp', 'his-glue.preset.json'), vorher = sha(f);
  const r1 = await post(cy.url, '/presets', { name: 'His Glue', geraet: 'komp', werte: { thresh: -1 }, beschreibung: KOMP_B, ueberschreiben: true });
  const r2 = await post(cy.url, '/presets/nutzer/komp/his-glue/umbenennen', { name: 'Mine Now' });
  const r3 = await post(cy.url, '/presets/nutzer/komp/his-glue/loeschen', {});
  for (const r of [r1, r2, r3]) assert.deepEqual([r.code, r.j.fehler], [403, 'nur_andreas_preset']);
  assert.equal(sha(f), vorher);
  assert.equal(fs.existsSync(path.join(an.nutzer, 'komp', 'mine-now.preset.json')), false);
});

test('rights: a damaged unmarked file (bad JSON, word outside the vocabulary) is refused for Cypher on all three operations, untouched, no trash', async (t) => {
  const { an, cy } = await zwei(t);
  fs.mkdirSync(path.join(an.nutzer, 'komp'), { recursive: true });
  const kaputt = path.join(an.nutzer, 'komp', 'kaputt.preset.json'), wort = path.join(an.nutzer, 'komp', 'wort.preset.json');
  fs.copyFileSync(path.join(FIX, 'kaputt.json'), kaputt);
  const j = JSON.parse(fs.readFileSync(path.join(FIX, 'gueltig.json'), 'utf8'));
  fs.writeFileSync(wort, JSON.stringify({ ...j, name: 'Wort', beschreibung: { ...j.beschreibung, charakter: ['erfunden'] } }));
  const vorher = [sha(kaputt), sha(wort)];
  for (const [slug, name] of [['kaputt', 'Kaputt'], ['wort', 'Wort']]) {
    const r1 = await post(cy.url, '/presets', { name, geraet: 'komp', werte: KOMP_W, beschreibung: KOMP_B, ueberschreiben: true });
    const r3 = await post(cy.url, `/presets/nutzer/komp/${slug}/loeschen`, {});
    for (const r of [r1, r3]) assert.deepEqual([r.code, r.j.fehler], [403, 'nur_andreas_preset'], slug);
    const r2 = await post(cy.url, `/presets/nutzer/komp/${slug}/umbenennen`, { name: 'Neu' });
    assert.ok(r2.code === 403 || r2.code === 409, `rename of a damaged file is refused (${r2.code} ${r2.j.fehler})`);
  }
  assert.deepEqual([sha(kaputt), sha(wort)], vorher);
  assert.equal(fs.existsSync(path.join(an.nutzer, '.papierkorb')), false);
  // negative control: Andreas replaces one damaged file and deletes the other
  assert.equal((await post(an.url, '/presets', { name: 'Kaputt', geraet: 'komp', werte: KOMP_W, beschreibung: KOMP_B, ueberschreiben: true })).code, 200);
  assert.equal((await post(an.url, '/presets/nutzer/komp/wort/loeschen', {})).code, 200);
  assert.equal(fs.existsSync(wort), false);
});

test('rights: negative controls — Cypher overwrites, renames and deletes her own; Andreas overwrites hers and the mark goes', async (t) => {
  const { an, cy } = await zwei(t);
  assert.equal((await post(cy.url, '/presets', { name: 'Her Glue', geraet: 'komp', werte: KOMP_W, beschreibung: KOMP_B })).code, 201);
  const f = path.join(an.nutzer, 'komp', 'her-glue.preset.json');
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).autor, 'cypher');
  assert.equal((await post(cy.url, '/presets', { name: 'Her Glue', geraet: 'komp', werte: { thresh: -3 }, beschreibung: KOMP_B, ueberschreiben: true })).code, 200);
  assert.equal((await post(cy.url, '/presets/nutzer/komp/her-glue/umbenennen', { name: 'Her Glue 2' })).code, 200);
  assert.equal((await hole(an.url, '/presets')).j.find((e) => e.slug === 'her-glue-2').autor, 'cypher', 'the list carries the mark');
  assert.equal((await post(an.url, '/presets', { name: 'Her Glue 2', geraet: 'komp', werte: { thresh: -4 }, beschreibung: KOMP_B, ueberschreiben: true })).code, 200);
  assert.equal('autor' in JSON.parse(fs.readFileSync(path.join(an.nutzer, 'komp', 'her-glue-2.preset.json'), 'utf8')), false);
  assert.equal((await post(cy.url, '/presets/nutzer/komp/her-glue-2/loeschen', {})).code, 403, 'now Andreas\' preset');
  assert.equal((await post(cy.url, '/presets', { name: 'Gone', geraet: 'komp', werte: KOMP_W, beschreibung: KOMP_B })).code, 201);
  assert.equal((await post(cy.url, '/presets/nutzer/komp/gone/loeschen', {})).code, 200);
});

test('save over HTTP carries graph for baukasten', async (t) => {
  const s = await stapel(t);
  const PAD = { art: 'pad', unterart: 'analog', charakter: ['warm'], genre: [], einsatz: ['intro'], energie: 1, text: 'Pad over HTTP.' };
  const ohne = await post(s.url, '/presets', { name: 'Pad', geraet: 'baukasten', werte: { knob1: 0.2 }, beschreibung: PAD });
  assert.deepEqual([ohne.code, ohne.j.fehler], [400, 'graph_fehlt']);
  assert.equal((await post(s.url, '/presets', { name: 'Pad', geraet: 'baukasten', graph: 'pad', werte: { knob1: 0.2 }, beschreibung: PAD })).code, 201);
  assert.equal((await hole(s.url, '/presets/nutzer/baukasten/pad')).j.graph, 'pad');
});
