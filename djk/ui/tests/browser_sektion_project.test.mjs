// THIS PROJECT rows (browser plan 2, task 3): the pure row builder over GET /proj/dateien and the first clip of a file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { projektZeilen, ersterClip } from '../public/browser/sektion_project.js';

const leer = () => ({ audio: [], midi: [], takes: [], exporte: [], stems: [], bounces: [], resamples: [], instrumente: [], kits: [], presets: [], fehlend: [] });

test('projektZeilen: order of spec B3, missing and recovered marks', () => {
  const d = leer();
  d.audio = [{ sha256: 'a'.repeat(64), name: 'Kick.wav', pfad: '/x/Kick.wav', clips: 2, fehlt: false }, { sha256: 'b'.repeat(64), name: 'Snare ä.wav', pfad: '', clips: 1, fehlt: true }];
  d.midi = [{ clip_id: 'c1', spur_id: 's1', name: 'Bass line' }];
  d.takes = [{ datei: 'take-1.wav', spur_id: 's2', gerettet: true }];
  d.exporte = [{ datei: 'mix.wav', zeit: '2026-11-23T10:00:00.000Z' }];
  d.kits = ['808']; d.presets = ['warm pad'];
  const z = projektZeilen(d);
  assert.deepEqual(z.map((x) => x.art), ['audio', 'audio', 'midi', 'take', 'export', 'kit', 'preset']);
  assert.equal(z[0].fehlt, undefined);
  assert.equal(z[1].fehlt, true);
  assert.equal(z[1].sha256, 'b'.repeat(64));
  assert.equal(z[1].text, 'Snare ä.wav');
  assert.equal(z[2].clip_id, 'c1');
  assert.equal(z[3].gerettet, true);
  assert.equal(z[3].spur_id, 's2');
  assert.equal(z[4].datei, 'mix.wav');
});

test('projektZeilen: an empty view gives no rows; every kind has its place in the order', () => {
  assert.deepEqual(projektZeilen(leer()), []);
  const d = leer();
  d.instrumente = [{ spur_id: 's1', spur_name: 'Lead', geraet: 'surge' }];
  d.resamples = [{ datei: 'r.wav', zeit: 'z' }]; d.bounces = [{ datei: 'b.wav', zeit: 'z' }]; d.stems = [{ datei: 's.wav', zeit: 'z' }];
  assert.deepEqual(projektZeilen(d).map((x) => x.art), ['stem', 'bounce', 'resample', 'instrument']);
  assert.deepEqual(projektZeilen(null), []);
});

test('ersterClip: the first audio clip that names the sha, else null', () => {
  const p = { spuren: [{ id: 's1', clips: [{ id: 'm', art: 'midi' }, { id: 'c1', art: 'audio', quelle: { sha256: 'x' } }] }, { id: 's2', clips: [{ id: 'c2', art: 'audio', quelle: { sha256: 'y' } }] }] };
  assert.equal(ersterClip(p, 'y'), 'c2');
  assert.equal(ersterClip(p, 'x'), 'c1');
  assert.equal(ersterClip(p, 'z'), null);
  assert.equal(ersterClip(null, 'x'), null);
});

// ---- task 7: actions ----
import { aufraeumenText, findeFehlende, sammleAlles, raeumeAuf, platziere, exportiere, fuehreAus, relinkeDatei, NICHT_DA_TITEL } from '../public/browser/sektion_project.js';

const aktHost = (antworten = {}) => {
  const g = { posts: [], gets: [], meldungen: [], gewaehlt: [] };
  g.holeJson = async (url, body) => { g.posts.push([url, body]); const a = antworten[url]; return typeof a === 'function' ? a(body) : a ?? { status: 200, j: { ok: true } }; };
  g.holeGet = async (url) => { g.gets.push(url); return antworten[url] ?? { status: 200, j: {} }; };
  g.melde = (t, f) => g.meldungen.push([t, f === true]);
  g.waehleClip = async (id) => { g.gewaehlt.push(id); return true; };
  return g;
};
const SHA = 'c'.repeat(64);

test('aufraeumenText: nothing gives no question; two files name the count, the bin and the kept exports', () => {
  assert.equal(aufraeumenText({ dateien: [] }).leer, true);
  const t = aufraeumenText({ dateien: ['audio/a-aaaaaaaa.wav', 'aufnahmen/take-2-1.wav'] });
  assert.equal(t.leer, false);
  assert.match(t.frage, /2 files/);
  assert.match(t.frage, /\.papierkorb/);
  assert.match(t.frage, /exports are kept/);
  assert.match(t.frage, /undo/);
  assert.match(t.frage, /audio\/a-aaaaaaaa\.wav\naufnahmen\/take-2-1\.wav/);
  const viele = aufraeumenText({ dateien: Array.from({ length: 25 }, (_, i) => `audio/f${i}.wav`) }).frage;
  assert.match(viele, /f19\.wav/);
  assert.doesNotMatch(viele, /f20\.wav/);
  assert.match(viele, /and 5 more/);
});

test('EXPORT PROJECT: a present route starts a download of the real URL (nothing is fetched as a blob), a refusal of the probe shows its text', async () => {
  const h = aktHost();
  const aufrufe = [], starts = [];
  const fetchFn = async (url) => { aufrufe.push(url); return { status: 409, json: async () => ({ grund: 'projekt_nicht_offen' }) }; };
  const r = await exportiere(h, 'beat 1', { fetchFn, starte: (url) => starts.push(url) });
  assert.equal(r.status, 'ok');
  assert.deepEqual(aufrufe, ['/proj/export_zip?slug=']);   // the probe has no slug: the route answers at once, no zip is built
  assert.deepEqual(starts, ['/proj/export_zip?slug=beat%201']);
  const nein = await exportiere(aktHost(), 'beat', { fetchFn: async () => ({ status: 403, json: async () => ({ text: 'only the owner may export' }) }), starte: () => assert.fail('no download') });
  assert.deepEqual([nein.status, nein.text], ['fehler', 'only the owner may export']);
});

test('FIND: known file links, unknown asks for a file, catalogue missing is an error with its text, 404 is not available', async () => {
  let h = aktHost({ '/proj/finden': { status: 200, j: { ok: true, pfad: '/x/a.wav' } } });
  assert.equal((await findeFehlende(h, SHA)).status, 'verknuepft');
  assert.deepEqual(h.posts[0], ['/proj/finden', { sha256: SHA }]);
  h = aktHost({ '/proj/finden': { status: 200, j: { ok: false, grund: 'nicht_gefunden', text: 'not found' } } });
  assert.equal((await findeFehlende(h, SHA)).status, 'frage_datei');
  h = aktHost({ '/proj/finden': { status: 503, j: { ok: false, grund: 'katalog_fehlt', text: 'There is no library catalogue yet' } } });
  assert.deepEqual(await findeFehlende(h, SHA), { status: 'fehler', text: 'There is no library catalogue yet' });
  h = aktHost({ '/proj/finden': { status: 404, j: null } });
  assert.equal((await findeFehlende(h, SHA)).status, 'nicht_da');
});

test('CLEAN UP posts nur_zeigen first and the real call only after a yes; nothing to clean up asks nothing', async () => {
  const tragen = { '/proj/aufraeumen': (b) => ({ status: 200, j: b.nur_zeigen ? { dateien: ['audio/a-aaaaaaaa.wav', 'x'], verschoben: false } : { dateien: ['audio/a-aaaaaaaa.wav', 'x'], verschoben: true } }) };
  let h = aktHost(tragen), frage = '';
  assert.equal((await raeumeAuf(h, (t) => { frage = t; return false; })).status, 'abgelehnt');
  assert.deepEqual(h.posts, [['/proj/aufraeumen', { nur_zeigen: true }]]);
  assert.match(frage, /2 files/);
  h = aktHost(tragen);
  const r = await raeumeAuf(h, () => true);
  assert.equal(r.status, 'ok');
  assert.deepEqual(h.posts, [['/proj/aufraeumen', { nur_zeigen: true }], ['/proj/aufraeumen', {}]]);
  h = aktHost({ '/proj/aufraeumen': { status: 200, j: { dateien: [], verschoben: false } } });
  let gefragt = false;
  const leer = await raeumeAuf(h, () => { gefragt = true; return true; });
  assert.equal(gefragt, false);
  assert.equal(leer.status, 'leer');
  assert.equal(leer.text, 'Nothing to clean up.');
  assert.equal(h.posts.length, 1);
});

test('COLLECT ALL: a 409 transport_laeuft goes to host.melde with its text', async () => {
  const h = aktHost({ '/proj/einsammeln': { status: 409, j: { fehler: 'transport_laeuft', text: 'music is playing: collecting starts when it stops' } } });
  const r = await sammleAlles(h);
  assert.equal(r.status, 'fehler');
  assert.deepEqual(h.meldungen, [['music is playing: collecting starts when it stops', true]]);
  const ok = aktHost({ '/proj/einsammeln': { status: 200, j: { kopiert: 3, schon_da: 1, fehlt: [], abweichend: [], bytes: 10, aufgeschoben: 0 } } });
  assert.equal((await sammleAlles(ok)).status, 'ok');
  assert.match(ok.meldungen[0][0], /3 files copied/);
});

test('PLACE posts the file and selects the new clip', async () => {
  const h = aktHost({ '/proj/gerettet_platzieren': { status: 200, j: { ok: true, clip_id: 'k9' } } });
  assert.equal((await platziere(h, 'take-1-gerettet.wav')).status, 'ok');
  assert.deepEqual(h.posts, [['/proj/gerettet_platzieren', { datei: 'take-1-gerettet.wav' }]]);
  assert.deepEqual(h.gewaehlt, ['k9']);
});

test('every action with a 404 route is not available, throws nothing and names no error', async () => {
  const h = aktHost({ '/proj/finden': { status: 404 }, '/proj/aufraeumen': { status: 404 }, '/proj/einsammeln': { status: 404 }, '/proj/gerettet_platzieren': { status: 404 }, '/proj/relink': { status: 404 } });
  assert.equal((await findeFehlende(h, SHA)).status, 'nicht_da');
  assert.equal((await raeumeAuf(h, () => true)).status, 'nicht_da');
  assert.equal((await sammleAlles(h)).status, 'nicht_da');
  assert.equal((await platziere(h, 'x.wav')).status, 'nicht_da');
  assert.equal((await relinkeDatei(h, SHA, '/x/a.wav')).status, 'nicht_da');
  assert.deepEqual(h.meldungen, []);
  const fetchFn = async () => ({ status: 404, ok: false, json: async () => null });
  assert.equal((await exportiere(h, 'beat', { fetchFn, starte: () => assert.fail('no download') })).status, 'nicht_da');
});

test('fuehreAus: the key is disabled while it runs, re-enabled in finally, and stays off with the title on nicht_da', async () => {
  const taste = { disabled: false, title: 'orig' };
  let waehrend = null;
  await fuehreAus(taste, async () => { waehrend = taste.disabled; return { status: 'ok' }; });
  assert.equal(waehrend, true);
  assert.equal(taste.disabled, false);
  await fuehreAus(taste, async () => { throw new Error('boom'); }).catch(() => {});
  assert.equal(taste.disabled, false);
  await fuehreAus(taste, async () => ({ status: 'nicht_da' }));
  assert.equal(taste.disabled, true);
  assert.equal(taste.title, NICHT_DA_TITEL);
  assert.equal(NICHT_DA_TITEL, 'Not available in this build yet');
});

test('RELINK of a chosen file: a hash that differs is refused with the page text, the right one relinks and reopens the project', async () => {
  const route = { url: '/import/datei?name=a.wav&ziel=bibliothek', art: 'audio', headers: {} };
  const datei = { name: 'a.wav', size: 3 };
  let h = aktHost({ '/proj/relink': { status: 200, j: { ok: true } } });
  h.projekt = () => ({ slug: 'beat', projekt: {} });
  h.oeffne = async (s) => { h.geoeffnet = s; return { ok: true }; };
  const sende = async () => assert.fail('a file with another hash must not be uploaded');
  const falsch = await relinkeDatei(h, SHA, datei, { sende, route, hash: async () => 'd'.repeat(64) });
  assert.equal(falsch.status, 'fehler');
  assert.match(falsch.text, /not the one the project uses; it was not copied/);
  assert.deepEqual(h.posts, []);
  const gross = await relinkeDatei(h, SHA, { name: 'b.wav', size: 2 ** 31 }, { sende, route, hash: async () => assert.fail('too large to hash') });
  assert.match(gross.text, /too large to check/);
  const richtig = await relinkeDatei(h, SHA, datei, { hash: async () => SHA, sende: async () => ({ status: 200, j: { ok: true, pfad: '/importe/a.wav', sha256: SHA } }), route });
  assert.equal(richtig.status, 'ok');
  assert.deepEqual(h.posts, [['/proj/relink', { sha256: SHA, pfad: '/importe/a.wav' }]]);
  assert.equal(h.geoeffnet, 'beat');
});
